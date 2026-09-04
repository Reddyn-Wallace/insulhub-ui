import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { decryptLegacyCredential, legacyAllowedOrigins, readCredentialKeyring, validateLegacyEndpoint } from "../legacy-credentials";
import type { LegacyAdapterIdentity } from "./types";

export interface ClaimedLegacyConfig {
  companyId: string;
  requestId: string;
  adapterMode: "FICTIONAL" | "LIVE";
  contractVersion: string;
  legacyJobPrefix: string;
  legacyBaseUrl: string | null;
  legacyCredentialCiphertext: Uint8Array | null;
  legacyCredentialNonce: Uint8Array | null;
  legacyCredentialKeyVersion: number | null;
  legacyCredentialFingerprint: string | null;
  legacyCredentialUpdatedAt: string | Date | null;
}

type BoundValue = Readonly<{ identity: LegacyAdapterIdentity; accessToken: string | null }>;
const boundValues = new WeakMap<BoundLegacyCredential, BoundValue>();

export class BoundLegacyCredential {
  private constructor(value: BoundValue) {
    boundValues.set(this, Object.freeze({ identity: Object.freeze({ ...value.identity }), accessToken: value.accessToken }));
    Object.freeze(this);
  }

  get identity(): LegacyAdapterIdentity {
    const value = boundValues.get(this);
    if (!value) throw new Error("Legacy credential binding is unavailable");
    return value.identity;
  }

  static bind(claim: ClaimedLegacyConfig, options: { env?: NodeJS.ProcessEnv; keyring?: ReturnType<typeof readCredentialKeyring> } = {}): BoundLegacyCredential | null {
    const env = options.env ?? process.env;
    let credentialUpdatedAt: string | null = null;
    if (claim.legacyCredentialUpdatedAt !== null) {
      const timestamp = new Date(claim.legacyCredentialUpdatedAt);
      if (!Number.isFinite(timestamp.getTime())) return null;
      credentialUpdatedAt = timestamp.toISOString();
    }
    const base = { companyId: claim.companyId, requestId: claim.requestId, adapterMode: claim.adapterMode, contractVersion: claim.contractVersion,
      legacyJobPrefix: claim.legacyJobPrefix, baseUrl: claim.legacyBaseUrl, credentialKeyVersion: claim.legacyCredentialKeyVersion,
      credentialFingerprint: claim.legacyCredentialFingerprint, credentialUpdatedAt } satisfies LegacyAdapterIdentity;
    if (claim.adapterMode === "FICTIONAL") {
      return claim.legacyBaseUrl === null && claim.legacyCredentialCiphertext === null && claim.legacyCredentialNonce === null
        && claim.legacyCredentialKeyVersion === null && claim.legacyCredentialFingerprint === null && claim.legacyCredentialUpdatedAt === null
        ? new BoundLegacyCredential({ identity: base, accessToken: null }) : null;
    }
    if (!claim.legacyBaseUrl || !claim.legacyCredentialCiphertext || !claim.legacyCredentialNonce || !claim.legacyCredentialKeyVersion
      || !claim.legacyCredentialFingerprint || !claim.legacyCredentialUpdatedAt) return null;
    let endpoint: URL; try { endpoint = validateLegacyEndpoint(claim.legacyBaseUrl, legacyAllowedOrigins(env)); } catch { return null; }
    const actual = createHash("sha256").update(claim.legacyCredentialCiphertext).update(claim.legacyCredentialNonce).digest();
    const expected = Buffer.from(claim.legacyCredentialFingerprint, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    try {
      const credential = decryptLegacyCredential({ ciphertext: Buffer.from(claim.legacyCredentialCiphertext), nonce: Buffer.from(claim.legacyCredentialNonce), keyVersion: claim.legacyCredentialKeyVersion },
        { companyId: claim.companyId, endpoint: endpoint.toString() }, options.keyring ?? readCredentialKeyring(env));
      return credential.accessToken && credential.accessToken.length <= 8_192 && !/[\u0000-\u001f\u007f-\u009f]/u.test(credential.accessToken)
        ? new BoundLegacyCredential({ identity: { ...base, baseUrl: endpoint.toString() }, accessToken: credential.accessToken }) : null;
    } catch { return null; }
  }
}

/** Server-only capability unwrap. A structural lookalike cannot pass the WeakMap brand check. */
export function readBoundLegacyCredential(binding: BoundLegacyCredential): BoundValue | null {
  return boundValues.get(binding) ?? null;
}
