import { describe, expect, it } from "vitest";
import { quoteDiff, revisionContent, snapshotQuote } from "./model";
import { confirmQuoteMutation, confirmQuotePdf } from "./confirmation";
import { ADD_FILES, UPDATE_JOB_QUOTE } from "@/lib/mutations";
import { quoteHistoryMutation } from "./mutation";

describe("quote history changes", () => {
  it("reports committed scope, signed discounts and NZD totals", () => {
    const before = snapshotQuote({ stage: "QUOTE", quote: { wall: { SQM: 80 }, c_total: 6900 } });
    const after = snapshotQuote({ stage: "QUOTE", quote: { wall: { SQM: 92 }, c_total: 7590, extras: [{ name: "Discount", price: -300 }] } });
    expect(quoteDiff(before, after)).toMatchObject({
      revised: true,
      changes: [
        { label: "Wall area", before: "80 m²", after: "92 m²" },
        { label: "Total incl. GST", before: "$6,900.00", after: "$7,590.00" },
        { label: "Discount", before: "—", after: "-$300.00" },
      ],
    });
  });

  it("preserves duplicate extras and ignores order, rounding noise and unrelated job fields", () => {
    const extras = [{ name: "Paint", price: 10 }, { name: "Paint", price: 10 }, { name: "Paint", price: 20 }];
    const before = snapshotQuote({ stage: "QUOTE", quote: { extras, c_total: 3.45000000001 }, notes: "ignored" });
    const after = snapshotQuote({ stage: "QUOTE", quote: { extras: [...extras].reverse(), c_total: 3.45 } });
    expect(quoteDiff(before, after).changes).toEqual([]);
    expect(revisionContent(before)).toEqual(revisionContent(after));
    const edited = snapshotQuote({ stage: "QUOTE", quote: { extras: [...extras.slice(1), { name: "Paint", price: 12 }], c_total: 3.45 } });
    expect(quoteDiff(after, edited).changes).toEqual([{ label: "Paint", before: "$10.00", after: "$12.00" }]);
  });

  it("keeps staff acceptance and follow-up settings on the same price revision", () => {
    const before = snapshotQuote({ stage: "QUOTE", quote: { quoteNumber: "Q1", status: "UNSET" } });
    const after = snapshotQuote({ stage: "SCHEDULED", quote: { quoteNumber: "Q1", status: "ACCEPTED", sendFollowupText: true } });
    expect(quoteDiff(before, after)).toMatchObject({ revised: false, keys: ["sendFollowupText", "status"] });
    expect(revisionContent(before)).toBe(revisionContent(after));
    expect(snapshotQuote({ stage: "LEAD", quote: { status: "UNSET", c_total: 0 } })).toBeNull();
  });

  it("attributes only PDF changes that agree with the submitted quote", () => {
    const snap = (total: number) => snapshotQuote({ stage: "QUOTE", quote: { c_total: total } });
    expect(confirmQuotePdf(snap(100), snap(200), snap(200)).kind).toBe("pdf");
    expect(confirmQuotePdf(snap(100), snap(200), snap(300)).kind).toBe("external");
  });
});


describe("quote mutation confirmation", () => {
  it("routes CRM quote actions and quote attachments without tracking other job files", () => {
    const id = "abcdef123456abcdef123456";
    const input = { _id: id, stage: "SCHEDULED", quote: { status: "ACCEPTED" } };
    expect(quoteHistoryMutation(UPDATE_JOB_QUOTE, { input })).toEqual({ id, kind: "accepted" });
    expect(quoteHistoryMutation(UPDATE_JOB_QUOTE, { input, emailQuoteToCustomer: true })).toEqual({ id, kind: "send" });
    const files = { _id: id, documentType: "QUOTE_SITE_PLAN", fileNames: ["roof.pdf"] };
    expect(quoteHistoryMutation(ADD_FILES, files)).toEqual({ id, kind: "files", added: ["roof.pdf"], removed: [] });
    expect(quoteHistoryMutation(ADD_FILES, { ...files, documentType: "OTHER" })).toBeNull();
  });

  it("records a send acknowledgment only for a successful matching response", async () => {
    const id = "abcdef123456abcdef123456";
    const attempt = { id, kind: "send" } as const;
    const updateJob = { _id: id, stage: "QUOTE", quote: { c_total: 7700 } };
    const read = async () => { throw new Error("Send acknowledgment should use the upstream write response"); };
    expect(await confirmQuoteMutation(attempt, { data: { updateJob } }, null, read)).toMatchObject({
      kind: "send", snapshot: { c_total: 7700 },
    });
    expect(await confirmQuoteMutation(attempt, { data: { updateJob }, errors: [{ message: "Delivery unknown" }] }, null, read)).toBeNull();
    expect(await confirmQuoteMutation(attempt, { data: { updateJob: null } }, null, read)).toBeNull();
  });
});
