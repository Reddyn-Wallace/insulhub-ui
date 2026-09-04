import { describe, expect, it } from "vitest";
import { clearDraftRecoveryScope, decodeDraftRecovery, DRAFT_RECOVERY_TTL_MS, draftRecoveryKey, EMPTY_LEAD_DRAFT, encodeDraftRecovery, partnerDraftReadiness, readDraftRecovery, removeDraftRecovery, validateLeadDraft, writeDraftRecovery, type DraftRecoveryStorage } from "./draft";
import { createQuoteDraft, PRODUCT_QUOTE_DEFAULTS, setQuoteProductEnabled } from "./quote";

describe("partner lead draft validation and recovery", () => {
  it("allows an incomplete draft while validating optional field shape", () => {
    expect(validateLeadDraft(EMPTY_LEAD_DRAFT)).toEqual({ ok: true, value: EMPTY_LEAD_DRAFT });
    expect(validateLeadDraft({ ...EMPTY_LEAD_DRAFT, customerEmail: "not-email" })).toMatchObject({ ok: false, errors: { customerEmail: expect.any(String) } });
    expect(validateLeadDraft({ ...EMPTY_LEAD_DRAFT, customerMobile: "021 call me" })).toMatchObject({ ok: false, errors: { customerMobile: expect.any(String) } });
  });

  it("rejects length overflow, unknown sources, duplicate sources, and tenant injection", () => {
    const overflows = [
      { value: { ...EMPTY_LEAD_DRAFT, customerName: "x".repeat(201) }, field: "customerName" },
      { value: { ...EMPTY_LEAD_DRAFT, customerMobile: "1".repeat(41) }, field: "customerMobile" },
      { value: { ...EMPTY_LEAD_DRAFT, customerEmail: `${"x".repeat(250)}@a.test` }, field: "customerEmail" },
      { value: { ...EMPTY_LEAD_DRAFT, siteAddress: { ...EMPTY_LEAD_DRAFT.siteAddress, street: "x".repeat(201) } }, field: "street" },
      { value: { ...EMPTY_LEAD_DRAFT, siteAddress: { ...EMPTY_LEAD_DRAFT.siteAddress, suburb: "x".repeat(101) } }, field: "suburb" },
      { value: { ...EMPTY_LEAD_DRAFT, siteAddress: { ...EMPTY_LEAD_DRAFT.siteAddress, city: "x".repeat(101) } }, field: "city" },
      { value: { ...EMPTY_LEAD_DRAFT, siteAddress: { ...EMPTY_LEAD_DRAFT.siteAddress, postcode: "1".repeat(21) } }, field: "postcode" },
      { value: { ...EMPTY_LEAD_DRAFT, notes: "x".repeat(4001) }, field: "notes" },
    ];
    for (const overflow of overflows) {
      const result = validateLeadDraft(overflow.value);
      expect(result).toMatchObject({ ok: false, errors: { [overflow.field]: expect.any(String) } });
    }
    expect(validateLeadDraft({ ...EMPTY_LEAD_DRAFT, leadSources: ["UNKNOWN"] })).toMatchObject({ ok: false, errors: { leadSources: expect.any(String) } });
    expect(validateLeadDraft({ ...EMPTY_LEAD_DRAFT, leadSources: ["REFERRAL", "REFERRAL"] })).toMatchObject({ ok: false, errors: { leadSources: expect.any(String) } });
    expect(validateLeadDraft({ ...EMPTY_LEAD_DRAFT, companyId: "forged" })).toMatchObject({ ok: false, errors: { form: expect.any(String) } });
  });

  it("round-trips scoped recovery and rejects another tenant, job, invalid revision, and stale payload", () => {
    const now = Date.parse("2026-08-30T00:00:00.000Z");
    const serialized = encodeDraftRecovery({ scope: "scope-a", jobId: "draft-1", revision: 3, draft: { ...EMPTY_LEAD_DRAFT, customerName: "Fictional Customer" }, savedAt: new Date(now).toISOString() });
    expect(draftRecoveryKey("scope-a", "draft-1")).toBe("partner-draft-recovery:v3:scope-a:draft-1");
    expect(decodeDraftRecovery(serialized, "scope-a", "draft-1", now)).toMatchObject({ scope: "scope-a", revision: 3, draft: { customerName: "Fictional Customer" } });
    expect(decodeDraftRecovery(serialized, "scope-b", "draft-1", now)).toBeNull();
    expect(decodeDraftRecovery(serialized, "scope-a", "draft-2", now)).toBeNull();
    expect(decodeDraftRecovery(encodeDraftRecovery({ scope: "scope-a", jobId: "draft-1", revision: -1, draft: EMPTY_LEAD_DRAFT, savedAt: new Date(now).toISOString() }), "scope-a", "draft-1", now)).toBeNull();
    expect(decodeDraftRecovery(encodeDraftRecovery({ scope: "scope-a", jobId: "draft-1", revision: 0, draft: EMPTY_LEAD_DRAFT, savedAt: new Date(now - DRAFT_RECOVERY_TTL_MS - 1).toISOString() }), "scope-a", "draft-1", now)).toBeNull();
    expect(decodeDraftRecovery("not-json", "scope-a", "draft-1", now)).toBeNull();
  });

  it("treats throwing browser storage as unavailable", () => {
    const storage = new Proxy({} as DraftRecoveryStorage, { get() { throw new Error("blocked"); } });
    expect(readDraftRecovery(storage, "key")).toBeNull();
    expect(writeDraftRecovery(storage, "key", "value")).toBe(false);
    expect(removeDraftRecovery(storage, "key")).toBe(false);
    expect(clearDraftRecoveryScope(storage, "scope-a")).toBe(false);
  });

  it("reports the complete future lead and quote readiness contract without blocking draft saves", () => {
    const empty = { ...EMPTY_LEAD_DRAFT, quote: createQuoteDraft(PRODUCT_QUOTE_DEFAULTS) };
    expect(partnerDraftReadiness(empty).map((issue) => issue.path)).toEqual(expect.arrayContaining(["customerName", "contact", "address", "quoteNumber", "quoteDate", "products", "floorPlan"]));
    let quote = createQuoteDraft({ ...PRODUCT_QUOTE_DEFAULTS, wallRateCents: 15_000 }, "LOCAL-DRAFT-READY", "2026-08-30T00:00:00.000Z");
    quote = setQuoteProductEnabled(quote, "wall", true);
    quote = { ...quote, wall: { ...quote.wall, rateCentsPerSqm: 15_000, areaSqm: 50, cavityDepthCm: 15 } };
    const ready = { ...EMPTY_LEAD_DRAFT, customerName: "Fictional Customer", customerMobile: "021 555 0100", siteAddress: { street: "1 Test Lane", suburb: "Brookfield", city: "Tauranga", postcode: "3110" }, quote };
    expect(partnerDraftReadiness(ready)).toEqual([{ path: "floorPlan", message: expect.stringContaining("pending") }]);
  });

  it("accepts server-authoritative floor-plan readiness without changing the D2 UI contract", () => {
    const ready = { ...EMPTY_LEAD_DRAFT, quote: createQuoteDraft(PRODUCT_QUOTE_DEFAULTS) };
    expect(partnerDraftReadiness(ready, { ready: true, issues: [] }).some((issue) => issue.path === "floorPlan")).toBe(false);
    expect(partnerDraftReadiness(ready, { ready: false, issues: ["Ground needs an up-to-date PDF."] })).toContainEqual({ path: "floorPlan", message: "Ground needs an up-to-date PDF." });
  });
});
