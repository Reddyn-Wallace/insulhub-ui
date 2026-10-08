import { it, expect } from "vitest";
import {
  validateReview,
  decisionFingerprint,
  activeDecisions,
} from "./review-validation";
import type { FinanceInputs, ReviewDecision } from "./model";
const data = (): FinanceInputs => ({
  checkedAt: "2026-09-27",
  bank: {
    accountName: "Main",
    currentCents: 10000,
    balanceUpdatedAt: "2026-09-27",
    transactionsUpdatedAt: "2026-09-27",
    stale: false,
  },
  historyStart: "2024-09-27",
  historyEnd: "2026-09-27",
  jobs: [
    {
      id: "j",
      number: "1",
      quote: "AP1",
      name: "Job",
      status: "JOB_NOT_STARTED_YET",
      archived: false,
      invoiceNumbers: [],
    },
  ],
  invoices: [
    {
      id: "i",
      number: "INV-1",
      reference: "AP1",
      contact: "Name",
      status: "AUTHORISED",
      currency: "NZD",
      date: "2026-09-01",
      dueDate: "2026-10-01",
      total: 10000,
      paid: 0,
      due: 10000,
      credited: 0,
      description: "",
    },
  ],
  payments: [],
  receipts: [
    {
      id: "r",
      date: "2026-09-10",
      amount: 10000,
      description: "receipt",
      reference: "",
    },
  ],
  warnings: [],
});
it("validates exact allocation coverage and rejects overallocations and unproven fee arithmetic", () => {
  const d = data(),
    v = {
      kind: "receipt" as const,
      receiptId: "r",
      allocations: [{ invoiceId: "i", gross: 10000, fee: 0, paymentId: null }],
      nonCustomer: false,
      reason: "Confirmed invoice reference",
    };
  expect(validateReview(d, [], v)).toBe("receipt:r");
  expect(() =>
    validateReview(d, [], {
      ...v,
      allocations: [{ ...v.allocations[0], gross: 12000 }],
    }),
  ).toThrow();
});
it("never accepts fabricated invoice/job IDs or a blank confirmation reason", () => {
  const d = data();
  expect(() =>
    validateReview(d, [], {
      kind: "link",
      invoiceId: "i",
      jobId: "fake",
      reason: "confirmed",
    }),
  ).toThrow();
  expect(() =>
    validateReview(d, [], {
      kind: "link",
      invoiceId: "i",
      jobId: "j",
      reason: "",
    }),
  ).toThrow();
});
it("invalidates saved decisions when their source evidence changes", () => {
  const d = data();
  const v = {
    kind: "receipt" as const,
    receiptId: "r",
    allocations: [],
    nonCustomer: true,
    reason: "Owner transfer",
  };
  const a: ReviewDecision = {
    key: "receipt:r",
    revision: 1,
    fingerprint: decisionFingerprint(d, "receipt:r"),
    value: v,
    updatedAt: "",
  };
  expect(activeDecisions(d, [a]).active.length).toBe(1);
  d.receipts[0].amount = 20000;
  expect(activeDecisions(d, [a]).stale.length).toBe(1);
});
it("requires opening allocations to predate the bank-history window", () => {
  expect(() =>
    validateReview(data(), [], {
      kind: "opening",
      invoiceId: "i",
      amount: 10000,
      date: "2026-09-01",
      reason: "Statement",
    }),
  ).toThrow();
});
it("invalidates receipt allocations when target invoice identity facts change but allows normal Xero catch-up", () => {
  const d = data();
  const value = {
    kind: "receipt" as const,
    receiptId: "r",
    allocations: [{ invoiceId: "i", gross: 10000, fee: 0, paymentId: null }],
    nonCustomer: false,
    reason: "Confirmed invoice receipt",
  };
  const saved: ReviewDecision = {
    key: "receipt:r",
    revision: 1,
    fingerprint: decisionFingerprint(d, "receipt:r", value),
    value,
    updatedAt: "",
  };
  expect(activeDecisions(d, [saved]).active).toHaveLength(1);
  d.invoices[0].paid = 10000;
  d.invoices[0].due = 0;
  d.invoices[0].status = "PAID";
  expect(activeDecisions(d, [saved]).active).toHaveLength(1);
  d.invoices[0].reference = "DIFFERENT";
  expect(activeDecisions(d, [saved]).stale).toHaveLength(1);
});
it("preserves saved receipt identity when retaining its full bank timestamp", () => {
  const d = data();
  d.receipts[0].date = "2026-09-27";
  const before = decisionFingerprint(d, "receipt:r");
  d.receipts[0].date = "2026-09-27T21:18:04.000Z";
  expect(decisionFingerprint(d, "receipt:r")).toBe(before);
  d.receipts[0].date = "2026-09-28T10:18:04.000+13:00";
  expect(decisionFingerprint(d, "receipt:r")).toBe(before);
  d.receipts[0].amount += 1;
  expect(decisionFingerprint(d, "receipt:r")).not.toBe(before);
});

it("owner classifications require a closed balance and expire when payment evidence changes", () => {
  const d = data();
  const value = {
    kind: "classification" as const,
    invoiceId: "i",
    classification: "refunded" as const,
    reason: "Owner confirms cancelled and fully refunded",
  };
  expect(() => validateReview(d, [], value)).toThrow(/unpaid/);
  Object.assign(d.invoices[0], { due: 0, paid: 10000 });
  expect(validateReview(d, [], value)).toBe("classification:i");
  const saved = {
    key: "classification:i",
    revision: 1,
    fingerprint: decisionFingerprint(d, "classification:i", value),
    value,
    updatedAt: "",
  };
  expect(activeDecisions(d, [saved]).active).toHaveLength(1);
  d.invoices[0].paid = 9000;
  expect(activeDecisions(d, [saved]).stale).toHaveLength(1);
});

it("accepts completed-paid-work confirmation only for closed invoices", () => {
  const d = data();
  const value = {
    kind: "classification" as const,
    invoiceId: "i",
    classification: "earned" as const,
    reason: "Owner confirms all paid work completed; later work remains open",
  };
  expect(() => validateReview(d, [], value)).toThrow(/unpaid/);
  d.invoices[0].due = 0;
  d.invoices[0].paid = 10000;
  expect(validateReview(d, [], value)).toBe("classification:i");
});
