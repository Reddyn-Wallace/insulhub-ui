import "server-only";
import { FinanceError, safeFetch } from "./errors";
import { getBankSnapshot, getBankTransactions } from "./akahu";
import { withXeroAccess } from "./xero-oauth";
import {
  cents,
  type FinanceInvoice,
  type FinanceJob,
  type FinancePayment,
  type FinanceInputs,
} from "./model";
type RecordValue = {
  Type?: string;
  InvoiceID?: string;
  InvoiceNumber?: string;
  Reference?: string;
  Contact?: { Name?: string };
  Date?: string;
  DateString?: string;
  DueDate?: string;
  DueDateString?: string;
  Status?: string;
  CurrencyCode?: string;
  Total?: number;
  AmountPaid?: number;
  AmountDue?: number | null;
  AmountCredited?: number;
  LineItems?: Array<{ Description?: string }>;
  PaymentID?: string;
  PaymentType?: string;
  Invoice?: { InvoiceID?: string };
  Amount?: number;
};
export function providerDate(v: unknown): string {
  if (typeof v !== "string") return "";
  const m = /^\/Date\((\d+)/.exec(v);
  const d = m ? new Date(Number(m[1])) : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : "";
}
export function normaliseInvoice(v: RecordValue): FinanceInvoice | null {
  if (v.Type && v.Type !== "ACCREC") return null;
  if (["DRAFT", "DELETED", "VOIDED", "SUBMITTED"].includes(v.Status || ""))
    return null;
  if (
    typeof v.Status !== "string" ||
    typeof v.InvoiceID !== "string" ||
    typeof v.InvoiceNumber !== "string" ||
    !["AUTHORISED", "PAID"].includes(v.Status || "")
  )
    throw new FinanceError(
      502,
      "Xero invoice identifiers or status were incomplete.",
    );
  const total = cents(v.Total),
    paid = cents(v.AmountPaid),
    due = cents(v.AmountDue),
    credited = cents(v.AmountCredited ?? 0);
  if ([total, paid, due, credited].some((x) => x < 0))
    throw new FinanceError(
      502,
      "Xero returned a negative invoice balance requiring review.",
    );
  return {
    id: v.InvoiceID,
    number: v.InvoiceNumber,
    reference: String(v.Reference || ""),
    contact: String(v.Contact?.Name || ""),
    date: providerDate(v.DateString || v.Date),
    dueDate: providerDate(v.DueDateString || v.DueDate),
    status: v.Status,
    currency: String(v.CurrencyCode || ""),
    total,
    paid,
    due,
    credited,
    description: (v.LineItems || [])
      .map((l: { Description?: string }) => String(l.Description || ""))
      .join(" · "),
  };
}
export function normalisePayment(v: RecordValue): FinancePayment | null {
  if (v.PaymentType !== "ACCRECPAYMENT" || v.Status !== "AUTHORISED")
    return null;
  if (
    typeof v.PaymentID !== "string" ||
    typeof v.Invoice?.InvoiceID !== "string"
  )
    throw new FinanceError(502, "Xero payment identifiers were incomplete.");
  const amount = cents(v.Amount);
  if (amount < 0)
    throw new FinanceError(502, "Unexpected customer payment amount.");
  return {
    id: v.PaymentID,
    invoiceId: v.Invoice.InvoiceID,
    amount,
    date: providerDate(v.DateString || v.Date),
    reference: String(v.Reference || ""),
  };
}
export async function readCrmJobs(token: string): Promise<FinanceJob[]> {
  const jobs: FinanceJob[] = [],
    seen = new Set<string>();
  let total: number | undefined;
  for (let page = 0; page < 100; page++) {
    const r = await safeFetch("https://api.insulhub.nz/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", "x-access-token": token },
      body: JSON.stringify({
        query:
          "query FinanceJobIndex($skip:Int,$limit:Int){jobs(skip:$skip,limit:$limit){total results{_id jobNumber archivedAt quote{quoteNumber} installation{installStatus} client{contactDetails{name streetAddress}}}}}",
        variables: { skip: page * 500, limit: 500 },
      }),
    });
    if (!r.ok) throw new FinanceError(502, "CRM jobs could not be read.");
    const d = await r.json(),
      list = d.data?.jobs;
    if (
      d.errors?.length ||
      !Number.isInteger(list?.total) ||
      list.total < 0 ||
      !Array.isArray(list.results)
    )
      throw new FinanceError(502, "CRM job index is incomplete.");
    if (total !== undefined && total !== list.total)
      throw new FinanceError(
        502,
        "CRM jobs changed during loading. Refresh again.",
      );
    total = list.total;
    for (const j of list.results) {
      if (typeof j._id !== "string" || seen.has(j._id))
        throw new FinanceError(502, "CRM job pagination overlapped.");
      seen.add(j._id);
      jobs.push({
        id: j._id,
        number: String(j.jobNumber ?? ""),
        quote: String(j.quote?.quoteNumber || ""),
        status: String(j.installation?.installStatus || ""),
        archived: !!j.archivedAt,
        name: String(
          j.client?.contactDetails?.streetAddress ||
            j.client?.contactDetails?.name ||
            "Job " + j.jobNumber,
        ),
        invoiceNumbers: [],
      });
    }
    if (jobs.length === total) return jobs;
    if (list.results.length < 500 || jobs.length > list.total)
      throw new FinanceError(502, "CRM job pagination is incomplete.");
  }
  throw new FinanceError(502, "CRM job pagination exceeded the limit.");
}
export async function readXeroData(ownerId: string) {
  return withXeroAccess(ownerId, async (token, tenant) => {
    const headers = {
      Authorization: "Bearer " + token,
      "xero-tenant-id": tenant,
      Accept: "application/json",
    };
    const invoices: FinanceInvoice[] = [],
      payments: FinancePayment[] = [];
    for (const endpoint of ["Invoices", "Payments"]) {
      const seen = new Set<string>();
      let done = false;
      for (let page = 1; page <= 100; page++) {
        const query = new URLSearchParams({
          page: String(page),
          pageSize: "100",
        });
        if (endpoint === "Invoices") query.set("where", 'Type=="ACCREC"');
        const r = await safeFetch(
          "https://api.xero.com/api.xro/2.0/" + endpoint + "?" + query,
          { headers },
        );
        if (!r.ok)
          throw new FinanceError(
            502,
            "Xero " +
              endpoint.toLowerCase() +
              " unavailable. Wait a minute before refreshing.",
          );
        const rows = (await r.json())[endpoint];
        if (!Array.isArray(rows))
          throw new FinanceError(502, "Xero returned an incomplete page.");
        for (const v of rows) {
          const id = v[endpoint === "Invoices" ? "InvoiceID" : "PaymentID"];
          if (typeof id !== "string" || seen.has(id))
            throw new FinanceError(502, "Xero pages overlapped.");
          seen.add(id);
          if (endpoint === "Invoices") {
            const i = normaliseInvoice(v);
            if (i) invoices.push(i);
          } else {
            const p = normalisePayment(v);
            if (p) payments.push(p);
          }
        }
        if (rows.length < 100) {
          done = true;
          break;
        }
      }
      if (!done)
        throw new FinanceError(502, "Xero pagination exceeded the limit.");
    }
    return { invoices, payments };
  });
}
export async function loadFinanceInputs(owner: {
  userId: string;
  token: string;
}): Promise<FinanceInputs> {
  const now = new Date(),
    historyEnd = now.toISOString(),
    historyStart = new Date(now.getTime() - 730 * 86400000).toISOString();
  const [bank, transactions, jobs, xero] = await Promise.all([
    getBankSnapshot(),
    getBankTransactions(historyStart, historyEnd),
    readCrmJobs(owner.token),
    readXeroData(owner.userId),
  ]);
  const receipts = transactions.map((t) => ({
    id: t.id,
    amount: cents(t.amount),
    date: providerDate(t.date),
    description: t.description,
    reference: t.reference ? JSON.stringify(t.reference) : "",
  }));
  return {
    checkedAt: new Date().toISOString(),
    bank,
    historyStart,
    historyEnd,
    jobs,
    ...xero,
    receipts,
    warnings: [
      "Bank history requested for the past two years; availability depends on the bank feed. Older or missing settlements require an opening allocation.",
      "Archived jobs remain in scope. Missing installation status never releases a deposit.",
    ],
  };
}
