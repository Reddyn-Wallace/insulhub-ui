import "server-only";
import { createHash } from "node:crypto";
import { SITE_PLAN_TEMPLATE_VERSION } from "../../site-plan-drawings";
import type { QuoteDraft } from "../quote";
import { PARTNER_SITE_PLAN_RENDERER_VERSION, PARTNER_SITE_PLAN_TEMPLATE_SHA256 } from "../site-plan-hash";
import { partnerSubmissionRemoteFileName } from "../submission";

export type LegacySafeCode =
  | "LEGACY_UNAVAILABLE" | "LEGACY_INVALID_INPUT" | "LEGACY_NOT_FOUND" | "LEGACY_DUPLICATE_MARKER"
  | "LEGACY_ARCHIVED_MATCH" | "LEGACY_PAGINATION_INCOMPLETE" | "LEGACY_VERSION_CONFLICT"
  | "LEGACY_REMOTE_NO_EFFECT" | "LEGACY_RESPONSE_AMBIGUOUS" | "LEGACY_READBACK_MISMATCH"
  | "LEGACY_UPLOAD_INTEGRITY" | "LEGACY_CONTRACT_MISMATCH";

export type LegacyOutcome<T> =
  | { kind: "CONFIRMED"; value: T }
  | { kind: "DEFINITE_FAILURE"; code: LegacySafeCode; noEffect: true }
  | { kind: "AMBIGUOUS"; code: "LEGACY_RESPONSE_AMBIGUOUS" }
  | { kind: "CONFLICT"; code: LegacySafeCode; reconciliationRequired: true };

export interface LegacyAdapterIdentity {
  companyId: string;
  requestId: string;
  adapterMode: "FICTIONAL" | "LIVE";
  contractVersion: string;
  legacyJobPrefix: string;
  baseUrl: string | null;
  credentialKeyVersion: number | null;
  credentialFingerprint: string | null;
  credentialUpdatedAt: string | null;
}

export interface LegacyLeadInput {
  identity: LegacyAdapterIdentity;
  marker: string;
  canonicalCreateFingerprint: string;
  customer: { name: string; mobile: string; email: string };
  siteAddress: { street: string; suburb: string; city: string; postcode: string };
  /** Present only when replaying an immutable schema-v1 submission. */
  billingModel?: "INSULHUB_BILLED" | "PARTNER_BILLED";
  leadSources: readonly string[];
  notes: string;
}

export interface LegacyLeadRecord {
  id: string;
  jobNumber: number;
  version: string;
  marker: string;
  canonicalCreateFingerprint: string;
  archived: boolean;
}

export interface LegacyJobRecord extends LegacyLeadRecord {
  stage: string;
  status: string;
  quoteFingerprint: string | null;
  attachedPlans: readonly LegacyAttachedPlan[];
  preservation: Readonly<{ sitePlanNotes: string; wallInternal: boolean | null; quoteSitePlanFiles: readonly string[] }>;
}

export interface LegacyQuoteWrite {
  identity: LegacyAdapterIdentity;
  legacyJobId: string;
  expectedVersion: string;
  expectedCurrentFingerprint: string | null;
  finalQuoteNumber: string;
  quote: QuoteDraft;
}

export interface LegacyFrozenPlan {
  ordinal: number;
  artifactId: string;
  remoteFileName: string;
  contentSha256: string;
  byteSize: number;
  pdfBytes: Uint8Array;
  rendererVersion: string;
  templateVersion: string;
  templateSha256: string;
}

export interface LegacyUploadedPlan {
  remoteFileName: string;
  storageKey: string;
  contentSha256: string;
  byteSize: number;
}

export interface LegacyAttachedPlan {
  remoteFileName: string;
  storageKey: string;
  contentSha256: string | null;
  byteSize: number | null;
}

export interface LegacyCallContext {
  readonly signal: AbortSignal;
  /** Monotonic remaining budget shared by the worker lease supervisor. */
  remainingMs(): number;
}

export interface LegacyAdapter {
  readonly identity: LegacyAdapterIdentity;
  createLead(input: LegacyLeadInput, context: LegacyCallContext): Promise<LegacyOutcome<LegacyLeadRecord>>;
  findLeadByMarker(marker: string, canonicalCreateFingerprint: string, context: LegacyCallContext): Promise<LegacyOutcome<LegacyLeadRecord | null>>;
  getJob(legacyJobId: string, context: LegacyCallContext): Promise<LegacyOutcome<LegacyJobRecord>>;
  updateFullQuote(input: LegacyQuoteWrite, context: LegacyCallContext): Promise<LegacyOutcome<{ version: string; fingerprint: string }>>;
  readQuote(legacyJobId: string, context: LegacyCallContext): Promise<LegacyOutcome<{ version: string; fingerprint: string }>>;
  uploadFrozenPlan(legacyJobId: string, plan: LegacyFrozenPlan, context: LegacyCallContext): Promise<LegacyOutcome<LegacyUploadedPlan>>;
  attachPlans(legacyJobId: string, expectedVersion: string, plans: readonly LegacyUploadedPlan[], context: LegacyCallContext): Promise<LegacyOutcome<{ version: string }>>;
  readAttachedPlans(legacyJobId: string, context: LegacyCallContext): Promise<LegacyOutcome<readonly LegacyAttachedPlan[]>>;
}

export interface LegacyNotificationAdapter {
  deliver(input: { eventId: string; companyId: string; jobId: string; requestId: string; fictionalSummary: "SUBMISSION_COMPLETED" | "RECONCILIATION_REQUIRED"; delivery?: NotificationDeliveryContext }, context: LegacyCallContext): Promise<
    { kind: "ENQUEUED" | "DELIVERED"; receipt: string } | { kind: "AMBIGUOUS" } | { kind: "FAILED"; noEffect: true } | { kind: "PERMANENT"; code: "NOTIFICATION_REJECTED" }
  >;
  lookup(receipt: string, context: LegacyCallContext): Promise<{ kind: "DELIVERED" | "PENDING" } | { kind: "AMBIGUOUS" } | { kind: "FAILED"; noEffect: true } | { kind: "PERMANENT"; code: "NOTIFICATION_REJECTED" }>;
}

export interface NotificationDeliveryContext {
  recipientEmail:string;
  companyName:string;
  customerName:string;
  propertyAddress:{street:string;suburb:string;city:string;postcode:string};
  quoteTotalCents:number;
  legacyJobId:string;
  legacyJobNumber:number;
  jobUrl:string;
}

export const definiteFailure = (code: LegacySafeCode): LegacyOutcome<never> => ({ kind: "DEFINITE_FAILURE", code, noEffect: true });
export const ambiguous = (): LegacyOutcome<never> => ({ kind: "AMBIGUOUS", code: "LEGACY_RESPONSE_AMBIGUOUS" });
export const conflict = (code: LegacySafeCode): LegacyOutcome<never> => ({ kind: "CONFLICT", code, reconciliationRequired: true });

export function validateLegacyFrozenPlan(identity: LegacyAdapterIdentity, plan: LegacyFrozenPlan): boolean {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let expectedFileName = "";
  try { expectedFileName = partnerSubmissionRemoteFileName(identity.legacyJobPrefix, identity.requestId, plan.ordinal, plan.artifactId, plan.contentSha256); } catch { return false; }
  return uuid.test(identity.companyId) && uuid.test(identity.requestId) && Number.isInteger(plan.ordinal) && plan.ordinal >= 0 && plan.ordinal <= 19 && uuid.test(plan.artifactId)
    && plan.remoteFileName === expectedFileName
    && /^[0-9a-f]{64}$/.test(plan.contentSha256) && plan.byteSize === plan.pdfBytes.byteLength && plan.byteSize >= 1 && plan.byteSize <= 5 * 1024 * 1024
    && Buffer.from(plan.pdfBytes).subarray(0, 5).equals(Buffer.from("%PDF-"))
    && createHash("sha256").update(plan.pdfBytes).digest("hex") === plan.contentSha256
    && plan.rendererVersion === PARTNER_SITE_PLAN_RENDERER_VERSION && plan.templateVersion === SITE_PLAN_TEMPLATE_VERSION
    && plan.templateSha256 === PARTNER_SITE_PLAN_TEMPLATE_SHA256;
}

export function sameLegacyIdentity(left: LegacyAdapterIdentity, right: LegacyAdapterIdentity): boolean {
  return left.companyId === right.companyId && left.requestId === right.requestId && left.adapterMode === right.adapterMode
    && left.contractVersion === right.contractVersion && left.legacyJobPrefix === right.legacyJobPrefix && left.baseUrl === right.baseUrl
    && left.credentialKeyVersion === right.credentialKeyVersion && left.credentialFingerprint === right.credentialFingerprint
    && left.credentialUpdatedAt === right.credentialUpdatedAt;
}

export function validateLegacyUploadedPlan(plan: LegacyUploadedPlan): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(plan.remoteFileName) && /^[0-9a-f]{64}$/.test(plan.contentSha256)
    && Number.isInteger(plan.byteSize) && plan.byteSize >= 1 && plan.byteSize <= 5 * 1024 * 1024
    && typeof plan.storageKey === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,499}$/.test(plan.storageKey);
}
