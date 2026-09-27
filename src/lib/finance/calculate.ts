import { isInstalled, type FinanceInputs, type ReviewDecision } from "./model";
import { linkInvoices } from "./linking";
import { matchReceipts } from "./matching";
export function calculateFinance(
  input: FinanceInputs,
  decisions: ReviewDecision[],
) {
  const links = linkInvoices(input.invoices, input.jobs, decisions),
    matches = matchReceipts(input, decisions);
  const rows = input.invoices.map((i) => {
    const link = links.get(i.id)!,
      job = input.jobs.find((j) => j.id === link.jobId) || null;
    const allocations = matches.flatMap((m) =>
      m.allocations
        .filter((a) => a.invoiceId === i.id)
        .map((a) => ({ ...a, receiptId: m.receipt.id, method: m.method })),
    );
    const opening = decisions.reduce(
      (n, d) =>
        n +
        (d.value?.kind === "opening" && d.value.invoiceId === i.id
          ? d.value.amount
          : 0),
      0,
    );
    const released = decisions.reduce(
      (n, d) =>
        n +
        (d.value?.kind === "release" && d.value.invoiceId === i.id
          ? d.value.amount
          : 0),
      0,
    );
    const gross = allocations.reduce((n, a) => n + a.gross, 0) + opening;
    const settled = Math.max(0, gross - released);
    const reflected = allocations.reduce(
      (n, a) => n + (a.paymentId && a.gross > 0 ? a.gross : 0),
      0,
    );
    const paymentCoverage =
      input.payments
        .filter((p) => p.invoiceId === i.id)
        .reduce((n, p) => n + p.amount, 0) === i.paid;
    const localCandidate = Math.max(0, allocations.reduce(
      (n, a) => n + (!a.paymentId ? a.gross : 0),
      0,
    ));
    const local =
      paymentCoverage && (i.paid === 0 || reflected === i.paid)
        ? Math.min(i.due, localCandidate)
        : 0;
    const unfinished = !!job && !isInstalled(job.status),
      supported = i.currency === "NZD";
    const unconfirmed = Math.max(0, i.paid - reflected - opening);
    const issues = [
      !job ? link.method : "",
      !supported ? "Non-NZD invoice excluded" : "",
      job && !job.status
        ? "Installation status missing; any advance retained"
        : "",
      job?.archived && unfinished
        ? "Archived unfinished job; refund/release review required"
        : "",
      !i.date ? "Invoice date missing" : "",
      gross < released ? "Refund/release exceeds evidenced receipts" : "",
      !paymentCoverage && i.paid > 0
        ? "Xero payment history does not explain the paid balance"
        : "",
      localCandidate > 0 && i.paid > reflected
        ? "Local debt adjustment held: existing Xero payments need settlement evidence"
        : "",
      localCandidate > i.due ? "Possible duplicate receipt or overpayment" : "",
    ].filter(Boolean);
    return {
      ...i,
      job,
      link,
      allocations,
      opening,
      released,
      settled,
      localAdjustment: supported && job && isInstalled(job.status) ? local : 0,
      reserved: supported && unfinished ? settled : 0,
      owed: supported && job && isInstalled(job.status) ? i.due - local : 0,
      unconfirmed: supported ? unconfirmed : 0,
      issues,
    };
  });
  const sum = (fn: (r: (typeof rows)[number]) => number) =>
    rows.reduce((n, r) => n + fn(r), 0);
  const reserved = sum((r) => r.reserved),
    owed = sum((r) => r.owed),
    localAdjustment = sum((r) => r.localAdjustment);
  const unmatchedReceipts = matches.reduce(
    (n, m) =>
      n +
      (!m.nonCustomer && !m.allocations.length && m.receipt.amount > 0
        ? m.receipt.amount
        : 0),
    0,
  );
  const unconfirmedUnfinished = sum((r) =>
      r.job && !isInstalled(r.job.status) ? r.unconfirmed : 0,
    ),
    unconfirmedInstalled = sum((r) =>
      r.job && isInstalled(r.job.status) ? r.unconfirmed : 0,
    ),
    unconfirmedUnknown = sum((r) => (!r.job ? r.unconfirmed : 0));
  const unlinked = rows.filter((r) => !r.job).length;
  const provisional =
    input.bank.stale ||
    unmatchedReceipts > 0 ||
    unlinked > 0 ||
    unconfirmedUnfinished > 0 ||
    rows.some((r) => r.issues.length > 0);
  return {
    checkedAt: input.checkedAt,
    bank: input.bank,
    historyStart: input.historyStart,
    historyEnd: input.historyEnd,
    warnings: input.warnings,
    jobCount: input.jobs.length,
    invoiceCount: rows.length,
    paymentCount: input.payments.length,
    reserved,
    owed,
    localAdjustment,
    xeroOwed: owed + localAdjustment,
    cashAfterDeposits: input.bank.currentCents - reserved,
    unmatchedReceipts,
    unconfirmedUnfinished,
    unconfirmedInstalled,
    unconfirmedUnknown,
    unlinked,
    provisional,
    rows,
    matches,
  };
}
export type FinanceDashboard = ReturnType<typeof calculateFinance>;
