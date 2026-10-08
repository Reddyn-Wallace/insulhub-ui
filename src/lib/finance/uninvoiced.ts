import {
  isInstalled,
  type FinanceInputs,
  type FinanceJob,
  type ReviewDecision,
} from "./model";
import { linkInvoices } from "./linking";
const normalName = (s: string) =>
  s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const nzDate = (s: string) => {
  const date = new Date(s);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Pacific/Auckland",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date)
    : "";
};
export function installAge(job: FinanceJob, checkedAt: string) {
  const installed = nzDate(job.installDate || ""),
    today = nzDate(checkedAt);
  return installed && today
    ? Math.round((Date.parse(today) - Date.parse(installed)) / 86400000)
    : null;
}
export function recentInstalledJob(job: FinanceJob, checkedAt: string) {
  const age = installAge(job, checkedAt);
  return (
    !job.archived &&
    isInstalled(job.status) &&
    age !== null &&
    age >= 0 &&
    age < 30
  );
}
export type UninvoicedRow = {
  jobId: string;
  contact: string;
  name: string;
  quote: string;
  installDate: string;
  age: number | null;
  over30: boolean;
  agreed: number | null;
  invoiced: number;
  amount: number | null;
  issue: string;
  invoices: string[];
};
export function uninvoicedWork(
  input: FinanceInputs,
  decisions: ReviewDecision[],
) {
  const tracked = new Set(input.trackedUninvoicedIds || []);
  const links = linkInvoices(input.invoices, input.jobs, decisions);
  const rows: UninvoicedRow[] = [];
  for (const job of input.jobs) {
    if (!tracked.has(job.id) && !recentInstalledJob(job, input.checkedAt))
      continue;
    if (job.finalInvoiceNumber || job.archived || !isInstalled(job.status))
      continue;
    const age = installAge(job, input.checkedAt);
    const invoices = input.invoices.filter(
      (i) => links.get(i.id)?.jobId === job.id,
    );
    const expected = [
      job.depositInvoiceNumber,
      ...(job.installmentInvoiceNumbers || []),
    ].filter(Boolean);
    const agreed = job.agreedCents ?? job.quoteCents ?? null;
    const invoiced = invoices.reduce((sum, i) => sum + i.total, 0);
    // A verified full value already invoiced leaves nothing to estimate, even
    // when the CRM still points at an obsolete deposit invoice.
    if (
      job.finalInvoiceChecked &&
      agreed !== null &&
      Number.isSafeInteger(agreed) &&
      agreed > 0 &&
      (job.status !== "INSTALLED_WITH_VARIATIONS_FROM_QUOTE" ||
        job.agreedCents != null) &&
      invoices.length > 0 &&
      invoices.every((i) => i.currency === "NZD" && i.credited === 0) &&
      invoiced >= agreed
    )
      continue;
    let issue = "";
    if (!job.finalInvoiceChecked)
      issue = "Final invoice status could not be verified in the CRM.";
    else if (age === null || age < 0)
      issue = "Installation date needs checking.";
    else if (agreed === null || !Number.isSafeInteger(agreed) || agreed <= 0)
      issue = "Agreed job value needs confirmation.";
    else if (
      job.status === "INSTALLED_WITH_VARIATIONS_FROM_QUOTE" &&
      job.agreedCents == null
    )
      issue = "Final value including variations needs confirmation.";
    else if (
      invoices.some((i) =>
        decisions.some(
          (d) =>
            d.value?.kind === "classification" && d.value.invoiceId === i.id,
        ),
      )
    )
      issue =
        "An owner-classified invoice needs checking before estimating more work.";
    else if (invoices.some((i) => i.currency !== "NZD" || i.credited > 0))
      issue = "Currency or credits need checking.";
    else if (expected.some((n) => !invoices.some((i) => i.number === n)))
      issue =
        "A CRM deposit or instalment invoice is missing from the matched Xero records.";
    else if (invoices.some((i) => !expected.includes(i.number)))
      issue =
        "A Xero invoice may already be the final invoice. Confirm it in the CRM.";
    else if (
      input.invoices.some(
        (i) =>
          !links.get(i.id)?.jobId &&
          (links.get(i.id)?.candidates.includes(job.id) ||
            (!!normalName(job.contact || "") &&
              normalName(i.contact) === normalName(job.contact || ""))),
      )
    )
      issue = "An invoice still needs its job match confirmed.";
    const amount = issue ? null : Math.max(0, agreed! - invoiced);
    if (amount === 0) continue;
    rows.push({
      jobId: job.id,
      contact: job.contact || "",
      name: job.name,
      quote: job.quote,
      installDate: job.installDate || "",
      age,
      over30: age !== null && age >= 30,
      agreed,
      invoiced,
      amount,
      issue,
      invoices: invoices.map((i) => i.number),
    });
  }
  for (const id of tracked)
    if (!input.jobs.some((j) => j.id === id))
      rows.push({
        jobId: id,
        contact: "",
        name: "Previously captured job",
        quote: "",
        installDate: "",
        age: null,
        over30: false,
        agreed: null,
        invoiced: 0,
        amount: null,
        issue: "Job is no longer available in the CRM index. Check its status.",
        invoices: [],
      });
  rows.sort((a, b) => (b.age ?? -1) - (a.age ?? -1));
  return {
    rows,
    total: rows.reduce((sum, r) => sum + (r.amount ?? 0), 0),
    needsConfirmation: rows.filter((r) => r.amount === null).length,
    over30: rows.filter((r) => r.over30).length,
  };
}
