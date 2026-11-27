type Extra = { name: string; price: number };
type FieldValue = string | number | boolean | string[] | Extra[] | null;
export type QuoteSnapshot = Record<string, FieldValue>;
export type QuoteChange = { label: string; before: string; after: string };
export type QuoteEventKind = "baseline" | "edit" | "status" | "accepted" | "send" | "pdf" | "files" | "external" | "recovered" | "unconfirmed";
export type QuoteEvent = {
  id: string; kind: QuoteEventKind; revision: number; at: string;
  actor: string | null; total: number | null; changes: QuoteChange[];
};
export type QuoteHistory = {
  revision: number; events: QuoteEvent[]; next: string | null;
  lastSend: QuoteEvent | null; changedSinceSend: boolean; pending: boolean;
};

const money = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });
export function quoteMoney(value: number) { return money.format(value); }
type Format = "money" | "area" | "rate" | "percent" | "depth" | "thickness" | "rvalue" | "date" | "status";
export const fields: [string, string, Format?][] = [
  ["quoteNumber", "Quote number"], ["date", "Quote date", "date"],
  ["wall.SQM", "Wall area", "area"], ["wall.SQMPrice", "Wall rate", "rate"],
  ["wall.cavityDepthMeters", "Wall cavity depth", "depth"], ["wall.c_RValue", "Wall R-value", "rvalue"],
  ["wall.c_bagCount", "Wall bags"], ["wall.internal", "Internal wall insulation"],
  ["ceiling.SQM", "Ceiling area", "area"], ["ceiling.SQMPrice", "Ceiling rate", "rate"],
  ["ceiling.RValue", "Ceiling R-value", "rvalue"], ["ceiling.downlights", "Downlights"],
  ["ceiling.c_thickness", "Ceiling thickness", "thickness"], ["ceiling.c_bagCount", "Ceiling bags"],
  ["consentFee", "Consent fee", "money"], ["c_contractPrice", "Contract price", "money"],
  ["c_gst", "GST", "money"], ["c_total", "Total incl. GST", "money"],
  ["totalOverridden", "Manual total"], ["depositPercentage", "Deposit percentage", "percent"],
  ["c_deposit", "Deposit", "money"], ["depositOverridden", "Manual deposit"],
  ["quoteNote", "Quote comments"], ["quoteResultNote", "Quote result notes"],
  ["sitePlanNotes", "Site plan notes"], ["files_QuoteSitePlan", "Site plan attachments"],
  ["sendFollowupEmail", "Follow-up email"], ["sendFollowupText", "Follow-up text"],
  ["status", "Quote status", "status"], ["deferralDate", "Deferred until", "date"],
];
const statusFields = new Set(["status", "deferralDate", "quoteResultNote", "sendFollowupEmail", "sendFollowupText"]);
const flags = new Set(["wall.internal", "totalOverridden", "depositOverridden", "sendFollowupEmail", "sendFollowupText"]);
const dateTime = new Intl.DateTimeFormat("en-NZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Pacific/Auckland" });
export function quoteHistoryDate(value: string) { return dateTime.format(new Date(value)); }

export const QUOTE_HISTORY_FIELDS = `
  quoteNumber date status deferralDate c_total c_deposit c_contractPrice c_gst depositPercentage consentFee
  quoteNote quoteResultNote totalOverridden depositOverridden sendFollowupEmail sendFollowupText
  extras { name price }
  wall { SQMPrice SQM c_RValue c_bagCount cavityDepthMeters internal }
  ceiling { SQMPrice SQM RValue downlights c_bagCount c_thickness }
  files_QuoteSitePlan
`;

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function normalizedDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : value;
}

export function snapshotQuote(job: unknown): QuoteSnapshot | null {
  const row = record(job);
  const quote = record(row.quote);
  if (!Object.keys(quote).length) return null;
  if (row.stage === "LEAD" && !quote.quoteNumber && !quote.date && !quote.c_total &&
      !record(quote.wall).SQM && !record(quote.ceiling).SQM &&
      !(Array.isArray(quote.extras) && quote.extras.length)) return null;

  const snapshot: QuoteSnapshot = {};
  for (const [key, , format] of fields) {
    const [group, member] = key.split(".");
    const value = key === "sitePlanNotes" ? row[key] : member ? record(quote[group])[member] : quote[key];
    if (key === "files_QuoteSitePlan") {
      snapshot[key] = Array.isArray(value) ? value.filter((name): name is string => typeof name === "string").sort() : [];
    } else if (flags.has(key)) {
      snapshot[key] = value === true;
    } else if (key === "status") {
      snapshot[key] = typeof value === "string" && value ? value : "UNSET";
    } else if (typeof value === "number" && Number.isFinite(value)) {
      snapshot[key] = (format === "money" || format === "rate") ? Math.round(value * 100) / 100 : value;
    } else if (typeof value === "string" && value.trim()) {
      const trimmed = value.trim();
      snapshot[key] = format === "date" ? normalizedDate(trimmed) : trimmed;
    } else {
      snapshot[key] = null;
    }
  }
  snapshot.extras = (Array.isArray(quote.extras) ? quote.extras : []).flatMap(item => {
    const { name, price } = record(item);
    if (typeof price !== "number" || !Number.isFinite(price)) return [];
    return [{ name: typeof name === "string" ? name.trim() : "", price: Math.round(price * 100) / 100 }];
  }).sort((a, b) => a.name.localeCompare(b.name, "en-NZ") || a.price - b.price);
  return snapshot;
}

export function formatValue(value: FieldValue, unit?: Format): string {
  if (value === null) return "—";
  if (Array.isArray(value)) return (value as string[]).join(", ") || "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    if (unit === "date" && Number.isFinite(Date.parse(value))) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split("-").reverse().join("/");
      return quoteHistoryDate(value);
    }
    if (unit === "status") {
      const labels = new Map([["UNSET", "Open"], ["ACCEPTED", "Accepted"], ["DECLINED", "Declined"], ["DEFERRED", "Deferred"]]);
      return labels.get(value) ?? value;
    }
    return value;
  }
  switch (unit) {
    case "money": return quoteMoney(value);
    case "rate": return `${quoteMoney(value)}/m²`;
    case "area": return `${value} m²`;
    case "percent": return `${value}%`;
    case "depth": return `${Math.round(value * 1000)} mm`;
    case "thickness": return `${value} mm`;
    case "rvalue": return `R${value}`;
    default: return String(value);
  }
}

function extraChanges(previous: Extra[], current: Extra[]): QuoteChange[] {
  const changes: QuoteChange[] = [];
  for (const name of new Set([...previous, ...current].map(extra => extra.name))) {
    const before = previous.filter(extra => extra.name === name).map(extra => extra.price);
    const after = current.filter(extra => extra.name === name).map(extra => extra.price);
    const oldPrices = before.filter(price => {
      const index = after.indexOf(price);
      if (index === -1) return true;
      after.splice(index, 1);
      return false;
    });
    for (let i = 0; i < Math.max(oldPrices.length, after.length); i++) {
      changes.push({
        label: name || ((after[i] ?? oldPrices[i]) < 0 ? "Discount" : "Extra charge"),
        before: oldPrices[i] === undefined ? "—" : quoteMoney(oldPrices[i]),
        after: after[i] === undefined ? "—" : quoteMoney(after[i]),
      });
    }
  }
  return changes;
}

function valuesEqual(left: FieldValue, right: FieldValue) {
  if (!Array.isArray(left) || !Array.isArray(right)) return left === right;
  return left.length === right.length && left.every((value, index) => {
    const other = right[index];
    return typeof value === "string" || typeof other === "string" ? value === other :
      value.name === other.name && value.price === other.price;
  });
}

export function quoteDiff(before: QuoteSnapshot | null, after: QuoteSnapshot | null) {
  const changes: QuoteChange[] = [];
  const keys: string[] = [];
  for (const [key, label, unit] of fields) {
    const from = before?.[key] ?? null;
    const to = after?.[key] ?? null;
    if (valuesEqual(from, to)) continue;
    keys.push(key);
    changes.push({ label, before: formatValue(from, unit), after: formatValue(to, unit) });
  }
  const extras = extraChanges((before?.extras ?? []) as Extra[], (after?.extras ?? []) as Extra[]);
  if (extras.length) keys.push("extras");
  changes.push(...extras);
  return { changes, keys, revised: keys.some(key => !statusFields.has(key)) };
}

export function revisionContent(snapshot: QuoteSnapshot | null) {
  if (!snapshot) return "null";
  const keys = [...fields.map(([key]) => key), "extras"].filter(key => !statusFields.has(key));
  return JSON.stringify(keys.map(key => snapshot[key] ?? null));
}

export function quoteTotal(snapshot: QuoteSnapshot | null): number | null {
  return typeof snapshot?.c_total === "number" ? snapshot.c_total : null;
}
