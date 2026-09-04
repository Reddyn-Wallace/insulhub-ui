import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createPartnerAuth, getAuthenticatedPrincipalWith } from "./auth";
import { partnerLogin, partnerLogout, type PartnerAuthRouteDependencies, type PartnerSurface } from "./auth-route";
import { createPartnerTestDatabase } from "./test-db";

const baseURL = "https://portal.example.test";
const authSecret = "route-composition-test-secret-at-least-32-characters";
const password = "correct horse battery staple";

type RouteFixture = Awaited<ReturnType<typeof createRouteFixture>>;

async function createRouteFixture() {
  const { Pool } = createPartnerTestDatabase();
  const pool = new Pool();
  const companyId = (await pool.query("INSERT INTO partner_companies (slug, name, billing_model) VALUES ('pilot', 'Pilot', 'INSULHUB_BILLED') RETURNING id")).rows[0].id;
  const passwordHash = await hashPassword(password);
  for (const user of [
    { id: "partner-user", companyId, type: "PARTNER", email: "partner@example.test", disabled: false },
    { id: "disabled-user", companyId, type: "PARTNER", email: "disabled@example.test", disabled: true },
    { id: "internal-user", companyId: null, type: "INTERNAL", email: "ops@example.test", disabled: false },
  ]) {
    await pool.query(
      "INSERT INTO partner_users (id, company_id, principal_type, name, email, disabled_at, ops_role) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [user.id, user.companyId, user.type, user.email, user.email, user.disabled ? new Date() : null, user.type === "INTERNAL" ? "ADMIN" : null],
    );
    await pool.query(
      "INSERT INTO partner_accounts (id, account_id, provider_id, user_id, password) VALUES ($1, $2, 'credential', $2, $3)",
      [randomUUID(), user.id, passwordHash],
    );
  }
  const auth = createPartnerAuth({ database: pool as never, baseURL, secret: authSecret });
  const dependencies: PartnerAuthRouteDependencies = {
    auth,
    sql: pool,
    origins: new Set([baseURL]),
    getPrincipal: (headers) => getAuthenticatedPrincipalWith(auth, pool, headers),
  };
  return { auth, pool, companyId, dependencies };
}

function loginRequest(surface: PartnerSurface, email: string, suppliedPassword = password, origin = baseURL) {
  const route = surface === "ops" ? "partner-ops" : "partner";
  return new Request(`${baseURL}/api/${route}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, "x-forwarded-for": "192.0.2.50" },
    body: JSON.stringify({ email, password: suppliedPassword }),
  });
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Expected Set-Cookie");
  return setCookie.split(";")[0];
}

function cookieHeaders(cookie: string, origin = baseURL): Headers {
  return new Headers({ cookie, origin, "x-forwarded-for": "192.0.2.50" });
}

describe("exposed partner auth route composition", () => {
  let fixture: RouteFixture;
  beforeEach(async () => { fixture = await createRouteFixture(); });

  it("issues cookies and derives the correct partner and internal principals", async () => {
    const partner = await partnerLogin(loginRequest("partner", "partner@example.test"), "partner", fixture.dependencies);
    const internal = await partnerLogin(loginRequest("ops", "ops@example.test"), "ops", fixture.dependencies);
    expect(partner.status).toBe(200);
    expect(internal.status).toBe(200);
    expect(partner.headers.get("cache-control")).toBe("private, no-store");
    expect(internal.headers.get("cache-control")).toBe("private, no-store");
    expect(partner.headers.get("set-cookie")).toMatch(/HttpOnly.*SameSite=Lax/i);
    await expect(getAuthenticatedPrincipalWith(fixture.auth, fixture.pool, cookieHeaders(cookieFrom(partner)))).resolves.toEqual({ userId: "partner-user", companyId: fixture.companyId, principalType: "PARTNER" });
    await expect(getAuthenticatedPrincipalWith(fixture.auth, fixture.pool, cookieHeaders(cookieFrom(internal)))).resolves.toEqual({ userId: "internal-user", companyId: null, principalType: "INTERNAL" });
    expect((await fixture.pool.query("SELECT event_type FROM partner_audit_events WHERE event_type = 'LOGIN_SUCCEEDED'")).rowCount).toBe(2);
  });

  it("denies wrong surfaces generically without creating a session", async () => {
    const partnerAtOps = await partnerLogin(loginRequest("ops", "partner@example.test"), "ops", fixture.dependencies);
    const internalAtPartner = await partnerLogin(loginRequest("partner", "ops@example.test"), "partner", fixture.dependencies);
    expect(partnerAtOps.status).toBe(401);
    expect(partnerAtOps.headers.get("cache-control")).toBe("private, no-store");
    expect(await partnerAtOps.json()).toEqual({ error: "Email or password is incorrect" });
    expect(await internalAtPartner.json()).toEqual({ error: "Email or password is incorrect" });
    expect((await fixture.pool.query("SELECT 1 FROM partner_sessions")).rowCount).toBe(0);
  });

  it("keeps unknown and wrong-password failures identical, including disabled users", async () => {
    const responses = await Promise.all([
      partnerLogin(loginRequest("partner", "missing@example.test"), "partner", fixture.dependencies),
      partnerLogin(loginRequest("partner", "partner@example.test", "wrong password value"), "partner", fixture.dependencies),
      partnerLogin(loginRequest("partner", "disabled@example.test", "wrong password value"), "partner", fixture.dependencies),
    ]);
    const results = await Promise.all(responses.map(async (response) => ({ status: response.status, body: await response.json() })));
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(results[0]).toEqual({ status: 401, body: { error: "Email or password is incorrect" } });
    expect((await fixture.pool.query("SELECT event_type FROM partner_audit_events WHERE event_type = 'LOGIN_FAILED'")).rowCount).toBe(3);
  });

  it.each(["disabled user", "archived company"])("explains %s only after correct credentials without creating a session", async (kind) => {
    if (kind === "archived company") await fixture.pool.query("UPDATE partner_companies SET is_active = false WHERE id = $1", [fixture.companyId]);
    const email = kind === "disabled user" ? "disabled@example.test" : "partner@example.test";
    const wrong = await partnerLogin(loginRequest("partner", email, "wrong password value"), "partner", fixture.dependencies);
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "Email or password is incorrect" });
    const denied = await partnerLogin(loginRequest("partner", email), "partner", fixture.dependencies);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: "ACCOUNT_DISABLED", error: "Your account is disabled. Contact your administrator." });
    expect(denied.headers.get("set-cookie")).toBeNull();
    expect((await fixture.pool.query("SELECT 1 FROM partner_sessions")).rowCount).toBe(0);
    const wrongSurface = await partnerLogin(loginRequest("ops", email), "ops", fixture.dependencies);
    expect(wrongSurface.status).toBe(401);
    expect(await wrongSurface.json()).toEqual({ error: "Email or password is incorrect" });
  });

  it("rejects a non-exact Origin before authentication", async () => {
    const response = await partnerLogin(loginRequest("partner", "partner@example.test", password, "https://evil.example.test"), "partner", fixture.dependencies);
    expect(response.status).toBe(403);
    expect((await fixture.pool.query("SELECT 1 FROM partner_sessions")).rowCount).toBe(0);
  });

  it("returns the generic body with a 429 when the exposed login is rate limited", async () => {
    const statuses: number[] = [];
    let lastBody: unknown;
    for (let index = 0; index < 7; index += 1) {
      const response = await partnerLogin(loginRequest("partner", "absent@example.test"), "partner", fixture.dependencies);
      statuses.push(response.status);
      lastBody = await response.json();
    }
    expect(statuses).toContain(429);
    expect(lastBody).toEqual({ error: "Email or password is incorrect" });
  });

  it("denies partner cookies at ops and internal cookies at partner", async () => {
    const partner = await partnerLogin(loginRequest("partner", "partner@example.test"), "partner", fixture.dependencies);
    const internal = await partnerLogin(loginRequest("ops", "ops@example.test"), "ops", fixture.dependencies);
    const partnerAtOps = await partnerLogout(new Request(`${baseURL}/api/partner-ops/auth/logout`, { method: "POST", headers: cookieHeaders(cookieFrom(partner)) }), "ops", fixture.dependencies);
    const internalAtPartner = await partnerLogout(new Request(`${baseURL}/api/partner/auth/logout`, { method: "POST", headers: cookieHeaders(cookieFrom(internal)) }), "partner", fixture.dependencies);
    expect(partnerAtOps.status).toBe(401);
    expect(internalAtPartner.status).toBe(401);
  });

  it("copies the clearing cookie, revokes the DB session, and audits logout", async () => {
    const login = await partnerLogin(loginRequest("partner", "partner@example.test"), "partner", fixture.dependencies);
    const cookie = cookieFrom(login);
    expect((await fixture.pool.query("SELECT 1 FROM partner_sessions WHERE user_id = 'partner-user'")).rowCount).toBe(1);
    const logout = await partnerLogout(new Request(`${baseURL}/api/partner/auth/logout`, { method: "POST", headers: cookieHeaders(cookie) }), "partner", fixture.dependencies);
    expect(logout.status).toBe(200);
    expect(logout.headers.get("cache-control")).toBe("private, no-store");
    expect(logout.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expect((await fixture.pool.query("SELECT 1 FROM partner_sessions WHERE user_id = 'partner-user'")).rowCount).toBe(0);
    expect((await fixture.pool.query("SELECT 1 FROM partner_audit_events WHERE event_type = 'LOGOUT' AND actor_user_id = 'partner-user'")).rowCount).toBe(1);
  });

  it("does not claim success, clear cookies, revoke the DB session, or audit when upstream sign-out fails", async () => {
    const login = await partnerLogin(loginRequest("partner", "partner@example.test"), "partner", fixture.dependencies);
    const cookie = cookieFrom(login);
    const failingDependencies: PartnerAuthRouteDependencies = {
      ...fixture.dependencies,
      auth: { handler: async () => new Response(null, { status: 500 }) } as never,
    };
    const logout = await partnerLogout(
      new Request(`${baseURL}/api/partner/auth/logout`, { method: "POST", headers: cookieHeaders(cookie) }),
      "partner",
      failingDependencies,
    );
    expect(logout.status).toBe(503);
    expect(await logout.json()).toEqual({ error: "Unable to sign out" });
    expect(logout.headers.get("set-cookie")).toBeNull();
    expect((await fixture.pool.query("SELECT 1 FROM partner_sessions WHERE user_id = 'partner-user'")).rowCount).toBe(1);
    expect((await fixture.pool.query("SELECT 1 FROM partner_audit_events WHERE event_type = 'LOGOUT' AND actor_user_id = 'partner-user'")).rowCount).toBe(0);
  });

  it("rejects existing cookies after user disable or company deactivation", async () => {
    const first = await partnerLogin(loginRequest("partner", "partner@example.test"), "partner", fixture.dependencies);
    const firstCookie = cookieFrom(first);
    await fixture.pool.query("UPDATE partner_users SET disabled_at = now() WHERE id = 'partner-user'");
    await expect(getAuthenticatedPrincipalWith(fixture.auth, fixture.pool, cookieHeaders(firstCookie))).resolves.toBeNull();

    await fixture.pool.query("UPDATE partner_users SET disabled_at = NULL WHERE id = 'partner-user'");
    const second = await partnerLogin(loginRequest("partner", "partner@example.test"), "partner", fixture.dependencies);
    const secondCookie = cookieFrom(second);
    await fixture.pool.query("UPDATE partner_companies SET is_active = false WHERE id = $1", [fixture.companyId]);
    await expect(getAuthenticatedPrincipalWith(fixture.auth, fixture.pool, cookieHeaders(secondCookie))).resolves.toBeNull();
  });
});
