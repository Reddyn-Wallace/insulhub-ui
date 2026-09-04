import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sanitizeAuditMetadata } from "./audit";
import type { PartnerSql } from "./db";
import { decryptLegacyCredential, encryptLegacyCredential, legacyAdapterConfiguration, legacyGraphqlRequestInit, replaceLegacyCredential, validateLegacyEndpoint } from "./legacy-credentials";

const keyring = { activeVersion: 7, keys: new Map([[7, randomBytes(32)]]) };
const binding = { companyId: "company-a", endpoint: "https://legacy.example.test/graphql" };
const internal = { userId: "ops", principalType: "INTERNAL" as const, companyId: null };

describe("legacy credential boundary", () => {
  it("round-trips authenticated encryption without plaintext serialization", () => {
    const encrypted = encryptLegacyCredential({ accessToken: "super-secret-token" }, binding, keyring);
    expect(encrypted.keyVersion).toBe(7);
    expect(encrypted.ciphertext.toString("utf8")).not.toContain("super-secret-token");
    expect(JSON.stringify(encrypted)).not.toContain("super-secret-token");
    expect(decryptLegacyCredential(encrypted, binding, keyring)).toEqual({ accessToken: "super-secret-token" });
    const tampered = { ...encrypted, ciphertext: Buffer.from(encrypted.ciphertext) };
    tampered.ciphertext[0] ^= 1;
    expect(() => decryptLegacyCredential(tampered, binding, keyring)).toThrow();
    expect(() => decryptLegacyCredential(encrypted, { ...binding, companyId: "company-b" }, keyring)).toThrow();
    expect(() => decryptLegacyCredential(encrypted, { ...binding, endpoint: "https://other.example.test/graphql" }, keyring)).toThrow();
  });

  it("allows only explicit HTTPS origins and the fixed GraphQL path", () => {
    expect(validateLegacyEndpoint("https://legacy.example.test/graphql", ["https://legacy.example.test"]).toString()).toBe("https://legacy.example.test/graphql");
    for (const url of ["http://legacy.example.test/graphql", "https://evil.test/graphql", "https://legacy.example.test/admin", "https://user:pass@legacy.example.test/graphql", "https://legacy.example.test/graphql?next=http://evil.test"]) {
      expect(() => validateLegacyEndpoint(url, ["https://legacy.example.test"])).toThrow("not permitted");
    }
  });

  it("keeps create/replace write-only and emits only redacted audit metadata", async () => {
    let values: readonly unknown[] = [];
    let statement = "";
    const sql = { query: async (text: string, input: readonly unknown[] = []) => { statement = text; values = input; return { rows: [{ id: "audit" }], rowCount: 1 }; } };
    const result = await replaceLegacyCredential(sql as unknown as PartnerSql, { companyId: "company", actor: internal, baseUrl: "https://legacy.example.test/graphql", credential: { accessToken: "never-return-me" } }, { allowedOrigins: ["https://legacy.example.test"], keyring });
    expect(result).toEqual({ configured: true, keyVersion: 7 });
    expect(JSON.stringify(values)).not.toContain("never-return-me");
    expect(JSON.stringify(values)).not.toContain("accessToken");
    expect(statement).toContain("principal_type = 'INTERNAL'");
    expect(statement).toContain("disabled_at IS NULL");
    expect(sanitizeAuditMetadata({ password: "x", token: "y", keyVersion: 7, reason: "rotate" })).toEqual({ keyVersion: 7, reason: "rotate" });
  });

  it("requires an internal principal at the credential replacement boundary", async () => {
    let called = false;
    const sql = { query: async () => { called = true; return { rows: [], rowCount: 0 }; } };
    const forgedPartner = { userId: "partner", principalType: "PARTNER" as const, companyId: "company" };
    await expect(replaceLegacyCredential(sql as unknown as PartnerSql, {
      companyId: "company",
      actor: forgedPartner as never,
      baseUrl: "https://legacy.example.test/graphql",
      credential: { accessToken: "secret" },
    }, { allowedOrigins: ["https://legacy.example.test"], keyring })).rejects.toThrow("Internal operator authorization required");
    expect(called).toBe(false);
  });

  it("remains functional without invented local credentials", async () => {
    const sql = { query: async () => ({ rows: [{ legacy_base_url: null, legacy_credential_ciphertext: null, legacy_credential_nonce: null, legacy_credential_key_version: null }], rowCount: 1 }) };
    await expect(legacyAdapterConfiguration(sql as unknown as PartnerSql, "company", { allowedOrigins: ["https://legacy.example.test"], keyring })).resolves.toEqual({ mode: "unconfigured" });
  });

  it("forbids redirects in the server adapter request policy", () => {
    const init = legacyGraphqlRequestInit({ accessToken: "server-only" }, { query: "query Test { ok }" });
    expect(init.redirect).toBe("error");
    expect(init.method).toBe("POST");
  });
});
