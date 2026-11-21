import { expect, it } from "vitest";
import { matchesQuoteFirstPage } from "./quote-first-page-check";

const quote = (id: string, date?: string) => ({
  _id: id, stage: "QUOTE", jobNumber: 1, updatedAt: "2026-11-21", quote: { date },
});
const undated = quote("undated");
const dated = quote("dated", "2026-11-12");
const deferred = { ...quote("deferred"), quote: { status: "DEFERRED" } };
const callback = { ...quote("callback"), lead: { callbackDate: "2026-11-18" } };

it("checks the complete subset for identical Open cards in the same order", () => {
  const expected = [undated, dated];
  expect(matchesQuoteFirstPage({ total: 4, results: [dated, deferred, callback, undated] }, expected, false)).toBe(true);
  expect(matchesQuoteFirstPage({ total: 4, results: [dated, deferred, callback] }, expected, false)).toBe(false);
  expect(matchesQuoteFirstPage({ total: 2, results: [dated, deferred] }, expected, false)).toBe(false);
  const wrongContact = { ...dated, client: { contactDetails: { name: "Another customer" } } };
  expect(matchesQuoteFirstPage({ total: 2, results: [undated, wrongContact] }, expected, false)).toBe(false);
  const changed = { ...dated, updatedAt: "2026-11-22" };
  expect(matchesQuoteFirstPage({ total: 2, results: [changed, undated] }, expected, false)).toBe(false);
});
