import { it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./xero-oauth", () => ({
  withXeroAccess: async (
    _owner: string,
    run: (token: string, tenant: string) => unknown,
  ) => run("token", "tenant"),
}));
vi.mock("./akahu", () => ({
  getBankSnapshot: vi.fn(async () => ({ currentCents: 10000 })),
  getBankTransactions: vi.fn(async () => []),
}));
import { loadFinanceInputs } from "./live-data";
import { getBankTransactions } from "./akahu";
it("overview reads invoice amounts and detailed jobs with one week of bank receipts and Xero payment evidence", async () => {
  const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("/Invoices?")) {
      expect(String(url)).toContain("pageSize=1000");
      return Response.json({
        Invoices: [
          {
            InvoiceID: "i",
            InvoiceNumber: "INV-1",
            Reference: "AP1",
            Status: "PAID",
            CurrencyCode: "NZD",
            Total: 10,
            AmountPaid: 10,
            AmountDue: 0,
          },
        ],
      });
    }
    if (String(url).includes("/Payments"))
      return Response.json({ Payments: [] });
    const q = JSON.parse(String(init?.body)).query;
    if (q.includes("FinanceJobIndex"))
      return Response.json({
        data: {
          jobs: {
            total: 1,
            results: [
              { _id: "j", quote: { quoteNumber: "AP1" }, stage: "INVOICE" },
            ],
          },
        },
      });
    return Response.json({
      data: {
        j0: {
          _id: "j",
          stage: "INVOICE",
          installation: { installStatus: "INSTALLED_AS_QUOTED" },
          finalInvoice: { xeroInvoiceNumber: "INV-1" },
        },
      },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const d = await loadFinanceInputs({ userId: "owner", token: "token" });
  expect(getBankTransactions).toHaveBeenCalledOnce();
  const [start, end] = vi.mocked(getBankTransactions).mock.calls[0];
  expect(Date.parse(end) - Date.parse(start)).toBe(7 * 86400000);
  expect(d.recentBankChecked).toBe(true);
  expect(d.bankChecked).toBe(false);
  expect(d.invoices[0].paid).toBe(1000);
  expect(d.jobs[0].invoiceNumbers).toEqual(["INV-1"]);
  expect(fetcher).toHaveBeenCalledTimes(4);
  vi.unstubAllGlobals();
});
