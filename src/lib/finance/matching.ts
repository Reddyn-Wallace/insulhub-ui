import type {
  Allocation,
  FinanceInputs,
  FinanceReceipt,
  ReviewDecision,
} from "./model";
export type ReceiptMatch = {
  receipt: FinanceReceipt;
  allocations: Allocation[];
  method: string;
  reason: string;
  nonCustomer: boolean;
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function hasReference(text: string, ref: string) {
  return (
    ref.length >= 3 &&
    new RegExp("(^|[^a-z0-9])" + escape(ref) + "($|[^a-z0-9])", "i").test(text)
  );
}
const near = (a: string, b: string) =>
  !!a && !!b && Math.abs(Date.parse(a) - Date.parse(b)) <= 3 * 86400000;
export function matchReceipts(
  input: FinanceInputs,
  decisions: ReviewDecision[],
): ReceiptMatch[] {
  const invoices = input.invoices.filter((i) => i.currency === "NZD");
  const manual = new Map(
    decisions.flatMap((d) =>
      d.value?.kind === "receipt"
        ? [[d.value.receiptId, d.value] as const]
        : [],
    ),
  );
  const candidates = new Map<string, typeof invoices>();
  for (const r of input.receipts) {
    const text = r.description + " " + r.reference;
    const numberMatches = invoices.filter((i) => hasReference(text, i.number));
    const refs = invoices.filter((i) => hasReference(text, i.reference));
    const ids = new Set([...numberMatches, ...refs].map((i) => i.id));
    // An exact invoice number narrows a shared quote, but a different job/reference conflicts.
    const pool = numberMatches.length
      ? numberMatches.filter((i) =>
          refs.every((x) => x.reference === i.reference || x.id === i.id),
        )
      : invoices.filter((i) => ids.has(i.id));
    candidates.set(
      r.id,
      pool.filter(
        (i) =>
          !/WINDCAVE|PAYMENT EXPRESS|\bDPS\b|STRIPE|PAYPAL|EFTPOS|SETTLEMENT|PAYOUT/i.test(
            text,
          ) &&
          r.amount > 0 &&
          r.amount <= i.total &&
          !!r.date &&
          !!i.date &&
          r.date >= i.date,
      ),
    );
  }
  const possible = (r: FinanceReceipt, invoiceId: string, gross: number) =>
    input.payments.filter(
      (p) =>
        p.invoiceId === invoiceId && p.amount === gross && near(p.date, r.date),
    );
  const counts = new Map<string, number>();
  for (const r of input.receipts) {
    if (manual.has(r.id)) continue;
    for (const i of candidates.get(r.id) || [])
      for (const p of possible(r, i.id, r.amount))
        counts.set(p.id, (counts.get(p.id) || 0) + 1);
  }
  const usedPayments = new Set<string>(),
    received = new Map<string, number>(),
    local = new Map<string, number>();
  const out: ReceiptMatch[] = [];
  // Owner decisions first; validation at save time enforces receipt/amount coverage.
  for (const r of input.receipts.filter((r) => manual.has(r.id))) {
    const m = manual.get(r.id)!;
    const allocations = m.allocations.map((a) => {
      const ps = possible(r, a.invoiceId, a.gross);
      const p = a.paymentId
        ? input.payments.find(
            (p) =>
              p.id === a.paymentId &&
              p.invoiceId === a.invoiceId &&
              p.amount === a.gross,
          )
        : ps.length === 1 && (counts.get(ps[0].id) || 0) === 0
          ? ps[0]
          : undefined;
      return { ...a, paymentId: p?.id || null };
    });
    let invalid = allocations.some(
      (a) => a.paymentId && usedPayments.has(a.paymentId),
    );
    if (
      !m.nonCustomer &&
      allocations.reduce((n, a) => n + a.gross - a.fee, 0) !== r.amount
    )
      invalid = true;
    if (invalid) {
      out.push({
        receipt: r,
        allocations: [],
        method: "Review",
        reason: "Saved allocation conflicts with current payment evidence.",
        nonCustomer: false,
      });
      continue;
    }
    for (const a of allocations) {
      if (a.paymentId) usedPayments.add(a.paymentId);
      received.set(a.invoiceId, (received.get(a.invoiceId) || 0) + a.gross);
      if (a.gross > 0 && !a.paymentId)
        local.set(a.invoiceId, (local.get(a.invoiceId) || 0) + a.gross);
    }
    out.push({
      receipt: r,
      allocations,
      method: "Owner confirmed",
      reason: m.reason,
      nonCustomer: m.nonCustomer,
    });
  }
  for (const r of input.receipts
    .filter((r) => !manual.has(r.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    const candidatesForReceipt = candidates.get(r.id) || [];
    let allocations: Allocation[] = [];
    let reason =
      r.amount < 0
        ? "Outgoing transaction; allocate only if this is a customer refund."
        : "No unique invoice reference, amount and date match.";
    if (candidatesForReceipt.length === 1) {
      const i = candidatesForReceipt[0],
        ps = possible(r, i.id, r.amount);
      const completePayments =
        input.payments
          .filter((p) => p.invoiceId === i.id)
          .reduce((n, p) => n + p.amount, 0) === i.paid;
      const p =
        ps.length === 1 &&
        counts.get(ps[0].id) === 1 &&
        !usedPayments.has(ps[0].id)
          ? ps[0]
          : undefined;
      const localOK =
        ps.length === 0 &&
        i.paid === 0 &&
        completePayments &&
        input.receipts.filter(
          (other) =>
            !manual.has(other.id) &&
            candidates.get(other.id)?.length === 1 &&
            candidates.get(other.id)?.[0].id === i.id &&
            other.amount === r.amount,
        ).length === 1 &&
        input.receipts
          .filter(
            (other) =>
              !manual.has(other.id) &&
              candidates.get(other.id)?.length === 1 &&
              candidates.get(other.id)?.[0].id === i.id,
          )
          .reduce((n, other) => n + other.amount, 0) <= i.due &&
        r.amount <= i.due - (local.get(i.id) || 0);
      const capacity = r.amount <= i.total - (received.get(i.id) || 0);
      if (capacity && (p || localOK)) {
        allocations = [
          {
            invoiceId: i.id,
            gross: r.amount,
            fee: 0,
            paymentId: p?.id || null,
          },
        ];
        if (p) usedPayments.add(p.id);
        else local.set(i.id, (local.get(i.id) || 0) + r.amount);
        received.set(i.id, (received.get(i.id) || 0) + r.amount);
        reason = p
          ? "Unique reference, amount and payment date; linked to Xero payment."
          : "Unique reference and amount; no matching Xero payment recorded.";
      } else
        reason =
          "Invoice reference found, but settlement or Xero payment evidence needs review.";
    } else if (candidatesForReceipt.length > 1)
      reason = "Reference could belong to more than one invoice.";
    out.push({
      receipt: r,
      allocations,
      method: allocations.length ? "Automatic" : "Review",
      reason,
      nonCustomer: false,
    });
  }
  return out;
}
