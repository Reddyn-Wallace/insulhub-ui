import { expect, it } from "vitest";
import type { BoardJob } from "./board";
import { matchesQuoteRanges, readQuoteRanges, writeQuoteRanges } from "./quote-ranges";

const quote: BoardJob = {
  _id: "quote", jobNumber: 1, stage: "QUOTE", updatedAt: "2026-11-10",
  quote: { date: "2026-11-10T11:00:00Z", c_total: 1250.50 },
};

it("includes both ends of the date range using the New Zealand quote day", () => {
  const range = readQuoteRanges(new URLSearchParams("quoteDateFrom=2026-11-11&quoteDateTo=2026-11-11"));
  expect(matchesQuoteRanges(quote, range)).toBe(true);
  expect(matchesQuoteRanges({ ...quote, quote: { date: "2026-11-10T10:59:59Z" } }, range)).toBe(false);
  expect(matchesQuoteRanges({ ...quote, quote: { date: "2026-11-11T11:00:00Z" } }, range)).toBe(false);
  expect(matchesQuoteRanges({ ...quote, quote: {} }, range)).toBe(false);
});

it("accepts one-sided bounds, inclusive decimals and a zero total", () => {
  const atLeast = readQuoteRanges(new URLSearchParams("quoteValueMin=1250.50"));
  const atMost = readQuoteRanges(new URLSearchParams("quoteValueMax=1250.50"));
  expect(matchesQuoteRanges(quote, atLeast)).toBe(true);
  expect(matchesQuoteRanges(quote, atMost)).toBe(true);
  expect(matchesQuoteRanges({ ...quote, quote: { c_total: 1250.49 } }, atLeast)).toBe(false);
  expect(matchesQuoteRanges({ ...quote, quote: {} }, atMost)).toBe(false);
  expect(matchesQuoteRanges({ ...quote, quote: { c_total: 0 } }, atMost)).toBe(true);
});

it("ignores malformed bounds while retaining valid ones", () => {
  const params = new URLSearchParams("quoteDateFrom=2026-02-31&quoteValueMin=NaN&quoteValueMax=1000&stage=QUOTE");
  writeQuoteRanges(params, readQuoteRanges(params));
  expect(params.toString()).toBe("quoteValueMax=1000&stage=QUOTE");
});
