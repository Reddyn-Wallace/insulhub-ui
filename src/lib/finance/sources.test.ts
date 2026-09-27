import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getBankSnapshot, getBankTransactions } from "./akahu";
import { getCrmSnapshot, getXeroSnapshot } from "./sources";
vi.mock("./xero-oauth", () => ({
  withXeroAccess: async (
    _owner: string,
    op: (token: string, tenant: string) => unknown,
  ) => op("access", "tenant"),
}));
vi.mock("./connection-store", () => ({
  readConnection: async () => ({
    tenant_id: "tenant",
    tenant_name: "Insulmax",
    refresh_pending: false,
  }),
}));
beforeEach(() => {
  vi.stubEnv("AKAHU_ACCOUNT_ID", "acc_main");
  vi.stubEnv("AKAHU_APP_TOKEN", "app");
  vi.stubEnv("AKAHU_USER_TOKEN", "user");
});
const account = () => ({
  success: true,
  item: {
    _id: "acc_main",
    name: "Trading Account",
    status: "ACTIVE",
    balance: {
      current: 11993.17,
      available: 61993.17,
      limit: 50000,
      currency: "NZD",
    },
    refreshed: {
      balance: new Date().toISOString(),
      transactions: new Date().toISOString(),
    },
  },
});
it("uses current cash rather than overdraft availability", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(account())),
  );
  expect((await getBankSnapshot()).currentCents).toBe(1199317);
});
it("rejects wrong accounts, disconnected feeds, missing timestamps and non-NZD balances", async () => {
  for (const change of [
    (a: ReturnType<typeof account>) => (a.item._id = "other"),
    (a: ReturnType<typeof account>) => (a.item.status = "INACTIVE"),
    (a: ReturnType<typeof account>) => (a.item.refreshed.balance = ""),
    (a: ReturnType<typeof account>) => (a.item.balance.currency = "USD"),
  ]) {
    const a = account();
    change(a);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(a)),
    );
    await expect(getBankSnapshot()).rejects.toThrow();
  }
});
it("marks stale bank data and never invents a missing transaction timestamp", async () => {
  const a = account();
  a.item.refreshed.balance = "2020-01-01T00:00:00Z";
  a.item.refreshed.transactions = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(a)),
  );
  const r = await getBankSnapshot();
  expect(r.stale).toBe(true);
  expect(r.transactionsUpdatedAt).toBeNull();
});
it("reads all transaction pages and fails repeated cursor instead of returning partial success", async () => {
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        ++calls === 1
          ? {
              success: true,
              items: [{ _id: "t1", _account: "acc_main", amount: 5 }],
              cursor: { next: "next" },
            }
          : {
              success: true,
              items: [{ _id: "t2", _account: "acc_main", amount: 7 }],
              cursor: { next: null },
            },
      ),
    ),
  );
  expect((await getBankTransactions("2026-09-01", "2026-09-27")).length).toBe(
    2,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ success: true, items: [], cursor: { next: "repeat" } }),
    ),
  );
  await expect(
    getBankTransactions("2026-09-01", "2026-09-27"),
  ).rejects.toThrow();
});
it("counts missing CRM invoice links explicitly", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: {
          jobs: {
            total: 2,
            results: [
              {
                _id: "j1",
                installation: { installStatus: "INSTALLED_AS_QUOTED" },
                depositInvoice: { xeroInvoiceNumber: "INV-1" },
              },
              { _id: "j2", installation: null },
            ],
          },
        },
      }),
    ),
  );
  const r = await getCrmSnapshot("session");
  expect(r.jobCount).toBe(2);
  expect(r.missingInvoiceLinks).toBe(1);
  expect(r.missingInstallationStatus).toBe(1);
});
it("fails incomplete CRM pagination", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ data: { jobs: { total: 5, results: [] } } }),
    ),
  );
  await expect(getCrmSnapshot("session")).rejects.toThrow();
});
it("does not treat malformed Xero balances as zero", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        Invoices: [
          {
            InvoiceID: "i1",
            InvoiceNumber: "INV-1",
            Type: "ACCREC",
            Status: "AUTHORISED",
            Total: 20,
            AmountDue: "not numeric",
            AmountPaid: 0,
          },
        ],
      }),
    ),
  );
  await expect(getXeroSnapshot("owner")).rejects.toThrow();
});

it("retains CRM jobs but flags missing mandatory invoice numbers as incomplete links", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: {
          jobs: {
            total: 1,
            results: [
              {
                _id: "j1",
                installation: { installStatus: "INSTALLED_AS_QUOTED" },
                depositInvoice: null,
                finalInvoice: { xeroInvoiceNumber: "INV-2" },
              },
            ],
          },
        },
        errors: [
          {
            message:
              "Cannot return null for non-nullable field InvoiceSchema.xeroInvoiceNumber.",
            path: ["jobs", "results", 0, "depositInvoice", "xeroInvoiceNumber"],
          },
        ],
      }),
    ),
  );
  const r = await getCrmSnapshot("session");
  expect(r.jobCount).toBe(1);
  expect(r.installed).toBe(1);
  expect(r.missingInvoiceLinks).toBe(1);
});
it("still rejects CRM errors outside the known missing invoice-number field", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: { jobs: { total: 1, results: [{ _id: "j1" }] } },
        errors: [
          {
            message: "Resolver failed",
            path: ["jobs", "results", 0, "installation"],
          },
        ],
      }),
    ),
  );
  await expect(getCrmSnapshot("session")).rejects.toThrow(
    "CRM job data was incomplete",
  );
});
