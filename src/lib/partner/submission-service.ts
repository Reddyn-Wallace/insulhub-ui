import "server-only";
import { createFictionalNotificationAdapter, productionNotificationAdapter } from "./legacy/notification";
import { FICTIONAL_LEGACY_CONTRACT } from "./legacy/contract";
import { INSULHUB_LIVE_CONTRACT } from "./legacy/insulhub-live";
import { partnerDemoModeEnabled } from "./demo";
import { PartnerSubmissionError, partnerSubmissionIdempotencyHash, type PartnerSubmissionPublicStatus } from "./submission";
import { buildAuthoritativePartnerSubmission, PartnerSubmissionRepository, partnerSubmissionScopeHash, type PartnerSubmissionPreflightRecord } from "./submission-repository";
import type { PartnerPrincipal } from "./repository";

export type PartnerSubmissionView = PartnerSubmissionPublicStatus | {
  state: "DRAFT" | "QUEUED" | "PROCESSING" | "FAILED_RETRYABLE" | "SUCCEEDED" | "RECONCILIATION_REQUIRED"; checkpoint: string; errorCode: null; createdAt: string; updatedAt: string; completedAt: string | null;
};

export type PartnerSubmissionResult =
  | { outcome: "accepted"; status: PartnerSubmissionPublicStatus; replayed: boolean; requestId: string }
  | { outcome: "not_found" }
  | { outcome: "unavailable" }
  | { outcome: "rate_limited" }
  | { outcome: "stale"; currentJobRevision: number; currentFloorPlanRevision: number }
  | { outcome: "not_ready"; code: "SUBMISSION_NOT_READY" | "SUBMISSION_PDF_MISSING" | "SUBMISSION_PDF_STALE" | "SUBMISSION_PDF_INTEGRITY_FAILED" }
  | { outcome: "conflict" }
  | { outcome: "ambiguous" };

export interface PartnerSubmissionServiceOptions { env?: NodeJS.ProcessEnv }

function preflightAvailable(config: PartnerSubmissionPreflightRecord, env: NodeJS.ProcessEnv): boolean {
  let demo = false;
  try { demo = partnerDemoModeEnabled(env); } catch { return false; }
  if (demo) return config.adapterMode === "FICTIONAL" && config.contractVersion === FICTIONAL_LEGACY_CONTRACT.version
    && Boolean(config.legacyJobPrefix) && createFictionalNotificationAdapter(env) !== null;
  // The connected mailbox is resolved during immediate processing. Its
  // availability must not be inferred from process-level configuration here.
  void productionNotificationAdapter;
  return env.PARTNER_REAL_POSTGRES_GATE_CONFIRMED === "REAL_POSTGRES_GATE_PASSED"
    && Boolean(env.PARTNER_SUBMISSION_DATABASE_URL) && Boolean(env.PARTNER_SUBMISSION_DATABASE_ROLE)
    && config.adapterMode === "LIVE" && config.contractVersion===INSULHUB_LIVE_CONTRACT
    && config.liveConfigurationComplete && Boolean(config.legacyJobPrefix);
}

function safeInputError(error: unknown): PartnerSubmissionResult | null {
  const code = error instanceof PartnerSubmissionError ? error.code : error instanceof Error ? error.message.match(/SUBMISSION_[A-Z_]+/)?.[0] : null;
  if (code === "SUBMISSION_IDEMPOTENCY_CONFLICT" || code === "SUBMISSION_NOT_DRAFT") return { outcome: "conflict" };
  if (code === "SUBMISSION_STALE") return { outcome: "conflict" };
  if (code === "SUBMISSION_PDF_MISSING" || code === "SUBMISSION_PDF_STALE" || code === "SUBMISSION_PDF_INTEGRITY_FAILED" || code === "SUBMISSION_PDF_SIZE_INVALID") {
    return { outcome: "not_ready", code: code === "SUBMISSION_PDF_SIZE_INVALID" ? "SUBMISSION_PDF_INTEGRITY_FAILED" : code };
  }
  if (code === "SUBMISSION_NOT_READY" || code === "SUBMISSION_PLAN_ORDER_INVALID" || code === "SUBMISSION_PLAN_SET_MISMATCH" || code === "SUBMISSION_INVALID_INPUT") return { outcome: "not_ready", code: "SUBMISSION_NOT_READY" };
  if (code === "SUBMISSION_CONTRACT_DISABLED" || code === "SUBMISSION_CONTRACT_MODE_FORBIDDEN") return { outcome: "unavailable" };
  return null;
}

export class PartnerSubmissionService {
  private readonly env: NodeJS.ProcessEnv;
  constructor(private readonly repository: PartnerSubmissionRepository, options: PartnerSubmissionServiceOptions = {}) { this.env = options.env ?? process.env; }

  async status(principal: PartnerPrincipal, jobId: string): Promise<PartnerSubmissionView | null> {
    const config = await this.repository.preflight(principal, jobId); if (!config) return null;
    const current = await this.repository.status(principal, jobId); if (current) return current;
    // A saga request is the only authority for saga delivery state. Older demo
    // fixtures can be non-DRAFT without one and must use the page's explicit
    // legacy read-only copy rather than a fabricated success/retry projection.
    if (config.state !== "DRAFT") return null;
    return { state: "DRAFT", checkpoint: config.checkpoint, errorCode: null, createdAt: config.createdAt, updatedAt: config.updatedAt, completedAt: null };
  }

  async statusAllowed(principal: PartnerPrincipal, clientIp: string): Promise<boolean> {
    const boundedIp = typeof clientIp === "string" && clientIp.length <= 128 && !/[\u0000-\u001f\u007f-\u009f]/u.test(clientIp) ? clientIp : "unknown";
    return this.repository.consumeStatusRateLimit(principal,
      partnerSubmissionScopeHash(`submission-status-user-v1|${principal.companyId}|${principal.userId}`),
      partnerSubmissionScopeHash(`submission-status-company-v1|${principal.companyId}`),
      partnerSubmissionScopeHash(`submission-status-ip-v1|${principal.companyId}|${boundedIp}`));
  }

  async submit(principal: PartnerPrincipal, jobId: string, input: { jobRevision: number; floorPlanRevision: number; idempotencyKey: string }, clientIp: string): Promise<PartnerSubmissionResult> {
    let idempotencyHash: string;
    try { idempotencyHash = partnerSubmissionIdempotencyHash(input.idempotencyKey); } catch { return { outcome: "not_ready", code: "SUBMISSION_NOT_READY" }; }
    // The raw key is never passed to storage, audit, errors or logs after this point.
    const config = await this.repository.preflight(principal, jobId);
    if (!config) return { outcome: "not_found" };
    if (config.state !== "DRAFT") {
      const current = await this.repository.status(principal, jobId);
      const requestId=await this.repository.requestId(principal,jobId);
      return current&&requestId ? { outcome: "accepted", status: current, replayed: true,requestId } : { outcome: "conflict" };
    }
    if (!preflightAvailable(config, this.env)) return { outcome: "unavailable" };
    if (config.jobRevision !== input.jobRevision || config.floorPlanRevision !== input.floorPlanRevision) {
      return { outcome: "stale", currentJobRevision: config.jobRevision, currentFloorPlanRevision: config.floorPlanRevision };
    }
    const boundedIp = typeof clientIp === "string" && clientIp.length <= 128 && !/[\u0000-\u001f\u007f-\u009f]/u.test(clientIp) ? clientIp : "unknown";
    const allowed = await this.repository.consumeRateLimit(principal,
      partnerSubmissionScopeHash(`submission-user-v1|${principal.companyId}|${principal.userId}`),
      partnerSubmissionScopeHash(`submission-company-v1|${principal.companyId}`),
      partnerSubmissionScopeHash(`submission-ip-v1|${principal.companyId}|${boundedIp}`));
    if (!allowed) return { outcome: "rate_limited" };

    try {
      const candidate = await this.repository.loadCandidate(principal, jobId, idempotencyHash);
      if (!candidate) return { outcome: "not_found" };
      if (candidate.jobRevision !== input.jobRevision || candidate.floorPlanRevision !== input.floorPlanRevision) {
        return { outcome: "stale", currentJobRevision: candidate.jobRevision, currentFloorPlanRevision: candidate.floorPlanRevision };
      }
      const secondConfig = await this.repository.preflight(principal, jobId);
      if (!secondConfig) return { outcome: "not_found" };
      if (!preflightAvailable(secondConfig, this.env) || secondConfig.adapterMode !== candidate.companyAdapterMode || secondConfig.contractVersion !== candidate.companyContractVersion || secondConfig.legacyJobPrefix !== candidate.companyLegacyJobPrefix) return { outcome: "unavailable" };
      const built = buildAuthoritativePartnerSubmission(candidate);
      const frozen = await this.repository.freeze(principal, candidate, built);
      return { outcome: "accepted", status: frozen.status, replayed: frozen.replayed,requestId:built.requestId };
    } catch (error) {
      const safe = safeInputError(error); if (safe?.outcome === "conflict" && error instanceof Error && error.message.includes("SUBMISSION_STALE")) {
        const latest = await this.repository.preflight(principal,jobId); if (latest) return { outcome:"stale",currentJobRevision:latest.jobRevision,currentFloorPlanRevision:latest.floorPlanRevision };
      }
      if(safe?.outcome==="conflict"){try{const current=await this.status(principal,jobId),requestId=await this.repository.requestId(principal,jobId);if(current&&current.state!=="DRAFT"&&requestId)return{outcome:"accepted",status:current as PartnerSubmissionPublicStatus,replayed:true,requestId};}catch{/* use bounded conflict below */}}
      if (safe) return safe;
      try { const current = await this.status(principal,jobId),requestId=await this.repository.requestId(principal,jobId); if (current && current.state !== "DRAFT"&&requestId) return { outcome:"accepted",status:current as PartnerSubmissionPublicStatus,replayed:true,requestId }; } catch { /* remain ambiguous */ }
      return { outcome: "ambiguous" };
    }
  }
}
