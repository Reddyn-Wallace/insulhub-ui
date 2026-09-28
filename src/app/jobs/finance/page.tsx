"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardResponse } from "@/lib/finance/dashboard";
import { isJobInstalled } from "@/lib/finance/model";
import {
  ReviewPanel,
  type ReviewTarget,
} from "@/components/finance/ReviewPanel";
import {
  money,
  when,
  financeApi,
  inputClass,
  buttonClass,
} from "@/components/finance/format";
type View = "deposits" | "owed" | "all" | "unlinked" | "review" | "history";
function Metric({
  label,
  value,
  note,
  dark = false,
}: {
  label: string;
  value: number;
  note: string;
  dark?: boolean;
}) {
  return (
    <div
      className={
        "rounded-2xl border p-5 sm:p-6 " +
        (dark
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white")
      }
    >
      <p
        className={
          "text-sm font-medium " + (dark ? "text-slate-300" : "text-slate-600")
        }
      >
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums lg:text-4xl">
        {money(value)}
      </p>
      <p
        className={
          "mt-3 text-xs leading-5 " +
          (dark ? "text-slate-300" : "text-slate-500")
        }
      >
        {note}
      </p>
    </div>
  );
}
export default function FinancePage() {
  const [data, setData] = useState<DashboardResponse | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [bankBusy, setBankBusy] = useState(false),
    [bankError, setBankError] = useState(""),
    [view, setView] = useState<View>("deposits"),
    [search, setSearch] = useState(""),
    [limit, setLimit] = useState(40),
    [outgoing, setOutgoing] = useState(false),
    [includeMatched, setIncludeMatched] = useState(false),
    [target, setTarget] = useState<ReviewTarget | null>(null),
    [expanded, setExpanded] = useState<string | null>(null);
  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    setError("");
    try {
      setData(await financeApi(refresh ? "dashboard?refresh=1" : "dashboard"));
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Could not load cash data.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function loadBank() {
    setBankBusy(true); setBankError("");
    try { setData(await financeApi("dashboard?bank=1")); }
    catch(e) {setBankError(e instanceof Error ? e.message : "Bank check unavailable");}
    finally {setBankBusy(false);}
  }
  const rows = useMemo(
    () =>
      data?.rows
        .filter((r) => {
          const scope =
            view === "deposits"
              ? !!r.job && !isJobInstalled(r.job)
              : view === "unlinked" ? !r.job : view === "owed"
                ? !!r.job && isJobInstalled(r.job) && r.due > 0
                : true;
          return (
            scope &&
            (
              r.number +
              " " +
              r.reference +
              " " +
              r.contact +
              " " +
              (r.job?.name || "")
            )
              .toLowerCase()
              .includes(search.toLowerCase())
          );
        })
        .sort((a, b) =>
          view === "deposits"
            ? b.reserved - a.reserved || b.paid - a.paid
            : view === "owed"
              ? b.owed - a.owed
              : b.date.localeCompare(a.date),
        ) || [],
    [data, view, search],
  );
  const receipts = useMemo(
    () =>
      data?.matches
        .filter(
          (m) =>
            (outgoing || m.receipt.amount > 0) &&
            (includeMatched || (!m.nonCustomer && !m.allocations.length)) &&
            (m.receipt.description + " " + m.receipt.reference)
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .sort((a, b) => b.receipt.date.localeCompare(a.receipt.date)) || [],
    [data, outgoing, includeMatched, search],
  );
  function changeView(v: View) {
    setView(v);
    setSearch("");
    setLimit(40);
    setExpanded(null);
  }
  function exportRows() {
    if (!data) return;
    const cell = (s: unknown) => {
      let t = String(s ?? "");
      if (/^[=+@\-\t\r]/.test(t)) t = "'" + t;
      return '"' + t.replaceAll('"', '""') + '"';
    };
    const values =
      view === "review"
        ? [
            [
              "Date",
              "Bank amount NZD",
              "Description",
              "Evidence",
              "Allocation",
            ],
            ...receipts.map((m) => [
              m.receipt.date,
              (m.receipt.amount / 100).toFixed(2),
              m.receipt.description,
              m.reason,
              m.method,
            ]),
          ]
        : [
            [
              "Invoice",
              "Reference",
              "Customer",
              "Job",
              "Status",
              "Currency",
              "Xero due",
              "Bank adjustment",
              "Known reserved",
              "Known owed",
              "Paid settlement unconfirmed",
              "Evidence",
            ],
            ...rows.map((r) => [
              r.number,
              r.reference,
              r.contact,
              r.job?.quote || "",
              r.job?.status || "Unlinked",
              r.currency,
              (r.due / 100).toFixed(2),
              (r.localAdjustment / 100).toFixed(2),
              (r.reserved / 100).toFixed(2),
              (r.owed / 100).toFixed(2),
              (r.unconfirmed / 100).toFixed(2),
              r.link.method + "; " + r.issues.join("; "),
            ]),
          ];
    const blob = new Blob(
        ["\uFEFF" + values.map((row) => row.map(cell).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8;" },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download =
      "Insulmax-cash-" + view + "-" + data.checkedAt.slice(0, 10) + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-7 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">
              Insulmax · Trading Account
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              Cash overview
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Cash in the bank, work still owed, and invoices still to collect.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/jobs/finance/connections"
              className="text-sm font-medium text-slate-600 underline underline-offset-4"
            >
              Connections
            </Link>
            <button
              className={buttonClass}
              onClick={() => void load(true)}
              disabled={busy}
            >
              {busy ? "Checking sources…" : "Refresh figures"}
            </button>
          </div>
        </header>
        {error && (
          <div
            role="alert"
            className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-6"
          >
            <h2 className="font-semibold">Figures unavailable</h2>
            <p className="mt-2 text-sm">{error}</p>
            <p className="mt-2 text-sm">
              No missing source has been counted as zero.
            </p>
          </div>
        )}
        {busy && !data && (
          <div
            role="status"
            className="rounded-2xl border border-slate-200 bg-white p-10"
          >
            <div className="mb-4 h-2 w-24 animate-pulse rounded bg-teal-500" />
            <p className="font-medium">
              Reading bank, Xero and installation records…
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Loading Xero invoices and CRM job status. Bank reconciliation loads separately.
            </p>
          </div>
        )}
        {data && (
          <>
            {data.provisional && (
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-amber-950">
                    Known amounts · review still needed
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-900">
                    {data.unlinked} invoices need a job link · {money(data.unclassifiedOwed)} outstanding on unlinked invoices
                    {data.staleDecisions.length
                      ? ` · ${data.staleDecisions.length} saved decisions need rechecking`
                      : ""}
                    . Deposit and debt totals may change.
                  </p>
                </div>
                <button
                  className="text-sm font-semibold text-amber-950 underline underline-offset-4"
                  onClick={() => changeView("unlinked")}
                >
                  Review job links →
                </button>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                label="Bank balance"
                value={data.bank.currentCents}
                note={
                  "NZD · " +
                  when(data.bank.balanceUpdatedAt) +
                  " · excludes overdraft"
                }
                dark
              />
              <Metric
                label="Deposits for unfinished jobs"
                value={data.reserved}
                note="Xero paid amounts for jobs not yet installed. A bank match is not required."
              />
              <Metric
                label="Bank less known deposits"
                value={data.cashAfterDeposits}
                note="Before wages, suppliers and tax. This is not a safe-to-spend figure."
              />
              <Metric
                label="Owed for installed jobs"
                value={data.owed}
                note={`Xero amount due on installed jobs. ${money(data.unclassifiedOwed)} additional debt needs a job link.`}
              />
            </div>
            <section className="mt-5 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                {!data.bankChecked ? <><h2 className="text-sm font-semibold">Bank reconciliation · separate check</h2><p className="mt-3 text-sm text-slate-600">Xero payments are already included above. Check bank settlement and unmatched receipts when needed; this does not change the payment totals.</p><button disabled={bankBusy} className={buttonClass + " mt-4"} onClick={() => void loadBank()}>{bankBusy ? "Checking bank history…" : "Load bank reconciliation"}</button>{bankError && <p role="alert" className="mt-3 text-sm text-rose-700">{bankError}</p>}</> : <>
                <h2 className="text-sm font-semibold">
                  Paid in Xero · bank settlement not confirmed
                </h2>
                <div className="mt-4 grid grid-cols-3 divide-x divide-slate-100">
                  <div className="pr-3">
                    <p className="text-xs text-slate-500">Unfinished jobs</p>
                    <p className="mt-2 text-lg font-semibold tabular-nums">
                      {money(data.unconfirmedUnfinished)}
                    </p>
                  </div>
                  <div className="px-3">
                    <p className="text-xs text-slate-500">Installed jobs</p>
                    <p className="mt-2 text-lg font-semibold tabular-nums">
                      {money(data.unconfirmedInstalled)}
                    </p>
                  </div>
                  <div className="pl-3">
                    <p className="text-xs text-slate-500">Job unlinked</p>
                    <p className="mt-2 text-lg font-semibold tabular-nums">
                      {money(data.unconfirmedUnknown)}
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-xs leading-5 text-slate-500">
                  Includes historical payments without matching bank evidence.
                  These are not extra cash or customer debt, and are not
                  necessarily Windcave payments in transit.
                </p></>}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Source coverage</h2>
                  <span
                    className={
                      "rounded-full px-2 py-1 text-xs " +
                      (data.bank.stale
                        ? "bg-amber-100 text-amber-900"
                        : "bg-teal-50 text-teal-800")
                    }
                  >
                    {data.bank.stale
                      ? "Bank update overdue"
                      : "Latest available feed"}
                  </span>
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  {data.invoiceCount} approved sales invoices ·{" "}
                  {data.jobCount.toLocaleString()} CRM jobs
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Bank transactions updated{" "}
                  {when(data.bank.transactionsUpdatedAt)}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Xero and CRM checked {when(data.checkedAt)}
                </p>
                <details className="mt-3 text-xs text-slate-500">
                  <summary className="cursor-pointer font-medium text-slate-700">
                    History and calculation notes
                  </summary>
                  <p className="mt-2">
                    History requested from {data.historyStart.slice(0, 10)}.
                    Actual history depends on the bank feed; deposit amounts use Xero regardless of bank matching. Checking sources does
                    not force an Akahu refresh.
                  </p>
                  {data.warnings.map((w) => (
                    <p key={w} className="mt-2">
                      {w}
                    </p>
                  ))}
                  <p className="mt-2">
                    All totals NZD including GST. Credits reduce invoice debt;
                    they do not count as payments. Jobs are installed or not installed. CRM completed stage or an installed result releases advances. Xero paid amounts remain reserved for other jobs.
                  </p>
                </details>
              </div>
            </section>
            <section className="mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-5 pt-5">
                <div
                  className="flex flex-wrap gap-x-6 gap-y-2"
                  role="tablist"
                  aria-label="Cash detail"
                >
                  {(
                    [
                      ["deposits", "Unfinished work"],
                      ["owed", "To collect"],
                      ["all", "All invoices"],
                  ["unlinked", "Needs linking"],
                      ["review", "Bank review"],
                      ["history", "Decision history"],
                    ] as [View, string][]
                  ).map(([v, label]) => (
                    <button
                      role="tab"
                      aria-selected={view === v}
                      key={v}
                      onClick={() => changeView(v)}
                      className={
                        "border-b-2 pb-4 text-sm font-semibold " +
                        (view === v
                          ? "border-teal-600 text-teal-800"
                          : "border-transparent text-slate-500 hover:text-slate-900")
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {view !== "history" && (
                <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                  <input
                    aria-label="Search financial records"
                    className={inputClass + " max-w-sm"}
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setLimit(40);
                    }}
                    placeholder={
                      view === "review"
                        ? "Search bank description or reference"
                        : "Search invoice, quote, customer or address"
                    }
                  />
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-slate-500">
                      {view === "review" ? receipts.length : rows.length}{" "}
                      records
                    </span>
                    <button
                      className="text-sm font-semibold text-teal-700"
                      onClick={exportRows}
                    >
                      Export this view
                    </button>
                  </div>
                </div>
              )}
              {view === "review" && !data.bankChecked && <div className="p-6"><p className="mb-4 text-sm text-slate-600">Bank history is loaded separately to keep the overview fast.</p><button className={buttonClass} disabled={bankBusy} onClick={() => void loadBank()}>{bankBusy ? "Checking bank history…" : "Load bank reconciliation"}</button>{bankError && <p role="alert">{bankError}</p>}</div>}
              {view === "review" && data.bankChecked && (
                <>
                  <div className="flex flex-wrap gap-5 px-5 pb-5 text-sm text-slate-600">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={outgoing}
                        onChange={(e) => setOutgoing(e.target.checked)}
                      />
                      Include outgoing transactions / refunds
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={includeMatched}
                        onChange={(e) => setIncludeMatched(e.target.checked)}
                      />
                      Include matched and classified
                    </label>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-500">
                        <tr>
                          {[
                            "Date",
                            "Bank transaction",
                            "Amount",
                            "Evidence",
                            "",
                          ].map((t) => (
                            <th key={t} className="px-5 py-3 font-medium">
                              {t}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {receipts.slice(0, limit).map((m) => (
                          <tr key={m.receipt.id}>
                            <td className="whitespace-nowrap px-5 py-4 text-slate-500">
                              {m.receipt.date}
                            </td>
                            <td className="max-w-xs px-5 py-4">
                              {m.receipt.description}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 font-medium tabular-nums">
                              {money(m.receipt.amount)}
                            </td>
                            <td className="max-w-xs px-5 py-4 text-xs leading-5 text-slate-500">
                              {m.nonCustomer
                                ? "Non-customer · "
                                : m.method + " · "}
                              {m.reason}
                            </td>
                            <td className="px-5 py-4">
                              <button
                                className="font-semibold text-teal-700"
                                onClick={() =>
                                  setTarget({
                                    kind: "receipt",
                                    id: m.receipt.id,
                                  })
                                }
                              >
                                Review
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!receipts.length && (
                    <p className="p-8 text-sm text-slate-500">
                      No transactions match this view.
                    </p>
                  )}
                </>
              )}
              {view !== "review" && view !== "history" && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>
                        {[
                          "Invoice / customer",
                          "CRM job",
                          "Xero due",
                          "Known reserve",
                          "Known owed",
                          "Evidence",
                        ].map((t) => (
                          <th
                            key={t}
                            className="whitespace-nowrap px-5 py-3 font-medium"
                          >
                            {t}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.slice(0, limit).map((r) => (
                        <tr key={r.id} className="align-top">
                          <td className="min-w-52 px-5 py-4">
                            <button
                              className="font-semibold text-slate-900 underline decoration-slate-300 underline-offset-4"
                              onClick={() =>
                                setExpanded(expanded === r.id ? null : r.id)
                              }
                              aria-expanded={expanded === r.id}
                            >
                              {r.number}
                            </button>
                            <p className="mt-1 text-xs text-slate-500">
                              {r.contact}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {r.reference || "No reference"}
                            </p>
                            {expanded === r.id && (
                              <div className="mt-4 max-w-sm space-y-3 rounded-xl bg-slate-50 p-4 text-xs">
                                <p>{r.description}</p>
                                <p>
                                  {r.currency} · Total{" "}
                                  {(r.total / 100).toFixed(2)} · Xero paid{" "}
                                  {(r.paid / 100).toFixed(2)} · Credits{" "}
                                  {(r.credited / 100).toFixed(2)}
                                </p>
                                <p>
                                  {data.bankChecked ? `Bank settlement unconfirmed ${money(r.unconfirmed)}` : "Bank settlement not checked. Xero payments are included."}
                                </p>
                                <p>{r.link.method}</p><p>CRM: {r.job?.status || "Unknown"} · stage {r.job?.stage || "Unknown"}{r.job?.detailVerified ? " · verified from job detail" : ""}</p>
                                {r.allocations.map((a, n) => (
                                  <p key={n}>
                                    {money(a.gross)} customer amount · fee{" "}
                                    {money(a.fee)} · {a.method}
                                    {a.paymentId
                                      ? " · recorded in Xero"
                                      : " · no identified Xero payment"}
                                  </p>
                                ))}
                                {r.issues.map((x) => (
                                  <p className="text-amber-800" key={x}>
                                    {x}
                                  </p>
                                ))}
                                <div className="flex flex-wrap gap-3">
                                  <button
                                    className="font-semibold text-teal-700"
                                    onClick={() =>
                                      setTarget({ kind: "link", id: r.id })
                                    }
                                  >
                                    Confirm/change job
                                  </button>
                                  <button
                                    className="font-semibold text-teal-700"
                                    onClick={() =>
                                      setTarget({ kind: "opening", id: r.id })
                                    }
                                  >
                                    Historical bank evidence
                                  </button>

                                </div>
                              </div>
                            )}
                          </td>
                          <td className="max-w-56 px-5 py-4">
                            {r.job ? (
                              <>
                                <Link
                                  className="text-teal-800 underline underline-offset-4"
                                  href={"/jobs/" + r.job.id}
                                >
                                  {r.job.quote || r.job.number}
                                </Link>
                                <p className="mt-1 text-xs text-slate-500">
                                  {r.job.name}
                                </p>
                                <p className="mt-2 text-xs">
                                  {isJobInstalled(r.job)
                                    ? "Installed"
                                    : r.job.status === "INSTALL_NOT_FINISHED"
                                      ? "Partly installed"
                                      : r.job.status
                                        ? "Not installed"
                                        : "Status unknown"}
                                  {r.job.archived ? " · archived" : ""}
                                </p>
                              </>
                            ) : (
                              <button
                                className="text-amber-800 underline underline-offset-4"
                                onClick={() =>
                                  setTarget({ kind: "link", id: r.id })
                                }
                              >
                                Link job
                              </button>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 tabular-nums">
                            {r.currency === "NZD"
                              ? money(r.due)
                              : r.currency + " " + (r.due / 100).toFixed(2)}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 font-medium tabular-nums">
                            {money(r.reserved)}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 font-medium tabular-nums">
                            {money(r.owed)}
                          </td>
                          <td className="max-w-52 px-5 py-4 text-xs leading-5 text-slate-500">
                            {r.issues.length
                              ? r.issues.join(" · ")
                              : r.unconfirmed
                                ? "Paid; settlement needs evidence"
                                : r.allocations.length
                                  ? "Bank evidence linked"
                                  : r.paid === 0
                                    ? "No payment recorded"
                                    : "Xero payment recorded"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!rows.length && (
                    <p className="p-8 text-sm text-slate-500">
                      No invoices match this view.
                    </p>
                  )}
                </div>
              )}
              {view === "history" && (
                <div className="divide-y divide-slate-100">
                  {data.history.length ? (
                    data.history.map((h) => (
                      <div
                        key={h.key + ":" + h.revision}
                        className="flex flex-wrap items-center justify-between gap-3 p-5"
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {h.value?.kind || "Decision undone"} · revision{" "}
                            {h.revision}
                          </p>
                          <p className="mt-1 text-sm text-slate-600">
                            {h.value?.reason ||
                              "Previous classification removed; evidence recalculated."}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            {when(h.updatedAt)}
                          </p>
                        </div>
                        <button
                          className="text-sm font-semibold text-teal-700"
                          onClick={() => {
                            const at = h.key.indexOf(":");
                            setTarget({
                              kind: h.key.slice(0, at) as ReviewTarget["kind"],
                              id: h.key.slice(at + 1),
                            });
                          }}
                        >
                          Inspect current decision
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="p-8 text-sm text-slate-500">
                      No owner decisions yet. Confirmations and reversals will
                      appear here.
                    </p>
                  )}
                </div>
              )}
              {view !== "history" &&
                (view === "review" ? receipts.length : rows.length) > limit && (
                  <div className="border-t border-slate-100 p-5 text-center">
                    <button
                      className="text-sm font-semibold text-teal-700"
                      onClick={() => setLimit(limit + 40)}
                    >
                      Show 40 more
                    </button>
                  </div>
                )}
            </section>
            <p className="mt-5 text-xs text-slate-500">
              Headline figures cover all loaded records. Search and tabs filter
              detail only. Review decisions affect this dashboard; source
              records remain in Xero, Akahu and the CRM.
            </p>
          </>
        )}
        {data && target && (
          <ReviewPanel
            key={target.kind + target.id}
            data={data}
            target={target}
            onClose={() => setTarget(null)}
            onSaved={() => load(true)}
          />
        )}
      </div>
    </main>
  );
}
