"use client";
import { useCallback, useEffect, useState } from "react";
import type { FinanceSourceStatus, SourceState } from "@/lib/finance/sources";
type Organisation = { id: string; name: string; eligible: boolean };
const money = (cents: number) =>
  new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(
    cents / 100,
  );
const date = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("en-NZ", {
        timeZone: "Pacific/Auckland",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not available";
async function api(path: string, method = "GET", body?: unknown) {
  const token = localStorage.getItem("token");
  if (!token) throw Error("Sign in to Insulhub to continue.");
  const r = await fetch("/api/finance/" + path, {
    method,
    cache: "no-store",
    headers: {
      "x-access-token": token,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "The connection check could not finish.");
  return d;
}
function StateTag({ source }: { source?: SourceState<unknown> }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${source?.status === "connected" ? "bg-emerald-50 text-emerald-800" : source?.status === "stale" ? "bg-amber-50 text-amber-900" : "bg-slate-100 text-slate-600"}`}
    >
      {source?.status === "connected"
        ? "Connected"
        : source?.status === "incomplete"
          ? "Links need review"
          : source?.status === "stale"
            ? "Update overdue"
            : source
              ? "Needs attention"
              : "Not checked"}
    </span>
  );
}
export default function Connections() {
  const [status, setStatus] = useState<FinanceSourceStatus | null>(null),
    [organisations, setOrganisations] = useState<Organisation[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [identity, setIdentity] = useState<{
      userId: string;
      ownerPinned: boolean;
    } | null>(null),
    [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const me = await api("identity");
      setIdentity(me);
      if (!me.ownerPinned) return;
      const [sources, orgs] = await Promise.all([
        api("sources"),
        api("xero/organisation").catch(() => ({ organisations: [] })),
      ]);
      setStatus(sources);
      setOrganisations(orgs.organisations);
    } catch (e) {
      setStatus(null);
      setIdentity(null);
      setOrganisations([]);
      setError(e instanceof Error ? e.message : "Connection check failed.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("xero");
    if (result)
      setNotice(
        result === "connected"
          ? "Xero authorised. Select the Insulmax organisation below."
          : result === "denied"
            ? "Xero authorisation was cancelled."
            : "Xero authorisation did not complete. Start again.",
      );
    void load();
  }, [load]);
  async function connect() {
    setBusy(true);
    setError("");
    try {
      const d = await api("xero/connect", "POST");
      const u = new URL(d.url);
      if (u.origin !== "https://login.xero.com")
        throw Error("Invalid authorisation address.");
      window.location.assign(u.toString());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not start authorisation.",
      );
      setBusy(false);
    }
  }
  async function select(id: string) {
    setBusy(true);
    setError("");
    try {
      await api("xero/organisation", "POST", { tenantId: id });
      setNotice("Organisation selected. Checking source data.");
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not select organisation.",
      );
      setBusy(false);
    }
  }
  const bank = status?.bank,
    crm = status?.crm,
    xero = status?.xero;
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Insulmax · Owner access
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
            Finance connections
          </h1>
          <p className="mt-2 max-w-xl text-sm text-slate-600">
            Verify the sources behind your cash dashboard. Bank cash, invoice
            payments and installation records each keep their own update time.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={busy}
          className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Checking sources…" : "Check sources"}
        </button>
      </div>
      {notice && (
        <p
          role="status"
          className="mb-5 rounded-xl bg-blue-50 p-4 text-sm text-blue-900"
        >
          {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mb-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-950"
        >
          {error}
        </p>
      )}
      {identity && !identity.ownerPinned && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="font-semibold">Owner verification required</h2>
          <p className="mt-2 text-sm">
            Your login email has been verified by the CRM. Finance access stays
            disabled until this canonical user ID is pinned in the server
            configuration.
          </p>
          <code className="mt-4 block select-all break-all">
            {identity.userId}
          </code>
        </section>
      )}
      {identity?.ownerPinned && (
        <>
          <div className="grid gap-5 lg:grid-cols-3">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">Bank · Akahu</h2>
                <StateTag source={bank} />
              </div>
              {bank && bank.status !== "unavailable" ? (
                <>
                  <p className="mt-7 text-xs uppercase tracking-wide text-slate-500">
                    Bank cash
                  </p>
                  <p className="mt-1 text-3xl font-semibold tabular-nums">
                    {money(bank.data.currentCents)}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    {bank.data.accountName} · NZD
                  </p>
                  <dl className="mt-6 space-y-3 text-xs text-slate-600">
                    <div>
                      <dt>Balance updated</dt>
                      <dd className="font-medium text-slate-900">
                        {date(bank.data.balanceUpdatedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt>Transactions updated</dt>
                      <dd className="font-medium text-slate-900">
                        {date(bank.data.transactionsUpdatedAt)}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-5 text-sm">
                    {bank.data.postedTransactionsLast30Days} posted transactions
                    in the last 30 days.
                  </p>
                </>
              ) : (
                <p className="mt-6 text-sm text-slate-600">
                  {bank?.status === "unavailable"
                    ? bank.error
                    : "Waiting for source check."}
                </p>
              )}
              <p className="mt-6 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">
                Overdraft availability is excluded. Akahu personal apps refresh
                daily. Checking sources reads the latest supplied data; it does
                not force a bank refresh.
              </p>
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">Invoices · Xero</h2>
                <StateTag source={xero} />
              </div>
              {xero && xero.status !== "unavailable" ? (
                <>
                  <p className="mt-7 text-3xl font-semibold tabular-nums">
                    {xero.data.invoiceCount}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    Sales invoices read · {xero.data.paymentCount} payment
                    records
                  </p>
                  <p className="mt-5 text-xs text-slate-500">
                    Checked {date(xero.checkedAt)}
                  </p>
                </>
              ) : (
                <p className="mt-6 text-sm text-slate-600">
                  {xero?.status === "unavailable"
                    ? xero.error
                    : "Waiting for source check."}
                </p>
              )}
              <button
                disabled={busy}
                onClick={() => void connect()}
                className="mt-6 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                Connect / reconnect Xero
              </button>
              {organisations.map((o) => (
                <div key={o.id} className="mt-4 rounded-lg bg-slate-50 p-3">
                  <p className="text-xs leading-5">{o.name}</p>
                  <button
                    disabled={busy || !o.eligible}
                    onClick={() => void select(o.id)}
                    className="mt-2 text-xs font-semibold text-blue-800 disabled:text-slate-400"
                  >
                    {o.eligible
                      ? "Use this organisation"
                      : "Outside dashboard scope"}
                  </button>
                </div>
              ))}
              <p className="mt-5 text-xs leading-5 text-slate-500">
                Read-only access. A paid invoice does not prove the money has
                reached the bank.
              </p>
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">Installations · CRM</h2>
                <StateTag source={crm} />
              </div>
              {crm && crm.status !== "unavailable" ? (
                <>
                  <p className="mt-7 text-3xl font-semibold tabular-nums">
                    {crm.data.jobCount}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    Jobs checked · {crm.data.installed} installed
                  </p>
                  <ul className="mt-6 space-y-2 text-sm text-slate-700">
                    <li>
                      {crm.data.missingInvoiceLinks} without invoice links
                    </li>
                    <li>
                      {crm.data.missingInstallationStatus} without installation
                      status
                    </li>
                  </ul>
                  <p className="mt-5 text-xs text-slate-500">
                    Checked {date(crm.checkedAt)}
                  </p>
                  <p className="mt-4 text-xs leading-5 text-slate-500">
                    {crm.data.scope}
                  </p>
                </>
              ) : (
                <p className="mt-6 text-sm text-slate-600">
                  {crm?.status === "unavailable"
                    ? crm.error
                    : "Waiting for source check."}
                </p>
              )}
            </section>
          </div>
          <section className="mt-6 rounded-2xl bg-slate-100 p-5 text-sm leading-6 text-slate-600">
            <strong className="text-slate-900">
              Connection verification only.
            </strong>{" "}
            Deposits for unfinished jobs and amounts owed for installed jobs
            will appear after invoice linking and payment matching have been
            verified.
          </section>
          {xero &&
            xero.status !== "unavailable" &&
            xero.data.samples.length > 0 && (
              <section className="mt-8 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="mb-4 font-semibold">
                  Xero sample · check against the source
                </h2>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      {[
                        "Invoice",
                        "Status",
                        "Currency",
                        "Total",
                        "Paid",
                        "Due",
                      ].map((h) => (
                        <th key={h} className="whitespace-nowrap border-b p-2">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {xero.data.samples.map((i) => (
                      <tr key={i.number}>
                        <td className="p-2">{i.number}</td>
                        <td className="p-2">{i.status}</td>
                        <td className="p-2">{i.currency}</td>
                        {[i.total, i.paid, i.due].map((n, j) => (
                          <td className="p-2 tabular-nums" key={j}>
                            {n.toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
        </>
      )}
    </main>
  );
}
