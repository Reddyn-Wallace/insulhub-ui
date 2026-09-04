import "server-only";
import { createHash } from "node:crypto";
import { partnerDemoModeEnabled } from "../demo";
import { legacySubmissionMarker } from "./contract";
import { deriveFinalQuoteNumber, legacyLeadCreateFingerprint, mapLegacyFullQuote, validateLegacyLeadInput } from "./graphql-adapter";
import { ambiguous, conflict, definiteFailure, sameLegacyIdentity, validateLegacyFrozenPlan, validateLegacyUploadedPlan, type LegacyAdapter, type LegacyAdapterIdentity, type LegacyAttachedPlan, type LegacyCallContext, type LegacyFrozenPlan, type LegacyJobRecord, type LegacyLeadInput, type LegacyLeadRecord, type LegacyOutcome, type LegacyQuoteWrite, type LegacyUploadedPlan } from "./types";

export type FictionalCrashWindow =
  | "DEFINITE_NO_EFFECT" | "EFFECT_THEN_RESPONSE_LOSS" | "SUCCESS_NO_EFFECT" | "CONCURRENT_STAFF_CHANGE"
  | "DUPLICATE_MARKER" | "ARCHIVED_MATCH" | "INCOMPLETE_PAGINATION" | "UPLOAD_EFFECT_THEN_LOSS"
  | "ATTACH_EFFECT_THEN_LOSS" | "PARTIAL_ATTACH";
export type FictionalOperation = "createLead" | "findLead" | "getJob" | "updateQuote" | "readQuote" | "uploadPlan" | "attachPlans" | "readAttachedPlans";

type FakeJob = LegacyJobRecord & { quoteFingerprint: string | null; uploads: Map<string, LegacyUploadedPlan> };

export class FictionalLegacyWorld {
  readonly jobs = new Map<string, FakeJob>();
  nextJobNumber = 10_000;
}

export interface FictionalLegacyAdapterController extends LegacyAdapter {
  readonly callCounts: Record<FictionalOperation, number>;
  queue(operation: FictionalOperation, ...windows: FictionalCrashWindow[]): this;
  seedJob(value: Partial<LegacyJobRecord> & Pick<LegacyJobRecord, "id" | "marker" | "canonicalCreateFingerprint">): void;
}

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const cloneLead = (job: FakeJob): LegacyLeadRecord => ({ id: job.id, jobNumber: job.jobNumber, version: job.version, marker: job.marker, canonicalCreateFingerprint: job.canonicalCreateFingerprint, archived: job.archived });
const bump = (value: string) => String(Number(value) + 1);
const clonePreservation = (value: LegacyJobRecord["preservation"]): LegacyJobRecord["preservation"] => Object.freeze({
  sitePlanNotes: value.sitePlanNotes, wallInternal: value.wallInternal, quoteSitePlanFiles: Object.freeze([...value.quoteSitePlanFiles]),
});
const unavailable=(context:LegacyCallContext)=>context.signal.aborted||!Number.isFinite(context.remainingMs())||context.remainingMs()<=0;

class FictionalLegacyAdapterImpl implements FictionalLegacyAdapterController {
  readonly callCounts: Record<FictionalOperation, number> = { createLead: 0, findLead: 0, getJob: 0, updateQuote: 0, readQuote: 0, uploadPlan: 0, attachPlans: 0, readAttachedPlans: 0 };
  private readonly script = new Map<FictionalOperation, FictionalCrashWindow[]>();

  constructor(readonly identity: LegacyAdapterIdentity, private readonly world: FictionalLegacyWorld) {
    if (identity.adapterMode !== "FICTIONAL" || identity.contractVersion !== "fictional-v1" || identity.baseUrl !== null || identity.credentialFingerprint !== null
      || identity.credentialKeyVersion !== null || identity.credentialUpdatedAt !== null) throw new Error("Fictional adapter cannot receive live configuration");
  }

  queue(operation: FictionalOperation, ...windows: FictionalCrashWindow[]): this {
    this.script.set(operation, [...(this.script.get(operation) ?? []), ...windows]); return this;
  }

  seedJob(value: Partial<LegacyJobRecord> & Pick<LegacyJobRecord, "id" | "marker" | "canonicalCreateFingerprint">): void {
    this.world.jobs.set(value.id, { id: value.id, jobNumber: value.jobNumber ?? this.world.nextJobNumber++, version: value.version ?? "1", marker: value.marker,
      canonicalCreateFingerprint: value.canonicalCreateFingerprint, archived: value.archived ?? false, stage: value.stage ?? "LEAD", status: value.status ?? "UNSET",
      quoteFingerprint: value.quoteFingerprint ?? null, attachedPlans: [...(value.attachedPlans ?? [])],
      preservation: clonePreservation(value.preservation ?? { sitePlanNotes: "", wallInternal: null, quoteSitePlanFiles: [] }), uploads: new Map() });
  }

  private step(operation: FictionalOperation): FictionalCrashWindow | null {
    this.callCounts[operation] += 1; const values = this.script.get(operation); return values?.shift() ?? null;
  }

  private boundJob(legacyJobId: string): FakeJob | LegacyOutcome<never> {
    const job = this.world.jobs.get(legacyJobId);
    if (!job) return definiteFailure("LEGACY_NOT_FOUND");
    if (job.archived || job.marker !== legacySubmissionMarker(this.identity.companyId, this.identity.requestId) || job.status !== "UNSET"
      || (job.stage !== "LEAD" && job.stage !== "QUOTE") || (job.stage === "LEAD" && job.quoteFingerprint !== null) || (job.stage === "QUOTE" && !job.quoteFingerprint)) return conflict("LEGACY_READBACK_MISMATCH");
    return job;
  }

  async createLead(input: LegacyLeadInput, context:LegacyCallContext): Promise<LegacyOutcome<LegacyLeadRecord>> {
    if(unavailable(context))return definiteFailure("LEGACY_REMOTE_NO_EFFECT");
    const step = this.step("createLead");
    if (step === "DEFINITE_NO_EFFECT") return definiteFailure("LEGACY_REMOTE_NO_EFFECT");
    if (!sameLegacyIdentity(input.identity, this.identity) || !validateLegacyLeadInput(input) || input.marker !== legacySubmissionMarker(this.identity.companyId, this.identity.requestId) || input.canonicalCreateFingerprint !== legacyLeadCreateFingerprint(input)) return definiteFailure("LEGACY_INVALID_INPUT");
    const matches = [...this.world.jobs.values()].filter((job) => job.marker === input.marker);
    if (matches.length > 1 || step === "DUPLICATE_MARKER") return conflict("LEGACY_DUPLICATE_MARKER");
    if (matches.length === 1 && matches[0].archived) return conflict("LEGACY_ARCHIVED_MATCH");
    if (matches.length === 1) return matches[0].canonicalCreateFingerprint === input.canonicalCreateFingerprint ? { kind: "CONFIRMED", value: cloneLead(matches[0]) } : conflict("LEGACY_READBACK_MISMATCH");
    if (step === "SUCCESS_NO_EFFECT") return conflict("LEGACY_READBACK_MISMATCH");
    const id = `fictional-${this.identity.companyId}-${this.world.nextJobNumber}`;
    const job: FakeJob = { id, jobNumber: this.world.nextJobNumber++, version: "1", marker: input.marker, canonicalCreateFingerprint: input.canonicalCreateFingerprint,
      archived: false, stage: "LEAD", status: "UNSET", quoteFingerprint: null, attachedPlans: [],
      preservation: { sitePlanNotes: "", wallInternal: null, quoteSitePlanFiles: [] }, uploads: new Map() };
    this.world.jobs.set(id, job);
    return step === "EFFECT_THEN_RESPONSE_LOSS" ? ambiguous() : { kind: "CONFIRMED", value: cloneLead(job) };
  }

  async findLeadByMarker(marker: string, canonicalCreateFingerprint: string, context:LegacyCallContext): Promise<LegacyOutcome<LegacyLeadRecord | null>> {
    if(unavailable(context))return definiteFailure("LEGACY_REMOTE_NO_EFFECT");
    const step = this.step("findLead");
    if(step==="DEFINITE_NO_EFFECT")return definiteFailure("LEGACY_REMOTE_NO_EFFECT");
    if(step==="EFFECT_THEN_RESPONSE_LOSS")return ambiguous();
    if (marker !== legacySubmissionMarker(this.identity.companyId, this.identity.requestId) || !/^[0-9a-f]{64}$/.test(canonicalCreateFingerprint)) return definiteFailure("LEGACY_INVALID_INPUT");
    if (step === "INCOMPLETE_PAGINATION") return conflict("LEGACY_PAGINATION_INCOMPLETE");
    const all = [...this.world.jobs.values()].filter((job) => job.marker === marker);
    if (step === "ARCHIVED_MATCH" || (all.length && all.every((job) => job.archived))) return conflict("LEGACY_ARCHIVED_MATCH");
    if (step === "DUPLICATE_MARKER" || all.length > 1) return conflict("LEGACY_DUPLICATE_MARKER");
    if (!all.length) return { kind: "CONFIRMED", value: null };
    if (all[0].archived) return conflict("LEGACY_ARCHIVED_MATCH");
    return all[0].canonicalCreateFingerprint === canonicalCreateFingerprint ? { kind: "CONFIRMED", value: cloneLead(all[0]) } : conflict("LEGACY_READBACK_MISMATCH");
  }

  async getJob(legacyJobId: string, context:LegacyCallContext): Promise<LegacyOutcome<LegacyJobRecord>> {
    if(unavailable(context))return definiteFailure("LEGACY_REMOTE_NO_EFFECT");
    const step = this.step("getJob"); if (step === "DEFINITE_NO_EFFECT") return definiteFailure("LEGACY_REMOTE_NO_EFFECT"); if (step === "EFFECT_THEN_RESPONSE_LOSS") return ambiguous();
    const job = this.boundJob(legacyJobId); if ("kind" in job) return job; return { kind: "CONFIRMED", value: {
      id: job.id, jobNumber: job.jobNumber, version: job.version, marker: job.marker, canonicalCreateFingerprint: job.canonicalCreateFingerprint,
      archived: job.archived, stage: job.stage, status: job.status, quoteFingerprint: job.quoteFingerprint,
      attachedPlans: job.attachedPlans.map((plan) => ({ ...plan })), preservation: clonePreservation(job.preservation),
    } };
  }

  async updateFullQuote(input: LegacyQuoteWrite, context:LegacyCallContext): Promise<LegacyOutcome<{ version: string; fingerprint: string }>> {
    if(unavailable(context))return definiteFailure("LEGACY_REMOTE_NO_EFFECT");
    const step = this.step("updateQuote"); const job = this.boundJob(input.legacyJobId);
    if ("kind" in job) return job;
    if (!sameLegacyIdentity(input.identity, this.identity)) return definiteFailure("LEGACY_INVALID_INPUT");
    if (step === "DEFINITE_NO_EFFECT") return definiteFailure("LEGACY_REMOTE_NO_EFFECT");
    if (input.finalQuoteNumber !== deriveFinalQuoteNumber(this.identity.legacyJobPrefix, job.jobNumber)) return conflict("LEGACY_READBACK_MISMATCH");
    const mapped = mapLegacyFullQuote(input, job.preservation); if (!mapped) return definiteFailure("LEGACY_INVALID_INPUT");
    if (job.quoteFingerprint === mapped.fingerprint) return { kind: "CONFIRMED", value: { version: job.version, fingerprint: mapped.fingerprint } };
    if (input.finalQuoteNumber.startsWith("LOCAL-") || input.expectedVersion !== job.version || input.expectedCurrentFingerprint !== job.quoteFingerprint) return conflict("LEGACY_VERSION_CONFLICT");
    if (step === "CONCURRENT_STAFF_CHANGE") { job.version = bump(job.version); job.quoteFingerprint = hash("fictional staff drift"); return conflict("LEGACY_VERSION_CONFLICT"); }
    if (step === "SUCCESS_NO_EFFECT") return conflict("LEGACY_READBACK_MISMATCH");
    job.quoteFingerprint = mapped.fingerprint; job.stage = "QUOTE"; job.status = "UNSET"; job.version = bump(job.version);
    if (step === "EFFECT_THEN_RESPONSE_LOSS") {
      const readback = await this.readQuote(input.legacyJobId, context);
      return readback.kind === "CONFIRMED" ? readback : ambiguous();
    }
    return unavailable(context) ? ambiguous() : { kind: "CONFIRMED", value: { version: job.version, fingerprint: mapped.fingerprint } };
  }

  async readQuote(legacyJobId: string, context:LegacyCallContext): Promise<LegacyOutcome<{ version: string; fingerprint: string }>> {
    if(unavailable(context))return definiteFailure("LEGACY_REMOTE_NO_EFFECT");
    const step = this.step("readQuote"); if (step === "DEFINITE_NO_EFFECT") return definiteFailure("LEGACY_REMOTE_NO_EFFECT"); if (step === "EFFECT_THEN_RESPONSE_LOSS") return ambiguous();
    const job = this.boundJob(legacyJobId); return "kind" in job ? job : !job.quoteFingerprint ? conflict("LEGACY_READBACK_MISMATCH") : { kind: "CONFIRMED", value: { version: job.version, fingerprint: job.quoteFingerprint } };
  }

  async uploadFrozenPlan(legacyJobId: string, plan: LegacyFrozenPlan, context:LegacyCallContext): Promise<LegacyOutcome<LegacyUploadedPlan>> {
    if(unavailable(context))return definiteFailure("LEGACY_REMOTE_NO_EFFECT");
    const step = this.step("uploadPlan"); const job = this.boundJob(legacyJobId);
    if ("kind" in job) return job;
    if (job.stage !== "QUOTE" || job.status !== "UNSET" || !job.quoteFingerprint) return conflict("LEGACY_READBACK_MISMATCH");
    if (step === "DEFINITE_NO_EFFECT") return definiteFailure("LEGACY_REMOTE_NO_EFFECT");
    if (!validateLegacyFrozenPlan(this.identity, plan)) return definiteFailure("LEGACY_UPLOAD_INTEGRITY");
    const actual = hash(plan.pdfBytes);
    const existing = job.uploads.get(plan.remoteFileName);
    if (existing) return existing.contentSha256 === actual && existing.byteSize === plan.byteSize ? { kind: "CONFIRMED", value: existing } : conflict("LEGACY_READBACK_MISMATCH");
    if (step === "SUCCESS_NO_EFFECT") return conflict("LEGACY_READBACK_MISMATCH");
    const uploaded = Object.freeze({ remoteFileName: plan.remoteFileName, storageKey: `fictional/${this.identity.companyId}/${this.identity.requestId}/${plan.remoteFileName}`, contentSha256: actual, byteSize: plan.byteSize });
    job.uploads.set(plan.remoteFileName, uploaded);
    return step === "UPLOAD_EFFECT_THEN_LOSS" || step === "EFFECT_THEN_RESPONSE_LOSS" || unavailable(context) ? ambiguous() : { kind: "CONFIRMED", value: { ...uploaded } };
  }

  async attachPlans(legacyJobId: string, expectedVersion: string, plans: readonly LegacyUploadedPlan[], context:LegacyCallContext): Promise<LegacyOutcome<{ version: string }>> {
    if(unavailable(context))return definiteFailure("LEGACY_REMOTE_NO_EFFECT");
    const step = this.step("attachPlans"); const job = this.boundJob(legacyJobId);
    if ("kind" in job) return job;
    if (job.stage !== "QUOTE" || job.status !== "UNSET" || !job.quoteFingerprint) return conflict("LEGACY_READBACK_MISMATCH");
    if (!plans.length || plans.length > 20) return definiteFailure("LEGACY_INVALID_INPUT");
    if (step === "DEFINITE_NO_EFFECT") return definiteFailure("LEGACY_REMOTE_NO_EFFECT");
    if (step === "SUCCESS_NO_EFFECT") return conflict("LEGACY_READBACK_MISMATCH");
    const verified = plans.every((plan) => { const stored = job.uploads.get(plan.remoteFileName); return validateLegacyUploadedPlan(plan) && stored?.contentSha256 === plan.contentSha256 && stored.byteSize === plan.byteSize && stored.storageKey === plan.storageKey; });
    if (!verified || new Set(plans.map((plan) => plan.remoteFileName)).size !== plans.length) return conflict("LEGACY_READBACK_MISMATCH");
    const current = [...job.attachedPlans].sort((a, b) => a.remoteFileName.localeCompare(b.remoteFileName)); const intended = [...plans].sort((a, b) => a.remoteFileName.localeCompare(b.remoteFileName));
    if (current.length === intended.length && intended.every((plan, index) => plan.remoteFileName === current[index].remoteFileName && plan.storageKey === current[index].storageKey && plan.contentSha256 === current[index].contentSha256 && plan.byteSize === current[index].byteSize)) return { kind: "CONFIRMED", value: { version: job.version } };
    if (expectedVersion !== job.version) return conflict("LEGACY_VERSION_CONFLICT");
    const attached = (step === "PARTIAL_ATTACH" ? plans.slice(0, -1) : plans).map((plan): LegacyAttachedPlan => ({ remoteFileName: plan.remoteFileName, storageKey:plan.storageKey, contentSha256: plan.contentSha256, byteSize: plan.byteSize }));
    job.attachedPlans = attached; job.version = bump(job.version);
    if (step === "PARTIAL_ATTACH") return conflict("LEGACY_READBACK_MISMATCH");
    if (step === "ATTACH_EFFECT_THEN_LOSS" || step === "EFFECT_THEN_RESPONSE_LOSS") {
      const readback = await this.readAttachedPlans(legacyJobId,context);
      return readback.kind === "CONFIRMED" && readback.value.length === attached.length ? { kind: "CONFIRMED", value: { version: job.version } } : ambiguous();
    }
    return unavailable(context) ? ambiguous() : { kind: "CONFIRMED", value: { version: job.version } };
  }

  async readAttachedPlans(legacyJobId: string, context:LegacyCallContext): Promise<LegacyOutcome<readonly LegacyAttachedPlan[]>> {
    if(unavailable(context))return definiteFailure("LEGACY_REMOTE_NO_EFFECT");
    const step = this.step("readAttachedPlans"); if (step === "DEFINITE_NO_EFFECT") return definiteFailure("LEGACY_REMOTE_NO_EFFECT"); if (step === "EFFECT_THEN_RESPONSE_LOSS") return ambiguous();
    const job = this.boundJob(legacyJobId); return "kind" in job ? job : { kind: "CONFIRMED", value: job.attachedPlans.map((plan) => ({ ...plan })) };
  }
}

export function createFictionalLegacyAdapter(identity: LegacyAdapterIdentity, env: NodeJS.ProcessEnv, world = new FictionalLegacyWorld()): FictionalLegacyAdapterController | null {
  if (process.env.NODE_ENV === "production") return null;
  try { if (!partnerDemoModeEnabled(env)) return null; } catch { return null; }
  try { return new FictionalLegacyAdapterImpl(identity, world); } catch { return null; }
}

export function createFictionalLegacyAdapterTestHarness(identity: LegacyAdapterIdentity, world = new FictionalLegacyWorld()): FictionalLegacyAdapterController | null {
  if (process.env.NODE_ENV !== "test" || !process.env.VITEST) return null;
  try { return new FictionalLegacyAdapterImpl(identity, world); } catch { return null; }
}
