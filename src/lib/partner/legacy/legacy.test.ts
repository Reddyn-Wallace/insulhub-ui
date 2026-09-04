import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createQuoteDraft, PRODUCT_QUOTE_DEFAULTS } from "../quote";
import { PARTNER_SITE_PLAN_RENDERER_VERSION, PARTNER_SITE_PLAN_TEMPLATE_SHA256 } from "../site-plan-hash";
import { partnerSubmissionRemoteFileName } from "../submission";
import { PARTNER_DEMO_CONFIRMATION } from "../demo";
import { encryptLegacyCredential } from "../legacy-credentials";
import { BoundLegacyCredential } from "./claimed-credential";
import { legacySubmissionMarker } from "./contract";
import { createFictionalLegacyAdapter, createFictionalLegacyAdapterTestHarness, type FictionalLegacyAdapterController, type FictionalOperation } from "./fake";
import { createLegacyAdapter, FictionalLegacyRegistry } from "./factory";
import { deriveFinalQuoteNumber, legacyLeadCreateFingerprint, mapLegacyFullQuote, resolveLegacyMarkerRecords } from "./graphql-adapter";
import { createFictionalNotificationAdapter, createFictionalNotificationAdapterTestHarness, FictionalNotificationWorld, productionNotificationAdapter } from "./notification";
import { validateLegacyUploadedPlan, type LegacyAdapterIdentity, type LegacyCallContext, type LegacyFrozenPlan, type LegacyLeadInput, type LegacyQuoteWrite } from "./types";

const companyId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const artifactId = "44444444-4444-4444-8444-444444444444";
const identity: LegacyAdapterIdentity = { companyId, requestId, adapterMode: "FICTIONAL", contractVersion: "fictional-v1", legacyJobPrefix: "NW", baseUrl: null, credentialKeyVersion: null, credentialFingerprint: null, credentialUpdatedAt: null };
const marker = legacySubmissionMarker(companyId, requestId)!;
const leadBase = { customer: { name: "Hine", mobile: "021 555", email: "" }, siteAddress: { street: "12 Māhoe Road", suburb: "Ōtāhuhu", city: "Auckland", postcode: "1062" }, billingModel: "INSULHUB_BILLED" as const, leadSources: ["REFERRAL"], notes: "Kia ora" };
const lead: LegacyLeadInput = { identity, marker, canonicalCreateFingerprint: legacyLeadCreateFingerprint(leadBase), ...leadBase };
const callContext:LegacyCallContext={signal:new AbortController().signal,remainingMs:()=>60_000};
type TestFictional=Omit<FictionalLegacyAdapterController,"queue"|"createLead"|"findLeadByMarker"|"getJob"|"updateFullQuote"|"readQuote"|"uploadFrozenPlan"|"attachPlans"|"readAttachedPlans">&{queue:(operation:FictionalOperation,...windows:Parameters<FictionalLegacyAdapterController["queue"]>[1][])=>TestFictional;
  createLead:(input:LegacyLeadInput)=>ReturnType<FictionalLegacyAdapterController["createLead"]>;findLeadByMarker:(marker:string,fingerprint:string)=>ReturnType<FictionalLegacyAdapterController["findLeadByMarker"]>;
  getJob:(id:string)=>ReturnType<FictionalLegacyAdapterController["getJob"]>;updateFullQuote:(input:LegacyQuoteWrite)=>ReturnType<FictionalLegacyAdapterController["updateFullQuote"]>;readQuote:(id:string)=>ReturnType<FictionalLegacyAdapterController["readQuote"]>;
  uploadFrozenPlan:(id:string,plan:LegacyFrozenPlan)=>ReturnType<FictionalLegacyAdapterController["uploadFrozenPlan"]>;attachPlans:(id:string,version:string,plans:Parameters<FictionalLegacyAdapterController["attachPlans"]>[2])=>ReturnType<FictionalLegacyAdapterController["attachPlans"]>;readAttachedPlans:(id:string)=>ReturnType<FictionalLegacyAdapterController["readAttachedPlans"]>};
function bindTestAdapter(adapter:FictionalLegacyAdapterController):TestFictional {
  const proxy: TestFictional = new Proxy(adapter, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (key === "queue" && typeof value === "function") return (...args: unknown[]) => { value.apply(target, args); return proxy; };
    return ["createLead","findLeadByMarker","getJob","updateFullQuote","readQuote","uploadFrozenPlan","attachPlans","readAttachedPlans"].includes(String(key)) && typeof value === "function"
      ? (...args: unknown[]) => value.apply(target, [...args, callContext]) : typeof value === "function" ? value.bind(target) : value;
  } }) as TestFictional;
  return proxy;
}

function readyQuote() {
  const quote = createQuoteDraft(PRODUCT_QUOTE_DEFAULTS, "LOCAL-READY", "2026-08-30T00:00:00.000Z");
  quote.wall = { enabled: true, areaSqm: 100, rateCentsPerSqm: 1000, cavityDepthCm: 10 }; return quote;
}

function plan(ordinal = 0, selectedArtifactId = artifactId): LegacyFrozenPlan {
  const pdfBytes = Buffer.from("%PDF-1.7\nfictional exact bytes"); const contentSha256 = createHash("sha256").update(pdfBytes).digest("hex");
  return { ordinal, artifactId: selectedArtifactId, remoteFileName: partnerSubmissionRemoteFileName("NW", requestId, ordinal, selectedArtifactId, contentSha256), contentSha256,
    byteSize: pdfBytes.byteLength, pdfBytes, rendererVersion: PARTNER_SITE_PLAN_RENDERER_VERSION, templateVersion: "site-plan-template-v2", templateSha256: PARTNER_SITE_PLAN_TEMPLATE_SHA256 };
}

describe("fictional legacy adapter", () => {
  const fictional = () => bindTestAdapter(createFictionalLegacyAdapterTestHarness(identity)!);
  it("recovers an effect-plus-response-loss by the exact stable marker without duplicate creation", async () => {
    const fake = fictional().queue("createLead", "EFFECT_THEN_RESPONSE_LOSS");
    expect((await fake.createLead(lead)).kind).toBe("AMBIGUOUS");
    const recovered = await fake.findLeadByMarker(marker, lead.canonicalCreateFingerprint);
    expect(recovered.kind).toBe("CONFIRMED"); expect(recovered.kind === "CONFIRMED" && recovered.value?.marker).toBe(marker);
    expect(fake.callCounts.createLead).toBe(1); expect(fake.callCounts.findLead).toBe(1);
  });

  it.each<[FictionalOperation, string]>([["findLead", "INCOMPLETE_PAGINATION"], ["findLead", "DUPLICATE_MARKER"], ["findLead", "ARCHIVED_MATCH"]])("scripts %s safely", async (operation, step) => {
    const fake = fictional().queue(operation, step as never); fake.seedJob({ id: "fictional-one", marker, canonicalCreateFingerprint: lead.canonicalCreateFingerprint, archived: step === "ARCHIVED_MATCH" });
    expect((await fake.findLeadByMarker(marker, lead.canonicalCreateFingerprint)).kind).toBe("CONFLICT");
  });

  it("enforces quote CAS, final numbering, no customer sends, exact PDF bytes and attach readback", async () => {
    const fake = fictional(); const created = await fake.createLead(lead); expect(created.kind).toBe("CONFIRMED");
    if (created.kind !== "CONFIRMED") throw new Error("fixture");
    const quoteWrite: LegacyQuoteWrite = { identity, legacyJobId: created.value.id, expectedVersion: created.value.version, expectedCurrentFingerprint: null, finalQuoteNumber: `NW-${created.value.jobNumber}`, quote: readyQuote() };
    const quote = await fake.updateFullQuote(quoteWrite); expect(quote.kind).toBe("CONFIRMED");
    const invalid = await fake.updateFullQuote({ ...quoteWrite, finalQuoteNumber: "LOCAL-BAD" }); expect(invalid.kind).toBe("CONFLICT");
    const frozen = plan(); const uploaded = await fake.uploadFrozenPlan(created.value.id, frozen); expect(uploaded.kind).toBe("CONFIRMED");
    if (uploaded.kind !== "CONFIRMED" || quote.kind !== "CONFIRMED") throw new Error("fixture");
    fake.queue("attachPlans", "ATTACH_EFFECT_THEN_LOSS"); expect((await fake.attachPlans(created.value.id, quote.value.version, [uploaded.value])).kind).toBe("CONFIRMED");
    expect((await fake.attachPlans(created.value.id, quote.value.version, [uploaded.value])).kind).toBe("CONFIRMED");
    expect(await fake.readAttachedPlans(created.value.id)).toEqual({ kind: "CONFIRMED", value: [{ remoteFileName: frozen.remoteFileName, storageKey: uploaded.value.storageKey, contentSha256: frozen.contentSha256, byteSize: frozen.byteSize }] });
    expect((await fake.getJob(created.value.id))).not.toHaveProperty("value.uploads");
  });

  it("models quote response loss, staff drift, upload loss and readback without duplicating effects", async () => {
    const fake = fictional(); const created = await fake.createLead(lead);
    if (created.kind !== "CONFIRMED") throw new Error("fixture");
    const input: LegacyQuoteWrite = { identity, legacyJobId: created.value.id, expectedVersion: "1", expectedCurrentFingerprint: null,
      finalQuoteNumber: `NW-${created.value.jobNumber}`, quote: readyQuote() };
    fake.queue("updateQuote", "EFFECT_THEN_RESPONSE_LOSS");
    expect((await fake.updateFullQuote(input)).kind).toBe("CONFIRMED");
    expect((await fake.updateFullQuote(input)).kind).toBe("CONFIRMED");
    const quote = await fake.readQuote(created.value.id); expect(quote.kind).toBe("CONFIRMED");
    if (quote.kind !== "CONFIRMED") throw new Error("fixture");
    const changedQuote = readyQuote(); changedQuote.comments = "changed intent";
    fake.queue("updateQuote", "CONCURRENT_STAFF_CHANGE");
    expect((await fake.updateFullQuote({ ...input, quote: changedQuote, expectedVersion: quote.value.version, expectedCurrentFingerprint: quote.value.fingerprint })).kind).toBe("CONFLICT");
    fake.queue("uploadPlan", "UPLOAD_EFFECT_THEN_LOSS"); const frozen = plan(); expect((await fake.uploadFrozenPlan(created.value.id, frozen)).kind).toBe("AMBIGUOUS");
    expect((await fake.uploadFrozenPlan(created.value.id, frozen)).kind).toBe("CONFIRMED"); expect(fake.callCounts.uploadPlan).toBe(2);
  });

  it("covers definite no-effect, success-no-effect, read loss and partial multi-plan attachment deterministically", async () => {
    const noEffect = fictional().queue("createLead", "DEFINITE_NO_EFFECT");
    expect((await noEffect.createLead(lead)).kind).toBe("DEFINITE_FAILURE");
    expect(await noEffect.findLeadByMarker(marker, lead.canonicalCreateFingerprint)).toEqual({ kind: "CONFIRMED", value: null });
    const falseSuccess = fictional().queue("createLead", "SUCCESS_NO_EFFECT");
    expect((await falseSuccess.createLead(lead)).kind).toBe("CONFLICT"); expect(falseSuccess.callCounts.createLead).toBe(1);

    const fake = fictional(); const created = await fake.createLead(lead); if (created.kind !== "CONFIRMED") throw new Error("fixture");
    const input: LegacyQuoteWrite = { identity, legacyJobId: created.value.id, expectedVersion: "1", expectedCurrentFingerprint: null, finalQuoteNumber: `NW-${created.value.jobNumber}`, quote: readyQuote() };
    const quote = await fake.updateFullQuote(input); if (quote.kind !== "CONFIRMED") throw new Error("fixture");
    fake.queue("readQuote", "EFFECT_THEN_RESPONSE_LOSS"); expect((await fake.readQuote(created.value.id)).kind).toBe("AMBIGUOUS");
    const first = await fake.uploadFrozenPlan(created.value.id, plan());
    const second = await fake.uploadFrozenPlan(created.value.id, plan(1, "66666666-6666-4666-8666-666666666666"));
    if (first.kind !== "CONFIRMED" || second.kind !== "CONFIRMED") throw new Error("fixture");
    fake.queue("attachPlans", "PARTIAL_ATTACH"); expect((await fake.attachPlans(created.value.id, quote.value.version, [first.value, second.value])).kind).toBe("CONFLICT");
    expect(await fake.readAttachedPlans(created.value.id)).toEqual({ kind: "CONFIRMED", value: [{ remoteFileName: first.value.remoteFileName, storageKey: first.value.storageKey, contentSha256: first.value.contentSha256, byteSize: first.value.byteSize }] });
  });

  it("keeps tenants isolated and reuses a process registry for response-loss recovery", async () => {
    const registry = new FictionalLegacyRegistry(); const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PARTNER_DEMO_MODE: "true", PARTNER_DEMO_CONFIRM: PARTNER_DEMO_CONFIRMATION, PARTNER_APP_ORIGIN: "http://127.0.0.1:3000/" };
    const binding = BoundLegacyCredential.bind({ companyId, requestId, adapterMode: "FICTIONAL", contractVersion: "fictional-v1", legacyJobPrefix: "NW", legacyBaseUrl: null, legacyCredentialCiphertext: null, legacyCredentialNonce: null, legacyCredentialKeyVersion: null, legacyCredentialFingerprint: null, legacyCredentialUpdatedAt: null }, { env })!;
    const first = createLegacyAdapter(binding, { env, fictionalRegistry: registry }); const second = createLegacyAdapter(binding, { env, fictionalRegistry: registry });
    expect(first.kind).toBe("AVAILABLE"); expect(second.kind).toBe("AVAILABLE");
    expect(first.kind === "AVAILABLE" && second.kind === "AVAILABLE" && first.adapter).toBe(second.kind === "AVAILABLE" ? second.adapter : null);
    const otherBinding = BoundLegacyCredential.bind({ companyId: "55555555-5555-4555-8555-555555555555", requestId, adapterMode: "FICTIONAL", contractVersion: "fictional-v1", legacyJobPrefix: "NW", legacyBaseUrl: null, legacyCredentialCiphertext: null, legacyCredentialNonce: null, legacyCredentialKeyVersion: null, legacyCredentialFingerprint: null, legacyCredentialUpdatedAt: null }, { env })!;
    const other = createLegacyAdapter(otherBinding, { env, fictionalRegistry: registry });
    expect(other.kind === "AVAILABLE" && first.kind === "AVAILABLE" && other.adapter).not.toBe(first.kind === "AVAILABLE" ? first.adapter : null);

    const secondRequestId = "77777777-7777-4777-8777-777777777777";
    const secondBinding = BoundLegacyCredential.bind({ companyId, requestId: secondRequestId, adapterMode: "FICTIONAL", contractVersion: "fictional-v1", legacyJobPrefix: "NW", legacyBaseUrl: null,
      legacyCredentialCiphertext: null, legacyCredentialNonce: null, legacyCredentialKeyVersion: null, legacyCredentialFingerprint: null, legacyCredentialUpdatedAt: null }, { env })!;
    const sameCompanySecond = createLegacyAdapter(secondBinding, { env, fictionalRegistry: registry });
    if (first.kind !== "AVAILABLE" || sameCompanySecond.kind !== "AVAILABLE") throw new Error("fixture");
    const firstLead = { ...lead, identity: first.adapter.identity }; const firstCreated = await first.adapter.createLead(firstLead,callContext);
    const secondBase = { ...leadBase, notes: "second request" }; const secondLead = { ...secondBase, identity: sameCompanySecond.adapter.identity,
      marker: legacySubmissionMarker(companyId, secondRequestId)!, canonicalCreateFingerprint: legacyLeadCreateFingerprint(secondBase) };
    const secondCreated = await sameCompanySecond.adapter.createLead(secondLead,callContext);
    if (firstCreated.kind !== "CONFIRMED" || secondCreated.kind !== "CONFIRMED") throw new Error("fixture");
    expect(secondCreated.value.jobNumber).toBe(firstCreated.value.jobNumber + 1); expect(secondCreated.value.id).not.toBe(firstCreated.value.id);
    expect(deriveFinalQuoteNumber("NW", secondCreated.value.jobNumber)).not.toBe(deriveFinalQuoteNumber("NW", firstCreated.value.jobNumber));
    expect((await sameCompanySecond.adapter.getJob(firstCreated.value.id,callContext)).kind).toBe("CONFLICT");
    expect((await sameCompanySecond.adapter.updateFullQuote({ identity: sameCompanySecond.adapter.identity, legacyJobId: firstCreated.value.id, expectedVersion: "1",
      expectedCurrentFingerprint: null, finalQuoteNumber: `NW-${firstCreated.value.jobNumber}`, quote: readyQuote() },callContext)).kind).toBe("CONFLICT");
    expect((await sameCompanySecond.adapter.uploadFrozenPlan(firstCreated.value.id, plan(),callContext)).kind).toBe("CONFLICT");
    expect((await sameCompanySecond.adapter.readAttachedPlans(firstCreated.value.id,callContext)).kind).toBe("CONFLICT");

    const driftedBinding = BoundLegacyCredential.bind({ companyId, requestId, adapterMode: "FICTIONAL", contractVersion: "fictional-v1", legacyJobPrefix: "DRIFT", legacyBaseUrl: null,
      legacyCredentialCiphertext: null, legacyCredentialNonce: null, legacyCredentialKeyVersion: null, legacyCredentialFingerprint: null, legacyCredentialUpdatedAt: null }, { env })!;
    expect(createLegacyAdapter(driftedBinding, { env, fictionalRegistry: registry }).kind).toBe("UNAVAILABLE");
  });
});

describe("factory, mapping and notification safety", () => {
  it("binds a claimed encrypted credential without making its token serializable and rejects provenance drift", () => {
    const keyring = { activeVersion: 7, keys: new Map([[7, Buffer.alloc(32, 4)]]) };
    const endpoint = "https://legacy.test/graphql"; const accessToken = "token-canary-never-serialize";
    const encrypted = encryptLegacyCredential({ accessToken }, { companyId, endpoint }, keyring);
    const fingerprint = createHash("sha256").update(encrypted.ciphertext).update(encrypted.nonce).digest("hex");
    const claim = { companyId, requestId, adapterMode: "LIVE" as const, contractVersion: "unapproved-v1", legacyJobPrefix: "NW", legacyBaseUrl: endpoint,
      legacyCredentialCiphertext: encrypted.ciphertext, legacyCredentialNonce: encrypted.nonce, legacyCredentialKeyVersion: 7,
      legacyCredentialFingerprint: fingerprint, legacyCredentialUpdatedAt: "2026-08-30T00:00:00.000Z" };
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PARTNER_LEGACY_ALLOWED_ORIGINS: "https://legacy.test" };
    const binding = BoundLegacyCredential.bind(claim, { env, keyring });
    expect(binding).not.toBeNull(); expect(JSON.stringify(binding)).not.toContain(accessToken); expect(Object.keys(binding!)).toEqual([]);
    const fetchSpy = vi.spyOn(globalThis, "fetch"); expect(createLegacyAdapter(binding!, { env }).kind).toBe("UNAVAILABLE"); expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore();
    expect(BoundLegacyCredential.bind({ ...claim, companyId: "55555555-5555-4555-8555-555555555555" }, { env, keyring })).toBeNull();
    expect(BoundLegacyCredential.bind({ ...claim, legacyBaseUrl: "https://other.test/graphql" }, { env, keyring })).toBeNull();
    expect(BoundLegacyCredential.bind({ ...claim, legacyCredentialKeyVersion: 8 }, { env, keyring })).toBeNull();
    expect(BoundLegacyCredential.bind({ ...claim, legacyCredentialFingerprint: "0".repeat(64) }, { env, keyring })).toBeNull();
    expect(BoundLegacyCredential.bind({ ...claim, legacyCredentialUpdatedAt: "not-a-date" }, { env, keyring })).toBeNull();
  });

  it("never selects fake in production or live when no approved contract exists and makes zero network calls", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const productionEnv: NodeJS.ProcessEnv = { NODE_ENV: "production", PARTNER_DEMO_MODE: "true", PARTNER_DEMO_CONFIRM: PARTNER_DEMO_CONFIRMATION, PARTNER_APP_ORIGIN: "https://portal.test" };
    const fictional = BoundLegacyCredential.bind({ companyId, requestId, adapterMode: "FICTIONAL", contractVersion: "fictional-v1", legacyJobPrefix: "NW", legacyBaseUrl: null, legacyCredentialCiphertext: null, legacyCredentialNonce: null, legacyCredentialKeyVersion: null, legacyCredentialFingerprint: null, legacyCredentialUpdatedAt: null })!;
    expect(createLegacyAdapter(fictional, { env: productionEnv }).kind).toBe("UNAVAILABLE");
    expect(createFictionalLegacyAdapter(identity, productionEnv)).toBeNull(); expect(createFictionalNotificationAdapter(productionEnv)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore();
  });

  it("maps a full quote without LOCAL numbers or any send/reminder side effects", () => {
    expect(deriveFinalQuoteNumber("NW", 123)).toBe("NW-123"); expect(deriveFinalQuoteNumber("NW", 0)).toBeNull();
    const input: LegacyQuoteWrite = { identity, legacyJobId: jobId, expectedVersion: "1", expectedCurrentFingerprint: null, finalQuoteNumber: "NW-123", quote: readyQuote() };
    const preserved = { sitePlanNotes: "preserve site-plan notes", wallInternal: true, quoteSitePlanFiles: ["existing-plan.pdf"] };
    const mapped = mapLegacyFullQuote(input, preserved)!;
    expect(mapped.payload).toEqual({ stage: "QUOTE", sitePlanNotes: "preserve site-plan notes",
      quote: { quoteNumber: "NW-123", date: "2026-08-30T00:00:00.000Z", status: "UNSET", deferralDate: null,
        totalOverridden: false, depositOverridden: false, sendFollowupEmail: false, sendFollowupText: false, files_QuoteSitePlan: ["existing-plan.pdf"],
        wall: { SQMPrice: 10, SQM: 100, cavityDepthMeters: 0.1, c_RValue: 2.8, c_bagCount: 15.4, internal: true }, ceiling: null,
        extras: [{ name: "Council Fee", price: 330 }], quoteNote: "", consentFee: 0, depositPercentage: 0,
        c_contractPrice: 1330, c_gst: 199.5, c_total: 1529.5, c_deposit: 0, quoteResultNote: "" } });
    for (const forbidden of ["client", "lead", "installation", "notes", "billingModel", "integrationReference"]) expect(mapped.payload).not.toHaveProperty(forbidden);
    expect(JSON.stringify(mapped.payload)).not.toContain("LOCAL-");
    expect(mapLegacyFullQuote({ ...input, finalQuoteNumber: "LOCAL-123" }, { sitePlanNotes: "", wallInternal: null, quoteSitePlanFiles: [] })).toBeNull();
    expect(validateLegacyUploadedPlan({ remoteFileName: "safe.pdf", storageKey: "bad:key", contentSha256: "0".repeat(64), byteSize: 100 })).toBe(false);
    expect(validateLegacyUploadedPlan({ remoteFileName: "safe.pdf", storageKey: "safe/path.pdf", contentSha256: "0".repeat(64), byteSize: 100 })).toBe(true);
  });

  it("marks fictional notifications visibly and leaves production unavailable", async () => {
    const world = new FictionalNotificationWorld(); const fake = createFictionalNotificationAdapterTestHarness(["ENQUEUED", "DELIVERED"], world)!;
    const eventId="77777777-7777-4777-8777-777777777777";
    expect(await fake.deliver({ eventId, companyId, jobId, requestId, fictionalSummary: "SUBMISSION_COMPLETED" },callContext)).toEqual({ kind: "ENQUEUED", receipt:`fictional:${eventId}` });
    expect(fake.calls[0].summary).toBe("[FICTIONAL] SUBMISSION_COMPLETED");
    expect((await fake.deliver({ eventId, companyId, jobId, requestId, fictionalSummary: "SUBMISSION_COMPLETED" },callContext)).kind).toBe("ENQUEUED");
    expect(fake.enqueues).toHaveLength(1); expect(fake.deliveries).toHaveLength(0);
    const recreated = createFictionalNotificationAdapterTestHarness(["AMBIGUOUS"], world)!;
    expect((await recreated.deliver({ eventId, companyId, jobId, requestId, fictionalSummary: "SUBMISSION_COMPLETED" },callContext)).kind).toBe("ENQUEUED");
    expect(fake.enqueues).toHaveLength(1); expect(fake.deliveries).toHaveLength(0);
    expect((await fake.deliver({ eventId:"88888888-8888-4888-8888-888888888888", companyId, jobId, requestId, fictionalSummary: "RECONCILIATION_REQUIRED" },callContext)).kind).toBe("DELIVERED");
    expect(fake.enqueues).toHaveLength(2); expect(fake.deliveries).toHaveLength(1);
    expect((await fake.deliver({ eventId:"99999999-9999-4999-8999-999999999999", companyId: "55555555-5555-4555-8555-555555555555", jobId, requestId, fictionalSummary: "SUBMISSION_COMPLETED" },callContext)).kind).toBe("DELIVERED");
    expect(fake.deliveries).toHaveLength(2);
    expect(productionNotificationAdapter()).toBeNull();
  });
});

describe("exhaustive marker resolution contract", () => {
  it("accepts exactly one active canonical marker and rejects archived/duplicate/mismatched records", () => {
    const record = { id: "legacy-1", jobNumber: 100, version: "1", archived: false, marker, canonicalCreateFingerprint: lead.canonicalCreateFingerprint };
    expect(resolveLegacyMarkerRecords([record], marker, lead.canonicalCreateFingerprint).kind).toBe("CONFIRMED");
    expect(resolveLegacyMarkerRecords([{ ...record, archived: true }], marker, lead.canonicalCreateFingerprint).kind).toBe("CONFLICT");
    expect(resolveLegacyMarkerRecords([record, { ...record, id: "legacy-2" }], marker, lead.canonicalCreateFingerprint).kind).toBe("CONFLICT");
    expect(resolveLegacyMarkerRecords([{ ...record, canonicalCreateFingerprint: "0".repeat(64) }], marker, lead.canonicalCreateFingerprint).kind).toBe("CONFLICT");
  });
});
