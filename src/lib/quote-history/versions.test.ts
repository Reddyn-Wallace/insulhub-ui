import { expect, it } from "vitest";
import { quoteDiff, snapshotQuote } from "./model";
import { quoteVersionValues, reconstructQuoteVersion } from "./versions";

const quote = (total: number, extras: { name: string; price: number }[], additional = {}) =>
  snapshotQuote({ stage: "QUOTE", quote: { c_total: total, extras, wall: { SQM: 61, SQMPrice: 80 }, ...additional } });

it("reconstructs the old quote using stored values, including blanks, a zero deposit and its previous status", () => {
  const before = quote(5612, [], { status: "ACCEPTED", c_deposit: 0, ceiling: { c_thickness: 0, c_bagCount: 0 } });
  const after = quote(5600.50, [{ name: "Discount", price: -10 }], {
    status: "UNSET", c_deposit: 1400.13, c_contractPrice: 4870, c_gst: 730.50,
  });
  const restored = reconstructQuoteVersion(after, [quoteDiff(before, after).changes]);
  expect(restored).toEqual(quoteVersionValues(before));
  expect(restored.fields).toMatchObject({ c_total: "$5,612.00", c_gst: "—", c_deposit: "$0.00", status: "Accepted" });
});

it("walks several edits back and preserves duplicate charges without carrying later-only prices backwards", () => {
  const extra = (price: number) => ({ name: "Painting", price });
  const before = quote(5800, [extra(25), extra(25), extra(40)]);
  const middle = quote(5810, [extra(25), extra(35), extra(40)]);
  const after = quote(5798.50, [extra(25), extra(35), extra(40), { name: "Discount", price: -10 }]);
  expect(reconstructQuoteVersion(after, [quoteDiff(middle, after).changes, quoteDiff(before, middle).changes]))
    .toEqual(quoteVersionValues(before));
});

it("marks inconsistent historic fields or ambiguous field and charge labels as unavailable", () => {
  const snapshot = quote(6900, [{ name: "GST", price: 900 }], { c_gst: 900 });
  const restored = reconstructQuoteVersion(snapshot, [[
    { label: "GST", before: "$890.00", after: "$900.00" },
    { label: "Total incl. GST", before: "$6,800.00", after: "$6,950.00" },
  ]]);
  expect(restored.fields.c_gst).toBeNull();
  expect(restored.fields.c_total).toBeNull();
  expect(restored.extras).toBeNull();
});
