import { it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { normaliseInvoice, normalisePayment, readCrmJobs } from "./live-data";
it("normalises Xero amounts in cents and separates cash payments from credits", () => {
  expect(
    normaliseInvoice({
      InvoiceID: "i",
      InvoiceNumber: "INV-1",
      Reference: "AP1",
      Status: "AUTHORISED",
      CurrencyCode: "NZD",
      Total: 30,
      AmountDue: 25,
      AmountPaid: 0,
      AmountCredited: 5,
      Date: "/Date(1790467200000+0000)/",
    }),
  ).toMatchObject({
    total: 3000,
    due: 2500,
    paid: 0,
    credited: 500,
    date: "2026-09-27",
  });
  expect(
    normalisePayment({
      PaymentID: "p",
      Invoice: { InvoiceID: "i" },
      PaymentType: "ACCRECPAYMENT",
      Status: "DELETED",
      Amount: 4,
    }),
  ).toBeNull();
  expect(
    normalisePayment({
      PaymentID: "p",
      Invoice: { InvoiceID: "i" },
      PaymentType: "ACCPAYPAYMENT",
      Status: "AUTHORISED",
      Amount: 4,
    }),
  ).toBeNull();
});
it("does not turn malformed invoice amounts into zero", () => {
  expect(() =>
    normaliseInvoice({
      InvoiceID: "i",
      InvoiceNumber: "INV-1",
      Status: "AUTHORISED",
      Total: 4,
      AmountPaid: 0,
      AmountDue: null,
    }),
  ).toThrow();
});
it("reads CRM quote references across all stages without the broken bulk invoice relation", async () => {
  const f = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const q = JSON.parse(String(init?.body)).query;
    expect(q).not.toContain("stages:");
    expect(q).not.toContain("depositInvoice");
    return Response.json({
      data: {
        jobs: {
          total: 1,
          results: [
            {
              _id: "j",
              jobNumber: 123,
              quote: { quoteNumber: "AP123" },
              archivedAt: "2026-01-01",
              installation: { installStatus: "JOB_NOT_STARTED_YET" },
            },
          ],
        },
      },
    });
  });
  vi.stubGlobal("fetch", f);
  expect(await readCrmJobs("token")).toMatchObject([
    { id: "j", quote: "AP123", archived: true },
  ]);
});
