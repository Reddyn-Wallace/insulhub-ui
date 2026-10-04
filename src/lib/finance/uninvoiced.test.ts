import { describe, expect, it } from "vitest";
import { uninvoicedWork, recentInstalledJob } from "./uninvoiced";
import type { FinanceInputs, FinanceJob, FinanceInvoice } from "./model";
const job: FinanceJob = {
  id: "j",
  number: "28697",
  quote: "BW28697",
  name: "44 Watt Street",
  contact: "Alan Mirza",
  archived: false,
  status: "INSTALLED_AS_QUOTED",
  stage: "INSTALLATION",
  invoiceNumbers: ["INV-0412"],
  installDate: "2026-10-01T19:00:00Z",
  quoteCents: 296700,
  finalInvoiceChecked: true,
  finalInvoiceNumber: null,
  depositInvoiceNumber: "INV-0412",
  installmentInvoiceNumbers: [],
};
const invoice: FinanceInvoice = {
  id: "i",
  number: "INV-0412",
  reference: "BW28697 (deposit)",
  contact: "Alan Mirza",
  description: "Deposit",
  total: 74175,
  paid: 74175,
  due: 0,
  credited: 0,
  currency: "NZD",
  status: "PAID",
  date: "2026-09-01",
  dueDate: "2026-09-01",
};
const input = (jobs = [job], invoices = [invoice]): FinanceInputs => ({
  checkedAt: "2026-10-04T07:00:00Z",
  jobs,
  invoices,
  payments: [],
  receipts: [],
  warnings: [],
  historyStart: "",
  historyEnd: "",
  bank: {} as never,
});
describe("completed work awaiting invoice", () => {
  it("counts only the remaining agreed value, independent of whether deposit is paid", () => {
    expect(uninvoicedWork(input(), []).total).toBe(222525);
    expect(
      uninvoicedWork(input([job], [{ ...invoice, paid: 0, due: 74175 }]), [])
        .total,
    ).toBe(222525);
  });
  it("uses NZ calendar dates inclusive of today and 29 preceding days, excluding future and unfinished work", () => {
    expect(
      recentInstalledJob(
        { ...job, installDate: "2026-09-04T12:00:00Z" },
        input().checkedAt,
      ),
    ).toBe(true);
    expect(
      recentInstalledJob(
        { ...job, installDate: "2026-09-04T11:59:59Z" },
        input().checkedAt,
      ),
    ).toBe(false);
    expect(
      recentInstalledJob(
        { ...job, installDate: "2026-10-04T11:00:00Z" },
        input().checkedAt,
      ),
    ).toBe(false);
    expect(
      uninvoicedWork(input([{ ...job, status: "JOB_NOT_STARTED_YET" }]), [])
        .rows,
    ).toEqual([]);
  });
  it("removes an estimate as soon as a final invoice is recorded, including discounted final invoices", () => {
    expect(
      uninvoicedWork(input([{ ...job, finalInvoiceNumber: "INV-FINAL" }]), [])
        .total,
    ).toBe(0);
    expect(
      uninvoicedWork(input([{ ...job, finalInvoiceNumber: "INV-FINAL" }]), [])
        .rows,
    ).toEqual([]);
  });
  it("does not treat an unrecognised invoice or missing expected deposit as uninvoiced money", () => {
    expect(
      uninvoicedWork(input([job], [{ ...invoice, number: "INV-OTHER" }]), [])
        .rows[0].amount,
    ).toBeNull();
    expect(uninvoicedWork(input([job], []), []).rows[0].amount).toBeNull();
  });
  it("includes entirely uninvoiced completed work but rejects missing prices and unchecked details", () => {
    const empty = { ...job, depositInvoiceNumber: null, invoiceNumbers: [] };
    expect(uninvoicedWork(input([empty], []), []).total).toBe(296700);
    for (const change of [
      { quoteCents: null },
      { finalInvoiceChecked: false },
      { status: "INSTALLED_WITH_VARIATIONS_FROM_QUOTE" },
    ])
      expect(
        uninvoicedWork(input([{ ...empty, ...change }], []), []).rows[0].amount,
      ).toBeNull();
    expect(
      uninvoicedWork(
        input(
          [
            {
              ...empty,
              status: "INSTALLED_WITH_VARIATIONS_FROM_QUOTE",
              agreedCents: 300000,
            },
          ],
          [],
        ),
        [],
      ).total,
    ).toBe(300000);
  });
  it("retains captured jobs past day 30 and flags them, without importing historical jobs", () => {
    const old = { ...job, installDate: "2026-08-01T20:00:00Z" };
    expect(uninvoicedWork(input([old]), []).rows).toEqual([]);
    expect(
      uninvoicedWork({ ...input([old]), trackedUninvoicedIds: ["j"] }, [])
        .rows[0],
    ).toMatchObject({ amount: 222525, over30: true });
    expect(
      uninvoicedWork({ ...input([]), trackedUninvoicedIds: ["j"] }, []).rows[0],
    ).toMatchObject({ amount: null, jobId: "j" });
  });
  it("does not infer a balance on owner-classified, credited, or non-NZD invoices", () => {
    for (const inv of [
      { ...invoice, credited: 100 },
      { ...invoice, currency: "AUD" },
    ])
      expect(uninvoicedWork(input([job], [inv]), []).total).toBe(0);
    expect(
      uninvoicedWork(input(), [
        {
          key: "classification:i",
          value: {
            kind: "classification",
            invoiceId: "i",
            classification: "earned",
            reason: "Paid scope completed",
          },
        } as never,
      ]).rows[0].amount,
    ).toBeNull();
  });
});
it("requires explicit installed status even on completed-stage jobs", () => {
  expect(
    uninvoicedWork(
      input([{ ...job, status: "JOB_NOT_STARTED_YET", stage: "COMPLETED" }]),
      [],
    ).rows,
  ).toEqual([]);
});
it("flags an unmatched invoice with the same punctuated customer name", () => {
  const j = {
    ...job,
    contact: "ACME Ltd",
    depositInvoiceNumber: null,
    invoiceNumbers: [],
  };
  expect(
    uninvoicedWork(
      input(
        [j],
        [
          {
            ...invoice,
            reference: "opaque",
            contact: "ACME LTD.",
            description: "Work",
          },
        ],
      ),
      [],
    ).rows[0].amount,
  ).toBeNull();
});
