import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
vi.mock("server-only", () => ({}));
import {
  financePool,
  saveTokens,
  withTokens,
  saveState,
  consumeState,
  pinTenant,
} from "./connection-store";
import { XERO_SCOPES } from "./xero-tokens";
const db = process.env.FINANCE_TEST_DATABASE_URL;
// Explicit test-only URL. Never default integration tests to application credentials.
describe.skipIf(!db)("disposable PostgreSQL integration", () => {
  beforeAll(async () => {
    if (!db || !db.includes("127.0.0.1"))
      throw Error(
        "Set FINANCE_TEST_DATABASE_URL to disposable localhost database",
      );
    vi.stubEnv("FINANCE_DATABASE_URL", db);
    vi.stubEnv(
      "FINANCE_ENCRYPTION_KEY",
      Buffer.alloc(32, 5).toString("base64"),
    );
    vi.stubEnv("XERO_CLIENT_ID", "client");
    vi.stubEnv("XERO_CLIENT_SECRET", "secret");
    await financePool().query(
      await readFile("scripts/finance-connections-schema.sql", "utf8"),
    );
  });
  afterAll(async () => {
    if (db) await financePool().end();
  });
  it("serialises refresh and persists rotation once across concurrent callers", async () => {
    await saveTokens("concurrent", {
      accessToken: "old",
      refreshToken: "old-refresh",
      expiresAt: 0,
    });
    let count = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        count++;
        await new Promise((r) => setTimeout(r, 60));
        return Response.json({
          access_token: "new",
          refresh_token: "new-refresh",
          expires_in: 1800,
          scope: XERO_SCOPES,
        });
      }),
    );
    const out = await Promise.all([
      withTokens("concurrent", async (t) => t.accessToken),
      withTokens("concurrent", async (t) => t.accessToken),
    ]);
    expect(out).toEqual(["new", "new"]);
    expect(count).toBe(1);
    const r = await financePool().query(
      "SELECT tokens,refresh_pending FROM finance_connections WHERE owner_id=$1",
      ["concurrent"],
    );
    expect(r.rows[0].tokens).not.toContain("new-refresh");
    expect(r.rows[0].refresh_pending).toBe(false);
  });
  it("persists uncertain refresh marker and refuses to retry a stale token", async () => {
    await saveTokens("uncertain", {
      accessToken: "old",
      refreshToken: "old-refresh",
      expiresAt: 0,
    });
    let count = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        count++;
        throw Error("provider timeout");
      }),
    );
    await expect(
      withTokens("uncertain", async (t) => t.accessToken),
    ).rejects.toThrow();
    await expect(
      withTokens("uncertain", async (t) => t.accessToken),
    ).rejects.toThrow("interrupted");
    expect(count).toBe(1);
  });
  it("consumes state once and refuses expired states", async () => {
    await saveState("state", "owner");
    expect(await consumeState("state")).toBe("owner");
    expect(await consumeState("state")).toBeNull();
    const expired = "expired-" + Date.now();
    await saveState(expired, "owner");
    await financePool().query(
      "UPDATE finance_oauth_states SET expires_at=now()-interval '1 minute'",
    );
    expect(await consumeState(expired)).toBeNull();
  });

  it("rejects a tenant selection validated before a concurrent reconnect", async () => {
    await saveTokens("generation", {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 300000,
    });
    const generation = await withTokens(
      "generation",
      async (t) => t.generation,
    );
    await saveTokens("generation", {
      accessToken: "b",
      refreshToken: "s",
      expiresAt: Date.now() + 300000,
    });
    await expect(
      pinTenant("generation", "tenant", "Insulmax", generation),
    ).rejects.toThrow("reconnected");
    const r = await financePool().query(
      "SELECT tenant_id FROM finance_connections WHERE owner_id=$1",
      ["generation"],
    );
    expect(r.rows[0].tenant_id).toBeNull();
  });
});
