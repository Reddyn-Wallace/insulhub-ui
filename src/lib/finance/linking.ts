import type { FinanceJob, InvoiceLink, ReviewDecision } from "./model";
const norm = (s: string) => s.trim().toUpperCase();
const words = (s: string) =>
  norm(s)
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
function corroborates(
  i: { contact?: string; description?: string },
  j: FinanceJob,
) {
  const contact = words(i.contact || ""),
    address = words(j.name);
  return (
    (!!contact && contact === words(j.contact || "")) ||
    (/^\d+[A-Z]?\s/.test(address) &&
      address.split(" ").length >= 3 &&
      ` ${words(i.description || "")} `.includes(` ${address} `))
  );
}
// Only the complete label formats verified in the owner's Xero records.
export function quoteReference(reference: string) {
  const value = norm(reference);
  return (
    /^(?:(?:QUOTE|DEPOSIT)(?:\s*#\s*|\s+)|#)?([A-Z]+\d+(?:[-/]\d+)?)(?:\s+\(DEPOSIT\))?\)?$/.exec(
      value,
    )?.[1] || value
  );
}
export function linkInvoices(
  invoices: Array<{
    id: string;
    number: string;
    reference: string;
    contact?: string;
    description?: string;
  }>,
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
    // A shared quote needs an independent full customer or site-address match.
    // Revision suffixes only fall back when no exact quote exists and corroboration is unique.
    const baseQuote = quoteReference(i.reference).replace(/[-/]\d+$/, "");
    const revisionRefs =
      refs.length === 0 && baseQuote !== quoteReference(i.reference)
        ? jobs.filter((j) => norm(j.quote) === baseQuote)
        : [];
    const corroborated = (refs.length > 1 ? refs : revisionRefs).filter((j) =>
      corroborates(i, j),
    );
    if (direct.length === 0 && corroborated.length === 1) {
      result.set(i.id, {
        jobId: corroborated[0].id,
        method: refs.length
          ? "quote and customer/site evidence"
          : "quote revision and customer/site evidence",
        candidates: (refs.length ? refs : revisionRefs).map((j) => j.id),
      });
      continue;
    }
    // An exact invoice relation resolves duplicate quote labels only when it agrees
    // with the reference (or no quote reference is available).
    const verifiedDirect =
      direct.length === 1 &&
      (refs.length === 0 || refs.some((j) => j.id === direct[0].id));
    const revisionConflict =
      direct.length > 0 &&
      revisionRefs.length > 0 &&
      !revisionRefs.some((j) => direct.some((d) => d.id === j.id));
    const candidates =
      verifiedDirect && !revisionConflict
        ? [direct[0].id]
        : [
            ...new Set(
              [
                ...direct,
                ...refs,
                ...(revisionConflict ? revisionRefs : []),
              ].map((j) => j.id),
            ),
          ];
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
