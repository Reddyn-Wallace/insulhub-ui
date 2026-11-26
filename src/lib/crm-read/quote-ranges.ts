import type { BoardJob } from "./board";

export const quoteRangeFields = [
  { key: "quoteDateFrom", label: "Quote date from", type: "date" },
  { key: "quoteDateTo", label: "Quote date to", type: "date" },
  { key: "quoteValueMin", label: "Minimum value (NZD)", type: "number" },
  { key: "quoteValueMax", label: "Maximum value (NZD)", type: "number" },
] as const;

export type QuoteRanges = Record<(typeof quoteRangeFields)[number]["key"], string>;

export const emptyQuoteRanges: QuoteRanges = {
  quoteDateFrom: "",
  quoteDateTo: "",
  quoteValueMin: "",
  quoteValueMax: "",
};

export const quoteRangeStorageKey = "jobs-quote-ranges";

const quoteDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit",
});

function isDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
}

function isValue(value: string) {
  return /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(value) && Number.isFinite(Number(value));
}

export function readQuoteRanges(params: Pick<URLSearchParams, "get">): QuoteRanges {
  const ranges = { ...emptyQuoteRanges };
  for (const { key, type } of quoteRangeFields) {
    const value = params.get(key) ?? "";
    if (type === "date" ? isDate(value) : isValue(value)) ranges[key] = value;
  }
  return ranges;
}

export function writeQuoteRanges(params: URLSearchParams, ranges: QuoteRanges) {
  for (const { key } of quoteRangeFields) {
    if (ranges[key]) params.set(key, ranges[key]);
    else params.delete(key);
  }
}

export function matchesQuoteRanges(job: BoardJob, ranges: QuoteRanges) {
  const { quoteDateFrom, quoteDateTo, quoteValueMin, quoteValueMax } = ranges;
  if (quoteDateFrom || quoteDateTo) {
    const timestamp = job.quote?.date ? Date.parse(job.quote.date) : NaN;
    if (!Number.isFinite(timestamp)) return false;
    const parts = quoteDay.formatToParts(timestamp);
    const part = (type: string) => parts.find(item => item.type === type)?.value;
    const day = `${part("year")}-${part("month")}-${part("day")}`;
    if ((quoteDateFrom && day < quoteDateFrom) || (quoteDateTo && day > quoteDateTo)) return false;
  }
  if (quoteValueMin || quoteValueMax) {
    const value = job.quote?.c_total;
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if ((quoteValueMin && value < Number(quoteValueMin)) || (quoteValueMax && value > Number(quoteValueMax))) return false;
  }
  return true;
}
