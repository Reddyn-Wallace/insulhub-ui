import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { PartnerSql } from "./db";
import { sanitizeAuditMetadata } from "./audit";
import type { InternalPrincipal } from "./repository";

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ALLOWED_PATHS = new Set(["/graphql"]);

export interface LegacyCredential {
  readonly accessToken: string;
}

export interface EncryptedLegacyCredential {
  readonly ciphertext: Buffer;
  readonly nonce: Buffer;
  readonly keyVersion: number;
}

export interface LegacyCredentialBinding {
  readonly companyId: string;
  readonly endpoint: string;
}

function credentialAad(binding: LegacyCredentialBinding, keyVersion: number): Buffer {
  return Buffer.from(JSON.stringify({ context: "partner-legacy-credential", keyVersion, companyId: binding.companyId, endpoint: binding.endpoint }), "utf8");
}

export function readCredentialKeyring(env: NodeJS.ProcessEnv = process.env): { activeVersion: number; keys: Map<number, Buffer> } {
  const activeVersion = Number(env.PARTNER_CREDENTIAL_ACTIVE_KEY_VERSION);
  if (!Number.isInteger(activeVersion) || activeVersion <= 0) throw new Error("Partner credential active key version is not configured");

  let raw: unknown;
  try {
    raw = JSON.parse(env.PARTNER_CREDENTIAL_KEYS_JSON ?? "");
  } catch {
    throw new Error("Partner credential keyring is not configured");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Partner credential keyring is invalid");

  const keys = new Map<number, Buffer>();
  for (const [versionText, encoded] of Object.entries(raw)) {
    if (typeof encoded !== "string") continue;
    const version = Number(versionText);
    const key = Buffer.from(encoded, "base64");
    if (Number.isInteger(version) && version > 0 && key.length === 32) keys.set(version, key);
  }
  if (!keys.has(activeVersion)) throw new Error("Partner credential active key is missing or invalid");
  return { activeVersion, keys };
}

export function encryptLegacyCredential(
  credential: LegacyCredential,
  binding: LegacyCredentialBinding,
  keyring = readCredentialKeyring(),
): EncryptedLegacyCredential {
  if (!credential.accessToken) throw new Error("Legacy credential is required");
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyring.keys.get(keyring.activeVersion)!, nonce);
  cipher.setAAD(credentialAad(binding, keyring.activeVersion));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ accessToken: credential.accessToken }), "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { ciphertext, nonce, keyVersion: keyring.activeVersion };
}

export function decryptLegacyCredential(
  encrypted: EncryptedLegacyCredential,
  binding: LegacyCredentialBinding,
  keyring = readCredentialKeyring(),
): LegacyCredential {
  const key = keyring.keys.get(encrypted.keyVersion);
  if (!key) throw new Error("Legacy credential key version is unavailable");
  if (encrypted.nonce.length !== NONCE_BYTES || encrypted.ciphertext.length <= AUTH_TAG_BYTES) throw new Error("Legacy credential envelope is invalid");
  const body = encrypted.ciphertext.subarray(0, -AUTH_TAG_BYTES);
  const tag = encrypted.ciphertext.subarray(-AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, encrypted.nonce);
  decipher.setAAD(credentialAad(binding, encrypted.keyVersion));
  decipher.setAuthTag(tag);
  const parsed = JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || typeof (parsed as { accessToken?: unknown }).accessToken !== "string") {
    throw new Error("Legacy credential payload is invalid");
  }
  return { accessToken: (parsed as { accessToken: string }).accessToken };
}

export function validateLegacyEndpoint(rawUrl: string, allowedOrigins: readonly string[]): URL {
  const url = new URL(rawUrl);
  const allowed = new Set(allowedOrigins.map((value) => new URL(value).origin));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Legacy endpoint is not permitted");
  if (!allowed.has(url.origin) || !ALLOWED_PATHS.has(url.pathname)) throw new Error("Legacy endpoint is not permitted");
  return url;
}

export function legacyAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.PARTNER_LEGACY_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

export async function replaceLegacyCredential(
  sql: PartnerSql,
  input: { companyId: string; actor: InternalPrincipal; baseUrl: string; credential: LegacyCredential },
  options: { allowedOrigins?: readonly string[]; keyring?: ReturnType<typeof readCredentialKeyring> } = {},
): Promise<{ configured: true; keyVersion: number }> {
  if (input.actor.principalType !== "INTERNAL" || input.actor.companyId !== null) throw new Error("Internal operator authorization required");
  const endpoint = validateLegacyEndpoint(input.baseUrl, options.allowedOrigins ?? legacyAllowedOrigins());
  const encrypted = encryptLegacyCredential(input.credential, { companyId: input.companyId, endpoint: endpoint.toString() }, options.keyring);
  const result = await sql.query(
    `WITH authorized_actor AS (
       SELECT id FROM partner_users
       WHERE id = $6 AND principal_type = 'INTERNAL' AND company_id IS NULL AND disabled_at IS NULL
     ), changed AS (
       UPDATE partner_companies
       SET legacy_base_url = $1, legacy_credential_ciphertext = $2, legacy_credential_nonce = $3,
           legacy_credential_key_version = $4, legacy_credential_updated_at = now(), revision = revision + 1, updated_at = now()
       WHERE id = $5 AND EXISTS (SELECT 1 FROM authorized_actor)
       RETURNING id
     )
     INSERT INTO partner_audit_events (event_type, actor_user_id, company_id, metadata)
     SELECT 'LEGACY_CREDENTIAL_REPLACED', authorized_actor.id, changed.id, $7::jsonb
     FROM changed CROSS JOIN authorized_actor
     RETURNING id`,
    [endpoint.toString(), encrypted.ciphertext, encrypted.nonce, encrypted.keyVersion, input.companyId, input.actor.userId, JSON.stringify(sanitizeAuditMetadata({ keyVersion: encrypted.keyVersion }))],
  );
  if (result.rowCount !== 1) throw new Error("Internal operator authorization or partner company not found");
  return { configured: true, keyVersion: encrypted.keyVersion };
}

export async function legacyAdapterConfiguration(
  sql: PartnerSql,
  companyId: string,
  options: { allowedOrigins?: readonly string[]; keyring?: ReturnType<typeof readCredentialKeyring> } = {},
): Promise<{ mode: "unconfigured" } | { mode: "configured"; endpoint: URL; credential: LegacyCredential }> {
  const result = await sql.query<{
    legacy_base_url: string | null;
    legacy_credential_ciphertext: Buffer | null;
    legacy_credential_nonce: Buffer | null;
    legacy_credential_key_version: number | null;
  }>(`SELECT legacy_base_url, legacy_credential_ciphertext, legacy_credential_nonce, legacy_credential_key_version
      FROM partner_companies WHERE id = $1 AND is_active = true`, [companyId]);
  const row = result.rows[0];
  if (!row?.legacy_base_url || !row.legacy_credential_ciphertext || !row.legacy_credential_nonce || !row.legacy_credential_key_version) {
    return { mode: "unconfigured" };
  }
  return {
    mode: "configured",
    endpoint: validateLegacyEndpoint(row.legacy_base_url, options.allowedOrigins ?? legacyAllowedOrigins()),
    credential: decryptLegacyCredential({
      ciphertext: row.legacy_credential_ciphertext,
      nonce: row.legacy_credential_nonce,
      keyVersion: row.legacy_credential_key_version,
    }, { companyId, endpoint: validateLegacyEndpoint(row.legacy_base_url, options.allowedOrigins ?? legacyAllowedOrigins()).toString() }, options.keyring),
  };
}

export function legacyGraphqlRequestInit(credential: LegacyCredential, body: unknown): RequestInit {
  return {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json", "x-access-token": credential.accessToken },
    body: JSON.stringify(body),
  };
}
