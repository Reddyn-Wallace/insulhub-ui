import { describe, expect, it } from "vitest";
import { sanitizeAuditMetadata, writePartnerAuditEvent } from "./audit";

describe("partner audit events", () => {
  it("records required events without sensitive payloads", async () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = [];
    const sql = { query: async (text: string, values: readonly unknown[] = []) => { calls.push({ text, values }); return { rows: [], rowCount: 1 }; } };
    for (const type of ["LOGIN_SUCCEEDED", "LOGIN_FAILED", "LOGOUT", "USER_PROVISIONED", "USER_DISABLED", "SESSIONS_REVOKED", "LEGACY_CREDENTIAL_REPLACED"] as const) {
      await writePartnerAuditEvent(sql, { type, metadata: { outcome: "ok", password: "no", token: "no", cookie: "no", reason: "test" } });
    }
    expect(calls).toHaveLength(7);
    expect(JSON.stringify(calls)).not.toContain('"password":"no"');
    expect(JSON.stringify(calls)).not.toContain('"token":"no"');
    expect(JSON.stringify(calls)).not.toContain('"cookie":"no"');
    expect(sanitizeAuditMetadata({ outcome: "ok", authorization: "Bearer secret" })).toEqual({ outcome: "ok" });
  });

  it("rejects oversized request IDs and metadata before writing", async () => {
    let called = false;
    const sql = { query: async () => { called = true; return { rows: [], rowCount: 1 }; } };
    await expect(writePartnerAuditEvent(sql as never, { type: "LOGIN_FAILED", requestId: "x".repeat(201) })).rejects.toThrow("request ID");
    await expect(writePartnerAuditEvent(sql as never, { type: "LOGIN_FAILED", metadata: { reason: "x".repeat(17_000) } })).rejects.toThrow("metadata");
    expect(called).toBe(false);
  });
});
