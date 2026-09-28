import type { FinanceJob, InvoiceLink, ReviewDecision } from "./model";
const norm = (s: string) => s.trim().toUpperCase();
// Only the complete label formats verified in the owner's Xero records.
export function quoteReference(reference: string) {
  const value = norm(reference);
  return (
    /^(?:(?:QUOTE|DEPOSIT)(?:\s*#\s*|\s+)|#)?([A-Z]+\d+(?:-\d+)?)(?:\s+\(DEPOSIT\))?$/.exec(
      value,
    )?.[1] || value
  );
}
export function linkInvoices(
  invoices: Array<{ id: string; number: string; reference: string }>,
  jobs: FinanceJob[],
  decisions: ReviewDecision[],
) {
  const result = new Map<string, InvoiceLink>();
  for (const i of invoices) {
    const manual = decisions.find(
      (d) => d.value?.kind === "link" && d.value.invoiceId === i.id,
    )?.value;
    if (manual?.kind === "link" && jobs.some((j) => j.id === manual.jobId)) {
      result.set(i.id, {
        jobId: manual.jobId,
        method: "owner confirmed",
        candidates: [manual.jobId],
      });
      continue;
    }
    const direct = jobs.filter((j) =>
      j.invoiceNumbers.some((n) => norm(n) === norm(i.number)),
    );
    const refs = jobs.filter(
      (j) =>
        norm(i.reference) === norm(j.id) ||
        (!!j.quote && quoteReference(i.reference) === norm(j.quote)),
    );
    // An exact invoice relation resolves duplicate quote labels only when it agrees
    // with the reference (or no quote reference is available).
    const verifiedDirect =
      direct.length === 1 &&
      (refs.length === 0 || refs.some((j) => j.id === direct[0].id));
    const candidates = verifiedDirect
      ? [direct[0].id]
      : [...new Set([...direct, ...refs].map((j) => j.id))];
    result.set(i.id, {
      jobId: candidates.length === 1 ? candidates[0] : null,
      method:
        candidates.length > 1
          ? "Conflicting job references"
          : candidates.length === 0
            ? "No verified job link"
            : direct.length
              ? "CRM invoice number"
              : refs[0].id === i.reference
                ? "CRM job reference"
                : "quote reference",
      candidates,
    });
  }
  return result;
}
