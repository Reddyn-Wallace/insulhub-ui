import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createPartnerAuth, disablePartnerUserInTransaction } from "./auth";
import { createPartnerTestDatabase } from "./test-db";

const baseURL = "https://portal.example.test";
const secret = "test-only-auth-secret-that-is-at-least-32-characters";

type Fixture = Awaited<ReturnType<typeof authFixture>>;

async function authFixture() {
  const { Pool } = createPartnerTestDatabase();
  const pool = new Pool();
  const companyId = (await pool.query("INSERT INTO partner_companies (slug, name, billing_model) VALUES ('pilot', 'Pilot', 'INSULHUB_BILLED') RETURNING id")).rows[0].id;
  const password = "correct horse battery staple";
  const passwordHash = await hashPassword(password);
  for (const user of [
    { id: "partner-user", companyId, type: "PARTNER", email: "partner@example.test" },
    { id: "disabled-user", companyId, type: "PARTNER", email: "disabled@example.test", disabled: true },
    { id: "internal-user", companyId: null, type: "INTERNAL", email: "ops@example.test" },
    { id: "disabled-internal", companyId: null, type: "INTERNAL", email: "disabled-ops@example.test", disabled: true },
  ]) {
    await pool.query(
      `INSERT INTO partner_users (id, company_id, principal_type, name, email, disabled_at, ops_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.id, user.companyId, user.type, user.email, user.email, user.disabled ? new Date() : null, user.type === "INTERNAL" ? "ADMIN" : null],
    );
    await pool.query(
      `INSERT INTO partner_accounts (id, account_id, provider_id, user_id, password)
       VALUES ($1, $2, 'credential', $2, $3)`,
      [randomUUID(), user.id, passwordHash],
    );
  }
  const auth = createPartnerAuth({ database: pool as never, baseURL, secret });
  return { auth, pool, companyId, password };
}

function authRequest(path: string, body: unknown, surface: "partner" | "ops" = "partner", cookie?: string) {
  const headers = new Headers({
    "content-type": "application/json",
    origin: baseURL,
    "x-partner-auth-surface": surface,
    "x-forwarded-for": "192.0.2.10",
  });
  if (cookie) headers.set("cookie", cookie);
  return new Request(`${baseURL}/api/partner/auth${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function sessionCookie(response: Response): string {
  const value = response.headers.get("set-cookie");
  if (!value) throw new Error("Expected session cookie");
  return value.split(";")[0];
}

describe("Better Auth partner lifecycle", () => {
  let fixture: Fixture;
  beforeEach(async () => { fixture = await authFixture(); });

  it("creates a fresh opaque session, does not fixate, and revokes it on logout", async () => {
    const attackerCookie = "insulhub_partner.session_token=attacker-selected-value";
    const login = await fixture.auth.handler(authRequest("/sign-in/email", { email: "partner@example.test", password: fixture.password }, "partner", attackerCookie));
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    expect(login.headers.get("set-cookie")?.toLowerCase()).toContain("samesite=lax");
    const cookie = sessionCookie(login);
    expect(cookie).not.toContain("attacker-selected-value");
    const firstToken = (await fixture.pool.query("SELECT token FROM partner_sessions WHERE user_id = 'partner-user'")).rows[0].token;
    expect(firstToken).not.toBe("attacker-selected-value");

    const secondLogin = await fixture.auth.handler(authRequest("/sign-in/email", { email: "partner@example.test", password: fixture.password }, "partner"));
    expect(secondLogin.status).toBe(200);
    const tokens = (await fixture.pool.query("SELECT token FROM partner_sessions WHERE user_id = 'partner-user'")).rows.map((row: { token: string }) => row.token);
    expect(new Set(tokens).size).toBe(2);

    const logout = await fixture.auth.handler(authRequest("/sign-out", {}, "partner", cookie));
    expect(logout.status).toBe(200);
    expect((await fixture.pool.query("SELECT 1 FROM partner_sessions WHERE token = $1", [firstToken])).rowCount).toBe(0);
  });

  it("blocks disabled users and revocation invalidates existing sessions", async () => {
    const disabled = await fixture.auth.handler(authRequest("/sign-in/email", { email: "disabled@example.test", password: fixture.password }));
    expect(disabled.status).toBeGreaterThanOrEqual(400);

    const login = await fixture.auth.handler(authRequest("/sign-in/email", { email: "partner@example.test", password: fixture.password }));
    expect(login.status).toBe(200);
    await fixture.pool.query("UPDATE partner_users SET disabled_at = now() WHERE id = 'partner-user'");
    await fixture.pool.query("DELETE FROM partner_sessions WHERE user_id = 'partner-user'");
    expect((await fixture.pool.query("SELECT 1 FROM partner_sessions WHERE user_id = 'partner-user'")).rowCount).toBe(0);
    const again = await fixture.auth.handler(authRequest("/sign-in/email", { email: "partner@example.test", password: fixture.password }));
    expect(again.status).toBeGreaterThanOrEqual(400);
  });

  it("disables an account, revokes sessions, and appends redacted audits", async () => {
    const login = await fixture.auth.handler(authRequest("/sign-in/email", { email: "partner@example.test", password: fixture.password }));
    expect(login.status).toBe(200);
    await disablePartnerUserInTransaction(fixture.pool as never, {
      actor: { userId: "internal-user", companyId: null, principalType: "INTERNAL" },
      subjectUserId: "partner-user",
      reason: "pilot access removed",
    });
    expect((await fixture.pool.query("SELECT 1 FROM partner_sessions WHERE user_id = 'partner-user'")).rowCount).toBe(0);
    const audits = await fixture.pool.query("SELECT event_type, metadata FROM partner_audit_events WHERE subject_user_id = 'partner-user' ORDER BY occurred_at");
    expect(audits.rows.map((row: { event_type: string }) => row.event_type).sort()).toEqual(["SESSIONS_REVOKED", "USER_DISABLED"]);
    expect(JSON.stringify(audits.rows)).not.toMatch(/password|token|cookie|credential/i);
  });

  it("fails closed when a forged partner principal tries to disable a user", async () => {
    const login = await fixture.auth.handler(authRequest("/sign-in/email", { email: "partner@example.test", password: fixture.password }));
    expect(login.status).toBe(200);
    await expect(disablePartnerUserInTransaction(fixture.pool as never, {
      actor: { userId: "partner-user", companyId: fixture.companyId, principalType: "PARTNER" } as never,
      subjectUserId: "partner-user",
      reason: "forged request",
    })).rejects.toThrow("Internal authorization required");
    expect((await fixture.pool.query("SELECT disabled_at FROM partner_users WHERE id = 'partner-user'")).rows[0].disabled_at).toBeNull();
    expect((await fixture.pool.query("SELECT 1 FROM partner_sessions WHERE user_id = 'partner-user'")).rowCount).toBe(1);
    expect((await fixture.pool.query("SELECT 1 FROM partner_audit_events WHERE subject_user_id = 'partner-user'")).rowCount).toBe(0);
  });

  it("fails closed when the internal actor is disabled inside the mutation", async () => {
    const login = await fixture.auth.handler(authRequest("/sign-in/email", { email: "partner@example.test", password: fixture.password }));
    expect(login.status).toBe(200);
    await expect(disablePartnerUserInTransaction(fixture.pool as never, {
      actor: { userId: "disabled-internal", companyId: null, principalType: "INTERNAL" },
      subjectUserId: "partner-user",
      reason: "invalid actor",
    })).rejects.toThrow("Unable to disable partner user");
    expect((await fixture.pool.query("SELECT disabled_at FROM partner_users WHERE id = 'partner-user'")).rows[0].disabled_at).toBeNull();
    expect((await fixture.pool.query("SELECT 1 FROM partner_sessions WHERE user_id = 'partner-user'")).rowCount).toBe(1);
    expect((await fixture.pool.query("SELECT 1 FROM partner_audit_events WHERE subject_user_id = 'partner-user'")).rowCount).toBe(0);
  });

  it("enforces separate partner and internal login surfaces", async () => {
    const partnerIntoOps = await fixture.auth.handler(authRequest("/sign-in/email", { email: "partner@example.test", password: fixture.password }, "ops"));
    const opsIntoPartner = await fixture.auth.handler(authRequest("/sign-in/email", { email: "ops@example.test", password: fixture.password }, "partner"));
    expect(partnerIntoOps.status).toBeGreaterThanOrEqual(400);
    expect(opsIntoPartner.status).toBeGreaterThanOrEqual(400);
    expect((await fixture.pool.query("SELECT 1 FROM partner_sessions WHERE user_id IN ('partner-user', 'internal-user')")).rowCount).toBe(0);
    const ops = await fixture.auth.handler(authRequest("/sign-in/email", { email: "ops@example.test", password: fixture.password }, "ops"));
    expect(ops.status).toBe(200);
  });

  it("rate limits repeated login failures in database storage", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 7; index += 1) {
      const response = await fixture.auth.handler(authRequest("/sign-in/email", { email: "missing@example.test", password: "incorrect-password" }));
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
    expect((await fixture.pool.query("SELECT count FROM partner_auth_rate_limits")).rowCount).toBeGreaterThan(0);
  });
});
