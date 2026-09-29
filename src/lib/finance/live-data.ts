import "server-only";
import { linkInvoices } from "./linking";
import { FinanceError, safeFetch } from "./errors";
import { getBankSnapshot, getBankTransactions } from "./akahu";
import { withXeroAccess } from "./xero-oauth";
import {
  cents,
  isJobInstalled,
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
async function boundedMap<T, R>(
  items: T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        result[index] = await run(items[index], index);
      }
    }),
  );
  return result;
}
export async function readCrmJobs(token: string): Promise<FinanceJob[]> {
  async function page(skip: number) {
    const r = await safeFetch("https://api.insulhub.nz/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", "x-access-token": token },
      body: JSON.stringify({
        query:
          "query FinanceJobIndex($skip:Int,$limit:Int){jobs(skip:$skip,limit:$limit){total results{_id jobNumber stage archivedAt quote{quoteNumber} installation{installStatus} client{contactDetails{name streetAddress}}}}}",
        variables: { skip, limit: 500 },
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
    return list;
  }
  const first = await page(0);
  if (first.total > 50000)
    throw new FinanceError(502, "CRM job index exceeds the supported size.");
  const rest = await boundedMap(
    Array.from(
      { length: Math.max(0, Math.ceil(first.total / 500) - 1) },
      (_, i) => (i + 1) * 500,
    ),
    3,
    page,
  );
  const jobs: FinanceJob[] = [],
    seen = new Set<string>();
  for (const list of [first, ...rest]) {
    if (list.total !== first.total)
      throw new FinanceError(
        502,
        "CRM jobs changed during loading. Refresh again.",
      );
    for (const j of list.results) {
      if (typeof j._id !== "string" || seen.has(j._id))
        throw new FinanceError(502, "CRM job pagination overlapped.");
      seen.add(j._id);
      jobs.push({
        id: j._id,
        number: String(j.jobNumber ?? ""),
        quote: String(j.quote?.quoteNumber || ""),
        status: String(j.installation?.installStatus || ""),
        stage: String(j.stage || ""),
        archived: !!j.archivedAt,
        contact: String(j.client?.contactDetails?.name || ""),
        name: String(
          j.client?.contactDetails?.streetAddress ||
            j.client?.contactDetails?.name ||
            "Job " + j.jobNumber,
        ),
        invoiceNumbers: [],
      });
    }
  }
  if (jobs.length !== first.total)
    throw new FinanceError(502, "CRM job pagination is incomplete.");
  return jobs;
}
export async function verifyCrmDetails(
  token: string,
  jobs: FinanceJob[],
  invoices: FinanceInvoice[],
) {
  const links = linkInvoices(invoices, jobs, []);
  const selected = new Set<string>();
  for (const link of links.values()) {
    if (!link.jobId) for (const id of link.candidates) selected.add(id);
    else {
      const job = jobs.find((j) => j.id === link.jobId);
      if (job && !isJobInstalled(job)) selected.add(job.id);
    }
  }
  const normalName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const contacts = new Set(
    invoices
      .filter((i) => !links.get(i.id)?.jobId)
      .map((i) => normalName(i.contact))
      .filter(Boolean),
  );
  for (const j of jobs)
    if (j.contact && contacts.has(normalName(j.contact))) selected.add(j.id);
  const candidates = jobs.filter((j) => selected.has(j.id));
  const chunks = Array.from(
    { length: Math.ceil(candidates.length / 15) },
    (_, i) => candidates.slice(i * 15, i * 15 + 15),
  );
  const updates = new Map<string, FinanceJob>();
  await boundedMap(chunks, 3, async (batch) => {
    const variables = Object.fromEntries(batch.map((j, i) => ["id" + i, j.id]));
    const fields = batch
      .map(
        (_, i) =>
          `j${i}:job(_id:$id${i}){_id stage installation{installStatus} depositInvoice{xeroInvoiceNumber} finalInvoice{xeroInvoiceNumber} additionalInstallmentInvoices{xeroInvoiceNumber}}`,
      )
      .join(" ");
    const query = `query FinanceJobDetails(${batch.map((_, i) => `$id${i}:ObjectId!`).join(",")}){${fields}}`;
    const r = await safeFetch("https://api.insulhub.nz/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", "x-access-token": token },
      body: JSON.stringify({ query, variables }),
    });
    if (!r.ok)
      throw new FinanceError(502, "Detailed CRM jobs could not be read.");
    const d = await r.json();
    const unexpected = (d.errors || []).some(
      (e: { message?: string; path?: Array<string | number> }) =>
        !(
          /Cannot return null for non-nullable field .*xeroInvoiceNumber/.test(
            e.message || "",
          ) &&
          e.path?.some((p) =>
            [
              "depositInvoice",
              "finalInvoice",
              "additionalInstallmentInvoices",
            ].includes(String(p)),
          )
        ),
    );
    if (unexpected)
      throw new FinanceError(502, "Detailed CRM job verification failed.");
    batch.forEach((j, i) => {
      const detail = d.data?.["j" + i];
      if (!detail || detail._id !== j.id)
        throw new FinanceError(502, "Detailed CRM job was incomplete.");
      const numbers = [
        detail.depositInvoice,
        detail.finalInvoice,
        ...(detail.additionalInstallmentInvoices || []),
      ]
        .map((v) => v?.xeroInvoiceNumber)
        .filter((v: unknown): v is string => typeof v === "string" && !!v);
      updates.set(j.id, {
        ...j,
        status: String(detail.installation?.installStatus || ""),
        stage: String(detail.stage || ""),
        invoiceNumbers: numbers,
        detailVerified: true,
        completionConflict:
          detail.stage === "COMPLETED" &&
          detail.installation?.installStatus === "INSTALL_NOT_FINISHED",
      });
    });
  });
  return jobs.map((j) => updates.get(j.id) || j);
}
export async function readXeroData(ownerId: string, includePayments = true) {
  return withXeroAccess(ownerId, async (token, tenant) => {
    const headers = {
      Authorization: "Bearer " + token,
      "xero-tenant-id": tenant,
      Accept: "application/json",
    };
    const invoices: FinanceInvoice[] = [],
      payments: FinancePayment[] = [];
    for (const endpoint of includePayments
      ? ["Invoices", "Payments"]
      : ["Invoices"]) {
      const seen = new Set<string>();
      let done = false;
      for (let page = 1; page <= 100; page++) {
        const query = new URLSearchParams({
          page: String(page),
          pageSize: "1000",
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
        if (rows.length < 1000) {
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
export async function loadFinanceInputs(
  owner: {
    userId: string;
    token: string;
  },
  bankCheck = false,
): Promise<FinanceInputs> {
  const started = Date.now();
  const now = new Date(),
    historyEnd = now.toISOString(),
    historyStart = new Date(
      now.getTime() - (bankCheck ? 730 : 7) * 86400000,
    ).toISOString();
  const timings: Record<string, number> = {};
  async function timed<T>(name: string, action: Promise<T>) {
    const start = Date.now();
    const result = await action;
    timings[name] = Date.now() - start;
    return result;
  }
  const [bank, transactions, jobs, xero] = await Promise.all([
    timed("bank", getBankSnapshot()),
    getBankTransactions(historyStart, historyEnd),
    timed("crmIndex", readCrmJobs(owner.token)),
    timed("xero", readXeroData(owner.userId, true)),
  ]);
  const receipts = transactions.map((t) => ({
    id: t.id,
    amount: cents(t.amount),
    date: providerDate(t.date),
    description: t.description,
    reference: t.reference ? JSON.stringify(t.reference) : "",
  }));
  const verifiedJobs = await timed(
    "crmDetails",
    verifyCrmDetails(owner.token, jobs, xero.invoices),
  );
  console.info(
    "finance_load",
    JSON.stringify({
      mode: bankCheck ? "bank" : "overview",
      elapsedMs: Date.now() - started,
      timings,
      jobs: jobs.length,
      invoices: xero.invoices.length,
    }),
  );
  return {
    checkedAt: new Date().toISOString(),
    bank,
    historyStart,
    historyEnd,
    jobs: verifiedJobs,
    bankChecked: bankCheck,
    recentBankChecked: true,
    ...xero,
    receipts,
    warnings: [
      bankCheck
        ? "Bank history covers up to two years. Only receipts from the past week may reduce installed-job debt."
        : "Receipts from the past week are checked for completed-job payments not yet reflected in Xero. Earlier Xero payments can overlap recent receipts. Uncertain amounts remain owed until reconciled.",
      "Archived jobs remain in scope. Missing installation status never releases a deposit.",
    ],
  };
}
