import { it, expect } from "vitest";
import { calculateFinance } from "./calculate";
import type { FinanceInputs, ReviewDecision, ReviewValue } from "./model";
const base = (): FinanceInputs => ({
  checkedAt: "2026-09-27T10:00:00Z",
  bank: {
    accountName: "Trading",
    currentCents: 1000000,
    balanceUpdatedAt: "2026-09-27T09:00:00Z",
    transactionsUpdatedAt: "2026-09-27T09:00:00Z",
    stale: false,
  },
  historyStart: "2024-09-27",
  historyEnd: "2026-09-27",
  jobs: [
    {
      id: "j",
      number: "1",
      quote: "AP1",
      status: "JOB_NOT_STARTED_YET",
      name: "Test",
      archived: false,
      invoiceNumbers: [],
    },
  ],
  invoices: [
    {
      id: "i",
      number: "INV-0001",
      reference: "AP1",
      contact: "Test",
      date: "2026-09-01",
      dueDate: "2026-09-20",
      status: "AUTHORISED",
      currency: "NZD",
      total: 100000,
      paid: 0,
      due: 100000,
      credited: 0,
      description: "Deposit",
    },
  ],
  payments: [],
  receipts: [],
  warnings: [],
});
const decision = (value: ReviewValue): ReviewDecision => ({
  key: "test",
  revision: 1,
  fingerprint: "test",
  value,
  updatedAt: "",
});
const receipt = (d: FinanceInputs, amount = 100000, id = "r") =>
  d.receipts.push({
    id,
    amount,
    date: "2026-09-10",
    description: "INV-0001",
    reference: "",
  });
const paid = (d: FinanceInputs, amount = 100000) => {
  d.invoices[0].paid = amount;
  d.invoices[0].due = d.invoices[0].total - amount;
  d.payments.push({
    id: "p",
    invoiceId: "i",
    amount,
    date: "2026-09-10",
    reference: "",
  });
};
const installed = (d: FinanceInputs) => {
  d.jobs[0].status = "INSTALLED_AS_QUOTED";
};
it("matches plain bank quote references against labelled Xero references", () => {
  const d = base(); d.invoices[0].reference = "AP1 (deposit)"; receipt(d); paid(d);
  d.receipts[0].description = "Customer AP1";
  expect(calculateFinance(d, []).reserved).toBe(100000);
  d.invoices.push({...d.invoices[0], id: "other", number: "INV-0002", reference: "Quote #AP1"});
  expect(calculateFinance(d, []).reserved).toBe(0);
  d.receipts[0].description = "Customer INV 0001 AP1";
  expect(calculateFinance(d, []).reserved).toBe(100000);
  d.receipts[0].description = "Customer 0001";
  expect(calculateFinance(d, []).reserved).toBe(0);
});
it("reserves received deposits, partial deposits and early final payments; unpaid future billing is excluded", () => {
  const d = base();
  expect(calculateFinance(d, []).reserved).toBe(0);
  receipt(d, 60000);
  expect(calculateFinance(d, [])).toMatchObject({ reserved: 60000, owed: 0 });
  d.invoices[0].description = "Final invoice";
  expect(calculateFinance(d, []).reserved).toBe(60000);
});
it("paid Xero invoices without bank evidence are neither bank cash nor customer debt", () => {
  const d = base();
  paid(d);
  expect(calculateFinance(d, [])).toMatchObject({
    reserved: 0,
    unconfirmedUnfinished: 100000,
  });
  installed(d);
  expect(calculateFinance(d, [])).toMatchObject({
    owed: 0,
    unconfirmedInstalled: 100000,
  });
});
it("deducts a local bank payment once and removes the adjustment when Xero catches up", () => {
  const d = base();
  d.invoices[0].total = 300000;
  d.invoices[0].due = 300000;
  installed(d);
  receipt(d, 120000);
  expect(calculateFinance(d, [])).toMatchObject({
    owed: 180000,
    localAdjustment: 120000,
  });
  paid(d, 120000);
  expect(calculateFinance(d, [])).toMatchObject({
    owed: 180000,
    localAdjustment: 0,
  });
});
it("installation releases reserves, partial work retains them, reopening restores them", () => {
  const d = base();
  receipt(d);
  paid(d);
  expect(calculateFinance(d, []).reserved).toBe(100000);
  installed(d);
  expect(calculateFinance(d, []).reserved).toBe(0);
  d.jobs[0].status = "INSTALL_NOT_FINISHED";
  expect(calculateFinance(d, []).reserved).toBe(100000);
});
it("cancelled/archived and unknown-status jobs retain reserves until evidenced refunds or explicit releases", () => {
  const d = base();
  d.jobs[0].archived = true;
  d.jobs[0].status = "";
  receipt(d);
  const refund = decision({
    kind: "receipt",
    receiptId: "refund",
    allocations: [{ invoiceId: "i", gross: -20000, fee: 0, paymentId: null }],
    nonCustomer: false,
    reason: "Settled refund",
  });
  d.receipts.push({
    id: "refund",
    amount: -20000,
    date: "2026-09-11",
    description: "Refund",
    reference: "",
  });
  expect(calculateFinance(d, [refund]).reserved).toBe(80000);
  expect(
    calculateFinance(d, [
      refund,
      decision({
        kind: "release",
        invoiceId: "i",
        amount: 80000,
        reason: "Retained by agreement",
      }),
    ]).reserved,
  ).toBe(0);
});
it("gross customer advance includes evidenced processor fees", () => {
  const d = base();
  receipt(d, 98000);
  paid(d);
  const a = decision({
    kind: "receipt",
    receiptId: "r",
    allocations: [{ invoiceId: "i", gross: 100000, fee: 2000, paymentId: "p" }],
    nonCustomer: false,
    reason: "Payout statement",
  });
  expect(calculateFinance(d, [a]).reserved).toBe(100000);
});
it("unknown receipts and grouped payouts stay in review; name/amount alone never matches", () => {
  const d = base();
  receipt(d);
  d.receipts[0].description = "Test";
  expect(calculateFinance(d, [])).toMatchObject({
    reserved: 0,
    unmatchedReceipts: 100000,
    provisional: true,
  });
});
it("credits reduce Xero due without inventing payments or cash", () => {
  const d = base();
  installed(d);
  d.invoices[0].total = 300000;
  d.invoices[0].due = 250000;
  d.invoices[0].credited = 50000;
  expect(calculateFinance(d, [])).toMatchObject({
    owed: 250000,
    reserved: 0,
    unconfirmedInstalled: 0,
  });
});
it("duplicate bank receipts cannot both claim the same Xero payment", () => {
  const d = base();
  paid(d);
  receipt(d);
  receipt(d, 100000, "r2");
  const r = calculateFinance(d, []);
  expect(r.reserved).toBe(0);
  expect(r.unmatchedReceipts).toBe(200000);
});
it("does not cap reserves at bank cash", () => {
  const d = base();
  d.bank.currentCents = 10000;
  receipt(d);
  expect(calculateFinance(d, []).cashAfterDeposits).toBe(-90000);
});
it("conflicting quote links and unsupported currencies never count as verified debt", () => {
  const d = base();
  installed(d);
  d.jobs.push({ ...d.jobs[0], id: "j2" });
  expect(calculateFinance(d, []).owed).toBe(0);
  d.jobs.pop();
  d.invoices[0].currency = "USD";
  expect(calculateFinance(d, []).owed).toBe(0);
});
it("a lowered Xero balance with missing payment evidence never causes a second local deduction", () => {
  const d = base();
  installed(d);
  receipt(d, 40000);
  d.invoices[0].paid = 40000;
  d.invoices[0].due = 60000;
  expect(calculateFinance(d, [])).toMatchObject({
    owed: 60000,
    localAdjustment: 0,
  });
});
it("unidentified overpayments are not forced onto an invoice", () => {
  const d = base();
  receipt(d, 120000);
  expect(calculateFinance(d, [])).toMatchObject({
    reserved: 0,
    unmatchedReceipts: 120000,
  });
});
it("opening allocations reserve evidenced historical advances without inventing current bank cash", () => {
  const d = base();
  paid(d);
  const r = calculateFinance(d, [
    decision({
      kind: "opening",
      invoiceId: "i",
      amount: 100000,
      date: "2024-01-01",
      reason: "Owner confirmed bank statement",
    }),
  ]);
  expect(r.reserved).toBe(100000);
  expect(r.bank.currentCents).toBe(1000000);
});
it("does not deduct an already recorded payment again when the bank settlement is more than three days later", () => {
  const d = base();
  installed(d);
  d.invoices[0].total = 300000;
  d.invoices[0].due = 300000;
  paid(d, 120000);
  receipt(d, 120000);
  d.receipts[0].date = "2026-09-17";
  expect(calculateFinance(d, [])).toMatchObject({
    owed: 180000,
    localAdjustment: 0,
  });
});
it("net processor payouts with invoice references remain in review", () => {
  const d = base();
  receipt(d, 98000);
  d.receipts[0].description = "WINDCAVE payout INV-0001";
  expect(calculateFinance(d, [])).toMatchObject({
    reserved: 0,
    unmatchedReceipts: 98000,
  });
});
it("manual bank allocation without identified Xero payment cannot duplicate an existing paid amount", () => {
  const d = base();
  installed(d);
  d.invoices[0].total = 300000;
  d.invoices[0].due = 300000;
  paid(d, 120000);
  receipt(d, 120000);
  d.receipts[0].date = "2026-09-17";
  const a = decision({
    kind: "receipt",
    receiptId: "r",
    allocations: [{ invoiceId: "i", gross: 120000, fee: 0, paymentId: null }],
    nonCustomer: false,
    reason: "Customer receipt",
  });
  expect(calculateFinance(d, [a])).toMatchObject({
    owed: 180000,
    localAdjustment: 0,
  });
});
it("competing equal reference receipts without Xero payments all require review", () => {
  const d = base();
  receipt(d);
  receipt(d, 100000, "r2");
  expect(calculateFinance(d, [])).toMatchObject({
    reserved: 0,
    unmatchedReceipts: 200000,
  });
});
it('nets settled refunds against unrecorded bank receipts before reducing installed debt',()=>{const d=base();installed(d);receipt(d);d.receipts.push({id:'refund',amount:-20000,date:'2026-09-11',description:'Refund',reference:''});const a=decision({kind:'receipt',receiptId:'refund',allocations:[{invoiceId:'i',gross:-20000,fee:0,paymentId:null}],nonCustomer:false,reason:'Settled partial refund'});expect(calculateFinance(d,[a])).toMatchObject({owed:20000,localAdjustment:80000});d.receipts[1].amount=-100000;a.value={...a.value as Extract<ReviewValue,{kind:'receipt'}>,allocations:[{invoiceId:'i',gross:-100000,fee:0,paymentId:null}]};expect(calculateFinance(d,[a])).toMatchObject({owed:100000,localAdjustment:0});});
it('preserves two owner-confirmed receipts when only one owns the existing Xero payment',()=>{const d=base();d.invoices[0].total=300000;d.invoices[0].due=300000;paid(d,100000);receipt(d);receipt(d,100000,'r2');const first=decision({kind:'receipt',receiptId:'r',allocations:[{invoiceId:'i',gross:100000,fee:0,paymentId:'p'}],nonCustomer:false,reason:'First received payment'}),second={...decision({kind:'receipt',receiptId:'r2',allocations:[{invoiceId:'i',gross:100000,fee:0,paymentId:null}],nonCustomer:false,reason:'Second received payment'}),key:'second'};expect(calculateFinance(d,[first,second])).toMatchObject({reserved:200000,unmatchedReceipts:0});});
