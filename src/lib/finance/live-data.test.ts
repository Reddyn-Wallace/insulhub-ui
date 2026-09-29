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
it("verifies invoice links and installation from CRM detail, without matching names alone", async () => {
  const { verifyCrmDetails } = await import("./live-data");
  const jobs = [
    {
      id: "j",
      number: "1",
      quote: "AP1",
      status: "JOB_NOT_STARTED_YET",
      archived: false,
      name: "Address",
      contact: "Customer",
      invoiceNumbers: [],
    },
  ];
  const invoices = [
    normaliseInvoice({
      InvoiceID: "i",
      InvoiceNumber: "INV-1",
      Reference: "opaque",
      Contact: { Name: "Customer" },
      Status: "PAID",
      CurrencyCode: "NZD",
      Total: 10,
      AmountPaid: 10,
      AmountDue: 0,
    })!,
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: {
          j0: {
            _id: "j",
            stage: "COMPLETED",
            installation: { installStatus: "INSTALLED_AS_QUOTED" },
            depositInvoice: { xeroInvoiceNumber: "INV-1" },
            finalInvoice: null,
            additionalInstallmentInvoices: [],
          },
        },
      }),
    ),
  );
  const result = await verifyCrmDetails("token", jobs, invoices);
  expect(result[0]).toMatchObject({
    status: "INSTALLED_AS_QUOTED",
    stage: "COMPLETED",
    invoiceNumbers: ["INV-1"],
    detailVerified: true,
  });
});
it("verifies every competing quote job before finalising customer-corroborated links", async () => {
  const { linkInvoices } = await import("./linking");
  const { verifyCrmDetails } = await import("./live-data");
  const jobs = ["a", "b"].map((id) => ({
    id,
    number: id,
    quote: "AP1",
    status: "INSTALLED_AS_QUOTED",
    archived: false,
    name: "Address",
    contact: id === "a" ? "Customer A" : "Customer B",
    invoiceNumbers: [],
  }));
  const invoices = [
    normaliseInvoice({
      InvoiceID: "i",
      InvoiceNumber: "INV-1",
      Reference: "AP1",
      Contact: { Name: "Customer A" },
      Status: "PAID",
      CurrencyCode: "NZD",
      Total: 10,
      AmountPaid: 10,
      AmountDue: 0,
    })!,
  ];
  expect(linkInvoices(invoices, jobs, []).get("i")?.jobId).toBe("a");
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { variables } = JSON.parse(String(init?.body));
    expect(Object.values(variables).sort()).toEqual(["a", "b"]);
    return Response.json({
      data: Object.fromEntries(
        Object.entries(variables).map(([key, id]) => [
          key.replace("id", "j"),
          {
            _id: id,
            stage: "COMPLETED",
            installation: { installStatus: "INSTALLED_AS_QUOTED" },
            depositInvoice: id === "b" ? { xeroInvoiceNumber: "INV-1" } : null,
          },
        ]),
      ),
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const verified = await verifyCrmDetails("token", jobs, invoices);
  expect(verified.every((j) => j.detailVerified)).toBe(true);
  expect(linkInvoices(invoices, verified, []).get("i")?.jobId).toBe("b");
  vi.unstubAllGlobals();
});
