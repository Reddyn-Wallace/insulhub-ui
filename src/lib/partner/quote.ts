export const QUOTE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_COUNCIL_FEE = { id: "council-fee", name: "Council Fee", priceCents: 33_000 } as const;

export interface QuoteExtra { id: string; name: string; priceCents: number | null }
export interface QuoteDefaults {
  wallRateCents: number | null;
  ceilingRateCents: number | null;
  depositBasisPoints: number;
  consentFeeCents: number;
  extras: QuoteExtra[];
  revision: number;
}
export interface QuoteDefaultsSnapshot extends QuoteDefaults { source: "COMPANY_DEFAULTS" }
export interface QuoteWall {
  enabled: boolean;
  areaSqm: number | null;
  rateCentsPerSqm: number | null;
  cavityDepthCm: 10 | 15 | null;
}
export interface QuoteCeiling {
  enabled: boolean;
  areaSqm: number | null;
  rateCentsPerSqm: number | null;
  rValue: number | null;
  downlights: number | null;
}
export interface QuoteDraft {
  schema: typeof QUOTE_SCHEMA_VERSION;
  quoteNumber: string;
  quoteDate: string;
  numberSource: "LOCAL_DRAFT";
  wall: QuoteWall;
  ceiling: QuoteCeiling;
  consentFeeCents: number | null;
  depositBasisPoints: number | null;
  extras: QuoteExtra[];
  comments: string;
  defaultsSnapshot: QuoteDefaultsSnapshot;
}
export interface QuoteCalculation {
  wall: { rValue: 2.8 | 4.2 | null; bags: number | null; lineCents: number };
  ceiling: { thicknessMm: number | null; bags: number | null; lineCents: number };
  extrasCents: number;
  contractCents: number;
  gstCents: number;
  consentFeeCents: number;
  totalCents: number;
  depositCents: number;
}
export interface QuoteReadinessIssue { path: string; message: string }
export type QuoteFieldErrors = Partial<Record<string, string>>;

const EMPTY_WALL: QuoteWall = { enabled: false, areaSqm: null, rateCentsPerSqm: null, cavityDepthCm: null };
const EMPTY_CEILING: QuoteCeiling = { enabled: false, areaSqm: null, rateCentsPerSqm: null, rValue: null, downlights: null };
export const QUOTE_LIMITS = {
  area: 100_000,
  rate: 10_000_000,
  rValue: 20,
  money: 1_000_000_000,
  extras: 50,
  extraId: 80,
  extraName: 120,
  comments: 4_000,
  quoteNumber: 120,
  defaultsJsonBytes: 7_000,
} as const;
const MAX = QUOTE_LIMITS;

export const PRODUCT_QUOTE_DEFAULTS: QuoteDefaults = {
  wallRateCents: null,
  ceilingRateCents: null,
  depositBasisPoints: 0,
  consentFeeCents: 0,
  extras: [{ ...DEFAULT_COUNCIL_FEE }],
  revision: 0,
};

const DEFAULT_KEYS = new Set(["wallRateCents", "ceilingRateCents", "depositBasisPoints", "consentFeeCents", "extras", "revision"]);
const SNAPSHOT_KEYS = new Set([...DEFAULT_KEYS, "source"]);
const EXTRA_KEYS = new Set(["id", "name", "priceCents"]);

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function jsonBytes(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.POSITIVE_INFINITY; }
}

export function normalizeQuoteDefaults(value: unknown): { ok: true; value: QuoteDefaults } | { ok: false; error: string } {
  const input = plainRecord(value);
  if (!input || !hasOnlyKeys(input, DEFAULT_KEYS) || !Array.isArray(input.extras) || input.extras.length > MAX.extras || jsonBytes(input.extras) > MAX.defaultsJsonBytes) {
    return { ok: false, error: "Quote defaults are invalid." };
  }
  const positiveRate = (candidate: unknown): candidate is number | null => candidate === null || (Number.isInteger(candidate) && Number(candidate) > 0 && Number(candidate) <= MAX.rate);
  if (!positiveRate(input.wallRateCents) || !positiveRate(input.ceilingRateCents)) return { ok: false, error: "Quote defaults are invalid." };
  if (!Number.isInteger(input.depositBasisPoints) || Number(input.depositBasisPoints) < 0 || Number(input.depositBasisPoints) > 10_000) return { ok: false, error: "Quote defaults are invalid." };
  if (!Number.isInteger(input.consentFeeCents) || Number(input.consentFeeCents) < 0 || Number(input.consentFeeCents) > MAX.money) return { ok: false, error: "Quote defaults are invalid." };
  if (!Number.isInteger(input.revision) || Number(input.revision) < 0 || Number(input.revision) > 2_147_483_647) return { ok: false, error: "Quote defaults are invalid." };
  const seen = new Set<string>();
  const extras: QuoteExtra[] = [];
  for (const item of input.extras) {
    const extra = plainRecord(item);
    if (!extra || !hasOnlyKeys(extra, EXTRA_KEYS) || typeof extra.id !== "string" || !extra.id || extra.id.length > MAX.extraId || seen.has(extra.id)
      || typeof extra.name !== "string" || !extra.name.trim() || extra.name.length > MAX.extraName
      || !Number.isInteger(extra.priceCents) || Number(extra.priceCents) < 0 || Number(extra.priceCents) > MAX.money) {
      return { ok: false, error: "Quote defaults are invalid." };
    }
    seen.add(extra.id);
    extras.push({ id: extra.id, name: extra.name, priceCents: Number(extra.priceCents) });
  }
  return { ok: true, value: {
    wallRateCents: input.wallRateCents as number | null,
    ceilingRateCents: input.ceilingRateCents as number | null,
    depositBasisPoints: Number(input.depositBasisPoints),
    consentFeeCents: Number(input.consentFeeCents),
    extras,
    revision: Number(input.revision),
  } };
}

function cloneExtras(extras: readonly QuoteExtra[]): QuoteExtra[] {
  return extras.map((extra) => ({ ...extra }));
}

export function createQuoteDraft(defaults: QuoteDefaults, quoteNumber = "", quoteDate = ""): QuoteDraft {
  const normalized = normalizeQuoteDefaults(defaults);
  if (!normalized.ok) throw new Error(normalized.error);
  const safeDefaults = normalized.value;
  const snapshot: QuoteDefaultsSnapshot = { ...safeDefaults, extras: cloneExtras(safeDefaults.extras), source: "COMPANY_DEFAULTS" };
  return {
    schema: QUOTE_SCHEMA_VERSION,
    quoteNumber,
    quoteDate,
    numberSource: "LOCAL_DRAFT",
    wall: { ...EMPTY_WALL },
    ceiling: { ...EMPTY_CEILING },
    consentFeeCents: 0,
    depositBasisPoints: 0,
    extras: cloneExtras(safeDefaults.extras),
    comments: "",
    defaultsSnapshot: snapshot,
  };
}

export function setQuoteProductEnabled(quote: QuoteDraft, product: "wall" | "ceiling", enabled: boolean): QuoteDraft {
  if (product === "wall") return { ...quote, wall: enabled ? { ...EMPTY_WALL, enabled: true, rateCentsPerSqm: null, cavityDepthCm: 10 } : { ...EMPTY_WALL } };
  return { ...quote, ceiling: enabled ? { ...EMPTY_CEILING, enabled: true, rateCentsPerSqm: null, downlights: 0 } : { ...EMPTY_CEILING } };
}

type DecimalFraction = { numerator: bigint; denominator: bigint };

function decimalFraction(value: number): DecimalFraction | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const [coefficient, exponentText] = value.toString().toLowerCase().split("e");
  const [whole, fraction = ""] = coefficient.split(".");
  const exponent = Number(exponentText ?? 0) - fraction.length;
  const numerator = BigInt(`${whole}${fraction}`);
  if (exponent >= 0) return { numerator: numerator * (BigInt(10) ** BigInt(exponent)), denominator: BigInt(1) };
  return { numerator, denominator: BigInt(10) ** BigInt(-exponent) };
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return quotient + ((numerator % denominator) * BigInt(2) >= denominator ? BigInt(1) : BigInt(0));
}

function decimalTimesInteger(value: number, multiplier: number): number {
  const fraction = decimalFraction(value);
  if (!fraction) return 0;
  return Number(roundHalfUp(fraction.numerator * BigInt(multiplier), fraction.denominator));
}

function decimalTimesIntegerExact(value: number, multiplier: number): number | null {
  const fraction = decimalFraction(value);
  if (!fraction) return null;
  const numerator = fraction.numerator * BigInt(multiplier);
  const whole = numerator / fraction.denominator;
  const remainder = numerator % fraction.denominator;
  if (remainder === BigInt(0)) return Number(whole);
  const decimals = fraction.denominator.toString().length - 1;
  return Number(`${whole}.${remainder.toString().padStart(decimals, "0")}`);
}

function decimalProductToOnePlace(left: number, right: number, numerator = BigInt(1), denominator = BigInt(1)): number | null {
  const leftFraction = decimalFraction(left);
  const rightFraction = decimalFraction(right);
  if (!leftFraction || !rightFraction) return null;
  const tenths = roundHalfUp(
    leftFraction.numerator * rightFraction.numerator * numerator * BigInt(10),
    leftFraction.denominator * rightFraction.denominator * denominator,
  );
  return Number(tenths) / 10;
}

function decimalToOnePlace(value: number, numerator = BigInt(1), denominator = BigInt(1)): number | null {
  return decimalProductToOnePlace(value, 1, numerator, denominator);
}

function usable(value: number | null, max: number, integer = false): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max && (!integer || Number.isInteger(value));
}

export function calculateQuote(quote: QuoteDraft): QuoteCalculation {
  const wallLine = quote.wall.enabled && usable(quote.wall.areaSqm, MAX.area) && usable(quote.wall.rateCentsPerSqm, MAX.rate, true) ? decimalTimesInteger(quote.wall.areaSqm, quote.wall.rateCentsPerSqm) : 0;
  const ceilingLine = quote.ceiling.enabled && usable(quote.ceiling.areaSqm, MAX.area) && usable(quote.ceiling.rateCentsPerSqm, MAX.rate, true) ? decimalTimesInteger(quote.ceiling.areaSqm, quote.ceiling.rateCentsPerSqm) : 0;
  const extrasCents = quote.extras.reduce((sum, extra) => sum + (usable(extra.priceCents, MAX.money, true) ? extra.priceCents : 0), 0);
  const contractCents = wallLine + ceilingLine + extrasCents;
  const gstCents = Number(roundHalfUp(BigInt(contractCents) * BigInt(15), BigInt(100)));
  const consentFeeCents = usable(quote.consentFeeCents, MAX.money, true) ? quote.consentFeeCents : 0;
  const totalCents = contractCents + gstCents + consentFeeCents;
  const depositBasisPoints = usable(quote.depositBasisPoints, 10_000, true) ? quote.depositBasisPoints : 0;
  const depositCents = Number(roundHalfUp(BigInt(totalCents) * BigInt(depositBasisPoints), BigInt(10_000)));
  const wallR = quote.wall.enabled && quote.wall.cavityDepthCm ? (quote.wall.cavityDepthCm === 10 ? 2.8 : 4.2) : null;
  const wallBags = quote.wall.enabled && usable(quote.wall.areaSqm, MAX.area) && quote.wall.cavityDepthCm
    ? decimalToOnePlace(quote.wall.areaSqm, quote.wall.cavityDepthCm === 10 ? BigInt(2) : BigInt(1), quote.wall.cavityDepthCm === 10 ? BigInt(13) : BigInt(5))
    : null;
  const ceilingThickness = quote.ceiling.enabled && usable(quote.ceiling.rValue, MAX.rValue) ? decimalTimesIntegerExact(quote.ceiling.rValue, 42) : null;
  const ceilingBags = quote.ceiling.enabled && usable(quote.ceiling.rValue, MAX.rValue) && usable(quote.ceiling.areaSqm, MAX.area)
    ? decimalProductToOnePlace(quote.ceiling.rValue, quote.ceiling.areaSqm, BigInt(405), BigInt(10_000))
    : null;
  return { wall: { rValue: wallR, bags: wallBags, lineCents: wallLine }, ceiling: { thicknessMm: ceilingThickness, bags: ceilingBags, lineCents: ceilingLine }, extrasCents, contractCents, gstCents, consentFeeCents, totalCents, depositCents };
}

function finiteNullable(value: unknown, max: number, path: string, errors: QuoteFieldErrors, integer = false): number | null {
  if (value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value))) {
    errors[path] = "Enter a valid non-negative value.";
    return null;
  }
  return value;
}
function text(value: unknown, max: number, path: string, errors: QuoteFieldErrors): string {
  if (typeof value !== "string" || value.length > max) { errors[path] = `Keep this field to ${max} characters or fewer.`; return ""; }
  return value;
}

export function normalizeQuoteDraft(value: unknown, authoritative?: { quoteNumber: string; quoteDate: string; defaultsSnapshot: QuoteDefaultsSnapshot }): { ok: true; value: QuoteDraft } | { ok: false; errors: QuoteFieldErrors } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, errors: { quote: "Quote data is invalid." } };
  const input = value as Record<string, unknown>;
  const quoteKeys = new Set(["schema", "quoteNumber", "quoteDate", "numberSource", "wall", "ceiling", "consentFeeCents", "depositBasisPoints", "extras", "comments", "defaultsSnapshot"]);
  if (!hasOnlyKeys(input, quoteKeys)) return { ok: false, errors: { quote: "Quote data is invalid." } };
  const errors: QuoteFieldErrors = {};
  const wall = input.wall && typeof input.wall === "object" && !Array.isArray(input.wall) ? input.wall as Record<string, unknown> : {};
  const ceiling = input.ceiling && typeof input.ceiling === "object" && !Array.isArray(input.ceiling) ? input.ceiling as Record<string, unknown> : {};
  if (!hasOnlyKeys(wall, new Set(["enabled", "areaSqm", "rateCentsPerSqm", "cavityDepthCm"]))) errors.wall = "Wall quote data is invalid.";
  if (!hasOnlyKeys(ceiling, new Set(["enabled", "areaSqm", "rateCentsPerSqm", "rValue", "downlights"]))) errors.ceiling = "Ceiling quote data is invalid.";
  const wallEnabled = wall.enabled === true;
  const ceilingEnabled = ceiling.enabled === true;
  if (typeof wall.enabled !== "boolean") errors.wall = "Choose whether wall insulation is included.";
  if (typeof ceiling.enabled !== "boolean") errors.ceiling = "Choose whether ceiling insulation is included.";
  const depth = wall.cavityDepthCm === null || wall.cavityDepthCm === "" ? null : wall.cavityDepthCm;
  if (wallEnabled && depth !== null && depth !== 10 && depth !== 15) errors["wall.cavityDepthCm"] = "Choose a 10 cm or 15 cm cavity.";
  const extrasInput = Array.isArray(input.extras) ? input.extras : [];
  if (!Array.isArray(input.extras) || extrasInput.length > MAX.extras) errors.extras = `Add no more than ${MAX.extras} extras.`;
  const seen = new Set<string>();
  const extras = extrasInput.slice(0, MAX.extras).map((item, index): QuoteExtra => {
    const extra = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    if (!hasOnlyKeys(extra, EXTRA_KEYS)) errors[`extras.${index}`] = "Extra data is invalid.";
    const id = text(extra.id, MAX.extraId, `extras.${index}.id`, errors);
    if (!id || seen.has(id)) errors[`extras.${index}.id`] = "Each extra must have a unique identifier.";
    seen.add(id);
    return { id, name: text(extra.name, MAX.extraName, `extras.${index}.name`, errors), priceCents: finiteNullable(extra.priceCents, MAX.money, `extras.${index}.priceCents`, errors, true) };
  });
  const validateSnapshot = (snapshot: unknown): QuoteDefaultsSnapshot | null => {
    const record = plainRecord(snapshot);
    if (!record || !hasOnlyKeys(record, SNAPSHOT_KEYS) || record.source !== "COMPANY_DEFAULTS") return null;
    const normalized = normalizeQuoteDefaults(Object.fromEntries(Object.entries(record).filter(([key]) => key !== "source")));
    return normalized.ok ? { ...normalized.value, extras: cloneExtras(normalized.value.extras), source: "COMPANY_DEFAULTS" } : null;
  };
  const suppliedSnapshot = validateSnapshot(input.defaultsSnapshot);
  const authoritativeSnapshot = authoritative ? validateSnapshot(authoritative.defaultsSnapshot) : null;
  if (!suppliedSnapshot || (authoritative && !authoritativeSnapshot)) errors.defaultsSnapshot = "Quote defaults are invalid.";
  const defaultsSnapshot = authoritativeSnapshot ?? suppliedSnapshot;
  const quoteNumber = authoritative?.quoteNumber ?? text(input.quoteNumber, MAX.quoteNumber, "quoteNumber", errors);
  const quoteDate = authoritative?.quoteDate ?? text(input.quoteDate, 40, "quoteDate", errors);
  if (quoteDate && !Number.isFinite(Date.parse(quoteDate))) errors.quoteDate = "Quote date is invalid.";
  const normalized: QuoteDraft = {
    schema: QUOTE_SCHEMA_VERSION, quoteNumber, quoteDate, numberSource: "LOCAL_DRAFT",
    wall: wallEnabled ? { enabled: true, areaSqm: finiteNullable(wall.areaSqm, MAX.area, "wall.areaSqm", errors), rateCentsPerSqm: finiteNullable(wall.rateCentsPerSqm, MAX.rate, "wall.rateCentsPerSqm", errors, true), cavityDepthCm: depth === 10 || depth === 15 ? depth : null } : { ...EMPTY_WALL },
    ceiling: ceilingEnabled ? { enabled: true, areaSqm: finiteNullable(ceiling.areaSqm, MAX.area, "ceiling.areaSqm", errors), rateCentsPerSqm: finiteNullable(ceiling.rateCentsPerSqm, MAX.rate, "ceiling.rateCentsPerSqm", errors, true), rValue: finiteNullable(ceiling.rValue, MAX.rValue, "ceiling.rValue", errors), downlights: finiteNullable(ceiling.downlights, 10_000, "ceiling.downlights", errors, true) } : { ...EMPTY_CEILING },
    consentFeeCents: finiteNullable(input.consentFeeCents, MAX.money, "consentFeeCents", errors, true),
    depositBasisPoints: finiteNullable(input.depositBasisPoints, 10_000, "depositBasisPoints", errors, true),
    extras, comments: text(input.comments, MAX.comments, "comments", errors), defaultsSnapshot: defaultsSnapshot ?? { ...PRODUCT_QUOTE_DEFAULTS, extras: cloneExtras(PRODUCT_QUOTE_DEFAULTS.extras), source: "COMPANY_DEFAULTS" },
  };
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: normalized };
}

export function quoteReadiness(quote: QuoteDraft): QuoteReadinessIssue[] {
  const issues: QuoteReadinessIssue[] = [];
  if (!quote.quoteNumber.trim()) issues.push({ path: "quoteNumber", message: "A local quote number is required." });
  if (!quote.quoteDate || !Number.isFinite(Date.parse(quote.quoteDate))) issues.push({ path: "quoteDate", message: "A quote date is required." });
  if (!quote.wall.enabled && !quote.ceiling.enabled) issues.push({ path: "products", message: "Enable at least one insulation product." });
  if (quote.wall.enabled) {
    if (!usable(quote.wall.areaSqm, MAX.area) || quote.wall.areaSqm <= 0) issues.push({ path: "wall.areaSqm", message: "Wall area must be greater than zero." });
    if (!usable(quote.wall.rateCentsPerSqm, MAX.rate, true) || quote.wall.rateCentsPerSqm <= 0) issues.push({ path: "wall.rateCentsPerSqm", message: "Wall rate must be greater than zero." });
    if (quote.wall.cavityDepthCm !== 10 && quote.wall.cavityDepthCm !== 15) issues.push({ path: "wall.cavityDepthCm", message: "Choose a wall cavity depth." });
  }
  if (quote.ceiling.enabled) {
    if (!usable(quote.ceiling.areaSqm, MAX.area) || quote.ceiling.areaSqm <= 0) issues.push({ path: "ceiling.areaSqm", message: "Ceiling area must be greater than zero." });
    if (!usable(quote.ceiling.rateCentsPerSqm, MAX.rate, true) || quote.ceiling.rateCentsPerSqm <= 0) issues.push({ path: "ceiling.rateCentsPerSqm", message: "Ceiling rate must be greater than zero." });
    if (!usable(quote.ceiling.rValue, MAX.rValue) || quote.ceiling.rValue <= 0) issues.push({ path: "ceiling.rValue", message: "Ceiling R-value must be greater than zero." });
    if (!usable(quote.ceiling.downlights, 10_000, true)) issues.push({ path: "ceiling.downlights", message: "Downlights must be a whole number of zero or more." });
  }
  if (!usable(quote.consentFeeCents, MAX.money, true)) issues.push({ path: "consentFeeCents", message: "Consent must be a non-negative amount." });
  if (!usable(quote.depositBasisPoints, 10_000, true)) issues.push({ path: "depositBasisPoints", message: "Deposit must be between 0% and 100%." });
  quote.extras.forEach((extra, index) => { if (!extra.name.trim()) issues.push({ path: `extras.${index}.name`, message: "Each extra needs a name." }); if (!usable(extra.priceCents, MAX.money, true)) issues.push({ path: `extras.${index}.priceCents`, message: "Each extra needs a non-negative price." }); });
  issues.push({ path: "floorPlan", message: "Floor plan readiness is pending until the next portal stage." });
  return issues;
}

export function moneyFromDollars(value: string): number | null {
  return decimalStringToScaledInteger(value, 2, MAX.money);
}

export function basisPointsFromPercent(value: string): number | null {
  return decimalStringToScaledInteger(value, 2, 10_000);
}

function decimalStringToScaledInteger(value: string, decimalPlaces: number, maximum: number): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(\d+)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fraction = match[2] ?? "";
  const scale = BigInt(10) ** BigInt(decimalPlaces);
  const scaledFraction = (fraction + "0".repeat(decimalPlaces)).slice(0, decimalPlaces);
  let scaled = whole * scale + BigInt(scaledFraction || "0");
  if (fraction.length > decimalPlaces && Number(fraction[decimalPlaces]) >= 5) scaled += BigInt(1);
  return scaled <= BigInt(maximum) ? Number(scaled) : null;
}
export function dollarsFromCents(value: number | null): string { return value === null ? "" : (value / 100).toFixed(2); }
export function percentFromBasisPoints(value: number | null): string { return value === null ? "" : (value / 100).toFixed(2); }

/** Portal fees are fixed, regardless of old company defaults or client input. */
export function partnerQuoteTerms<T extends QuoteDraft>(quote: T): T {
  return { ...quote, consentFeeCents: 0, depositBasisPoints: 0 };
}
