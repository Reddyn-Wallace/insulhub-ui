"use client";

import { useCallback, useMemo, useState } from "react";
import { gql } from "@/lib/graphql";
import { readBrowserCache, writeBrowserCache } from "@/lib/client-cache";

type Person = {
  _id?: string;
  firstname?: string | null;
  lastname?: string | null;
};

type ContactDetails = {
  name?: string | null;
  streetAddress?: string | null;
  suburb?: string | null;
  city?: string | null;
  postCode?: string | null;
};

type ReportJob = {
  _id: string;
  jobNumber?: number | null;
  stage?: string | null;
  notes?: string | null;
  createdAt?: string | null;
  archivedAt?: string | null;
  acceptedAt?: string | null;
  lead?: {
    allocatedTo?: Person | null;
  } | null;
  quote?: {
    status?: string | null;
    c_total?: number | null;
    wall?: { SQM?: number | null } | null;
    ceiling?: { SQM?: number | null } | null;
  } | null;
  installation?: {
    installDate?: string | null;
    installStatus?: string | null;
  } | null;
  client?: {
    contactDetails?: ContactDetails | null;
  } | null;
};

type ReportResult = {
  leads: ReportJob[];
  sales: ReportJob[];
  installs: ReportJob[];
  upcoming: {
    unscheduled: ReportJob[];
    pencilled: ReportJob[];
    confirmed: ReportJob[];
  };
};

type InstallPlanningRow = {
  jobId: string;
  status: "confirmed" | "pencilled";
};

const REPORT_QUERY = `
  query WeeklyTeamReport($stages: [JobStage!], $skip: Int, $limit: Int) {
    jobs(stages: $stages, skip: $skip, limit: $limit) {
      total
      results {
        _id
        jobNumber
        stage
        notes
        createdAt
        archivedAt
        lead {
          allocatedTo { _id firstname lastname }
        }
        quote {
          status
          c_total
          wall { SQM }
          ceiling { SQM }
        }
        installation {
          installDate
          installStatus
        }
        client {
          contactDetails {
            name
            streetAddress
            suburb
            city
            postCode
          }
        }
      }
    }
  }
`;

const ACCEPTED_AT_QUERY = `
  query WeeklyTeamReportAcceptedAt($_id: ObjectId!) {
    job(_id: $_id) {
      _id
      acceptedAt
    }
  }
`;

const REPORT_STAGES = ["LEAD", "QUOTE", "SCHEDULED", "INSTALLATION", "INVOICE", "COMPLETED"];
const SCHEDULED_STAGES = new Set(["SCHEDULED", "INSTALLATION", "INVOICE"]);
const INSTALL_REPORT_STAGES = new Set(["SCHEDULED", "INSTALLATION", "INVOICE", "COMPLETED"]);
const REPORT_RESULT_CACHE_PREFIX = "report:weekly-sales-usage:v2:";
const ACCEPTED_AT_CACHE_KEY = "report:weekly-sales-usage:accepted-at:v1";
const ACCEPTED_AT_CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const ACCEPTED_AT_FETCH_CONCURRENCY = 32;
const CURRENT_WEEK_TTL_MS = 5 * 60 * 1000;
const PREVIOUS_WEEK_TTL_MS = 30 * 60 * 1000;
const reportResultRequests = new Map<string, Promise<ReportResult>>();

function todayNzKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function defaultFromDate(today: string): string {
  const day = new Date(`${today}T00:00:00`).getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(today, mondayOffset);
}

function weekRangeFor(key: string): { fromDate: string; toDate: string } {
  const fromDate = defaultFromDate(key);
  return { fromDate, toDate: addDays(fromDate, 6) };
}

function reportResultCacheKey(fromDate: string, toDate: string): string {
  return `${REPORT_RESULT_CACHE_PREFIX}${fromDate}:${toDate}`;
}

function reportResultTtlMs(fromDate: string, toDate: string, today: string): number {
  const currentWeek = weekRangeFor(today);
  if (fromDate === currentWeek.fromDate && toDate >= currentWeek.fromDate && toDate <= currentWeek.toDate) {
    return CURRENT_WEEK_TTL_MS;
  }
  return PREVIOUS_WEEK_TTL_MS;
}

function toNzDateKey(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

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

function parseInstallMetaStatus(notes?: string | null): "confirmed" | "pencilled" | null {
  const text = notes || "";
  const start = text.indexOf("[INSTALL_META]");
  const end = text.indexOf("[/INSTALL_META]");
  if (start === -1 || end === -1 || end < start) return null;
  const body = text.slice(start, end);
  const statusMatch = body.match(/^status:\s*(.+)$/im);
  return statusMatch?.[1]?.trim().toLowerCase() === "pencilled" ? "pencilled" : "confirmed";
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function isAcceptedJob(job: ReportJob): boolean {
  const status = (job.quote?.status || "").toUpperCase();
  return status === "ACCEPTED" || status === "INSTALL" || SCHEDULED_STAGES.has(job.stage || "");
}

function isActivePipelineJob(job: ReportJob): boolean {
  return SCHEDULED_STAGES.has(job.stage || "")
    && !["INSTALLED_AS_QUOTED", "INSTALLED_WITH_VARIATIONS_FROM_QUOTE"].includes(job.installation?.installStatus || "");
}

async function fetchInstallPlanningStatuses(jobIds: string[]): Promise<Record<string, "confirmed" | "pencilled">> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  if (!token || jobIds.length === 0) return {};

  const params = new URLSearchParams({ jobIds: jobIds.join(",") });
  const response = await fetch(`/api/install-planning?${params.toString()}`, {
    headers: { "x-access-token": token },
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json?.error || "Failed to load install planning");

  const statuses: Record<string, "confirmed" | "pencilled"> = {};
  for (const row of (json.planning || []) as InstallPlanningRow[]) {
    statuses[row.jobId] = row.status;
  }
  return statuses;
}

async function hydrateAcceptedDates(jobs: ReportJob[]): Promise<ReportJob[]> {
  const candidates = jobs.filter(isAcceptedJob);
  if (candidates.length === 0) return jobs;

  const cached = readBrowserCache<Record<string, string>>(
    ACCEPTED_AT_CACHE_KEY,
    ACCEPTED_AT_CACHE_TTL_MS,
    "local"
  ) ?? {};

  const acceptedAtById = new Map<string, string | null | undefined>();
  const missing: ReportJob[] = [];

  for (const job of candidates) {
    const acceptedAt = cached[job._id];
    if (acceptedAt) {
      acceptedAtById.set(job._id, acceptedAt);
    } else {
      missing.push(job);
    }
  }

  if (missing.length === 0) {
    return jobs.map((job) => acceptedAtById.has(job._id)
      ? { ...job, acceptedAt: acceptedAtById.get(job._id) }
      : job);
  }

  let cacheChanged = false;

  for (let i = 0; i < missing.length; i += ACCEPTED_AT_FETCH_CONCURRENCY) {
    const batch = missing.slice(i, i + ACCEPTED_AT_FETCH_CONCURRENCY);
    const detailResults = await Promise.allSettled(
      batch.map((job) => gql<{ job: Pick<ReportJob, "_id" | "acceptedAt"> }>(ACCEPTED_AT_QUERY, { _id: job._id }))
    );

    for (const result of detailResults) {
      if (result.status === "fulfilled" && result.value.job?._id) {
        acceptedAtById.set(result.value.job._id, result.value.job.acceptedAt);
        if (result.value.job.acceptedAt) {
          cached[result.value.job._id] = result.value.job.acceptedAt;
          cacheChanged = true;
        }
      }
    }
  }

  if (cacheChanged) writeBrowserCache(ACCEPTED_AT_CACHE_KEY, cached, "local");
  if (acceptedAtById.size === 0) return jobs;
  return jobs.map((job) => acceptedAtById.has(job._id)
    ? { ...job, acceptedAt: acceptedAtById.get(job._id) }
    : job);
}

async function buildReport(fromDate: string, toDate: string): Promise<ReportResult> {
  const data = await gql<{ jobs: { results: ReportJob[] } }>(REPORT_QUERY, {
    stages: REPORT_STAGES,
    skip: 0,
    limit: 5000,
  }, {
    cacheKey: "report:weekly-team:v6:jobs",
    ttlMs: 5 * 60 * 1000,
  });

  const allJobs = await hydrateAcceptedDates((data.jobs.results || []).filter((job) => !job.archivedAt));
  const leads = allJobs
    .filter((job) => {
      const key = toNzDateKey(job.createdAt);
      return !!key && key >= fromDate && key <= toDate;
    })
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

  const sales = allJobs
    .filter((job) => {
      const status = (job.quote?.status || "").toUpperCase();
      const key = toNzDateKey(job.acceptedAt);
      return (status === "ACCEPTED" || status === "INSTALL" || SCHEDULED_STAGES.has(job.stage || ""))
        && !!key
        && key >= fromDate
        && key <= toDate;
    })
    .sort((a, b) => (toNzDateKey(a.acceptedAt)).localeCompare(toNzDateKey(b.acceptedAt)));

  const installs = allJobs
    .filter((job) => {
      const key = toNzDateKey(job.installation?.installDate);
      return INSTALL_REPORT_STAGES.has(job.stage || "")
        && !!key
        && key >= fromDate
        && key <= toDate;
    })
    .sort((a, b) => (a.installation?.installDate || "").localeCompare(b.installation?.installDate || ""));

  const upcomingJobs = allJobs.filter(isActivePipelineJob);
  const upcomingWithDates = upcomingJobs.filter((job) => !!toNzDateKey(job.installation?.installDate));
  const planningStatuses = await fetchInstallPlanningStatuses(upcomingWithDates.map((job) => job._id));
  const upcoming = {
    unscheduled: upcomingJobs.filter((job) => !toNzDateKey(job.installation?.installDate)),
    pencilled: upcomingWithDates.filter((job) => (planningStatuses[job._id] || parseInstallMetaStatus(job.notes)) === "pencilled"),
    confirmed: upcomingWithDates.filter((job) => (planningStatuses[job._id] || parseInstallMetaStatus(job.notes) || "confirmed") === "confirmed"),
  };

  return { leads, sales, installs, upcoming };
}

async function getReportForRange(fromDate: string, toDate: string, today: string): Promise<ReportResult> {
  const cacheKey = reportResultCacheKey(fromDate, toDate);
  const ttlMs = reportResultTtlMs(fromDate, toDate, today);
  const cached = readBrowserCache<ReportResult>(cacheKey, ttlMs);
  if (cached) return cached;

  const existing = reportResultRequests.get(cacheKey);
  if (existing) return existing;

  const request = buildReport(fromDate, toDate)
    .then((report) => {
      writeBrowserCache(cacheKey, report);
      return report;
    })
    .finally(() => reportResultRequests.delete(cacheKey));

  reportResultRequests.set(cacheKey, request);
  return request;
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

  const runReport = useCallback(async () => {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      setResult(await getReportForRange(fromDate, toDate, today));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load weekly report");
    } finally {
      setLoading(false);
    }
  }, [fromDate, today, toDate]);

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

            <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
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
            </div>
          </div>

          {dateRangeInvalid && <p className="mt-2 text-xs font-medium text-red-600">From date must be before or equal to To date.</p>}
          {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
          {loading && (
            <p className="mt-2 text-xs font-medium text-gray-500">
              First run may take a minute while accepted dates are cached.
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
