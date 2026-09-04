import "server-only";
import { partnerDemoModeEnabled } from "../demo";
import { legacyAllowedOrigins, validateLegacyEndpoint } from "../legacy-credentials";
import { BoundLegacyCredential, readBoundLegacyCredential } from "./claimed-credential";
import { approvedLiveContract, contractSupportsSafeSubmission, FICTIONAL_LEGACY_CONTRACT } from "./contract";
import { createFictionalLegacyAdapter, FictionalLegacyWorld, type FictionalLegacyAdapterController } from "./fake";
import { createApprovedGraphqlLegacyAdapter } from "./graphql-adapter";
import { sameLegacyIdentity, type LegacyAdapter, type LegacyAdapterIdentity, type LegacySafeCode } from "./types";

export type LegacyAdapterSelection = { kind: "AVAILABLE"; adapter: LegacyAdapter } | { kind: "UNAVAILABLE"; code: LegacySafeCode };

export class FictionalLegacyRegistry {
  private readonly adapters = new Map<string, FictionalLegacyAdapterController>();
  private readonly worlds = new Map<string, FictionalLegacyWorld>();
  get(identity: LegacyAdapterIdentity, env: NodeJS.ProcessEnv): FictionalLegacyAdapterController | null {
    const key = `${identity.companyId}:${identity.requestId}`;
    const current = this.adapters.get(key);
    if (current) return sameLegacyIdentity(current.identity, identity) ? current : null;
    const world = this.worlds.get(identity.companyId) ?? new FictionalLegacyWorld(); this.worlds.set(identity.companyId, world);
    const created = createFictionalLegacyAdapter(identity, env, world); if (!created) return null;
    this.adapters.set(key, created); return created;
  }
  clear(): void { this.adapters.clear(); this.worlds.clear(); }
  projection(){return{adapters:[...this.adapters.values()].map(adapter=>({identity:adapter.identity,callCounts:{...adapter.callCounts}})),jobs:[...this.worlds.values()].reduce((sum,world)=>sum+world.jobs.size,0)};}
}

type FictionalRuntime = NodeJS.Process & { __insulHubFictionalLegacyRegistry?: FictionalLegacyRegistry };
const fictionalRuntime = process as FictionalRuntime;
const processFictionalRegistry = fictionalRuntime.__insulHubFictionalLegacyRegistry ??= new FictionalLegacyRegistry();

export function resetProcessFictionalLegacyRegistry(): void { processFictionalRegistry.clear(); }
export function processFictionalLegacyProjection(){return processFictionalRegistry.projection();}

export function createLegacyAdapter(
  binding: BoundLegacyCredential,
  options: { env?: NodeJS.ProcessEnv; fictionalRegistry?: FictionalLegacyRegistry; allowedOrigins?: readonly string[] } = {},
): LegacyAdapterSelection {
  const env = options.env ?? process.env;
  const input = readBoundLegacyCredential(binding);
  if (!input) return { kind: "UNAVAILABLE", code: "LEGACY_UNAVAILABLE" };
  if (process.env.NODE_ENV === "production" && env !== process.env) return { kind: "UNAVAILABLE", code: "LEGACY_UNAVAILABLE" };
  let demo = false;
  try { demo = partnerDemoModeEnabled(env); } catch { return { kind: "UNAVAILABLE", code: "LEGACY_UNAVAILABLE" }; }
  if (demo) {
    if (input.identity.adapterMode !== "FICTIONAL" || input.identity.contractVersion !== FICTIONAL_LEGACY_CONTRACT.version
      || input.identity.baseUrl !== null || input.accessToken !== null || input.identity.credentialFingerprint !== null
      || input.identity.credentialKeyVersion !== null || input.identity.credentialUpdatedAt !== null) return { kind: "UNAVAILABLE", code: "LEGACY_CONTRACT_MISMATCH" };
    const adapter = (options.fictionalRegistry ?? processFictionalRegistry).get(input.identity, env);
    return adapter ? { kind: "AVAILABLE", adapter } : { kind: "UNAVAILABLE", code: "LEGACY_CONTRACT_MISMATCH" };
  }
  if (input.identity.adapterMode !== "LIVE") return { kind: "UNAVAILABLE", code: "LEGACY_UNAVAILABLE" };
  const contract = approvedLiveContract(input.identity.contractVersion);
  if (!contract || !contractSupportsSafeSubmission(contract) || !input.identity.baseUrl || !input.accessToken
    || !input.identity.credentialFingerprint || !input.identity.credentialKeyVersion || !input.identity.credentialUpdatedAt) return { kind: "UNAVAILABLE", code: "LEGACY_CONTRACT_MISMATCH" };
  try { validateLegacyEndpoint(input.identity.baseUrl, options.allowedOrigins ?? legacyAllowedOrigins(env)); } catch { return { kind: "UNAVAILABLE", code: "LEGACY_CONTRACT_MISMATCH" }; }
  const adapter = createApprovedGraphqlLegacyAdapter(binding);
  return adapter ? { kind: "AVAILABLE", adapter } : { kind: "UNAVAILABLE", code: "LEGACY_UNAVAILABLE" };
}
