import { expect, it } from "vitest";
import { recentReceiptAdjustments } from "./recent-receipts";
import type { FinanceInputs, ReviewDecision } from "./model";
const input = (): FinanceInputs => ({
  checkedAt: "2026-09-29T10:00:00Z",
  historyStart: "2026-09-22T10:00:00Z",
  historyEnd: "2026-09-29T10:00:00Z",
  recentBankChecked: true,
  bank: {
    accountName: "Trading",
    currentCents: 500000,
    balanceUpdatedAt: "2026-09-29T09:00:00Z",
    transactionsUpdatedAt: "2026-09-29T09:00:00Z",
    stale: false,
  },
  jobs: [],
  invoices: [
    {
      id: "i",
      number: "INV-0001",
      reference: "AP1",
      contact: "Customer",
      date: "2026-09-01",
      dueDate: "2026-09-20",
      status: "AUTHORISED",
      currency: "NZD",
      total: 100000,
      paid: 0,
      due: 100000,
      credited: 0,
      description: "",
    },
  ],
  receipts: [
    {
      id: "r",
      amount: 40000,
      date: "2026-09-28T09:00:00Z",
      description: "Customer INV 0001",
      reference: "",
    },
  ],
  payments: [],
  warnings: [],
});
it("deducts partial receipts once and stops deducting when Xero catches up", () => {
  const d = input();
  expect(recentReceiptAdjustments(d, []).get("i")).toBe(40000);
  d.invoices[0].paid = 15000;
  d.invoices[0].due = 85000;
  expect(recentReceiptAdjustments(d, []).get("i")).toBe(25000);
  d.invoices[0].paid = 40000;
  d.invoices[0].due = 60000;
  expect(recentReceiptAdjustments(d, []).get("i") || 0).toBe(0);
});
it("does not use amount-only, processor, duplicate invoice, or outside-week evidence", () => {
  for (const description of [
    "Customer",
    "Windcave INV-0001",
    "INV-0001 INV-0002",
    "INV-0001 INV-9999",
  ]) {
    const d = input();
    d.receipts[0].description = description;
    if (description.includes("0002"))
      d.invoices.push({ ...d.invoices[0], id: "i2", number: "INV-0002" });
    expect(recentReceiptAdjustments(d, []).size).toBe(0);
  }
  const d = input();
  d.receipts[0].date = "2026-09-21";
  expect(recentReceiptAdjustments(d, []).size).toBe(0);
});
it("honours owner non-customer decisions and caps deductions at Xero due", () => {
  const d = input();
  const decisions = [
    {
      key: "receipt:r",
      revision: 1,
      fingerprint: "test",
      updatedAt: "2026-09-29",
      value: {
        kind: "receipt",
        receiptId: "r",
        nonCustomer: true,
        allocations: [],
        reason: "Not customer income",
      },
    },
  ] as ReviewDecision[];
  expect(recentReceiptAdjustments(d, decisions).size).toBe(0);
  d.invoices[0].due = 10000;
  expect(recentReceiptAdjustments(d, []).get("i")).toBe(10000);
});
it("never subtracts existing Xero payments twice when payment detail is incomplete", () => {
  const d = input();
  d.receipts.push({ ...d.receipts[0], id: "r2", amount: 20000 });
  d.invoices[0].paid = 45000;
  d.invoices[0].due = 55000;
  expect(recentReceiptAdjustments(d, []).get("i")).toBe(15000);
});
it("flags old-deposit overlap rather than assuming dates prove independent receipts", () => {
  const d = input();
  d.invoices[0].paid = 60000;
  d.invoices[0].due = 40000;
  d.payments = [
    {
      id: "old",
      invoiceId: "i",
      amount: 60000,
      date: "2026-09-02",
      reference: "",
    },
  ];
  const uncertain = new Set<string>();
  expect(recentReceiptAdjustments(d, [], uncertain).size).toBe(0);
  expect(uncertain.has("i")).toBe(true);
  d.invoices[0].paid = 80000;
  d.invoices[0].due = 20000;
  d.payments.push({
    id: "catchup",
    invoiceId: "i",
    amount: 20000,
    date: "2026-09-28",
    reference: "",
  });
  expect(recentReceiptAdjustments(d, []).get("i") || 0).toBe(0);
  d.invoices[0].paid = 100000;
  d.invoices[0].due = 0;
  d.payments[1].amount = 40000;
  expect(recentReceiptAdjustments(d, []).get("i") || 0).toBe(0);
});

it("reports ambiguous overlap rather than silently ignoring a receipt", () => {
  const d = input();
  d.invoices[0].paid = 60000;
  d.invoices[0].due = 40000;
  const uncertain = new Set<string>();
  expect(recentReceiptAdjustments(d, [], uncertain).size).toBe(0);
  expect(uncertain.has("i")).toBe(true);
});

it("respects an owner link to an older Xero payment instead of deducting it twice", () => {
  const d = input();
  d.invoices[0].total = 140000;
  d.invoices[0].paid = 60000;
  d.invoices[0].due = 80000;
  d.receipts[0].amount = 60000;
  d.payments = [
    {
      id: "old",
      invoiceId: "i",
      amount: 60000,
      date: "2026-09-02",
      reference: "",
    },
  ];
  const decisions: ReviewDecision[] = [
    {
      key: "receipt:r",
      revision: 1,
      fingerprint: "test",
      updatedAt: "",
      value: {
        kind: "receipt",
        receiptId: "r",
        nonCustomer: false,
        reason: "Confirmed existing payment",
        allocations: [
          { invoiceId: "i", gross: 60000, fee: 0, paymentId: "old" },
        ],
      },
    },
  ];
  expect(recentReceiptAdjustments(d, decisions).size).toBe(0);
});
it("recognises the compact bank reference Inv0441 without dropping invoice digits", () => {
  const d = input();
  d.invoices[0].number = "INV-0441";
  d.receipts[0].description = "Berry A R Berry Inv0441";
  expect(recentReceiptAdjustments(d, []).get("i")).toBe(40000);
  d.receipts[0].description = "Berry 0441";
  expect(recentReceiptAdjustments(d, []).size).toBe(0);
});
it("resolves a reused paid-deposit reference only with the same verified job, explicit quote and full later invoice amount", () => {
  const d = input();
  d.jobs = [
    {
      id: "job",
      quote: "RW26353",
      number: "1",
      name: "Test",
      status: "INSTALLED_AS_QUOTED",
      archived: false,
      invoiceNumbers: [],
    },
  ];
  d.invoices[0] = {
    ...d.invoices[0],
    number: "INV-0422",
    reference: "Quote #RW26353",
    total: 646418,
    due: 646418,
    date: "2026-09-14",
  };
  d.invoices.push({
    ...d.invoices[0],
    id: "deposit",
    number: "INV-0340",
    reference: "RW26353 (deposit)",
    date: "2026-08-05",
    status: "PAID",
    total: 230860,
    paid: 230860,
    due: 0,
  });
  d.receipts[0] = {
    ...d.receipts[0],
    amount: 646418,
    description: "De Sain,Shona Rw26353 Inv-0340 Shona Desain",
  };
  expect(recentReceiptAdjustments(d, []).get("i")).toBe(646418);
  d.invoices[0].paid = 200000;
  d.invoices[0].due = 446418;
  expect(recentReceiptAdjustments(d, []).get("i")).toBe(446418);
  d.invoices[0].paid = 646418;
  d.invoices[0].due = 0;
  expect(recentReceiptAdjustments(d, []).size).toBe(0);
  d.invoices[0].paid = 0;
  d.invoices[0].due = 646418;
  d.receipts[0].description = "De Sain Inv-0340";
  expect(recentReceiptAdjustments(d, []).size).toBe(0);
  d.receipts[0].description = "Rw26353 Inv-0340";
  d.invoices.push({ ...d.invoices[0], id: "duplicate", number: "INV-0500" });
  expect(recentReceiptAdjustments(d, []).size).toBe(0);
  Object.assign(d.invoices[2], { status: "PAID", paid: 646418, due: 0 });
  expect(recentReceiptAdjustments(d, []).size).toBe(0);
});

it("uses the actual bank timestamp at the seven-day boundary", () => {
  const d = input();
  d.receipts[0].date = "2026-09-22T11:00:00Z";
  expect(recentReceiptAdjustments(d, []).get("i")).toBe(40000);
  d.receipts[0].date = "2026-09-22T09:00:00Z";
  expect(recentReceiptAdjustments(d, []).size).toBe(0);
});
