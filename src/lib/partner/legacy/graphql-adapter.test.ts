import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createQuoteDraft, PRODUCT_QUOTE_DEFAULTS } from "../quote";
import { encryptLegacyCredential } from "../legacy-credentials";
import { PARTNER_SITE_PLAN_RENDERER_VERSION, PARTNER_SITE_PLAN_TEMPLATE_SHA256 } from "../site-plan-hash";
import { partnerSubmissionRemoteFileName } from "../submission";
import { BoundLegacyCredential } from "./claimed-credential";
import { legacySubmissionMarker } from "./contract";
import { createGraphqlLegacyAdapterTestHarness, legacyLeadCreateFingerprint, mapLegacyFullQuote } from "./graphql-adapter";
import type { LegacyAdapter, LegacyCallContext, LegacyFrozenPlan, LegacyLeadInput, LegacyQuoteWrite, LegacyUploadedPlan } from "./types";

const companyId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const artifactId = "44444444-4444-4444-8444-444444444444";
const legacyJobId = "abcdefabcdefabcdefabcdef";
const marker = legacySubmissionMarker(companyId, requestId)!;
const callContext:LegacyCallContext={signal:new AbortController().signal,remainingMs:()=>60_000};
type TestAdapter={createLead:(input:LegacyLeadInput)=>ReturnType<LegacyAdapter["createLead"]>;findLeadByMarker:(marker:string,fingerprint:string)=>ReturnType<LegacyAdapter["findLeadByMarker"]>;getJob:(id:string)=>ReturnType<LegacyAdapter["getJob"]>;updateFullQuote:(input:LegacyQuoteWrite)=>ReturnType<LegacyAdapter["updateFullQuote"]>;readQuote:(id:string)=>ReturnType<LegacyAdapter["readQuote"]>;uploadFrozenPlan:(id:string,plan:LegacyFrozenPlan)=>ReturnType<LegacyAdapter["uploadFrozenPlan"]>;attachPlans:(id:string,version:string,plans:readonly LegacyUploadedPlan[])=>ReturnType<LegacyAdapter["attachPlans"]>;readAttachedPlans:(id:string)=>ReturnType<LegacyAdapter["readAttachedPlans"]>};
function testAdapter(bound:BoundLegacyCredential,fetchImpl:typeof fetch):TestAdapter{const adapter=createGraphqlLegacyAdapterTestHarness(bound,fetchImpl)!;return {createLead:(input)=>adapter.createLead(input,callContext),findLeadByMarker:(value,fingerprint)=>adapter.findLeadByMarker(value,fingerprint,callContext),getJob:(id)=>adapter.getJob(id,callContext),updateFullQuote:(input)=>adapter.updateFullQuote(input,callContext),readQuote:(id)=>adapter.readQuote(id,callContext),uploadFrozenPlan:(id,plan)=>adapter.uploadFrozenPlan(id,plan,callContext),attachPlans:(id,version,plans)=>adapter.attachPlans(id,version,plans,callContext),readAttachedPlans:(id)=>adapter.readAttachedPlans(id,callContext)};}
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

function binding() {
  const endpoint = "https://legacy.test/graphql"; const keyring = { activeVersion: 2, keys: new Map([[2, Buffer.alloc(32, 9)]]) };
  const encrypted = encryptLegacyCredential({ accessToken: "test-transport-token" }, { companyId, endpoint }, keyring);
  return BoundLegacyCredential.bind({ companyId, requestId, adapterMode: "LIVE", contractVersion: "test-only-v1", legacyJobPrefix: "NW", legacyBaseUrl: endpoint,
    legacyCredentialCiphertext: encrypted.ciphertext, legacyCredentialNonce: encrypted.nonce, legacyCredentialKeyVersion: 2,
    legacyCredentialFingerprint: createHash("sha256").update(encrypted.ciphertext).update(encrypted.nonce).digest("hex"), legacyCredentialUpdatedAt: "2026-08-30T00:00:00.000Z" },
  { env: { NODE_ENV: "test", PARTNER_LEGACY_ALLOWED_ORIGINS: "https://legacy.test" }, keyring })!;
}

const leadBase = { customer: { name: "Hine", mobile: "021 555", email: "" }, siteAddress: { street: "12 Māhoe Road", suburb: "Ōtāhuhu", city: "Auckland", postcode: "1062" },
  billingModel: "INSULHUB_BILLED" as const, leadSources: ["REFERRAL"], notes: "Kia ora" };

function leadInput(bound = binding()): LegacyLeadInput {
  return { identity: bound.identity, marker, canonicalCreateFingerprint: legacyLeadCreateFingerprint(leadBase), ...leadBase };
}

function jobRow(overrides: Record<string, unknown> = {}) {
  const contact = { name: "Hine", phoneMobile: "021 555", email: "", streetAddress: "12 Māhoe Road", suburb: "Ōtāhuhu", city: "Auckland", postCode: "1062" };
  return { _id: legacyJobId, jobNumber: 123, version: "1", archivedAt: null, integrationReference: marker, notes: "Kia ora", sitePlanNotes: "preserve exact site plan notes", billingModel: "INSULHUB_BILLED",
    client: { name: "Hine", contactDetails: contact, billingDetails: contact }, lead: { leadStatus: "NEW", leadSource: ["REFERRAL"], allocation: "UNALLOCATED",
      allocatedTo: null, callbackDate: null, quoteBookingDate: null, quoteBookingSendEmailReminder: false, quoteBookingSendTextReminder: false },
    installation: { installDate: null, installNote: "preserve", installStatus: null, checkSheetSignedAsComplete: false }, stage: "LEAD",
    quoteFingerprint: null, quote: null, attachedPlans: [], ...overrides };
}

function quoteWrite(bound = binding()): LegacyQuoteWrite {
  const quote = createQuoteDraft(PRODUCT_QUOTE_DEFAULTS, "LOCAL-READY", "2026-08-30T00:00:00.000Z");
  quote.wall = { enabled: true, areaSqm: 100, rateCentsPerSqm: 1000, cavityDepthCm: 10 };
  return { identity: bound.identity, legacyJobId, expectedVersion: "1", expectedCurrentFingerprint: null, finalQuoteNumber: "NW-123", quote };
}

function frozenPlan(): LegacyFrozenPlan {
  const pdfBytes = Buffer.from("%PDF-1.7\nexact adapter bytes"); const contentSha256 = createHash("sha256").update(pdfBytes).digest("hex");
  return { ordinal: 0, artifactId, remoteFileName: partnerSubmissionRemoteFileName("NW", requestId, 0, artifactId, contentSha256), contentSha256,
    byteSize: pdfBytes.length, pdfBytes, rendererVersion: PARTNER_SITE_PLAN_RENDERER_VERSION, templateVersion: "site-plan-template-v2", templateSha256: PARTNER_SITE_PLAN_TEMPLATE_SHA256 };
}

describe("test-isolated GraphQL adapter contract", () => {
  it("exhaustively paginates an exact marker and stops repeated cursors without unbounded calls", async () => {
    const bound = binding(); const node = jobRow(); let calls = 0;
    const fetchImpl = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      calls += 1; const body = JSON.parse(String(init?.body)) as { variables: { after: string | null } };
      return json({ data: { jobsByIntegrationReference: body.variables.after === null
        ? { nodes: [], pageInfo: { hasNextPage: true, endCursor: "cursor-1" } }
        : { nodes: [node], pageInfo: { hasNextPage: false, endCursor: null } } } });
    });
    const adapter = testAdapter(bound, fetchImpl as typeof fetch);
    expect((await adapter.findLeadByMarker(marker, leadInput(bound).canonicalCreateFingerprint)).kind).toBe("CONFIRMED"); expect(calls).toBe(2);

    const repeated = vi.fn(async () => json({ data: { jobsByIntegrationReference: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "same" } } } }));
    const repeatedAdapter = testAdapter(bound, repeated as typeof fetch);
    expect((await repeatedAdapter.findLeadByMarker(marker, leadInput(bound).canonicalCreateFingerprint)).kind).toBe("CONFLICT"); expect(repeated).toHaveBeenCalledTimes(2);
  });

  it("validates create fields before fetch and projects every field needed for marker recovery", async () => {
    const bound = binding(); const fetchImpl = vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) => { void _url; void _init; return json({ data: { createJob: jobRow() } }); });
    const adapter = testAdapter(bound, fetchImpl as typeof fetch);
    expect((await adapter.createLead(leadInput(bound))).kind).toBe("CONFIRMED");
    const sent = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)) as { query: string; variables: { input: Record<string, unknown> } };
    expect(sent.query).toMatch(/archivedAt.*integrationReference.*notes.*contactDetails.*billingModel.*leadSource/);
    expect(sent.variables.input).toEqual(expect.objectContaining({ integrationReference: marker, stage: "LEAD", billingModel: "INSULHUB_BILLED" }));
    expect((await adapter.createLead({ ...leadInput(bound), customer: { ...leadBase.customer, name: "" } })).kind).toBe("DEFINITE_FAILURE");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const archived = testAdapter(bound, vi.fn(async () => json({ data: { createJob: jobRow({ archivedAt: "2026-08-30T00:00:00.000Z" }) } })) as typeof fetch);
    expect((await archived.createLead(leadInput(bound))).kind).toBe("CONFLICT");
    const malformed = testAdapter(bound, vi.fn(async () => json({ data: { createJob: jobRow({ _id: "not-an-object-id" }) } })) as typeof fetch);
    expect((await malformed.createLead(leadInput(bound))).kind).toBe("CONFLICT");
  });

  it("recovers quote response loss only from exact full readback and rejects flag drift", async () => {
    const bound = binding(); const input = quoteWrite(bound); const mapped = mapLegacyFullQuote(input, { sitePlanNotes: "", wallInternal: null, quoteSitePlanFiles: [] })!;
    const quoted = jobRow({ version: "2", stage: "QUOTE", sitePlanNotes: "", quoteFingerprint: mapped.fingerprint, quote: mapped.payload.quote });
    let sentUpdate: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("PartnerSubmissionJob")) return json({ data: { job: jobRow({ sitePlanNotes: null }) } });
      if (body.query.includes("PartnerUpdateFullQuote")) { sentUpdate = body.variables; throw new Error("response lost after effect"); }
      return json({ data: { job: quoted } });
    });
    const adapter = testAdapter(bound, fetchImpl as typeof fetch);
    expect(await adapter.updateFullQuote(input)).toEqual({ kind: "CONFIRMED", value: { version: "2", fingerprint: mapped.fingerprint } });
    expect(sentUpdate).toEqual(expect.objectContaining({ expectedVersion: "1", emailQuoteToCustomer: false,
      input: expect.objectContaining({ _id: legacyJobId, stage: "QUOTE", sitePlanNotes: "", quote: mapped.payload.quote }) }));
    const sentInput = (sentUpdate as unknown as { input: Record<string, unknown> } | null)?.input;
    expect(sentInput && Object.keys(sentInput).sort()).toEqual(["_id", "quote", "sitePlanNotes", "stage"]);
    const retryFetch = vi.fn(async () => json({ data: { job: quoted } }));
    expect(await testAdapter(bound, retryFetch as typeof fetch).updateFullQuote(input)).toEqual({ kind: "CONFIRMED", value: { version: "2", fingerprint: mapped.fingerprint } });
    expect(retryFetch).toHaveBeenCalledTimes(1);

    const driftFetch = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      if (body.query.includes("PartnerSubmissionJob")) return json({ data: { job: jobRow() } });
      if (body.query.includes("PartnerUpdateFullQuote")) return json({ data: { updateJob: { _id: legacyJobId, version: "2" } } });
      return json({ data: { job: { ...quoted, quote: { ...(mapped.payload.quote as Record<string, unknown>), sendFollowupEmail: true } } } });
    });
    expect((await testAdapter(bound, driftFetch as typeof fetch).updateFullQuote(input)).kind).toBe("CONFLICT");
  });

  it("keeps upload loss ambiguous and confirms attach loss or retry only by exact readback", async () => {
    const bound = binding(); const frozen = frozenPlan();
    const quote = quoteWrite(bound); const mapped = mapLegacyFullQuote(quote, { sitePlanNotes: "preserve exact site plan notes", wallInternal: null, quoteSitePlanFiles: [] })!;
    const quotedJob = (overrides: Record<string, unknown> = {}) => jobRow({ version: "2", stage: "QUOTE", quoteFingerprint: mapped.fingerprint, quote: mapped.payload.quote, ...overrides });
    const uploadFetch = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      if (String(init?.headers && JSON.stringify(init.headers)).includes("application/pdf")) throw new Error("upload response lost");
      return json({ data: { job: quotedJob() } });
    });
    expect((await testAdapter(bound, uploadFetch as typeof fetch).uploadFrozenPlan(legacyJobId, frozen)).kind).toBe("AMBIGUOUS");
    const uploaded: LegacyUploadedPlan = { remoteFileName: frozen.remoteFileName, storageKey: "safe/storage.pdf", contentSha256: frozen.contentSha256, byteSize: frozen.byteSize };
    let getCalls = 0;
    const attachFetch = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      if (body.query.includes("PartnerSubmissionJob")) { getCalls += 1; return json({ data: { job: quotedJob({ version: getCalls === 1 ? "2" : "3", attachedPlans: getCalls === 1 ? [] : [{ fileName: uploaded.remoteFileName, storageKey: uploaded.storageKey, contentSha256: uploaded.contentSha256, byteSize: uploaded.byteSize }] }) } }); }
      if (body.query.includes("PartnerAttachPlans")) throw new Error("attach response lost");
      return json({ data: { job: { _id: legacyJobId, version: "3", integrationReference: marker, attachedPlans: [{ fileName: uploaded.remoteFileName, storageKey: uploaded.storageKey, contentSha256: uploaded.contentSha256, byteSize: uploaded.byteSize }] } } });
    });
    const adapter = testAdapter(bound, attachFetch as typeof fetch);
    expect((await adapter.attachPlans(legacyJobId, "2", [uploaded])).kind).toBe("CONFIRMED");
    const retryFetch = vi.fn(async () => json({ data: { job: quotedJob({ version: "3", attachedPlans: [{ fileName: uploaded.remoteFileName, storageKey: uploaded.storageKey, contentSha256: uploaded.contentSha256, byteSize: uploaded.byteSize }] }) } }));
    expect(await testAdapter(bound, retryFetch as typeof fetch).attachPlans(legacyJobId, "2", [uploaded])).toEqual({ kind: "CONFIRMED", value: { version: "3" } });
    expect(retryFetch).toHaveBeenCalledTimes(1);
  });
});
