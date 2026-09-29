import { createHash } from "node:crypto";
import { calculateFinance } from "./calculate";
import type { FinanceInputs, ReviewDecision, ReviewValue } from "./model";
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message);
}
const integer = (n: unknown) =>
  typeof n === "number" && Number.isSafeInteger(n);
export function decisionFingerprint(
  d: FinanceInputs,
  key: string,
  value?: ReviewValue | null,
) {
  const split = key.indexOf(":"),
    kind = key.slice(0, split),
    id = key.slice(split + 1);
  const invoice = (id: string) => {
    const i = d.invoices.find((i) => i.id === id);
    return i
      ? {
          id: i.id,
          number: i.number,
          reference: i.reference,
          contact: i.contact,
          date: i.date,
          total: i.total,
          currency: i.currency,
          status: ["PAID", "AUTHORISED"].includes(i.status)
            ? "APPROVED"
            : i.status,
        }
      : null;
  };
  const job = (id: string) => {
    const j = d.jobs.find((j) => j.id === id);
    return j
      ? { id: j.id, number: j.number, quote: j.quote, name: j.name }
      : null;
  };
  let evidence: unknown =
    kind === "receipt"
      ? d.receipts.find((r) => r.id === id)
      : kind === "job"
        ? job(id)
        : invoice(id);
  if (!evidence) return "";
  // Preserve existing decision identities while retaining full bank timestamps for NZ display/window checks.
  if (kind === "receipt") {
    const receipt = evidence as FinanceInputs["receipts"][number];
    evidence = {
      ...receipt,
      date: Number.isFinite(Date.parse(receipt.date))
        ? new Date(receipt.date).toISOString().slice(0, 10)
        : "",
    };
  }
  if (value?.kind === "receipt" && !value.nonCustomer)
    evidence = {
      receipt: evidence,
      invoices: value.allocations.map((a) => invoice(a.invoiceId)),
    };
  if (value?.kind === "link")
    evidence = { invoice: evidence, job: job(value.jobId) };
  return createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}
export function validateReview(
  d: FinanceInputs,
  decisions: ReviewDecision[],
  v: ReviewValue,
): string {
  check(
    v &&
      typeof v === "object" &&
      typeof v.reason === "string" &&
      v.reason.trim().length >= 5 &&
      v.reason.length <= 1000,
    "Add a clear reason or settlement evidence (5–1000 characters).",
  );
  check(
    v.kind !== "release",
    "Historical retained releases no longer change Xero-based totals. Undo the old decision if needed.",
  );
  let key: string;
  if (v.kind === "link") {
    key = "link:" + v.invoiceId;
    check(
      d.invoices.some((i) => i.id === v.invoiceId) &&
        d.jobs.some((j) => j.id === v.jobId),
      "Select an existing invoice and CRM job.",
    );
    return key;
  }
  if (v.kind === "receipt") {
    key = "receipt:" + v.receiptId;
    const r = d.receipts.find((r) => r.id === v.receiptId);
    check(r, "Bank transaction is no longer in the loaded history.");
    check(
      Array.isArray(v.allocations) &&
        v.allocations.length <= 30 &&
        typeof v.nonCustomer === "boolean",
      "Invalid receipt allocation.",
    );
    if (v.nonCustomer) {
      check(
        v.allocations.length === 0,
        "Non-customer transactions cannot have invoice allocations.",
      );
      return key;
    }
    check(
      v.allocations.length > 0,
      "Allocate the receipt or classify it as non-customer.",
    );
    const invoiceIds = new Set<string>(),
      paymentIds = new Set<string>();
    for (const a of v.allocations) {
      const i = d.invoices.find((i) => i.id === a.invoiceId);
      check(i && i.currency === "NZD", "Choose an NZD customer invoice.");
      check(!invoiceIds.has(i.id), "Combine allocations to the same invoice.");
      invoiceIds.add(i.id);
      check(
        integer(a.gross) &&
          integer(a.fee) &&
          a.fee >= 0 &&
          a.gross !== 0 &&
          Math.sign(a.gross) === Math.sign(r.amount),
        "Invalid signed allocation amount.",
      );
      check(
        a.gross > 0 ? a.fee < a.gross : a.fee === 0,
        "Fees apply only to incoming settlements.",
      );
      check(
        a.paymentId === null || typeof a.paymentId === "string",
        "Invalid payment evidence.",
      );
      if (a.paymentId) {
        const p = d.payments.find((p) => p.id === a.paymentId);
        check(
          p && p.invoiceId === i.id && p.amount === a.gross,
          "Selected Xero payment no longer matches the allocation.",
        );
        check(!paymentIds.has(p.id), "A payment can be allocated once.");
        paymentIds.add(p.id);
      }
    }
    check(
      v.allocations.reduce((n, a) => n + a.gross - a.fee, 0) === r.amount,
      "Gross allocations less fees must equal the bank transaction exactly.",
    );
    const other = decisions.filter((x) => x.key !== key);
    for (const a of v.allocations) {
      if (a.paymentId)
        check(
          !other.some(
            (x) =>
              x.value?.kind === "receipt" &&
              x.value.allocations.some((b) => b.paymentId === a.paymentId),
          ),
          "That Xero payment is already allocated.",
        );
    }
  } else if (v.kind === "opening") {
    key = v.kind + ":" + v.invoiceId;
    check(
      integer(v.amount) && v.amount > 0,
      "Enter a positive amount in cents.",
    );
    const i = d.invoices.find((i) => i.id === v.invoiceId);
    check(i && i.currency === "NZD", "Choose an NZD invoice.");
    if (v.kind === "opening")
      check(
        /^\d{4}-\d{2}-\d{2}$/.test(v.date) &&
          Number.isFinite(Date.parse(v.date)) &&
          v.date < d.historyStart.slice(0, 10) &&
          v.date >= i.date,
        "An opening allocation must be on/after the invoice date and before the bank-history window.",
      );
  } else throw Error("Unknown review action.");
  const candidate: ReviewDecision = {
    key,
    revision: 1,
    fingerprint: decisionFingerprint(d, key),
    value: v,
    updatedAt: "",
  };
  const result = calculateFinance(d, [
    ...decisions.filter((x) => x.key !== key),
    candidate,
  ]);
  for (const row of result.rows) {
    const gross =
      row.allocations.reduce((n, a) => n + a.gross, 0) + row.opening;
    check(
      gross >= 0 && gross <= row.total,
      "Allocation exceeds the invoice total or refunds exceed evidenced receipts.",
    );
  }
  return key;
}
export function activeDecisions(d: FinanceInputs, decisions: ReviewDecision[]) {
  const active: ReviewDecision[] = [],
    stale: ReviewDecision[] = [];
  const candidates = decisions.filter((x) => x.value);
  for (const x of candidates) {
    try {
      check(
        x.fingerprint === decisionFingerprint(d, x.key, x.value),
        "Changed source evidence",
      );
      validateReview(
        d,
        candidates.filter((y) => y.key !== x.key),
        x.value!,
      );
      active.push(x);
    } catch {
      stale.push(x);
    }
  }
  return { active, stale };
}
