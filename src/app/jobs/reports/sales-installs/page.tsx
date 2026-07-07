"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  defaultFromDate,
  todayNzKey,
  toNzDateKey,
  type ContactDetails,
  type Person,
  type ReportJob,
  type ReportResponse,
  type ReportResult,
} from "@/lib/reports/sales-installs-types";

function shortDate(key: string): string {
  if (!key) return "";
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-NZ", {
    day: "2-digit",
    month: "short",
  }).format(new Date(year, month - 1, day));
}

function formatInstallDate(iso?: string | null): string {
  const key = toNzDateKey(iso);
  return key ? shortDate(key) : "-";
}

function weekdayLabel(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-NZ", { weekday: "short" }).format(new Date(year, month - 1, day));
}

function daysInRange(fromDate: string, toDate: string): string[] {
  const days: string[] = [];
  for (let key = fromDate; key <= toDate; key = addDays(key, 1)) {
    days.push(key);
  }
  return days;
}

function jobSqm(job: ReportJob): number {
  return (job.quote?.wall?.SQM ?? 0) + (job.quote?.ceiling?.SQM ?? 0);
}

function formatNzd(amount: number): string {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatSqm(sqm: number): string {
  return `${new Intl.NumberFormat("en-NZ", {
    minimumFractionDigits: sqm > 0 && sqm < 10 ? 1 : 0,
    maximumFractionDigits: 1,
  }).format(sqm)} m²`;
}

function fullName(person?: Person | null): string {
  return [person?.firstname, person?.lastname].filter(Boolean).join(" ").trim();
}

function salesperson(job: ReportJob): string {
  return fullName(job.lead?.allocatedTo) || "Unallocated";
}

function fullAddress(contact?: ContactDetails | null): string {
  return [contact?.streetAddress, contact?.suburb, contact?.city, contact?.postCode].filter(Boolean).join(", ");
}

function installStatusLabel(status?: string | null): string {
  if (status === "JOB_NOT_STARTED_YET") return "Not started";
  if (status === "INSTALLED_AS_QUOTED") return "Installed";
  if (status === "INSTALLED_WITH_VARIATIONS_FROM_QUOTE") return "Variation";
  if (!status) return "Not set";
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

async function fetchReport(fromDate: string, toDate: string, refresh = false): Promise<ReportResponse> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  if (!token) throw new Error("Unauthorized");

  const params = new URLSearchParams({ from: fromDate, to: toDate });
  if (refresh) params.set("refresh", "1");

  const response = await fetch(`/api/reports/sales-installs?${params.toString()}`, {
    headers: { "x-access-token": token },
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json?.error || "Failed to load weekly report");
  return json as ReportResponse;
}

async function warmReports() {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  if (!token) return;

  await fetch("/api/reports/sales-installs/warm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-token": token,
    },
    body: JSON.stringify({}),
  }).catch(() => undefined);
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "brand" | "orange" | "neutral";
}) {
  return (
    <div className={classNames(
      "rounded-xl border px-4 py-3 shadow-sm",
      tone === "brand" && "border-[#1a3a4a] bg-[#1a3a4a] text-white",
      tone === "orange" && "border-[#e85d04]/20 bg-orange-50 text-gray-950",
      tone === "neutral" && "border-gray-100 bg-white text-gray-950"
    )}>
      <div className={classNames("text-[10px] font-semibold uppercase tracking-widest", tone === "brand" ? "text-white/70" : "text-gray-500")}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
      {detail && <div className={classNames("mt-0.5 text-xs", tone === "brand" ? "text-white/70" : "text-gray-500")}>{detail}</div>}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-gray-950">{title}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function EmptyBlock({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-5 text-center text-xs font-medium text-gray-500">
      {label}
    </div>
  );
}

function LeadsChart({ days, leads }: { days: string[]; leads: ReportJob[] }) {
  const counts = days.map((key) => ({
    key,
    count: leads.filter((lead) => toNzDateKey(lead.createdAt) === key).length,
  }));
  const max = Math.max(1, ...counts.map((point) => point.count));

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3">
      <div className="flex h-32 items-end gap-2">
        {counts.map((point) => {
          const height = point.count === 0 ? 4 : Math.max(18, (point.count / max) * 104);
          return (
            <div key={point.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div className="flex h-24 w-full items-end justify-center rounded-md bg-white px-1">
                <div
                  className={classNames(
                    "w-full max-w-8 rounded-t-md",
                    point.count > 0 ? "bg-[#e85d04]" : "bg-gray-200"
                  )}
                  style={{ height: `${height}px` }}
                  title={`${point.count} leads`}
                />
              </div>
              <div className="text-center leading-tight">
                <div className="text-[10px] font-bold text-gray-700">{point.count}</div>
                <div className="text-[10px] font-medium text-gray-400">{weekdayLabel(point.key)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompactTable({
  headers,
  children,
}: {
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-100">
      <table className="w-full table-fixed border-collapse text-left text-xs">
        <thead className="bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-3 py-2">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export default function SalesInstallsPage() {
  const today = useMemo(() => todayNzKey(), []);
  const [fromDate, setFromDate] = useState(() => defaultFromDate(today));
  const [toDate, setToDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReportResult | null>(null);
  const [cacheInfo, setCacheInfo] = useState<ReportResponse["cache"] | null>(null);

  useEffect(() => {
    void warmReports();
  }, []);

  const loadReport = useCallback(async (refresh = false) => {
    setLoading(true);
    setError("");
    setResult(null);
    setCacheInfo(null);

    try {
      const response = await fetchReport(fromDate, toDate, refresh);
      setResult(response.report);
      setCacheInfo(response.cache);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load weekly report");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  const runReport = useCallback(() => {
    void loadReport(false);
  }, [loadReport]);

  const refreshReport = useCallback(() => {
    void loadReport(true);
  }, [loadReport]);

  const dateRangeInvalid = !!fromDate && !!toDate && fromDate > toDate;
  const days = useMemo(() => daysInRange(fromDate, toDate), [fromDate, toDate]);
  const leadCount = result?.leads.length || 0;
  const salesCount = result?.sales.length || 0;
  const salesSqm = result?.sales.reduce((sum, job) => sum + jobSqm(job), 0) || 0;
  const salesTotal = result?.sales.reduce((sum, job) => sum + (job.quote?.c_total || 0), 0) || 0;
  const installCount = result?.installs.length || 0;
  const installSqm = result?.installs.reduce((sum, job) => sum + jobSqm(job), 0) || 0;
  const installTotal = result?.installs.reduce((sum, job) => sum + (job.quote?.c_total || 0), 0) || 0;
  const upcoming = result?.upcoming;
  const hasResults = result !== null;

  return (
    <div className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
      <div className="mx-auto max-w-7xl px-3 py-4">
        <div className="mb-4 rounded-xl border border-[#1a3a4a]/10 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-[#e85d04]">Team report</div>
              <h1 className="mt-0.5 text-xl font-bold tracking-tight text-gray-950">Weekly Sales & Usage</h1>
              <p className="mt-1 text-xs text-gray-500">
                {shortDate(fromDate)} to {shortDate(toDate)} · leads by created date, quotes by accepted date, installs by install date.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 lg:grid-cols-[1fr_1fr_auto_auto]">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">From</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1a3a4a]/20"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">To</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1a3a4a]/20"
                />
              </div>
              <button
                onClick={runReport}
                disabled={loading || !fromDate || !toDate || dateRangeInvalid}
                className="self-end rounded-lg bg-[#1a3a4a] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#14313f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Building..." : "Run report"}
              </button>
              <button
                onClick={refreshReport}
                disabled={loading || !fromDate || !toDate || dateRangeInvalid}
                className="self-end rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Refresh
              </button>
            </div>
          </div>

          {dateRangeInvalid && <p className="mt-2 text-xs font-medium text-red-600">From date must be before or equal to To date.</p>}
          {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
          {loading && (
            <p className="mt-2 text-xs font-medium text-gray-500">
              Preparing the shared report cache.
            </p>
          )}
          {cacheInfo && (
            <p className="mt-2 text-xs font-medium text-gray-500">
              {cacheInfo.status === "hit" ? "Loaded from shared cache" : cacheInfo.status === "refresh" ? "Refreshed from InsulHub" : "Built and cached"}.
              {" "}Cache expires {new Intl.DateTimeFormat("en-NZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(cacheInfo.expiresAt))}.
            </p>
          )}
        </div>

        {!hasResults && (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-10 text-center shadow-sm">
            <div className="text-sm font-semibold text-gray-900">Choose a date range and run the report.</div>
            <p className="mt-1 text-xs text-gray-500">It is built for short weekly ranges so the whole summary screenshots cleanly.</p>
          </div>
        )}

        {hasResults && (
          <div className="grid gap-4 xl:grid-cols-3">
            <Section title="Leads" subtitle="Newly created leads by day">
              <div className="mb-3">
                <MetricCard label="New leads" value={String(leadCount)} tone="brand" />
              </div>
              {leadCount > 0 ? <LeadsChart days={days} leads={result.leads} /> : <EmptyBlock label="No new leads in this range." />}
            </Section>

            <Section title="Sales" subtitle="Accepted quotes by accepted date">
              <div className="mb-3 grid grid-cols-3 gap-2">
                <MetricCard label="Accepted" value={String(salesCount)} tone="brand" />
                <MetricCard label="SQM" value={formatSqm(salesSqm)} />
                <MetricCard label="Value" value={formatNzd(salesTotal)} tone="orange" />
              </div>
              {salesCount > 0 ? (
                <CompactTable headers={["Address", "SQM", "$", "Salesperson"]}>
                  {result.sales.map((job) => (
                    <tr key={job._id} className="align-top">
                      <td className="px-3 py-2 text-gray-500 truncate">{fullAddress(job.client?.contactDetails) || "-"}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{formatSqm(jobSqm(job))}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{formatNzd(job.quote?.c_total || 0)}</td>
                      <td className="px-3 py-2 text-gray-500 truncate">{salesperson(job)}</td>
                    </tr>
                  ))}
                </CompactTable>
              ) : (
                <EmptyBlock label="No accepted quotes in this range." />
              )}
            </Section>

            <Section title="Installs" subtitle="Jobs scheduled for install">
              <div className="mb-3 grid grid-cols-3 gap-2">
                <MetricCard label="Scheduled" value={String(installCount)} tone="brand" />
                <MetricCard label="SQM" value={formatSqm(installSqm)} />
                <MetricCard label="Value" value={formatNzd(installTotal)} tone="orange" />
              </div>
              {installCount > 0 ? (
                <CompactTable headers={["Address", "Install", "SQM", "Status"]}>
                  {result.installs.map((job) => (
                    <tr key={job._id} className="align-top">
                      <td className="px-3 py-2 text-gray-500 truncate">{fullAddress(job.client?.contactDetails) || "-"}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{formatInstallDate(job.installation?.installDate)}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{formatSqm(jobSqm(job))}</td>
                      <td className="px-3 py-2">
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-semibold text-gray-700">
                          {installStatusLabel(job.installation?.installStatus)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </CompactTable>
              ) : (
                <EmptyBlock label="No scheduled installs in this range." />
              )}
            </Section>

            <section className="rounded-xl border border-[#1a3a4a]/10 bg-white p-4 shadow-sm xl:col-span-3">
              <div className="mb-3">
                <h2 className="text-sm font-bold text-gray-950">Upcoming</h2>
                <p className="mt-0.5 text-xs text-gray-500">Accepted work still moving toward install.</p>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <MetricCard
                  label="Unscheduled"
                  value={String(upcoming?.unscheduled.length || 0)}
                  detail="accepted, no install date"
                  tone="orange"
                />
                <MetricCard
                  label="Pencilled"
                  value={String(upcoming?.pencilled.length || 0)}
                  detail="install date pencilled"
                />
                <MetricCard
                  label="Confirmed"
                  value={String(upcoming?.confirmed.length || 0)}
                  detail="install date confirmed"
                  tone="brand"
                />
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
