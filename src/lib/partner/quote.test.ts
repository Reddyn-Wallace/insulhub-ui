import { describe, expect, it } from "vitest";
import { basisPointsFromPercent, calculateQuote, createQuoteDraft, DEFAULT_COUNCIL_FEE, moneyFromDollars, normalizeQuoteDefaults, normalizeQuoteDraft, PRODUCT_QUOTE_DEFAULTS, quoteReadiness, setQuoteProductEnabled, type QuoteDefaults } from "./quote";
import { mapQuoteToLegacyAdapterShape } from "./quote-adapter";

const defaults: QuoteDefaults = { wallRateCents: 15_000, ceilingRateCents: 12_000, depositBasisPoints: 2_500, consentFeeCents: 0, extras: [{ ...DEFAULT_COUNCIL_FEE }], revision: 7 };
function completeQuote() {
  let quote = createQuoteDraft(defaults, "LOCAL-DRAFT-ABC123", "2026-08-30T01:02:03.000Z");
  quote = setQuoteProductEnabled(quote, "wall", true);
  quote = setQuoteProductEnabled(quote, "ceiling", true);
  return { ...quote, wall: { ...quote.wall, rateCentsPerSqm: 15_000, areaSqm: 100, cavityDepthCm: 10 as const }, ceiling: { ...quote.ceiling, rateCentsPerSqm: 12_000, areaSqm: 80, rValue: 3.6, downlights: 4 } };
}

describe("partner quote domain", () => {
  it("applies exact product and pricing formulas with half-up cents", () => {
    const result = calculateQuote(completeQuote());
    expect(result.wall).toEqual({ rValue: 2.8, bags: 15.4, lineCents: 1_500_000 });
    expect(result.ceiling).toEqual({ thicknessMm: 151.2, bags: 11.7, lineCents: 960_000 });
    expect(result).toMatchObject({ extrasCents: 33_000, contractCents: 2_493_000, gstCents: 373_950, totalCents: 2_866_950, depositCents: 0 });
  });

  it("supports each wall depth, a single product, consent, extras and boundary rounding", () => {
    const base = completeQuote();
    expect(calculateQuote({ ...base, wall: { ...base.wall, cavityDepthCm: 15, areaSqm: 25 }, ceiling: { enabled: false, areaSqm: null, rateCentsPerSqm: null, rValue: null, downlights: null }, extras: [], consentFeeCents: 101, depositBasisPoints: 5_000 }).wall).toMatchObject({ rValue: 4.2, bags: 5 });
    const boundary = { ...base, wall: { ...base.wall, areaSqm: 0.005, rateCentsPerSqm: 100 }, ceiling: { enabled: false, areaSqm: null, rateCentsPerSqm: null, rValue: null, downlights: null }, extras: [], consentFeeCents: 0, depositBasisPoints: 5_000 };
    expect(calculateQuote(boundary)).toMatchObject({ contractCents: 1, gstCents: 0, totalCents: 1, depositCents: 1 });
    expect(calculateQuote({ ...boundary, wall: { ...boundary.wall, areaSqm: 0.1 } }).gstCents).toBe(2);
    expect(calculateQuote({ ...boundary, wall: { ...boundary.wall, areaSqm: 0.29, rateCentsPerSqm: 50 } }).wall.lineCents).toBe(15);
  });

  it("parses dollar strings half-up and preserves exact ceiling thickness", () => {
    expect(moneyFromDollars("10.075")).toBe(1_008);
    expect(moneyFromDollars("0.005")).toBe(1);
    expect(moneyFromDollars("1.004")).toBe(100);
    expect(moneyFromDollars("1,000.00")).toBeNull();
    const quote = { ...completeQuote(), ceiling: { ...completeQuote().ceiling, rValue: 3.666 } };
    expect(calculateQuote(quote).ceiling.thicknessMm).toBe(153.972);
  });

  it("parses deposit percentages as exact decimal basis points", () => {
    expect(basisPointsFromPercent("10.075")).toBe(1_008);
    expect(basisPointsFromPercent("0.005")).toBe(1);
    expect(basisPointsFromPercent("100")).toBe(10_000);
    expect(basisPointsFromPercent("100.004")).toBe(10_000);
    expect(basisPointsFromPercent("100.005")).toBeNull();
    expect(basisPointsFromPercent("101")).toBeNull();
    expect(basisPointsFromPercent("10x")).toBeNull();
  });

  it("uses integer-safe half-up rounding even when percentage intermediates exceed safe integers", () => {
    const quote = completeQuote();
    const extras = Array.from({ length: 50 }, (_, index) => ({
      id: `extra-${index}`,
      name: `Extra ${index}`,
      priceCents: index === 49 ? 1 : 1_000_000_000,
    }));
    const result = calculateQuote({
      ...quote,
      wall: { ...quote.wall, areaSqm: 100_000, rateCentsPerSqm: 10_000_000 },
      ceiling: { ...quote.ceiling, areaSqm: 100_000, rateCentsPerSqm: 10_000_000 },
      extras,
      consentFeeCents: 0,
      depositBasisPoints: 4_999,
    });
    expect(result).toMatchObject({
      contractCents: 2_049_000_000_001,
      gstCents: 307_350_000_000,
      totalCents: 2_356_350_000_001,
      depositCents: 1_177_939_365_000,
    });
  });

  it("clears disabled products and uses blank InsulHub rates when re-enabled", () => {
    const quote = completeQuote();
    const wallOff = setQuoteProductEnabled(quote, "wall", false);
    expect(wallOff.wall).toEqual({ enabled: false, areaSqm: null, rateCentsPerSqm: null, cavityDepthCm: null });
    expect(calculateQuote(wallOff).wall.lineCents).toBe(0);
    expect(setQuoteProductEnabled(wallOff, "wall", true).wall).toEqual({ enabled: true, areaSqm: null, rateCentsPerSqm: null, cavityDepthCm: 10 });
    const ceilingOff = setQuoteProductEnabled(quote, "ceiling", false);
    expect(ceilingOff.ceiling).toEqual({ enabled: false, areaSqm: null, rateCentsPerSqm: null, rValue: null, downlights: null });
    expect(setQuoteProductEnabled(ceilingOff, "ceiling", true).ceiling.downlights).toBe(0);
  });

  it("snapshots defaults without sharing mutable extras", () => {
    const mutableDefaults = { ...defaults, extras: defaults.extras.map((extra) => ({ ...extra })) };
    const quote = createQuoteDraft(mutableDefaults);
    mutableDefaults.extras[0].name = "Changed later";
    expect(quote.extras[0].name).toBe("Council Fee");
    expect(quote.defaultsSnapshot).toMatchObject({ revision: 7, source: "COMPANY_DEFAULTS", wallRateCents: 15_000 });
    expect(PRODUCT_QUOTE_DEFAULTS).toMatchObject({ depositBasisPoints: 0, consentFeeCents: 0 });
  });

  it("rejects unsafe shapes, nonfinite, negative and computed client fields while allowing incomplete drafts", () => {
    const quote = createQuoteDraft(defaults);
    expect(normalizeQuoteDraft(quote)).toMatchObject({ ok: true });
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(normalizeQuoteDraft({ ...completeQuote(), wall: { ...completeQuote().wall, areaSqm: value } })).toMatchObject({ ok: false, errors: { "wall.areaSqm": expect.any(String) } });
    }
    expect(normalizeQuoteDraft({ ...quote, totals: { totalCents: 1 } })).toMatchObject({ ok: false });
    expect(normalizeQuoteDraft({ ...quote, wall: { ...quote.wall, totals: { totalCents: 1 } } })).toMatchObject({ ok: false });
    expect(normalizeQuoteDraft({ ...quote, extras: [{ ...quote.extras[0], companyId: "tenant" }] })).toMatchObject({ ok: false });
    expect(normalizeQuoteDraft({ ...quote, defaultsSnapshot: { ...quote.defaultsSnapshot, calculation: {} } })).toMatchObject({ ok: false });
    expect(normalizeQuoteDraft({ ...quote, depositBasisPoints: 10_001 })).toMatchObject({ ok: false });
    expect(normalizeQuoteDraft({ ...quote, extras: [{ id: "same", name: "A", priceCents: 0 }, { id: "same", name: "B", priceCents: 0 }] })).toMatchObject({ ok: false });
  });

  it("validates bounded company defaults before they can be snapshotted", () => {
    expect(normalizeQuoteDefaults(defaults)).toMatchObject({ ok: true });
    expect(normalizeQuoteDefaults({ ...defaults, wallRateCents: 10_000_001 })).toMatchObject({ ok: false });
    expect(normalizeQuoteDefaults({ ...defaults, consentFeeCents: 1_000_000_001 })).toMatchObject({ ok: false });
    expect(normalizeQuoteDefaults({ ...defaults, extras: [{ id: "x", name: "", priceCents: 0 }] })).toMatchObject({ ok: false });
    expect(() => createQuoteDraft({ ...defaults, extras: [{ id: "same", name: "One", priceCents: 0 }, { id: "same", name: "Two", priceCents: 0 }] })).toThrow("Quote defaults are invalid");
  });

  it("reports strict future readiness and the pending floor-plan gate", () => {
    expect(quoteReadiness(createQuoteDraft(defaults)).map((issue) => issue.path)).toEqual(expect.arrayContaining(["quoteNumber", "quoteDate", "products", "floorPlan"]));
    const issues = quoteReadiness(completeQuote());
    expect(issues).toEqual([{ path: "floorPlan", message: expect.stringContaining("pending") }]);
    expect(quoteReadiness({ ...completeQuote(), extras: [{ id: "x", name: " ", priceCents: -1 }] }).map((issue) => issue.path)).toEqual(expect.arrayContaining(["extras.0.name", "extras.0.priceCents"]));
    const nonfinite = { ...completeQuote(), wall: { ...completeQuote().wall, areaSqm: Number.POSITIVE_INFINITY }, consentFeeCents: Number.NaN, depositBasisPoints: Number.NaN, extras: [{ id: "x", name: "Named", priceCents: Number.POSITIVE_INFINITY }] };
    expect(quoteReadiness(nonfinite).map((issue) => issue.path)).toEqual(expect.arrayContaining(["wall.areaSqm", "consentFeeCents", "depositBasisPoints", "extras.0.priceCents"]));
  });

  it("maps the proven legacy quote DTO with explicit unit conversions", () => {
    const payload = mapQuoteToLegacyAdapterShape(completeQuote());
    expect(payload).toEqual({
      quoteNumber: "LOCAL-DRAFT-ABC123",
      date: "2026-08-30T01:02:03.000Z",
      wall: { SQMPrice: 150, SQM: 100, cavityDepthMeters: 0.1, c_RValue: 2.8, c_bagCount: 15.4 },
      ceiling: { SQMPrice: 120, SQM: 80, RValue: 3.6, downlights: 4, c_thickness: 151.2, c_bagCount: 11.7 },
      extras: [{ name: "Council Fee", price: 330 }],
      quoteNote: "",
      consentFee: 0,
      depositPercentage: 0,
      c_contractPrice: 24_930,
      c_gst: 3_739.5,
      c_total: 28_669.5,
      c_deposit: 0,
      quoteResultNote: "",
    });
    expect(mapQuoteToLegacyAdapterShape(createQuoteDraft(defaults))).toMatchObject({ wall: null, ceiling: null });
  });
});
