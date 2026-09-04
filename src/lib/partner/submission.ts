import "server-only";
import { createHash } from "node:crypto";
import { parseSitePlanDocument, type SitePlanDrawingDocument } from "../site-plan-drawings";
import { partnerDraftReadiness, validateLeadDraft, type LeadDraftFields } from "./draft";
import { partnerQuoteTerms, normalizeQuoteDraft, type QuoteDraft } from "./quote";
import { canonicalJson, normalizeSitePlanRenderInput, sitePlanRenderHash } from "./site-plan-hash";
import { sitePlanReadiness } from "./site-plan-readiness";
import { partnerDemoModeEnabled, readPartnerDemoPdfBytes } from "./demo";

export const PARTNER_SUBMISSION_SNAPSHOT_SCHEMA = 2 as const;
export const PARTNER_SUBMISSION_CONTRACT_VERSION_MAX = 80;
export const PARTNER_SUBMISSION_PDF_MAX_BYTES = 5 * 1024 * 1024;
export const PARTNER_SUBMISSION_SNAPSHOT_MAX_BYTES = 6 * 1024 * 1024;

export type PartnerSubmissionAdapterMode = "DISABLED" | "FICTIONAL" | "LIVE";
export type PartnerSubmissionRequestState = "QUEUED" | "PROCESSING" | "FAILED_RETRYABLE" | "SUCCEEDED" | "RECONCILIATION_REQUIRED";
export type PartnerSubmissionCheckpoint = "NONE" | "FROZEN" | "CREATE_STARTED" | "LEAD_CREATED" | "QUOTE_UPDATED" | "PLANS_ATTACHED" | "FINALIZED" | "RECONCILIATION";
export type PartnerSubmissionErrorCode =
  | "SUBMISSION_CONTRACT_DISABLED"
  | "SUBMISSION_CONTRACT_MODE_FORBIDDEN"
  | "SUBMISSION_INVALID_INPUT"
  | "SUBMISSION_NOT_DRAFT"
  | "SUBMISSION_NOT_READY"
  | "SUBMISSION_PLAN_ORDER_INVALID"
  | "SUBMISSION_PLAN_SET_MISMATCH"
  | "SUBMISSION_PDF_MISSING"
  | "SUBMISSION_PDF_STALE"
  | "SUBMISSION_PDF_INTEGRITY_FAILED"
  | "SUBMISSION_PDF_SIZE_INVALID"
  | "SUBMISSION_IDEMPOTENCY_CONFLICT"
  | "SUBMISSION_STALE"
  | "SUBMISSION_LEASE_LOST"
  | "SUBMISSION_ILLEGAL_TRANSITION"
  | "SUBMISSION_RECONCILIATION_REQUIRED";

const SAFE_ERROR_CODES = new Set<PartnerSubmissionErrorCode>([
  "SUBMISSION_CONTRACT_DISABLED", "SUBMISSION_CONTRACT_MODE_FORBIDDEN", "SUBMISSION_INVALID_INPUT", "SUBMISSION_NOT_DRAFT",
  "SUBMISSION_NOT_READY", "SUBMISSION_PLAN_ORDER_INVALID", "SUBMISSION_PLAN_SET_MISMATCH", "SUBMISSION_PDF_MISSING",
  "SUBMISSION_PDF_STALE", "SUBMISSION_PDF_INTEGRITY_FAILED", "SUBMISSION_PDF_SIZE_INVALID", "SUBMISSION_IDEMPOTENCY_CONFLICT",
  "SUBMISSION_STALE", "SUBMISSION_LEASE_LOST", "SUBMISSION_ILLEGAL_TRANSITION", "SUBMISSION_RECONCILIATION_REQUIRED",
]);

export class PartnerSubmissionError extends Error {
  constructor(readonly code: PartnerSubmissionErrorCode) { super(code); this.name = "PartnerSubmissionError"; }
}

export interface PartnerSubmissionArtifactCandidate {
  id: string;
  drawingRevision: number;
  renderHash: string;
  contentSha256: string;
  byteSize: number;
  bytes: Uint8Array;
  rendererVersion: string;
  templateVersion: string;
  templateSha256: string;
  localFileName: string;
}

export interface PartnerSubmissionPlanCandidate {
  id: string;
  name: string;
  sortOrder: number;
  revision: number;
  document: SitePlanDrawingDocument;
  currentArtifact: PartnerSubmissionArtifactCandidate | null;
}

export interface PartnerSubmissionCandidate extends LeadDraftFields {
  companyId: string;
  companyName: string;
  idempotencyKeyHash: string;
  companyAdapterMode: PartnerSubmissionAdapterMode;
  companyContractVersion: string | null;
  companyLegacyJobPrefix: string | null;
  jobId: string;
  jobRevision: number;
  floorPlanRevision: number;
  submissionState: string;
  clientReference: string;
  quote: QuoteDraft;
  plans: readonly PartnerSubmissionPlanCandidate[];
}

export interface PartnerSubmissionManifestInput {
  ordinal: number;
  drawingId: string;
  artifactId: string;
  drawingRevision: number;
  documentCanonical: string;
  documentSha256: string;
  renderInputCanonical: string;
  renderHash: string;
  contentSha256: string;
  byteSize: number;
  remoteFileName: string;
}

export interface BuiltPartnerSubmissionSnapshot {
  requestId: string;
  canonicalDocument: string;
  candidateSnapshotSha256: string;
  candidateRequestHash: string;
  byteSize: number;
  manifest: PartnerSubmissionManifestInput[];
  snapshot: Readonly<Record<string, unknown> & { job: Readonly<{ quote: QuoteDraft; leadSources: readonly string[] }> }>;
}

export interface PartnerSubmissionPublicStatus {
  state: PartnerSubmissionRequestState;
  checkpoint: PartnerSubmissionCheckpoint;
  errorCode: PartnerSubmissionErrorCode | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  notification?: "PENDING" | "DELIVERED" | "DEAD";
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertSafeContract(candidate: PartnerSubmissionCandidate, environment: "production" | "development" | "test"): void {
  const version = candidate.companyContractVersion;
  const prefix = candidate.companyLegacyJobPrefix;
  if (candidate.companyAdapterMode === "DISABLED" || !version || !prefix
    || version.length > PARTNER_SUBMISSION_CONTRACT_VERSION_MAX
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(version)
    || !/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(prefix)) throw new PartnerSubmissionError("SUBMISSION_CONTRACT_DISABLED");
  if (environment === "production" && candidate.companyAdapterMode !== "LIVE") throw new PartnerSubmissionError("SUBMISSION_CONTRACT_MODE_FORBIDDEN");
}

export function partnerSubmissionRemoteFileName(prefix: string, requestId: string, ordinal: number, artifactId: string, contentSha256: string): string {
  if (!/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(prefix) || !Number.isInteger(ordinal) || ordinal < 0 || ordinal > 19
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artifactId)
    || !/^[0-9a-f]{64}$/.test(contentSha256)) throw new PartnerSubmissionError("SUBMISSION_INVALID_INPUT");
  return `${prefix}-${requestId.toLowerCase().replaceAll("-", "")}-${String(ordinal + 1).padStart(2, "0")}-${artifactId.toLowerCase().replaceAll("-", "")}-${contentSha256}.pdf`;
}

export function partnerSubmissionRequestId(companyId: string, jobId: string, idempotencyKeyHash: string): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(companyId) || !uuid.test(jobId) || !/^[0-9a-f]{64}$/.test(idempotencyKeyHash)) throw new PartnerSubmissionError("SUBMISSION_INVALID_INPUT");
  const value = sha256(`partner-submission-request-v1|${companyId.toLowerCase()}|${jobId.toLowerCase()}|${idempotencyKeyHash}`);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}

export function partnerSubmissionIdempotencyHash(rawKey: string): string {
  if (typeof rawKey !== "string" || rawKey.length < 16 || rawKey.length > 200 || /[\u0000-\u001f\u007f-\u009f]/u.test(rawKey)) throw new PartnerSubmissionError("SUBMISSION_INVALID_INPUT");
  return sha256(rawKey.normalize("NFC"));
}

export function partnerSubmissionArtifactBytes(artifactId: string, storedBytes: Uint8Array, environment: NodeJS.ProcessEnv = process.env): Uint8Array {
  if (!partnerDemoModeEnabled(environment)) return storedBytes;
  const actual = readPartnerDemoPdfBytes(artifactId);
  if (!actual) throw new PartnerSubmissionError("SUBMISSION_PDF_INTEGRITY_FAILED");
  return actual;
}

function buildPartnerSubmissionSnapshotUnchecked(candidate: PartnerSubmissionCandidate, options: { environment?: "production" | "development" | "test" } = {}): BuiltPartnerSubmissionSnapshot {
  assertSafeContract(candidate, options.environment ?? (process.env.NODE_ENV === "production" ? "production" : "development"));
  if (candidate.submissionState !== "DRAFT") throw new PartnerSubmissionError("SUBMISSION_NOT_DRAFT");
  if (!Number.isInteger(candidate.jobRevision) || candidate.jobRevision < 0 || !Number.isInteger(candidate.floorPlanRevision) || candidate.floorPlanRevision < 0) throw new PartnerSubmissionError("SUBMISSION_INVALID_INPUT");
  const requestId = partnerSubmissionRequestId(candidate.companyId, candidate.jobId, candidate.idempotencyKeyHash);

  const lead = validateLeadDraft({
    customerName: candidate.customerName, customerMobile: candidate.customerMobile, customerEmail: candidate.customerEmail,
    siteAddress: candidate.siteAddress, leadSources: candidate.leadSources, notes: candidate.notes,
  });
  if (typeof candidate.companyName !== "string" || !candidate.companyName.trim() || candidate.companyName.length > 160) throw new PartnerSubmissionError("SUBMISSION_INVALID_INPUT");
  const quote = normalizeQuoteDraft(partnerQuoteTerms(candidate.quote));
  if (!lead.ok || !quote.ok) throw new PartnerSubmissionError("SUBMISSION_INVALID_INPUT");

  const ordered = [...candidate.plans].sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  if (!ordered.length || ordered.length > 20 || ordered.some((plan, index) => plan.sortOrder !== index)) throw new PartnerSubmissionError("SUBMISSION_PLAN_ORDER_INVALID");

  const prepared = ordered.map((plan, ordinal) => {
    const document = parseSitePlanDocument(plan.document);
    if (!document) throw new PartnerSubmissionError("SUBMISSION_INVALID_INPUT");
    const input = normalizeSitePlanRenderInput({ drawingName: plan.name, siteAddress: lead.value.siteAddress, document });
    const expectedRenderHash = sitePlanRenderHash(input);
    const artifact = plan.currentArtifact;
    if (!artifact) throw new PartnerSubmissionError("SUBMISSION_PDF_MISSING");
    if (artifact.drawingRevision !== plan.revision || artifact.renderHash !== expectedRenderHash) throw new PartnerSubmissionError("SUBMISSION_PDF_STALE");
    if (artifact.rendererVersion !== input.rendererVersion || artifact.templateVersion !== input.templateVersion || artifact.templateSha256 !== input.templateSha256
      || typeof artifact.localFileName !== "string" || !artifact.localFileName.trim() || [...artifact.localFileName].length > 240) throw new PartnerSubmissionError("SUBMISSION_PDF_INTEGRITY_FAILED");
    if (!(artifact.bytes instanceof Uint8Array) || artifact.byteSize !== artifact.bytes.byteLength || artifact.byteSize < 1 || artifact.byteSize > PARTNER_SUBMISSION_PDF_MAX_BYTES || !Buffer.from(artifact.bytes).subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new PartnerSubmissionError("SUBMISSION_PDF_SIZE_INVALID");
    const actualContentSha = sha256(artifact.bytes);
    if (actualContentSha !== artifact.contentSha256) throw new PartnerSubmissionError("SUBMISSION_PDF_INTEGRITY_FAILED");
    const documentCanonical = canonicalJson(document);
    const documentSha256 = sha256(documentCanonical);
    const renderInputCanonical = canonicalJson(input);
    return {
      ordinal, plan, document, input, artifact, documentCanonical, documentSha256, renderInputCanonical,
      remoteFileName: partnerSubmissionRemoteFileName(candidate.companyLegacyJobPrefix!, requestId, ordinal, artifact.id, actualContentSha),
    };
  });

  const floorReadiness = sitePlanReadiness(prepared.map(({ plan, document, artifact, input }) => ({
    name: plan.name, revision: plan.revision, document,
    currentArtifact: { drawingRevision: artifact.drawingRevision, renderHash: artifact.renderHash },
    expectedRenderHash: sitePlanRenderHash(input),
  })));
  const readiness = partnerDraftReadiness({ ...lead.value, quote: quote.value }, floorReadiness);
  if (readiness.length) throw new PartnerSubmissionError("SUBMISSION_NOT_READY");

  const plans = prepared.map(({ ordinal, plan, document, artifact, documentSha256, remoteFileName }) => ({
    ordinal,
    drawingId: plan.id,
    name: plan.name.normalize("NFC"),
    drawingRevision: plan.revision,
    document,
    documentSha256,
    artifact: {
      id: artifact.id,
      renderHash: artifact.renderHash,
      contentSha256: artifact.contentSha256,
      byteSize: artifact.byteSize,
      rendererVersion: artifact.rendererVersion,
      templateVersion: artifact.templateVersion,
      templateSha256: artifact.templateSha256,
      localFileName: artifact.localFileName.normalize("NFC"),
    },
    remoteFileName,
  }));
  const snapshot = {
    schemaVersion: PARTNER_SUBMISSION_SNAPSHOT_SCHEMA,
    contract: { adapterMode: candidate.companyAdapterMode, version: candidate.companyContractVersion, legacyJobPrefix: candidate.companyLegacyJobPrefix },
    job: {
      id: candidate.jobId, companyId: candidate.companyId, revision: candidate.jobRevision, floorPlanRevision: candidate.floorPlanRevision,
      clientReference: candidate.clientReference.normalize("NFC"),
      customer: { name: lead.value.customerName.normalize("NFC"), mobile: lead.value.customerMobile.normalize("NFC"), email: lead.value.customerEmail.normalize("NFC") },
      siteAddress: lead.value.siteAddress, leadSources: [candidate.companyName.trim().normalize("NFC")], notes: lead.value.notes.normalize("NFC"),
      quote: quote.value,
    },
    plans,
  } as const;
  const canonicalDocument = canonicalJson(snapshot);
  const byteSize = Buffer.byteLength(canonicalDocument, "utf8");
  if (byteSize > PARTNER_SUBMISSION_SNAPSHOT_MAX_BYTES) throw new PartnerSubmissionError("SUBMISSION_INVALID_INPUT");
  const candidateSnapshotSha256 = sha256(canonicalDocument);
  const manifest: PartnerSubmissionManifestInput[] = prepared.map((plan) => ({
    ordinal: plan.ordinal, drawingId: plan.plan.id, artifactId: plan.artifact.id, drawingRevision: plan.plan.revision,
    documentCanonical: plan.documentCanonical, documentSha256: plan.documentSha256, renderInputCanonical: plan.renderInputCanonical,
    renderHash: plan.artifact.renderHash, contentSha256: plan.artifact.contentSha256, byteSize: plan.artifact.byteSize, remoteFileName: plan.remoteFileName,
  }));
  return { requestId, canonicalDocument, candidateSnapshotSha256, candidateRequestHash: sha256(canonicalJson({ schemaVersion: PARTNER_SUBMISSION_SNAPSHOT_SCHEMA, snapshotSha256: candidateSnapshotSha256, jobRevision: candidate.jobRevision, floorPlanRevision: candidate.floorPlanRevision })), byteSize, manifest, snapshot };
}

export function buildPartnerSubmissionSnapshot(candidate: PartnerSubmissionCandidate, options: { environment?: "production" | "development" | "test" } = {}): BuiltPartnerSubmissionSnapshot {
  try {
    return buildPartnerSubmissionSnapshotUnchecked(candidate, options);
  } catch (error) {
    if (error instanceof PartnerSubmissionError) throw error;
    throw new PartnerSubmissionError("SUBMISSION_INVALID_INPUT");
  }
}

export function partnerSubmissionPublicStatus(value: {
  state: unknown; checkpoint: unknown; safeErrorCode?: unknown; createdAt: Date | string; updatedAt: Date | string; completedAt?: Date | string | null;
}): PartnerSubmissionPublicStatus {
  const states = new Set<PartnerSubmissionRequestState>(["QUEUED","PROCESSING","FAILED_RETRYABLE","SUCCEEDED","RECONCILIATION_REQUIRED"]);
  const checkpoints = new Set<PartnerSubmissionCheckpoint>(["NONE","FROZEN","CREATE_STARTED","LEAD_CREATED","QUOTE_UPDATED","PLANS_ATTACHED","FINALIZED","RECONCILIATION"]);
  if (!states.has(value.state as PartnerSubmissionRequestState) || !checkpoints.has(value.checkpoint as PartnerSubmissionCheckpoint)) throw new PartnerSubmissionError("SUBMISSION_INVALID_INPUT");
  const safeErrorCode = typeof value.safeErrorCode === "string" && SAFE_ERROR_CODES.has(value.safeErrorCode as PartnerSubmissionErrorCode) ? value.safeErrorCode as PartnerSubmissionErrorCode : null;
  return {
    state: value.state as PartnerSubmissionRequestState, checkpoint: value.checkpoint as PartnerSubmissionCheckpoint, errorCode: safeErrorCode,
    createdAt: new Date(value.createdAt).toISOString(), updatedAt: new Date(value.updatedAt).toISOString(), completedAt: value.completedAt ? new Date(value.completedAt).toISOString() : null,
  };
}
