import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SITE_PLAN_DOCUMENT } from "../site-plan-drawings";
import { createQuoteDraft, PRODUCT_QUOTE_DEFAULTS } from "./quote";
import { deletePartnerDemoPdfBytes, storePartnerDemoPdfBytes } from "./demo";
import { normalizeSitePlanRenderInput, PARTNER_SITE_PLAN_RENDERER_VERSION, PARTNER_SITE_PLAN_TEMPLATE_SHA256, sitePlanRenderHash } from "./site-plan-hash";
import { buildPartnerSubmissionSnapshot, PARTNER_SUBMISSION_SNAPSHOT_MAX_BYTES, partnerSubmissionArtifactBytes, partnerSubmissionIdempotencyHash, partnerSubmissionPublicStatus, partnerSubmissionRemoteFileName, partnerSubmissionRequestId, type PartnerSubmissionCandidate, type PartnerSubmissionPlanCandidate } from "./submission";

const companyId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const drawingId = "33333333-3333-4333-8333-333333333333";
const artifactId = "44444444-4444-4444-8444-444444444444";
const idempotencyKeyHash = partnerSubmissionIdempotencyHash("submit-key-company-a-0001");
const wall = { id: "wall-1", start: { x: 1, y: 1 }, end: { x: 5, y: 1 }, style: "solid" as const };
afterEach(() => vi.unstubAllEnvs());

function candidate(overrides: Partial<PartnerSubmissionCandidate> = {}): PartnerSubmissionCandidate {
  const quote = createQuoteDraft(PRODUCT_QUOTE_DEFAULTS, "LOCAL-READY", "2026-08-30T00:00:00.000Z");
  quote.wall = { enabled: true, areaSqm: 100, rateCentsPerSqm: 1000, cavityDepthCm: 10 };
  const document = { ...EMPTY_SITE_PLAN_DOCUMENT, walls: [wall] };
  const input = normalizeSitePlanRenderInput({ drawingName: "Ground floor", siteAddress: { street: "12 Māhoe Road", suburb: "Ōtāhuhu", city: "Auckland", postcode: "1062" }, document });
  const bytes = Buffer.from("%PDF-1.7\nsubmission fixture");
  const plan: PartnerSubmissionPlanCandidate = {
    id: drawingId, name: "Ground floor", sortOrder: 0, revision: 2, document,
    currentArtifact: {
      id: artifactId, drawingRevision: 2, renderHash: sitePlanRenderHash(input), contentSha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.byteLength, bytes, rendererVersion: PARTNER_SITE_PLAN_RENDERER_VERSION, templateVersion: input.templateVersion,
      templateSha256: PARTNER_SITE_PLAN_TEMPLATE_SHA256, localFileName: "Ground floor.pdf",
    },
  };
  return {
    companyId, companyName: "Northwind Insulation", idempotencyKeyHash, companyAdapterMode: "FICTIONAL", companyContractVersion: "fictional-v1", companyLegacyJobPrefix: "NW",
    jobId, jobRevision: 4, floorPlanRevision: 1, submissionState: "DRAFT", clientReference: "DRAFT-1",
    customerName: "Hine Te Rangi", customerMobile: "021 555 0123", customerEmail: "", siteAddress: { street: "12 Māhoe Road", suburb: "Ōtāhuhu", city: "Auckland", postcode: "1062" },
    leadSources: [], notes: "Kia ora", quote, plans: [plan], ...overrides,
  };
}

describe("partner submission snapshot domain", () => {
  it("builds a deterministic authoritative-ready canonical snapshot and manifest", () => {
    const first = buildPartnerSubmissionSnapshot(candidate(), { environment: "test" });
    const second = buildPartnerSubmissionSnapshot(candidate(), { environment: "test" });
    expect(second).toEqual(first);
    expect(first.candidateSnapshotSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.candidateRequestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.manifest).toHaveLength(1);
    expect(first.requestId).toBe(partnerSubmissionRequestId(companyId, jobId, idempotencyKeyHash));
    expect(first.manifest[0].remoteFileName).toBe(partnerSubmissionRemoteFileName("NW", first.requestId, 0, artifactId, first.manifest[0].contentSha256));
    expect(first.canonicalDocument).toContain("Māhoe");
    expect(first.canonicalDocument).not.toMatch(/credential|ciphertext|password|idempotency/i);
  });

  it("binds each remote object name to the frozen request and exact artifact", () => {
    const first = buildPartnerSubmissionSnapshot(candidate(), { environment: "test" });
    const otherRequest = buildPartnerSubmissionSnapshot(candidate({ idempotencyKeyHash: partnerSubmissionIdempotencyHash("submit-key-company-a-0002") }), { environment: "test" });
    expect(first.manifest[0].remoteFileName).not.toBe(otherRequest.manifest[0].remoteFileName);
    expect(first.manifest[0].remoteFileName).toContain(first.requestId.replaceAll("-", ""));
    expect(first.manifest[0].remoteFileName).toContain(artifactId.replaceAll("-", ""));
  });

  it("derives the same request identity for independent retries of the same tenant, job and key", () => {
    const first = buildPartnerSubmissionSnapshot(candidate(), { environment: "test" });
    const retried = buildPartnerSubmissionSnapshot(candidate(), { environment: "test" });
    expect(retried.requestId).toBe(first.requestId);
    expect(retried.manifest[0].remoteFileName).toBe(first.manifest[0].remoteFileName);
  });

  it("accepts the bounded worst-count twenty-floor candidate below the whole-snapshot cap", () => {
    const base = candidate();
    const document = {
      ...EMPTY_SITE_PLAN_DOCUMENT,
      walls: Array.from({ length: 500 }, (_, index) => ({ id: `wall-${index}`, start: { x: index % 18, y: index % 17 }, end: { x: (index % 18) + 0.5, y: index % 17 }, style: "solid" as const })),
      textNotes: Array.from({ length: 100 }, (_, index) => ({ id: `note-${index}`, text: "i".repeat(200), x: index % 18, y: index % 17, fontSize: 0.32 })),
    };
    const bytes = Buffer.from("%PDF-1.7\nbounded twenty-floor fixture");
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const plans = Array.from({ length: 20 }, (_, index): PartnerSubmissionPlanCandidate => {
      const id = `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`;
      const artifact = `44444444-4444-4444-8444-${String(index + 1).padStart(12, "0")}`;
      const name = `Floor ${index + 1}`;
      const input = normalizeSitePlanRenderInput({ drawingName: name, siteAddress: base.siteAddress, document });
      return { id, name, sortOrder: index, revision: 1, document, currentArtifact: {
        id: artifact, drawingRevision: 1, renderHash: sitePlanRenderHash(input), contentSha256, byteSize: bytes.byteLength, bytes,
        rendererVersion: PARTNER_SITE_PLAN_RENDERER_VERSION, templateVersion: input.templateVersion, templateSha256: PARTNER_SITE_PLAN_TEMPLATE_SHA256,
        localFileName: `${name}.pdf`,
      } };
    });
    const built = buildPartnerSubmissionSnapshot({ ...base, plans }, { environment: "test" });
    expect(built.manifest).toHaveLength(20);
    expect(built.byteSize).toBeLessThan(PARTNER_SUBMISSION_SNAPSHOT_MAX_BYTES);
  });

  it("rejects stale, missing, corrupt, non-PDF and forged-provenance artifacts", () => {
    const base = candidate(); const plan = base.plans[0];
    expect(() => buildPartnerSubmissionSnapshot({ ...base, plans: [{ ...plan, currentArtifact: null }] })).toThrow("SUBMISSION_PDF_MISSING");
    expect(() => buildPartnerSubmissionSnapshot({ ...base, plans: [{ ...plan, currentArtifact: { ...plan.currentArtifact!, drawingRevision: 1 } }] })).toThrow("SUBMISSION_PDF_STALE");
    expect(() => buildPartnerSubmissionSnapshot({ ...base, plans: [{ ...plan, currentArtifact: { ...plan.currentArtifact!, contentSha256: "0".repeat(64) } }] })).toThrow("SUBMISSION_PDF_INTEGRITY_FAILED");
    const arbitrary = Buffer.from("not a PDF");
    expect(() => buildPartnerSubmissionSnapshot({ ...base, plans: [{ ...plan, currentArtifact: { ...plan.currentArtifact!, bytes: arbitrary, byteSize: arbitrary.byteLength, contentSha256: createHash("sha256").update(arbitrary).digest("hex") } }] })).toThrow("SUBMISSION_PDF_SIZE_INVALID");
    expect(() => buildPartnerSubmissionSnapshot({ ...base, plans: [{ ...plan, currentArtifact: { ...plan.currentArtifact!, rendererVersion: "forged" } }] })).toThrow("SUBMISSION_PDF_INTEGRITY_FAILED");
  });

  it("rejects incomplete lead/quote, invalid order, disabled contracts and fictional production", () => {
    expect(() => buildPartnerSubmissionSnapshot(candidate({ customerMobile: "", customerEmail: "" }))).toThrow("SUBMISSION_NOT_READY");
    expect(() => buildPartnerSubmissionSnapshot(candidate({ plans: [{ ...candidate().plans[0], sortOrder: 1 }] }))).toThrow("SUBMISSION_PLAN_ORDER_INVALID");
    expect(() => buildPartnerSubmissionSnapshot(candidate({ companyAdapterMode: "DISABLED", companyContractVersion: null, companyLegacyJobPrefix: null }))).toThrow("SUBMISSION_CONTRACT_DISABLED");
    expect(() => buildPartnerSubmissionSnapshot(candidate(), { environment: "production" })).toThrow("SUBMISSION_CONTRACT_MODE_FORBIDDEN");
  });

  it("translates normalization failures to a bounded safe error", () => {
    expect(() => buildPartnerSubmissionSnapshot(candidate({ siteAddress: { ...candidate().siteAddress, street: "12 Bad\u0001 Road" } }))).toThrow("SUBMISSION_INVALID_INPUT");
  });

  it("resolves fictional artifact bytes from process memory and fails closed when missing", () => {
    vi.stubEnv("PARTNER_DEMO_MODE", "true"); vi.stubEnv("PARTNER_DEMO_CONFIRM", "LOCAL_FICTIONAL_DATA_ONLY"); vi.stubEnv("PARTNER_APP_ORIGIN", "http://127.0.0.1:3000/"); vi.stubEnv("NODE_ENV", "test");
    const demoEnv = { ...process.env };
    const actual = Buffer.from("%PDF-1.7\nactual demo bytes");
    storePartnerDemoPdfBytes(artifactId, actual);
    expect(Buffer.from(partnerSubmissionArtifactBytes(artifactId, Buffer.from("%PDF-placeholder"), demoEnv))).toEqual(actual);
    deletePartnerDemoPdfBytes([artifactId]);
    expect(() => partnerSubmissionArtifactBytes(artifactId, Buffer.from("%PDF-placeholder"), demoEnv)).toThrow("SUBMISSION_PDF_INTEGRITY_FAILED");
  });

  it("hashes tenant-owned raw idempotency material without projecting it", () => {
    const raw = "submit-key-company-a-0001";
    expect(partnerSubmissionIdempotencyHash(raw)).toHaveLength(64);
    expect(partnerSubmissionIdempotencyHash(raw)).not.toContain(raw);
    expect(() => partnerSubmissionIdempotencyHash("short")).toThrow("SUBMISSION_INVALID_INPUT");
  });

  it("exposes only bounded public status and drops unknown internal errors", () => {
    const status = partnerSubmissionPublicStatus({ state: "FAILED_RETRYABLE", checkpoint: "CREATE_STARTED", safeErrorCode: "RAW_PROVIDER_RESPONSE", createdAt: "2026-08-30T00:00:00Z", updatedAt: "2026-08-30T00:01:00Z" });
    expect(status).toEqual({ state: "FAILED_RETRYABLE", checkpoint: "CREATE_STARTED", errorCode: null, createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:01:00.000Z", completedAt: null });
    expect(status).not.toHaveProperty("requestId"); expect(status).not.toHaveProperty("leaseToken"); expect(status).not.toHaveProperty("snapshotId");
  });
});
