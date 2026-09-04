import "server-only";
import { createHash } from "node:crypto";
import { mapQuoteToLegacyAdapterShape } from "../quote-adapter";
import { validateLeadDraft } from "../draft";
import { normalizeQuoteDraft, quoteReadiness } from "../quote";
import { canonicalJson } from "../site-plan-hash";
import type { LegacyContract } from "./contract";
import { contractSupportsSafeSubmission, legacySubmissionMarker } from "./contract";
import { legacyTransport, type LegacyTransportConfig } from "./graphql-transport";
import { BoundLegacyCredential, readBoundLegacyCredential } from "./claimed-credential";
import { ambiguous, conflict, definiteFailure, sameLegacyIdentity, validateLegacyFrozenPlan, validateLegacyUploadedPlan, type LegacyAdapter, type LegacyAdapterIdentity, type LegacyAttachedPlan, type LegacyCallContext, type LegacyFrozenPlan, type LegacyJobRecord, type LegacyLeadInput, type LegacyLeadRecord, type LegacyOutcome, type LegacyQuoteWrite, type LegacyUploadedPlan } from "./types";

const CONTACT_FIELDS = `name phoneMobile email streetAddress suburb city postCode`;
const QUOTE_FIELDS = `quoteNumber date status deferralDate totalOverridden depositOverridden sendFollowupEmail sendFollowupText files_QuoteSitePlan wall{SQMPrice SQM cavityDepthMeters c_RValue c_bagCount internal} ceiling{SQMPrice SQM RValue downlights c_thickness c_bagCount} extras{name price} quoteNote consentFee depositPercentage c_contractPrice c_gst c_total c_deposit quoteResultNote`;
const CREATE_LEAD = `mutation PartnerCreateLead($input: CreateJobInput!){createJob(input:$input){_id jobNumber version archivedAt integrationReference notes client{contactDetails{${CONTACT_FIELDS}}} billingModel lead{leadSource}}}`;
const FIND_MARKER = `query PartnerFindMarker($marker:String!,$after:String){jobsByIntegrationReference(reference:$marker,after:$after,first:100){nodes{_id jobNumber version archivedAt integrationReference notes client{contactDetails{${CONTACT_FIELDS}}} billingModel lead{leadSource}} pageInfo{hasNextPage endCursor}}}`;
const GET_JOB = `query PartnerSubmissionJob($id:ObjectId!){job(_id:$id){_id jobNumber version archivedAt integrationReference notes sitePlanNotes billingModel client{contactDetails{${CONTACT_FIELDS}}} lead{leadSource} stage quoteFingerprint quote{${QUOTE_FIELDS}} attachedPlans{fileName storageKey contentSha256 byteSize}}}`;
const UPDATE_QUOTE = `mutation PartnerUpdateFullQuote($input:UpdateJobInput!,$expectedVersion:String!,$emailQuoteToCustomer:Boolean!){updateJob(input:$input,expectedVersion:$expectedVersion,emailQuoteToCustomer:$emailQuoteToCustomer){_id version}}`;
const READ_QUOTE = `query PartnerReadQuote($id:ObjectId!){job(_id:$id){_id version integrationReference quoteFingerprint stage sitePlanNotes quote{${QUOTE_FIELDS}}}}`;
const ATTACH_PLANS = `mutation PartnerAttachPlans($id:ObjectId!,$expectedVersion:String!,$plans:[PartnerPlanInput!]!){attachPartnerPlans(_id:$id,expectedVersion:$expectedVersion,plans:$plans){_id version}}`;
const READ_PLANS = `query PartnerReadPlans($id:ObjectId!){job(_id:$id){_id version integrationReference attachedPlans{fileName storageKey contentSha256 byteSize}}}`;

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, max = 200): string | null => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f-\u009f]/u.test(value) ? value : null;
const positiveInteger = (value: unknown): number | null => Number.isInteger(value) && Number(value) > 0 && Number(value) <= Number.MAX_SAFE_INTEGER ? Number(value) : null;
const fingerprint = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const safeIdentifier = (value: unknown, max = 120): value is string => typeof value === "string" && value.length >= 1 && value.length <= max && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const safeLegacyObjectId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{24}$/i.test(value);
const safeFingerprint = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

export function validateLegacyLeadInput(input: LegacyLeadInput): boolean {
  const validated = validateLeadDraft({ customerName: input.customer.name, customerMobile: input.customer.mobile, customerEmail: input.customer.email,
    siteAddress: input.siteAddress, leadSources: [], notes: input.notes });
  return validated.ok && Array.isArray(input.leadSources) && input.leadSources.length <= 6 && input.leadSources.every((source) => Boolean(text(source, 160))) && Boolean(validated.value.customerName.trim()) && Boolean(validated.value.customerMobile.trim() || validated.value.customerEmail.trim())
    && Object.values(validated.value.siteAddress).every((part) => Boolean(part.trim()))
    && (input.billingModel === undefined || input.billingModel === "INSULHUB_BILLED" || input.billingModel === "PARTNER_BILLED");
}

function normalizedQuoteMatches(input: LegacyQuoteWrite): boolean {
  const normalized = normalizeQuoteDraft(input.quote);
  try { return normalized.ok && quoteReadiness(normalized.value).every((issue) => issue.path === "floorPlan")
    && canonicalJson(normalized.value) === canonicalJson(input.quote); } catch { return false; }
}

function quoteReadbackFingerprint(row: Record<string, unknown>): string | null {
  const quote = record(row.quote);
  if (!quote || row.stage !== "QUOTE" || typeof row.sitePlanNotes !== "string" || row.sitePlanNotes.length > 4000
    || quote.status !== "UNSET" || quote.sendFollowupEmail !== false || quote.sendFollowupText !== false) return null;
  try { return fingerprint({ stage: "QUOTE", sitePlanNotes: row.sitePlanNotes, quote: structuredClone(quote) }); } catch { return null; }
}

export function deriveFinalQuoteNumber(prefix: string, jobNumber: number): string | null {
  return /^[A-Z0-9][A-Z0-9-]{0,39}$/.test(prefix) && Number.isSafeInteger(jobNumber) && jobNumber > 0 ? `${prefix}-${jobNumber}` : null;
}

export function mapLegacyLeadCreate(input: LegacyLeadInput): Record<string, unknown> {
  const contactDetails = { name: input.customer.name, phoneMobile: input.customer.mobile, email: input.customer.email,
    streetAddress: input.siteAddress.street, suburb: input.siteAddress.suburb, city: input.siteAddress.city, postCode: input.siteAddress.postcode };
  return {
    integrationReference: input.marker, ...(input.billingModel ? { billingModel: input.billingModel } : {}), notes: input.notes, stage: "LEAD",
    lead: { leadStatus: "NEW", leadSource: [...input.leadSources], allocation: "UNALLOCATED" },
    client: { name: input.customer.name, contactDetails, billingDetails: { ...contactDetails } },
  };
}

export function legacyLeadCreateFingerprint(input: Pick<LegacyLeadInput, "customer" | "siteAddress" | "billingModel" | "leadSources" | "notes">): string {
  const neutral = { customer: input.customer, siteAddress: input.siteAddress, leadSources: [...input.leadSources], notes: input.notes };
  return fingerprint(input.billingModel ? { customer: input.customer, siteAddress: input.siteAddress, billingModel: input.billingModel, leadSources: [...input.leadSources], notes: input.notes } : neutral);
}

export function mapLegacyFullQuote(input: LegacyQuoteWrite, preserved: LegacyJobRecord["preservation"]): { payload: Record<string, unknown>; fingerprint: string } | null {
  if (!normalizedQuoteMatches(input) || input.finalQuoteNumber.startsWith("LOCAL-") || !/^[A-Z0-9][A-Z0-9-]{0,119}$/.test(input.finalQuoteNumber)
    || typeof preserved.sitePlanNotes !== "string" || preserved.sitePlanNotes.length > 4000) return null;
  const mappedQuote = mapQuoteToLegacyAdapterShape(input.quote);
  const quote = { ...mappedQuote, quoteNumber: input.finalQuoteNumber, status: "UNSET", deferralDate: null, totalOverridden: false, depositOverridden: false,
    sendFollowupEmail: false, sendFollowupText: false,
    files_QuoteSitePlan: [...preserved.quoteSitePlanFiles],
    wall: mappedQuote.wall ? { ...mappedQuote.wall, internal: preserved.wallInternal ?? false } : null };
  const owned = { stage: "QUOTE", sitePlanNotes: preserved.sitePlanNotes, quote };
  return { payload: owned, fingerprint: fingerprint(owned) };
}

function parseLead(value: unknown): LegacyLeadRecord | null {
  const row = record(value); if (!row) return null;
  const id = text(row._id, 120); const marker = text(row.integrationReference, 200); const jobNumber = positiveInteger(row.jobNumber); const version = text(row.version, 120);
  const client = record(row.client); const contact = record(client?.contactDetails);
  const address = contact ? { street: contact.streetAddress, suburb: contact.suburb, city: contact.city, postcode: contact.postCode } : null;
  const archived = row.archivedAt === null ? false : Boolean(text(row.archivedAt, 80));
  if (!id || !safeLegacyObjectId(id) || !marker || !jobNumber || !version || (row.archivedAt !== null && !archived) || !contact || !address) return null;
  if (typeof row.notes !== "string") return null;
  const lead = record(row.lead); if (!lead || !Array.isArray(lead.leadSource) || lead.leadSource.some((source) => typeof source !== "string")) return null;
  const canonicalCreateFingerprint = fingerprint({ customer: { name: contact.name, mobile: contact.phoneMobile, email: contact.email }, siteAddress: address, billingModel: row.billingModel, leadSources: lead.leadSource, notes: row.notes });
  return { id, marker, jobNumber, version, archived, canonicalCreateFingerprint };
}

function parsePlans(value: unknown): LegacyAttachedPlan[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const plans: LegacyAttachedPlan[] = [];
  for (const item of value) { const row = record(item); const remoteFileName = text(row?.fileName, 240); if (!row || !remoteFileName) return null;
    const storageKey=text(row.storageKey,500);if(!storageKey)return null;
    if (row.contentSha256 !== null && (typeof row.contentSha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.contentSha256))) return null;
    if (row.byteSize !== null && (!Number.isInteger(row.byteSize) || Number(row.byteSize) < 1 || Number(row.byteSize) > 5 * 1024 * 1024)) return null;
    plans.push({ remoteFileName, storageKey, contentSha256: row.contentSha256 as string | null, byteSize: row.byteSize as number | null }); }
  return plans;
}

export function resolveLegacyMarkerRecords(records: readonly LegacyLeadRecord[], marker: string, canonicalCreateFingerprint: string): LegacyOutcome<LegacyLeadRecord | null> {
  if (records.some((record) => record.marker !== marker)) return conflict("LEGACY_READBACK_MISMATCH");
  if (records.length > 1) return conflict("LEGACY_DUPLICATE_MARKER");
  if (!records.length) return { kind: "CONFIRMED", value: null };
  if (records[0].archived) return conflict("LEGACY_ARCHIVED_MATCH");
  return records[0].canonicalCreateFingerprint === canonicalCreateFingerprint ? { kind: "CONFIRMED", value: records[0] } : conflict("LEGACY_READBACK_MISMATCH");
}

const CONSTRUCTION_TOKEN = Symbol("approved legacy adapter");
const TEST_CONSTRUCTION_TOKEN = Symbol("test-only legacy adapter");
class GraphqlLegacyAdapter implements LegacyAdapter {
  constructor(readonly identity: LegacyAdapterIdentity, private readonly contract: LegacyContract, private readonly transport: LegacyTransportConfig, token: symbol) {
    const isolatedTest = token === TEST_CONSTRUCTION_TOKEN && process.env.NODE_ENV === "test" && Boolean(process.env.VITEST);
    if ((!isolatedTest && (token !== CONSTRUCTION_TOKEN || !contractSupportsSafeSubmission(contract))) || identity.adapterMode !== "LIVE" || identity.contractVersion !== contract.version) throw new Error("Legacy live contract is unavailable");
  }

  async createLead(input: LegacyLeadInput, context: LegacyCallContext): Promise<LegacyOutcome<LegacyLeadRecord>> {
    const expectedMarker = legacySubmissionMarker(this.identity.companyId, this.identity.requestId);
    if (!sameLegacyIdentity(input.identity, this.identity) || !validateLegacyLeadInput(input) || !expectedMarker || input.marker !== expectedMarker || !safeFingerprint(input.canonicalCreateFingerprint)
      || input.canonicalCreateFingerprint !== legacyLeadCreateFingerprint(input)) return definiteFailure("LEGACY_INVALID_INPUT");
    const result = await legacyTransport<{ createJob?: unknown }>(this.transport, { kind: "GRAPHQL", query: CREATE_LEAD, variables: { input: mapLegacyLeadCreate(input) } }, context);
    if (result.kind !== "CONFIRMED") return result;
    const lead = parseLead(record(result.value)?.createJob); return lead && !lead.archived && lead.marker === input.marker && lead.canonicalCreateFingerprint === input.canonicalCreateFingerprint ? { kind: "CONFIRMED", value: lead } : conflict("LEGACY_READBACK_MISMATCH");
  }

  async findLeadByMarker(marker: string, canonicalCreateFingerprint: string, context: LegacyCallContext): Promise<LegacyOutcome<LegacyLeadRecord | null>> {
    if (marker !== legacySubmissionMarker(this.identity.companyId, this.identity.requestId) || !safeFingerprint(canonicalCreateFingerprint)) return definiteFailure("LEGACY_INVALID_INPUT");
    let after: string | null = null; const seenCursors = new Set<string>(); const matches: LegacyLeadRecord[] = []; const initialBudget=context.remainingMs();
    for (let page = 0; page < this.contract.capabilities.markerPageLimit; page += 1) {
      if (context.signal.aborted || context.remainingMs()<=0 || initialBudget-context.remainingMs() >= this.contract.capabilities.operationTimeoutMs) return conflict("LEGACY_PAGINATION_INCOMPLETE");
      const result = await legacyTransport<{ jobsByIntegrationReference?: unknown }>(this.transport, { kind: "GRAPHQL", query: FIND_MARKER, variables: { marker, after } }, context);
      if (result.kind !== "CONFIRMED") return result;
      const connection = record(record(result.value)?.jobsByIntegrationReference); const nodes = connection?.nodes; const pageInfo = record(connection?.pageInfo);
      if (!Array.isArray(nodes) || nodes.length > 100 || !pageInfo || typeof pageInfo.hasNextPage !== "boolean") return conflict("LEGACY_PAGINATION_INCOMPLETE");
      for (const node of nodes) { const lead = parseLead(node); if (!lead || lead.marker !== marker) return conflict("LEGACY_READBACK_MISMATCH"); matches.push(lead); if (matches.length > 1) return conflict("LEGACY_DUPLICATE_MARKER"); }
      if (!pageInfo.hasNextPage) break;
      const next = text(pageInfo.endCursor, 500); if (!next || seenCursors.has(next) || page === this.contract.capabilities.markerPageLimit - 1) return conflict("LEGACY_PAGINATION_INCOMPLETE");
      seenCursors.add(next); after = next;
    }
    return resolveLegacyMarkerRecords(matches, marker, canonicalCreateFingerprint);
  }

  async getJob(legacyJobId: string, context: LegacyCallContext): Promise<LegacyOutcome<LegacyJobRecord>> {
    if (!safeLegacyObjectId(legacyJobId)) return definiteFailure("LEGACY_INVALID_INPUT");
    const result = await legacyTransport<{ job?: unknown }>(this.transport, { kind: "GRAPHQL", query: GET_JOB, variables: { id: legacyJobId } }, context);
    if (result.kind !== "CONFIRMED") return result;
    const row = record(record(result.value)?.job); const lead = parseLead(row); const plans = parsePlans(row?.attachedPlans);
    const localQuoteFingerprint = row?.stage === "QUOTE" && row ? quoteReadbackFingerprint(row) : null;
    const sitePlanNotes = row?.sitePlanNotes === null ? "" : row?.sitePlanNotes;
    const priorQuote = record(row?.quote); const priorWall = record(priorQuote?.wall); const priorFiles = priorQuote?.files_QuoteSitePlan;
    if (!row || !lead || lead.archived || lead.id !== legacyJobId || !safeLegacyObjectId(lead.id) || lead.marker !== legacySubmissionMarker(this.identity.companyId, this.identity.requestId) || !plans || !text(row.stage, 80)
      || typeof sitePlanNotes !== "string" || sitePlanNotes.length > 4000
      || (priorFiles !== undefined && priorFiles !== null && (!Array.isArray(priorFiles) || priorFiles.length > 20 || priorFiles.some((file) => typeof file !== "string" || file.length > 500)))
      || (row.stage !== "LEAD" && row.stage !== "QUOTE") || (row.stage === "QUOTE" && !localQuoteFingerprint)
      || (row.stage === "LEAD" && row.quoteFingerprint !== null) || (row.quoteFingerprint !== null && row.quoteFingerprint !== localQuoteFingerprint)) return conflict("LEGACY_READBACK_MISMATCH");
    return { kind: "CONFIRMED", value: { ...lead, stage: row.stage as string, status: "UNSET", quoteFingerprint: localQuoteFingerprint,
      attachedPlans: plans, preservation: Object.freeze({ sitePlanNotes, wallInternal: typeof priorWall?.internal === "boolean" ? priorWall.internal : null,
        quoteSitePlanFiles: Object.freeze(Array.isArray(priorFiles) ? [...priorFiles] as string[] : []) }) } };
  }

  async updateFullQuote(input: LegacyQuoteWrite, context: LegacyCallContext): Promise<LegacyOutcome<{ version: string; fingerprint: string }>> {
    if (!sameLegacyIdentity(input.identity, this.identity) || !safeLegacyObjectId(input.legacyJobId) || !safeIdentifier(input.expectedVersion)
      || (input.expectedCurrentFingerprint !== null && !safeFingerprint(input.expectedCurrentFingerprint)) || !normalizedQuoteMatches(input)) return definiteFailure("LEGACY_INVALID_INPUT");
    const current = await this.getJob(input.legacyJobId, context); if (current.kind !== "CONFIRMED") return current;
    if (input.finalQuoteNumber !== deriveFinalQuoteNumber(this.identity.legacyJobPrefix, current.value.jobNumber)) return conflict("LEGACY_READBACK_MISMATCH");
    const mapped = mapLegacyFullQuote(input, current.value.preservation); if (!mapped) return definiteFailure("LEGACY_INVALID_INPUT");
    if (current.value.quoteFingerprint === mapped.fingerprint) return { kind: "CONFIRMED", value: { version: current.value.version, fingerprint: mapped.fingerprint } };
    if (current.value.version !== input.expectedVersion || current.value.quoteFingerprint !== input.expectedCurrentFingerprint) return conflict("LEGACY_VERSION_CONFLICT");
    const mutation = await legacyTransport<{ updateJob?: unknown }>(this.transport, { kind: "GRAPHQL", query: UPDATE_QUOTE,
      variables: { input: { _id: input.legacyJobId, ...mapped.payload }, expectedVersion: input.expectedVersion, emailQuoteToCustomer: false } }, context);
    if (mutation.kind === "DEFINITE_FAILURE" || mutation.kind === "CONFLICT") return mutation;
    const verified = await this.readQuote(input.legacyJobId, context);
    if (verified.kind !== "CONFIRMED") return verified.kind === "CONFLICT" ? verified : ambiguous();
    return verified.value.fingerprint === mapped.fingerprint ? verified : conflict("LEGACY_READBACK_MISMATCH");
  }

  async readQuote(legacyJobId: string, context: LegacyCallContext): Promise<LegacyOutcome<{ version: string; fingerprint: string }>> {
    if (!safeLegacyObjectId(legacyJobId)) return definiteFailure("LEGACY_INVALID_INPUT");
    const result = await legacyTransport<{ job?: unknown }>(this.transport, { kind: "GRAPHQL", query: READ_QUOTE, variables: { id: legacyJobId } }, context); if (result.kind !== "CONFIRMED") return result;
    const row = record(record(result.value)?.job); const version = text(row?.version, 120); const localFingerprint = row ? quoteReadbackFingerprint(row) : null;
    return row && row._id === legacyJobId && safeLegacyObjectId(row._id) && row.integrationReference === legacySubmissionMarker(this.identity.companyId, this.identity.requestId) && version && localFingerprint
      && (row.quoteFingerprint === null || row.quoteFingerprint === localFingerprint) ? { kind: "CONFIRMED", value: { version, fingerprint: localFingerprint } } : conflict("LEGACY_READBACK_MISMATCH");
  }

  async uploadFrozenPlan(legacyJobId: string, plan: LegacyFrozenPlan, context: LegacyCallContext): Promise<LegacyOutcome<LegacyUploadedPlan>> {
    if (!safeLegacyObjectId(legacyJobId) || !validateLegacyFrozenPlan(this.identity, plan)) return definiteFailure("LEGACY_UPLOAD_INTEGRITY");
    const bound = await this.getJob(legacyJobId, context); if (bound.kind !== "CONFIRMED") return bound;
    if (bound.value.stage !== "QUOTE" || bound.value.status !== "UNSET" || !bound.value.quoteFingerprint) return conflict("LEGACY_READBACK_MISMATCH");
    const result = await legacyTransport<{ storageKey?: unknown; fileName?: unknown; contentSha256?: unknown; byteSize?: unknown }>(this.transport, { kind: "UPLOAD", fileName: plan.remoteFileName,
      idempotencyKey: `${this.identity.companyId}:${this.identity.requestId}:${plan.ordinal}`, contentSha256: plan.contentSha256, bytes: plan.pdfBytes, headerPolicy: "UNAPPROVED_RAW_PDF_SCAFFOLD" }, context);
    if (result.kind !== "CONFIRMED") return result;
    const storageKey = text(result.value.storageKey, 500); const uploaded = storageKey ? { storageKey, remoteFileName: plan.remoteFileName, contentSha256: plan.contentSha256, byteSize: plan.byteSize } : null;
    return uploaded && result.value.fileName === plan.remoteFileName && result.value.contentSha256 === plan.contentSha256 && result.value.byteSize === plan.byteSize && validateLegacyUploadedPlan(uploaded)
      ? { kind: "CONFIRMED", value: uploaded } : conflict("LEGACY_READBACK_MISMATCH");
  }

  async attachPlans(legacyJobId: string, expectedVersion: string, plans: readonly LegacyUploadedPlan[], context: LegacyCallContext): Promise<LegacyOutcome<{ version: string }>> {
    if (!safeLegacyObjectId(legacyJobId) || !safeIdentifier(expectedVersion) || !plans.length || plans.length > 20 || plans.some((plan) => !validateLegacyUploadedPlan(plan)) || new Set(plans.map((plan) => plan.remoteFileName)).size !== plans.length) return definiteFailure("LEGACY_INVALID_INPUT");
    const bound = await this.getJob(legacyJobId, context); if (bound.kind !== "CONFIRMED") return bound;
    if (bound.value.stage !== "QUOTE" || bound.value.status !== "UNSET" || !bound.value.quoteFingerprint) return conflict("LEGACY_READBACK_MISMATCH");
    const attached = [...bound.value.attachedPlans].sort((a, b) => a.remoteFileName.localeCompare(b.remoteFileName));
    const intended = [...plans].sort((a, b) => a.remoteFileName.localeCompare(b.remoteFileName));
    const alreadyAttached = intended.length === attached.length && intended.every((plan, index) => plan.remoteFileName === attached[index].remoteFileName
      && plan.storageKey === attached[index].storageKey && plan.contentSha256 === attached[index].contentSha256 && plan.byteSize === attached[index].byteSize);
    if (alreadyAttached) return { kind: "CONFIRMED", value: { version: bound.value.version } };
    if (bound.value.version !== expectedVersion) return conflict("LEGACY_VERSION_CONFLICT");
    const result = await legacyTransport<{ attachPartnerPlans?: unknown }>(this.transport, { kind: "GRAPHQL", query: ATTACH_PLANS,
      variables: { id: legacyJobId, expectedVersion, plans: plans.map((plan) => ({ fileName: plan.remoteFileName, storageKey: plan.storageKey, contentSha256: plan.contentSha256, byteSize: plan.byteSize })) } }, context);
    if (result.kind === "DEFINITE_FAILURE" || result.kind === "CONFLICT") return result;
    const readback = await this.readAttachedPlans(legacyJobId, context);
    if (readback.kind !== "CONFIRMED") return readback.kind === "CONFLICT" ? readback : ambiguous();
    const expected = [...plans].sort((a, b) => a.remoteFileName.localeCompare(b.remoteFileName)); const actual = [...readback.value].sort((a, b) => a.remoteFileName.localeCompare(b.remoteFileName));
    if (expected.length !== actual.length || expected.some((plan, index) => plan.remoteFileName !== actual[index].remoteFileName || plan.storageKey !== actual[index].storageKey || plan.contentSha256 !== actual[index].contentSha256 || plan.byteSize !== actual[index].byteSize)) return result.kind === "AMBIGUOUS" ? ambiguous() : conflict("LEGACY_READBACK_MISMATCH");
    const current = await this.getJob(legacyJobId, context);
    if (current.kind !== "CONFIRMED") return current.kind === "CONFLICT" ? current : ambiguous();
    return { kind: "CONFIRMED", value: { version: current.value.version } };
  }

  async readAttachedPlans(legacyJobId: string, context: LegacyCallContext): Promise<LegacyOutcome<readonly LegacyAttachedPlan[]>> {
    if (!safeLegacyObjectId(legacyJobId)) return definiteFailure("LEGACY_INVALID_INPUT");
    const result = await legacyTransport<{ job?: unknown }>(this.transport, { kind: "GRAPHQL", query: READ_PLANS, variables: { id: legacyJobId } }, context); if (result.kind !== "CONFIRMED") return result;
    const row = record(record(result.value)?.job); const plans = parsePlans(row?.attachedPlans); return plans && row?._id === legacyJobId && safeLegacyObjectId(row._id)
      && row.integrationReference === legacySubmissionMarker(this.identity.companyId, this.identity.requestId) ? { kind: "CONFIRMED", value: plans } : conflict("LEGACY_READBACK_MISMATCH");
  }
}

export function createApprovedGraphqlLegacyAdapter(binding: BoundLegacyCredential): LegacyAdapter | null {
  // An accepted provider DTO/auth/upload implementation does not exist yet.
  // Keep this production seam fail-closed even if a registry entry is added prematurely.
  void binding;
  return null;
}

/** Network-isolated Vitest harness. It is unavailable in every non-test runtime and never enters the live registry. */
export function createGraphqlLegacyAdapterTestHarness(binding: BoundLegacyCredential, fetchImpl: typeof fetch): LegacyAdapter | null {
  if (process.env.NODE_ENV !== "test" || !process.env.VITEST) return null;
  const bound = readBoundLegacyCredential(binding); if (!bound?.accessToken || bound.identity.adapterMode !== "LIVE" || bound.identity.contractVersion !== "test-only-v1" || !bound.identity.baseUrl) return null;
  const contract: LegacyContract = Object.freeze({ version: "test-only-v1", approvedForLive: false, capabilities: Object.freeze({
    exactCreateMarker: true, exhaustiveMarkerPagination: true, remoteVersionCas: true, quoteReadback: true, uploadIdempotency: true,
    uploadContentHashReadback: true, uploadBytesReadback: true, attachmentReadback: true, markerField: "integrationReference" as const,
    providerDto: "UNAPPROVED_SCAFFOLD" as const, graphqlAuthPolicy: "UNAPPROVED_BEARER_SCAFFOLD" as const,
    uploadHeaderPolicy: "UNAPPROVED_RAW_PDF_SCAFFOLD" as const, markerPageLimit: 4, operationTimeoutMs: 5_000,
  }) });
  return new GraphqlLegacyAdapter(bound.identity, contract, { graphqlEndpoint: bound.identity.baseUrl, accessToken: bound.accessToken,
    allowedOrigins: [new URL(bound.identity.baseUrl).origin], timeoutMs: 1_000, fetchImpl, graphqlAuthPolicy: "UNAPPROVED_BEARER_SCAFFOLD" }, TEST_CONSTRUCTION_TOKEN);
}
