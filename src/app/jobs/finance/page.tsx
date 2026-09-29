"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
type View =
  | "deposits"
  | "owed"
  | "settled"
  | "pending"
  | "all"
  | "unlinked"
  | "review"
  | "history";
function Metric({
  label,
  value,
  note,
  dark = false,
  children,
  onOpen,
  actionLabel,
}: {
  label: string;
  value: number | string;
  note: ReactNode;
  children?: ReactNode;
  dark?: boolean;
  onOpen?: () => void;
  actionLabel?: string;
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
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${label}: ${typeof value === "number" ? money(value) : value}. ${actionLabel}`}
          className="w-full rounded-lg text-left transition hover:text-teal-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700"
        >
          <span className="flex justify-between gap-3 text-sm font-medium text-slate-600">
            {label}
            <span aria-hidden="true" className="text-teal-700">
              ↗
            </span>
          </span>
          <span className="mt-3 block text-3xl font-semibold tracking-tight tabular-nums lg:text-4xl">
            {typeof value === "number" ? money(value) : value}
          </span>
        </button>
      ) : (
        <>
          <p
            className={
              "text-sm font-medium " +
              (dark ? "text-slate-300" : "text-slate-600")
            }
          >
            {label}
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums lg:text-4xl">
            {typeof value === "number" ? money(value) : value}
          </p>
        </>
      )}
      {children}
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailSection = useRef<HTMLElement>(null);
  const [drillRequest, setDrillRequest] = useState(0);
  useEffect(() => {
    if (drillRequest && detailsOpen) {
      detailSection.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "start",
      });
      detailSection.current?.focus({ preventScroll: true });
    }
  }, [drillRequest, detailsOpen]);
  function openDetail(next: View) {
    changeView(next);
    setDetailsOpen(true);
    setDrillRequest((n) => n + 1);
  }
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
    setBankBusy(true);
    setBankError("");
    try {
      setData(await financeApi("dashboard?bank=1"));
    } catch (e) {
      setBankError(e instanceof Error ? e.message : "Bank check unavailable");
    } finally {
      setBankBusy(false);
    }
  }
  const rows = useMemo(
    () =>
      data?.rows
        .filter((r) => {
          const scope =
            view === "deposits"
              ? r.reserved > 0
              : view === "settled"
                ? r.localAdjustment > 0
                : view === "pending"
                  ? r.pendingSettlement > 0
                  : view === "unlinked"
                    ? !r.job && !r.classification
                    : view === "owed"
                      ? !r.classification &&
                        !!r.job &&
                        isJobInstalled(r.job) &&
                        r.due > 0
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
              "Awaiting settlement",
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
              (r.pendingSettlement / 100).toFixed(2),
              (r.reserved / 100).toFixed(2),
              (r.owed / 100).toFixed(2),
              (r.unconfirmed / 100).toFixed(2),
              [
                r.link.method,
                r.classification
                  ? `Owner confirmed ${r.classification.classification}: ${r.classification.reason}`
                  : "",
                ...r.issues,
              ]
                .filter(Boolean)
                .join("; "),
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
              Your cash, deposits held, and completed work still to collect.
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
              Loading payments, job status and recent bank receipts.
            </p>
          </div>
        )}
        {data && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Metric
                label="Bank less credit card"
                value={data.bankLessCreditCard ?? "Unavailable"}
                dark
                note={
                  <>
                    Operating account updated {when(data.bank.balanceUpdatedAt)}
                    {data.bank.stale ? " · Update overdue" : ""}.<br />
                    {"error" in data.creditCard ? (
                      data.creditCard.error
                    ) : (
                      <>
                        Card updated {when(data.creditCard.balanceUpdatedAt)}
                        {data.creditCard.stale ? " · Update overdue" : ""}.
                      </>
                    )}
                  </>
                }
              >
                <dl className="mt-4 space-y-2 border-t border-slate-700 pt-3 text-sm text-slate-300">
                  <div className="flex justify-between gap-3">
                    <dt>Operating account</dt>
                    <dd className="tabular-nums">
                      {money(data.bank.currentCents)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>
                      {"error" in data.creditCard
                        ? "Credit card"
                        : `${data.creditCard.name}${data.creditCard.currentCents > 0 ? " · in credit" : ""}`}
                    </dt>
                    <dd className="tabular-nums">
                      {"error" in data.creditCard
                        ? "Unavailable"
                        : `${data.creditCard.currentCents > 0 ? "+" : ""}${money(data.creditCard.currentCents)}`}
                    </dd>
                  </div>
                </dl>
              </Metric>
              <Metric
                onOpen={() => openDetail("deposits")}
                actionLabel="View deposits included in total"
                label="Deposits held for work to do"
                value={data.reserved}
                note={
                  data.unclassifiedPaid > 0
                    ? "Some received payments still need their job confirmed. This total may be incomplete."
                    : "Payments recorded in Xero for jobs not yet installed."
                }
              />
              <Metric
                onOpen={() => openDetail("owed")}
                actionLabel="View completed invoices and payments"
                label="Owed for completed jobs"
                value={data.owed}
                note={
                  <>
                    Already factors in{" "}
                    {money(data.localAdjustment + data.pendingSettlement)} in
                    payments received, awaiting reconciliation.
                    {data.unclassifiedOwed > 0 &&
                      " Some unpaid invoices still need their job confirmed."}
                  </>
                }
              />
            </div>
            {"error" in data.pendingBank ? (
              <p role="status" className="mt-4 text-sm text-amber-800">
                {data.pendingBank.error}
              </p>
            ) : (
              data.pendingBank.receipts.length > 0 && (
                <details className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
                  <summary className="cursor-pointer font-medium text-amber-900">
                    Bank payments awaiting settlement (
                    {data.pendingBank.receipts.length})
                  </summary>
                  <p className="mt-2 text-slate-600">
                    Pending entries can change. Only confidently matched invoice
                    payments reduce the amount to collect. The bank balance is
                    used as supplied by Akahu.
                  </p>
                  <ul className="mt-3 space-y-2">
                    {data.pendingBank.receipts.map((p, n) => (
                      <li key={n}>
                        {money(p.amount)} · {p.description}
                        <br />
                        <span className="text-xs text-slate-500">
                          {when(p.date)} · Bank data updated {when(p.updatedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )
            )}
            <p className="mt-5 text-xs leading-6 text-slate-500">
              NZD · Xero and job status checked {when(data.checkedAt)}.<br />
              Bank transactions updated {when(data.bank.transactionsUpdatedAt)}.
              Receipts from the past week checked; bank data is not live.
            </p>
            <details
              className="mt-8"
              open={detailsOpen}
              onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
            >
              <summary className="cursor-pointer text-sm font-semibold text-teal-800">
                View invoices and how these figures are worked out
              </summary>
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-600">
                <p>
                  Job completion comes from the CRM: installed or not installed.
                  Deposits use Xero payments. Money owed includes installed jobs
                  only, less confidently identified settled and pending receipts
                  from the past week that Xero has not yet reflected. Bank cash
                  is never increased by those receipts.
                </p>
                {data.unlinked > 0 && (
                  <p className="mt-3">
                    {data.unlinked} invoices do not yet have a confirmed CRM
                    job. They contain {money(data.unclassifiedPaid)} in recorded
                    payments and {money(data.unclassifiedOwed)} outstanding.
                    Their job status must be confirmed before those amounts can
                    be included in deposits or completed-job debt. See “Needs
                    linking” below.
                  </p>
                )}
                {data.uncertainRecentCount > 0 && (
                  <p className="mt-3">
                    Recent receipts on {data.uncertainRecentCount} invoices may
                    overlap payments already in Xero. The uncertain amount
                    remains owed until the evidence is clear.
                  </p>
                )}
                {data.staleDecisions.length > 0 && (
                  <p className="mt-3">
                    {data.staleDecisions.length} saved decisions need rechecking
                    because their supporting records changed.
                  </p>
                )}
                <p className="mt-3">
                  An invoice number or a confirmed allocation is required for a
                  bank adjustment; an amount alone is not enough. Previously
                  recorded payments may overlap recent bank receipts, even if
                  their dates differ. Where an old deposit prevents a confident
                  adjustment, the uncertain amount stays owed until Xero is
                  reconciled. Figures include GST. Refresh reads the latest
                  available data; it does not force an Akahu bank update.
                </p>
                <button
                  className={buttonClass + " mt-4"}
                  disabled={bankBusy}
                  onClick={() => void loadBank()}
                >
                  {bankBusy ? "Checking history…" : "Check older bank history"}
                </button>
                {bankError && (
                  <p role="alert" className="mt-3 text-rose-700">
                    {bankError}
                  </p>
                )}
              </div>
              <section
                ref={detailSection}
                tabIndex={-1}
                aria-label="Selected cash breakdown"
                className="mt-7 scroll-mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white outline-none"
              >
                {detailsOpen && view === "owed" && (
                  <div className="px-5 py-4">
                    <h2 className="font-semibold">
                      How the amount to collect is calculated
                    </h2>
                    <dl className="mt-4 space-y-2 border-t border-slate-200 pt-3 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt>Unpaid in Xero</dt>
                        <dd>{money(data.xeroOwed)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt>
                          <button
                            className="text-left text-teal-800 underline underline-offset-2"

                            onClick={() => openDetail("settled")}
                          >
                            Less: in bank, awaiting Xero
                          </button>
                        </dt>
                        <dd>−{money(data.localAdjustment)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt>
                          <button
                            className="text-left text-teal-800 underline underline-offset-2"

                            onClick={() => openDetail("pending")}
                          >
                            Less: pending bank settlement
                          </button>
                        </dt>
                        <dd>−{money(data.pendingSettlement)}</dd>
                      </div>
                      <div className="flex justify-between gap-3 font-semibold">
                        <dt>Still to collect</dt>
                        <dd>{money(data.owed)}</dd>
                      </div>
                    </dl>
                  </div>
                )}
                {view !== "review" && view !== "history" && (
                  <div className="border-b border-slate-200 bg-teal-50 px-5 py-4">
                    <h2 className="font-semibold text-teal-950">
                      {view === "deposits"
                        ? "Deposits included in the total"
                        : view === "owed"
                          ? "Completed invoices and payments"
                          : view === "settled"
                            ? "In the bank, awaiting Xero"
                            : view === "pending"
                              ? "Payments awaiting bank settlement"
                              : "Invoice details"}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {rows.length} {rows.length === 1 ? "invoice" : "invoices"}
                      {search ? " matching your search" : ""}
                      {["deposits", "owed", "settled", "pending"].includes(
                        view,
                      ) && (
                        <>
                          {" "}
                          ·{" "}
                          {money(
                            rows.reduce(
                              (sum, r) =>
                                sum +
                                (view === "deposits"
                                  ? r.reserved
                                  : view === "owed"
                                    ? r.owed
                                    : view === "settled"
                                      ? r.localAdjustment
                                      : r.pendingSettlement),
                              0,
                            ),
                          )}{" "}
                          {view === "deposits"
                            ? "held for work to do"
                            : view === "owed"
                              ? "still to collect"
                              : "deducted from completed-job debt"}
                        </>
                      )}
                      .
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Click an invoice to see the source amounts and matching
                      evidence.{" "}
                      {view === "deposits"
                        ? "Only payments for jobs not yet installed are included."
                        : "Xero due less the two payment deductions equals still to collect."}
                    </p>
                    <button
                      className="mt-2 text-xs font-semibold text-teal-800 underline"
                      onClick={() => openDetail("review")}
                    >
                      Review unallocated bank payments
                    </button>
                  </div>
                )}
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
                        ["settled", "Awaiting Xero"],
                        ["pending", "Pending settlement"],
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
                {view === "review" && !data.bankChecked && (
                  <div className="p-6">
                    <p className="mb-4 text-sm text-slate-600">
                      Bank history is loaded separately to keep the overview
                      fast.
                    </p>
                    <button
                      className={buttonClass}
                      disabled={bankBusy}
                      onClick={() => void loadBank()}
                    >
                      {bankBusy
                        ? "Checking bank history…"
                        : "Load bank reconciliation"}
                    </button>
                    {bankError && <p role="alert">{bankError}</p>}
                  </div>
                )}
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
                            "Deposits included",
                            "In bank, awaiting Xero",
                            "Pending settlement",
                            "Still to collect",
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
                                    {data.bankChecked
                                      ? `Bank settlement unconfirmed ${money(r.unconfirmed)}`
                                      : "Recent bank receipts checked; older settlement history is not loaded."}
                                  </p>
                                  {r.localAdjustment > 0 && (
                                    <p>
                                      Already received in bank:{" "}
                                      {money(r.localAdjustment)} deducted from
                                      this invoice.
                                    </p>
                                  )}
                                  {r.pendingSettlement > 0 && (
                                    <p className="mt-2 text-amber-800">
                                      Payment received — awaiting settlement:{" "}
                                      {money(r.pendingSettlement)}. Not counted
                                      again as settled cash.
                                    </p>
                                  )}
                                  {r.pendingEvidence.map((e) => (
                                    <p
                                      key={e.receiptId}
                                      className="mt-1 text-xs text-amber-800"
                                    >
                                      {when(e.date)} · {money(e.amount)} ·{" "}
                                      {e.description} · Pending bank entry
                                    </p>
                                  ))}
                                  {r.recentEvidence.map((e) => (
                                    <p key={e.receiptId}>
                                      {when(e.date)} · {money(e.amount)} ·{" "}
                                      {e.description} · {e.method}
                                    </p>
                                  ))}
                                  {r.classification && (
                                    <p>
                                      Owner confirmed:{" "}
                                      {r.classification.classification ===
                                      "refunded"
                                        ? "Cancelled and fully refunded"
                                        : "Not installation work"}
                                      . {r.classification.reason}
                                    </p>
                                  )}
                                  <p>{r.link.method}</p>
                                  <p>
                                    CRM: {r.job?.status || "Unknown"} · stage{" "}
                                    {r.job?.stage || "Unknown"}
                                    {r.job?.detailVerified
                                      ? " · verified from job detail"
                                      : ""}
                                  </p>
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
                                    {r.due === 0 && (
                                      <button
                                        className="font-semibold text-teal-700"
                                        onClick={() =>
                                          setTarget({
                                            kind: "classification",
                                            id: r.id,
                                          })
                                        }
                                      >
                                        Classify closed invoice
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </td>
                            <td className="max-w-56 px-5 py-4">
                              {r.classification ? (
                                <button
                                  className="text-teal-800 underline"
                                  onClick={() =>
                                    setTarget({
                                      kind: "classification",
                                      id: r.id,
                                    })
                                  }
                                >
                                  {r.classification.classification ===
                                  "refunded"
                                    ? "Cancelled · refunded"
                                    : "Not installation work"}
                                </button>
                              ) : r.job ? (
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
                              {money(r.localAdjustment)}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 tabular-nums">
                              {money(r.pendingSettlement)}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 font-medium tabular-nums">
                              {money(r.owed)}
                            </td>
                            <td className="max-w-52 px-5 py-4 text-xs leading-5 text-slate-500">
                              {r.classification
                                ? "Owner confirmed · excluded from deposits"
                                : r.pendingSettlement > 0
                                  ? "Payment received — awaiting settlement"
                                  : r.issues.length
                                    ? r.issues.join(" · ")
                                    : r.unconfirmed
                                      ? "Paid; settlement needs evidence"
                                      : r.localAdjustment > 0 ||
                                          r.allocations.length
                                        ? "Bank evidence linked"
                                        : r.paid === 0
                                          ? "No payment recorded"
                                          : "Xero payment recorded"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
                        <tr>
                          <td colSpan={2} className="px-5 py-4">
                            Total · {rows.length}{" "}
                            {rows.length === 1 ? "invoice" : "invoices"}
                            {search ? " (filtered)" : ""}
                          </td>
                          {[
                            "due",
                            "reserved",
                            "localAdjustment",
                            "pendingSettlement",
                            "owed",
                          ].map((key) => (
                            <td
                              key={key}
                              className="whitespace-nowrap px-5 py-4 tabular-nums"
                            >
                              {money(
                                rows.reduce(
                                  (sum, r) =>
                                    sum +
                                    (r.currency === "NZD"
                                      ? r[
                                          key as
                                            | "due"
                                            | "reserved"
                                            | "localAdjustment"
                                            | "pendingSettlement"
                                            | "owed"
                                        ]
                                      : 0),
                                  0,
                                ),
                              )}
                            </td>
                          ))}
                          <td className="px-5 py-4 text-xs font-normal">
                            NZD only · all matching rows
                          </td>
                        </tr>
                      </tfoot>
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
                                kind: h.key.slice(
                                  0,
                                  at,
                                ) as ReviewTarget["kind"],
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
                  (view === "review" ? receipts.length : rows.length) >
                    limit && (
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
                Headline figures cover all loaded records. Search and tabs
                filter detail only. Review decisions affect this dashboard;
                source records remain in Xero, Akahu and the CRM.
              </p>
            </details>
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
