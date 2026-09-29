import {
  isJobInstalled,
  type FinanceInputs,
  type ReviewDecision,
} from "./model";
import { linkInvoices } from "./linking";
import {
  recentReceiptAdjustments,
  type RecentReceiptEvidence,
} from "./recent-receipts";
import { matchReceipts } from "./matching";
export function calculateFinance(
  input: FinanceInputs,
  decisions: ReviewDecision[],
) {
  const links = linkInvoices(input.invoices, input.jobs, decisions),
    matches = matchReceipts(input, decisions);
  const uncertainRecent = new Set<string>();
  const recentEvidence: RecentReceiptEvidence[] = [];
  const recentAdjustments = recentReceiptAdjustments(
    input,
    decisions,
    uncertainRecent,
    recentEvidence,
  );
  // Carry the same recent-receipt evidence into drill-downs and bank review.
  for (const match of matches) {
    if (match.allocations.length || match.nonCustomer) continue;
    const proof = recentEvidence.filter(
      (e) =>
        e.receiptId === match.receipt.id &&
        (recentAdjustments.get(e.invoiceId) || 0) > 0,
    );
    if (proof.length === 1) {
      match.allocations = [
        {
          invoiceId: proof[0].invoiceId,
          gross: proof[0].amount,
          fee: 0,
          paymentId: null,
        },
      ];
      match.method = "Recent receipt evidence";
      match.reason = proof[0].method;
    }
  }
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
    const settled = Math.max(0, gross);
    const reflected = allocations.reduce(
      (n, a) => n + (a.paymentId && a.gross > 0 ? a.gross : 0),
      0,
    );
    // Recent proven receipts may reduce installed-job debt while Xero catches up.
    const localCandidate = Math.max(
      0,
      allocations.reduce((n, a) => n + (!a.paymentId ? a.gross : 0), 0),
    );
    const local = recentAdjustments.get(i.id) || 0;
    const unfinished = !!job && !isJobInstalled(job),
      supported = i.currency === "NZD";
    const unconfirmed =
      input.bankChecked === false
        ? 0
        : Math.max(0, i.paid - reflected - opening);
    const issues = [
      !job ? link.method : "",
      uncertainRecent.has(i.id)
        ? "Recent bank receipt may overlap Xero payments; uncertain amount remains owed."
        : "",
      !supported ? "Non-NZD invoice excluded" : "",
      job && !job.status
        ? "Installation status missing; any advance retained"
        : "",
      job?.archived && unfinished
        ? "Archived unfinished job; refund/release review required"
        : "",
      !i.date ? "Invoice date missing" : "",
      i.paid < released ? "Release exceeds Xero paid amount" : "",
      input.bankChecked !== false && localCandidate > 0
        ? "Bank receipt not linked to a Xero payment; reconcile in Xero"
        : "",
      job?.completionConflict
        ? "CRM completion signals conflict; review installation status"
        : "",
      job?.detailVerified === false
        ? "Detailed CRM record could not be verified"
        : "",
    ].filter(Boolean);
    return {
      ...i,
      job,
      link,
      allocations,
      opening,
      released,
      settled,
      recentEvidence: recentEvidence.filter((e) => e.invoiceId === i.id),
      localAdjustment: supported && job && isJobInstalled(job) ? local : 0,
      reserved: supported && unfinished ? i.paid : 0,
      owed: supported && job && isJobInstalled(job) ? i.due - local : 0,
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
      r.job && !isJobInstalled(r.job) ? r.unconfirmed : 0,
    ),
    unconfirmedInstalled = sum((r) =>
      r.job && isJobInstalled(r.job) ? r.unconfirmed : 0,
    ),
    unconfirmedUnknown = sum((r) => (!r.job ? r.unconfirmed : 0));
  const unlinked = rows.filter((r) => !r.job).length;
  const provisional =
    input.bank.stale ||
    unmatchedReceipts > 0 ||
    unlinked > 0 ||
    rows.some((r) => r.issues.length > 0);
  return {
    bankChecked: input.bankChecked !== false,
    recentBankChecked: !!input.recentBankChecked,
    uncertainRecentCount: uncertainRecent.size,
    unclassifiedPaid: sum((r) => (!r.job && r.currency === "NZD" ? r.paid : 0)),
    unclassifiedOwed: sum((r) => (!r.job && r.currency === "NZD" ? r.due : 0)),
    totalXeroOwed: sum((r) => (r.currency === "NZD" ? r.due : 0)),
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
