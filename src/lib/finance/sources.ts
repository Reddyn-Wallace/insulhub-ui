import "server-only";
import { FinanceError, safeFetch } from "./errors";
import { getBankSnapshot, getBankTransactions } from "./akahu";
import { readConnection } from "./connection-store";
import { withXeroAccess } from "./xero-oauth";
export type SourceState<T> =
  | { status: "connected" | "stale" | "incomplete"; checkedAt: string; data: T }
  | { status: "unavailable"; checkedAt: string; error: string };
export type FinanceSourceStatus = {
  bank: SourceState<Awaited<ReturnType<typeof bankCheck>>>;
  crm: SourceState<Awaited<ReturnType<typeof getCrmSnapshot>>>;
  xero: SourceState<Awaited<ReturnType<typeof getXeroSnapshot>>>;
};
type InvoiceLink = { xeroInvoiceNumber?: string | null };
type CrmJob = {
  _id: string;
  jobNumber?: number;
  installation?: { installStatus?: string | null } | null;
  depositInvoice?: InvoiceLink | null;
  finalInvoice?: InvoiceLink | null;
  additionalInstallmentInvoices?: InvoiceLink[];
};
export async function getCrmSnapshot(token: string) {
  const ids = new Set<string>();
  let jobCount = 0,
    missingInvoiceLinks = 0,
    missingInstallationStatus = 0,
    installed = 0;
  let expected: number | undefined;
  const samples: Array<{
    jobNumber: number | null;
    status: string | null;
    invoices: string[];
  }> = [];
  for (let page = 0; page < 100; page++) {
    const r = await safeFetch("https://api.insulhub.nz/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", "x-access-token": token },
      body: JSON.stringify({
        query:
          "query FinanceJobs($skip:Int,$limit:Int){jobs(stages:[SCHEDULED,INSTALLATION,INVOICE,COMPLETED],skip:$skip,limit:$limit){total results{_id jobNumber installation{installStatus} depositInvoice{xeroInvoiceNumber} finalInvoice{xeroInvoiceNumber} additionalInstallmentInvoices{xeroInvoiceNumber}}}}",
        variables: { skip: page * 250, limit: 250 },
      }),
    });
    if (!r.ok) throw new FinanceError(502, "CRM job data is unavailable.");
    const d = await r.json();
    const list = d.data?.jobs;
    if (
      d.errors?.length ||
      !Number.isInteger(list?.total) ||
      list.total < 0 ||
      !Array.isArray(list.results)
    ) {
      console.warn("Finance CRM response rejected", {
        totalType: typeof list?.total,
        resultsArray: Array.isArray(list?.results),
        errors: Array.isArray(d.errors)
          ? d.errors
              .slice(0, 5)
              .map(
                (e: {
                  path?: unknown[];
                  message?: string;
                  extensions?: { code?: unknown };
                }) => ({
                  path: e.path?.join("."),
                  message: e.message
                    ?.replace(/[A-Za-z0-9_\-]{30,}/g, "[redacted]")
                    .slice(0, 200),
                  code: e.extensions?.code,
                }),
              )
          : [],
      });
      throw new FinanceError(502, "CRM job data was incomplete.");
    }
    if (expected !== undefined && expected !== list.total)
      throw new FinanceError(
        502,
        "CRM jobs changed during verification. Run the check again.",
      );
    expected = list.total;
    for (const j of list.results as CrmJob[]) {
      if (typeof j._id !== "string" || ids.has(j._id))
        throw new FinanceError(
          502,
          "CRM pages contained missing or repeated jobs.",
        );
      ids.add(j._id);
      jobCount++;
      const status = j.installation?.installStatus || null;
      const invoices = [
        j.depositInvoice,
        j.finalInvoice,
        ...(j.additionalInstallmentInvoices || []),
      ]
        .map((x) => x?.xeroInvoiceNumber)
        .filter((x): x is string => typeof x === "string" && !!x);
      if (!invoices.length) missingInvoiceLinks++;
      if (!status) missingInstallationStatus++;
      if (
        [
          "INSTALLED_AS_QUOTED",
          "INSTALLED_WITH_VARIATIONS_FROM_QUOTE",
        ].includes(status || "")
      )
        installed++;
      if (samples.length < 5)
        samples.push({ jobNumber: j.jobNumber ?? null, status, invoices });
    }
    if (jobCount === expected)
      return {
        jobCount,
        installed,
        missingInvoiceLinks,
        missingInstallationStatus,
        samples,
        scope:
          "Scheduled, installation, invoice and completed stages; archival and older-stage deposit coverage will be audited in chunk 3.",
      };
    if (list.results.length < 250 || jobCount > list.total)
      throw new FinanceError(502, "CRM pagination was incomplete.");
  }
  throw new FinanceError(502, "CRM pagination exceeded the safety limit.");
}
export async function getXeroSnapshot(ownerId: string) {
  return withXeroAccess(ownerId, async (accessToken, tenantId) => {
    const headers = {
      Authorization: "Bearer " + accessToken,
      "xero-tenant-id": tenantId,
      Accept: "application/json",
    };
    let invoiceCount = 0,
      paymentCount = 0;
    const samples: Array<{
      number: string;
      status: string;
      total: number;
      paid: number;
      due: number;
      currency: string;
    }> = [];
    for (const endpoint of ["Invoices", "Payments"] as const) {
      const seen = new Set<string>();
      let done = false;
      for (let page = 1; page <= 100; page++) {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: "100",
        });
        if (endpoint === "Invoices") params.set("where", 'Type=="ACCREC"');
        const r = await safeFetch(
          "https://api.xero.com/api.xro/2.0/" + endpoint + "?" + params,
          { headers },
        );
        if (!r.ok)
          throw new FinanceError(
            502,
            "Xero " + endpoint.toLowerCase() + " could not be read.",
          );
        const d = await r.json(),
          items = d[endpoint];
        if (!Array.isArray(items))
          throw new FinanceError(
            502,
            "Xero returned incomplete " + endpoint.toLowerCase() + ".",
          );
        for (const item of items) {
          const id = item[endpoint === "Invoices" ? "InvoiceID" : "PaymentID"];
          if (typeof id !== "string" || seen.has(id))
            throw new FinanceError(
              502,
              "Xero pages overlapped or lacked identifiers. Retry verification.",
            );
          seen.add(id);
          if (endpoint === "Invoices") {
            invoiceCount++;
            if (
              !["DRAFT", "DELETED", "VOIDED", "SUBMITTED"].includes(item.Status)
            ) {
              if (
                !["Total", "AmountPaid", "AmountDue"].every(
                  (k) =>
                    typeof item[k] === "number" && Number.isFinite(item[k]),
                )
              )
                throw new FinanceError(
                  502,
                  "Xero returned an invalid invoice balance.",
                );
              if (samples.length < 5)
                samples.push({
                  number: String(item.InvoiceNumber),
                  status: String(item.Status),
                  total: item.Total,
                  paid: item.AmountPaid,
                  due: item.AmountDue,
                  currency: String(item.CurrencyCode || "Unknown"),
                });
            }
          } else {
            if (
              typeof item.Amount !== "number" ||
              !Number.isFinite(item.Amount)
            )
              throw new FinanceError(502, "Xero returned an invalid payment.");
            paymentCount++;
          }
        }
        if (items.length < 100) {
          done = true;
          break;
        }
      }
      if (!done)
        throw new FinanceError(
          502,
          "Xero pagination exceeded the safety limit.",
        );
    }
    return { invoiceCount, paymentCount, samples };
  });
}
async function bankCheck() {
  const snapshot = await getBankSnapshot();
  const end = new Date(),
    start = new Date(end.getTime() - 30 * 86400000);
  const transactions = await getBankTransactions(
    start.toISOString(),
    end.toISOString(),
  );
  return { ...snapshot, postedTransactionsLast30Days: transactions.length };
}
async function check<T>(operation: () => Promise<T>): Promise<SourceState<T>> {
  const checkedAt = new Date().toISOString();
  try {
    const data = await operation();
    return {
      status:
        typeof data === "object" &&
        data !== null &&
        "stale" in data &&
        data.stale
          ? "stale"
          : "connected",
      checkedAt,
      data,
    };
  } catch (error) {
    return {
      status: "unavailable",
      checkedAt,
      error:
        error instanceof FinanceError
          ? error.message
          : "Source verification is unavailable.",
    };
  }
}
export async function getSourceStatus(owner: {
  userId: string;
  token: string;
}): Promise<FinanceSourceStatus> {
  const [bank, crm, xero] = await Promise.all([
    check(bankCheck),
    check(() => getCrmSnapshot(owner.token)),
    check(async () => {
      const c = await readConnection(owner.userId);
      if (!c?.tenant_id)
        throw new FinanceError(
          409,
          "Connect Xero and select your organisation.",
        );
      return getXeroSnapshot(owner.userId);
    }),
  ]);
  if (
    crm.status === "connected" &&
    (crm.data.missingInvoiceLinks > 0 || crm.data.missingInstallationStatus > 0)
  )
    crm.status = "incomplete";
  return { bank, crm, xero };
}
