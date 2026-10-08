import { uninvoicedWork } from "./uninvoiced";
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
  const uninvoiced = uninvoicedWork(input, decisions);
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
  // Pending records have no stable IDs: rebuild and conservatively deduplicate every snapshot.
  const pendingReceipts =
    input.pendingBank && "receipts" in input.pendingBank
      ? input.pendingBank.receipts
      : [];
  const uniquePending = [
    ...new Map(
      pendingReceipts.map((p) => [
        JSON.stringify([p.date, p.amount, p.description]),
        p,
      ]),
    ).values(),
  ];
  // No stable pending identity: an equal-value reviewed/stale settled receipt can be the same entry.
  // Keep that pending amount uncertain rather than overriding an owner decision.
  const reviewedIds = new Set(
    decisions
      .filter((d) => d.value?.kind === "receipt")
      .map((d) => (d.value?.kind === "receipt" ? d.value.receiptId : "")),
  );
  const restrictedAmounts = new Set(
    input.receipts
      .filter(
        (r) =>
          reviewedIds.has(r.id) || input.excludedReceiptIds?.includes(r.id),
      )
      .map((r) => Math.abs(r.amount)),
  );
  const pendingEvidence: RecentReceiptEvidence[] = [];
  const pendingAdjustments = recentReceiptAdjustments(
    {
      ...input,
      receipts: [
        ...uniquePending
          .filter((p) => !restrictedAmounts.has(Math.abs(p.amount)))
          .map((p, n) => ({ ...p, id: `pending:${n}`, reference: "" })),
        ...input.receipts.filter((r) => r.amount < 0),
      ],
      excludedReceiptIds: [],
    },
    decisions,
    new Set(),
    pendingEvidence,
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
    const classification = decisions
      .map((d) => d.value)
      .find((v) => v?.kind === "classification" && v.invoiceId === i.id);
    const excluded =
      classification?.kind === "classification" ? classification : null;
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
    // Use the larger evidence total, never sum pending and settled versions of the same invoice payment.
    const awaiting =
      !excluded && i.currency === "NZD" && job && isJobInstalled(job)
        ? Math.max(0, (pendingAdjustments.get(i.id) || 0) - local)
        : 0;
    const unfinished = !!job && !isJobInstalled(job),
      supported = i.currency === "NZD" && !excluded;
    const unconfirmed =
      input.bankChecked === false
        ? 0
        : Math.max(0, i.paid - reflected - opening);
    const issues = [
      !job && !excluded ? link.method : "",
      uncertainRecent.has(i.id)
        ? "Recent bank receipt may overlap Xero payments; uncertain amount remains owed."
        : "",
      i.currency !== "NZD" ? "Non-NZD invoice excluded" : "",
      !excluded && job && !job.status
        ? "Installation status missing; any advance retained"
        : "",
      !excluded && job?.archived && unfinished
        ? "Archived unfinished job; refund/release review required"
        : "",
      !i.date ? "Invoice date missing" : "",
      i.paid < released ? "Release exceeds Xero paid amount" : "",
      input.bankChecked !== false && localCandidate > 0
        ? "Bank receipt not linked to a Xero payment; reconcile in Xero"
        : "",
      !excluded && job?.completionConflict
        ? "CRM completion signals conflict; review installation status"
        : "",
      !excluded && job?.detailVerified === false
        ? "Detailed CRM record could not be verified"
        : "",
    ].filter(Boolean);
    return {
      ...i,
      classification: excluded,
      job,
      link,
      allocations,
      opening,
      released,
      settled,
      recentEvidence: recentEvidence.filter((e) => e.invoiceId === i.id),
      pendingSettlement: awaiting,
      pendingEvidence: pendingEvidence.filter((e) => e.invoiceId === i.id),
      localAdjustment: supported && job && isJobInstalled(job) ? local : 0,
      reserved: supported && unfinished ? i.paid : 0,
      owed:
        supported && job && isJobInstalled(job) ? i.due - local - awaiting : 0,
      unconfirmed: supported ? unconfirmed : 0,
      issues,
    };
  });
  const sum = (fn: (r: (typeof rows)[number]) => number) =>
    rows.reduce((n, r) => n + fn(r), 0);
  const reserved = sum((r) => r.reserved),
    owed = sum((r) => r.owed),
    localAdjustment = sum((r) => r.localAdjustment),
    pendingSettlement = sum((r) => r.pendingSettlement);
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
  const unlinked = rows.filter((r) => !r.job && !r.classification).length;
  const provisional =
    input.bank.stale ||
    unmatchedReceipts > 0 ||
    unlinked > 0 ||
    rows.some((r) => r.issues.length > 0);
  return {
    uninvoiced,
    bankChecked: input.bankChecked !== false,
    recentBankChecked: !!input.recentBankChecked,
    uncertainRecentCount: uncertainRecent.size,
    unclassifiedPaid: sum((r) =>
      !r.job && !r.classification && r.currency === "NZD" ? r.paid : 0,
    ),
    unclassifiedOwed: sum((r) =>
      !r.job && !r.classification && r.currency === "NZD" ? r.due : 0,
    ),
    totalXeroOwed: sum((r) => (r.currency === "NZD" ? r.due : 0)),
    pendingSettlement,
    pendingBank: input.pendingBank ?? {
      error: "Pending bank payments have not been checked.",
    },
    checkedAt: input.checkedAt,
    bank: input.bank,
    bankLessCreditCard:
      input.creditCard && !("error" in input.creditCard)
        ? input.bank.currentCents + input.creditCard.currentCents
        : null,
    creditCard: input.creditCard ?? {
      error: "Credit card balance unavailable. Refresh sources.",
    },
    historyStart: input.historyStart,
    historyEnd: input.historyEnd,
    warnings: input.warnings,
    jobCount: input.jobs.length,
    invoiceCount: rows.length,
    paymentCount: input.payments.length,
    reserved,
    owed,
    localAdjustment,
    xeroOwed: owed + localAdjustment + pendingSettlement,
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
