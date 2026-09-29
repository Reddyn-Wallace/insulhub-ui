import type { FinanceInputs, ReviewDecision } from "./model";
import { quoteReference } from "./linking";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (text: string, ref: string) =>
  ref.length >= 3 &&
  new RegExp("(^|[^a-z0-9])" + escape(ref) + "($|[^a-z0-9])", "i").test(text);
// Dates do not prove payment identity: Xero payments can be backdated/grouped.
// Use a conservative lower bound and expose uncertain overlap instead of guessing.
export function recentReceiptAdjustments(
  input: FinanceInputs,
  decisions: ReviewDecision[],
  uncertain = new Set<string>(),
) {
  const result = new Map<string, number>();
  if (!input.recentBankChecked) return result;
  const end = Date.parse(input.checkedAt),
    start = end - 7 * 86400000;
  const received = new Map<string, number>(),
    blocked = new Set<string>();
  const manual = new Map(
    decisions.flatMap((d) =>
      d.value?.kind === "receipt"
        ? [[d.value.receiptId, d.value] as const]
        : [],
    ),
  );
  const seen = new Set<string>();
  for (const r of input.receipts) {
    const date = Date.parse(r.date);
    if (
      !Number.isFinite(date) ||
      date < start ||
      date > end ||
      input.excludedReceiptIds?.includes(r.id)
    )
      continue;
    if (seen.has(r.id)) return new Map<string, number>();
    seen.add(r.id);
    const decision = manual.get(r.id);
    if (decision?.nonCustomer) continue;
    let allocations: Array<{ invoiceId: string; gross: number }> = [];
    if (decision) {
      allocations = decision.allocations;
    } else {
      const text = `${r.description} ${r.reference}`.replace(
        /\bINV\s+(\d+)\b/gi,
        "INV-$1",
      );
      if (
        /WINDCAVE|PAYMENT EXPRESS|\bDPS\b|STRIPE|PAYPAL|EFTPOS|SETTLEMENT|PAYOUT/i.test(
          text,
        )
      )
        continue;
      const invoiceTokens = new Set(
        text.match(/\bINV-\d+\b/gi)?.map((v) => v.toUpperCase()) || [],
      );
      if (invoiceTokens.size > 1) continue;
      const candidates = input.invoices.filter((i) => has(text, i.number));
      if (candidates.length !== 1) continue;
      const i = candidates[0];
      if (
        input.invoices.some(
          (other) =>
            has(text, quoteReference(other.reference)) &&
            quoteReference(other.reference) !== quoteReference(i.reference),
        )
      )
        continue;
      if (
        !Number.isFinite(Date.parse(i.date)) ||
        date < Date.parse(i.date) ||
        Math.abs(r.amount) > i.total
      )
        continue;
      allocations = [{ invoiceId: i.id, gross: r.amount }];
    }
    for (const a of allocations) {
      if (a.gross < 0) blocked.add(a.invoiceId);
      else if (a.gross > 0) {
        received.set(a.invoiceId, (received.get(a.invoiceId) || 0) + a.gross);
      }
    }
  }
  for (const i of input.invoices) {
    if (i.currency !== "NZD" || blocked.has(i.id)) continue;
    const amount = received.get(i.id) || 0;
    if (amount > i.total) continue;
    const overlap = i.paid;
    const adjustment = Math.max(0, Math.min(i.due, amount - overlap));
    if (amount > adjustment && i.due > adjustment) uncertain.add(i.id);
    if (adjustment > 0) result.set(i.id, adjustment);
  }
  return result;
}
