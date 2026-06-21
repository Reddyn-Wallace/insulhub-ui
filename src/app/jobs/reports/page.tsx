"use client";

import { useMemo, useState } from "react";
import { gql } from "@/lib/graphql";

type UsageJob = {
  _id: string;
  jobNumber: number;
  stage: string;
  installation?: {
    installDate?: string | null;
    installStatus?: string | null;
    installNote?: string | null;
  };
  quote?: {
    wall?: {
      c_bagCount?: number | null;
      SQM?: number | null;
    } | null;
  } | null;
  client?: {
    contactDetails?: {
      name?: string;
      streetAddress?: string;
      suburb?: string;
      city?: string;
      postCode?: string;
    };
  };
  installerChecksheet?: {
    budgetBags?: number | null;
    actualBags?: number | null;
    wallAreaQuoted?: number | null;
    wallAreaInstalled?: number | null;
    commentsOrIssues?: string | null;
  };
};

type UsageJobsResponse = {
  jobs: {
    total: number;
    results: UsageJob[];
  };
};

type SortKey = "date" | "variance" | "actual" | "job";
type QuickFilter = "all" | "over" | "under" | "variation" | "missing" | "notes";

type UsageRow = {
  job: UsageJob;
  dateKey: string;
  installTs: number;
  customer: string;
  address: string;
  statusLabel: string;
  isVariation: boolean;
  budget: number | null;
  actual: number | null;
  variance: number | null;
  variancePct: number | null;
  wallAreaInstalled: number | null;
  intensity: number | null;
  installNote: string;
  commentsOrIssues: string;
  hasNotes: boolean;
};

const INSTALLED_STATUSES = ["INSTALLED_AS_QUOTED", "INSTALLED_WITH_VARIATIONS_FROM_QUOTE"];

const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "over", label: "Over budget" },
  { key: "under", label: "Under budget" },
  { key: "variation", label: "Variations" },
  { key: "missing", label: "Missing data" },
  { key: "notes", label: "Notes" },
];

const USAGE_JOBS_QUERY = `
  query UsageJobs($stages: [JobStage!], $skip: Int, $limit: Int) {
    jobs(stages: $stages, skip: $skip, limit: $limit) {
      total
      results {
        _id
        jobNumber
        stage
        installation {
          installDate
          installStatus
          installNote
        }
        quote {
          wall {
            c_bagCount
            SQM
          }
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
        installerChecksheet {
          budgetBags
          actualBags
          wallAreaQuoted
          wallAreaInstalled
          commentsOrIssues
        }
      }
    }
  }
`;

function toDateKeyNz(iso?: string | null) {
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

function todayNzKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function monthStartKey(key: string) {
  return `${key.slice(0, 8)}01`;
}

function parseDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(key: string, days: number) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return dateKeyFromLocalDate(d);
}

function dateKeyFromLocalDate(d: Date) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysBetween(from: string, to: string) {
  const start = parseDateKey(from).getTime();
  const end = parseDateKey(to).getTime();
  return Math.max(0, Math.round((end - start) / 86400000));
}

function formatNzDate(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

function formatNumber(value: number | null | undefined, digits = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-NZ", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatSigned(value: number | null | undefined, digits = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value, digits)}`;
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value, 1)}%`;
}

function fullAddress(contact?: { streetAddress?: string; suburb?: string; city?: string; postCode?: string }) {
  return [contact?.streetAddress, contact?.suburb, contact?.city, contact?.postCode].filter(Boolean).join(", ");
}

function statusLabel(status?: string | null) {
  if (status === "INSTALLED_WITH_VARIATIONS_FROM_QUOTE") return "Variation";
  if (status === "INSTALLED_AS_QUOTED") return "As quoted";
  return status || "Unknown";
}

function jobHref(jobId: string) {
  return `/jobs/${jobId}`;
}

function cleanText(value?: string | null) {
  return (value || "").trim();
}

function rowFromJob(job: UsageJob): UsageRow | null {
  const dateKey = toDateKeyNz(job.installation?.installDate);
  if (!dateKey) return null;

  const budget = typeof job.installerChecksheet?.budgetBags === "number"
    ? job.installerChecksheet.budgetBags
    : typeof job.quote?.wall?.c_bagCount === "number"
      ? job.quote.wall.c_bagCount
      : null;
  const actual = typeof job.installerChecksheet?.actualBags === "number" ? job.installerChecksheet.actualBags : null;
  const variance = typeof actual === "number" && typeof budget === "number" ? actual - budget : null;
  const variancePct = typeof variance === "number" && typeof budget === "number" && budget !== 0
    ? (variance / budget) * 100
    : null;
  const wallAreaInstalled = typeof job.installerChecksheet?.wallAreaInstalled === "number"
    ? job.installerChecksheet.wallAreaInstalled
    : null;
  const intensity = typeof actual === "number" && typeof wallAreaInstalled === "number" && wallAreaInstalled > 0
    ? actual / wallAreaInstalled
    : null;
  const installNote = cleanText(job.installation?.installNote);
  const commentsOrIssues = cleanText(job.installerChecksheet?.commentsOrIssues);

  return {
    job,
    dateKey,
    installTs: new Date(job.installation?.installDate || 0).getTime(),
    customer: job.client?.contactDetails?.name || "Unnamed customer",
    address: fullAddress(job.client?.contactDetails),
    statusLabel: statusLabel(job.installation?.installStatus),
    isVariation: job.installation?.installStatus === "INSTALLED_WITH_VARIATIONS_FROM_QUOTE",
    budget,
    actual,
    variance,
    variancePct,
    wallAreaInstalled,
    intensity,
    installNote,
    commentsOrIssues,
    hasNotes: Boolean(installNote || commentsOrIssues),
  };
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function KpiCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "good" | "warn" | "bad" | "brand";
}) {
  const tones = {
    neutral: "border-gray-100 bg-white text-gray-900",
    good: "border-emerald-100 bg-emerald-50 text-emerald-800",
    warn: "border-amber-100 bg-amber-50 text-amber-800",
    bad: "border-red-100 bg-red-50 text-red-800",
    brand: "border-[#1a3a4a]/10 bg-[#1a3a4a] text-white",
  };

  return (
    <div className={classNames("rounded-xl border px-4 py-3 shadow-sm", tones[tone])}>
      <div className={classNames("text-[11px] font-semibold uppercase tracking-wide", tone === "brand" ? "text-white/70" : "text-gray-500")}>{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
      {detail && <div className={classNames("mt-1 text-xs", tone === "brand" ? "text-white/75" : "text-gray-500")}>{detail}</div>}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-gray-100 rounded-xl p-4 md:p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-sm font-bold text-gray-900">{title}</h2>
        {subtitle && <p className="mt-1 text-xs text-gray-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function ProgressBar({
  label,
  value,
  max,
  color,
  meta,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  meta?: string;
}) {
  const width = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-gray-700">{label}</span>
        <span className="text-gray-500">{meta ?? formatNumber(value)}</span>
      </div>
      <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
        <div className={classNames("h-full rounded-full", color)} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function TrendBars({ points }: { points: { label: string; count: number; budget: number; actual: number }[] }) {
  const max = Math.max(1, ...points.map((p) => Math.max(p.count, p.actual, p.budget)));

  if (points.length === 0) {
    return <div className="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">No installs in this range.</div>;
  }

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-full items-end gap-2" style={{ minWidth: Math.max(560, points.length * 36) }}>
        {points.map((point) => {
          const height = Math.max(12, Math.round((point.actual / max) * 140));
          const budgetHeight = Math.max(8, Math.round((point.budget / max) * 140));
          return (
            <div key={point.label} className="flex flex-1 min-w-7 flex-col items-center gap-2">
              <div className="relative flex h-36 w-full items-end justify-center rounded-lg bg-gray-50 px-1">
                <div className="absolute bottom-0 w-2 rounded-t bg-[#1a3a4a]/25" style={{ height: `${budgetHeight}px` }} title={`Budget: ${formatNumber(point.budget)}`} />
                <div className="relative w-3 rounded-t bg-[#e85d04]" style={{ height: `${height}px` }} title={`Actual: ${formatNumber(point.actual)}`} />
              </div>
              <div className="text-center">
                <div className="text-[10px] font-semibold text-gray-500">{point.label}</div>
                <div className="text-[10px] text-gray-400">{point.count} jobs</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SortButton({
  label,
  sortKey,
  activeSort,
  descending,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  activeSort: SortKey;
  descending: boolean;
  onClick: (key: SortKey) => void;
}) {
  const active = activeSort === sortKey;
  return (
    <button
      type="button"
      onClick={() => onClick(sortKey)}
      className={classNames(
        "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
        active ? "border-[#1a3a4a] bg-[#1a3a4a] text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
      )}
    >
      {label}{active ? (descending ? " ↓" : " ↑") : ""}
    </button>
  );
}

export default function ReportsPage() {
  const today = useMemo(() => todayNzKey(), []);
  const [fromDate, setFromDate] = useState(() => monthStartKey(today));
  const [toDate, setToDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDescending, setSortDescending] = useState(true);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");

  async function runReport() {
    setLoading(true);
    setError("");
    setRows(null);

    try {
      const data = await gql<UsageJobsResponse>(USAGE_JOBS_QUERY, {
        stages: ["INSTALLATION", "INVOICE", "COMPLETED"],
        skip: 0,
        limit: 5000,
      }, {
        cacheKey: "report:usage-jobs",
        ttlMs: 5 * 60 * 1000,
      });

      const installedJobs = (data.jobs.results || [])
        .filter((job) => INSTALLED_STATUSES.includes(job.installation?.installStatus || ""));

      const nextRows = installedJobs
        .map(rowFromJob)
        .filter((row): row is UsageRow => Boolean(row))
        .filter((row) => row.dateKey >= fromDate && row.dateKey <= toDate)
        .sort((a, b) => a.installTs - b.installTs);

      setRows(nextRows);
      setQuickFilter("all");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage dashboard");
    } finally {
      setLoading(false);
    }
  }

  function handleSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDescending((v) => !v);
    } else {
      setSortKey(nextKey);
      setSortDescending(nextKey !== "job");
    }
  }

  const dateRangeInvalid = !!fromDate && !!toDate && fromDate > toDate;

  const metrics = useMemo(() => {
    const reportRows = rows || [];
    const completeRows = reportRows.filter((row) => typeof row.budget === "number" && typeof row.actual === "number");
    const totalBudget = completeRows.reduce((sum, row) => sum + (row.budget || 0), 0);
    const totalActual = completeRows.reduce((sum, row) => sum + (row.actual || 0), 0);
    const netVariance = totalActual - totalBudget;
    const variancePct = totalBudget > 0 ? (netVariance / totalBudget) * 100 : null;
    const missingBudget = reportRows.filter((row) => typeof row.budget !== "number").length;
    const missingActual = reportRows.filter((row) => typeof row.actual !== "number").length;
    const missingChecksheetValues = reportRows.filter((row) => typeof row.budget !== "number" || typeof row.actual !== "number").length;
    const variationCount = reportRows.filter((row) => row.isVariation).length;
    const intensityRows = reportRows.filter((row) => typeof row.intensity === "number");
    const avgIntensity = intensityRows.length
      ? intensityRows.reduce((sum, row) => sum + (row.intensity || 0), 0) / intensityRows.length
      : null;
    const under = completeRows.filter((row) => (row.variance || 0) < 0).length;
    const over = completeRows.filter((row) => (row.variance || 0) > 0).length;
    const onBudget = completeRows.filter((row) => (row.variance || 0) === 0).length;

    return {
      totalBudget,
      totalActual,
      netVariance,
      variancePct,
      missingBudget,
      missingActual,
      missingChecksheetValues,
      variationCount,
      variationPct: reportRows.length ? (variationCount / reportRows.length) * 100 : null,
      avgIntensity,
      intensityCoverage: intensityRows.length,
      under,
      over,
      onBudget,
      completeRows,
    };
  }, [rows]);

  const trendPoints = useMemo(() => {
    if (!rows || rows.length === 0) return [];
    const span = daysBetween(fromDate, toDate);
    const weekly = span > 31;
    const buckets = new Map<string, { label: string; count: number; budget: number; actual: number }>();

    if (weekly) {
      for (const row of rows) {
        const index = Math.floor(daysBetween(fromDate, row.dateKey) / 7);
        const start = addDays(fromDate, index * 7);
        const end = addDays(start, 6);
        const label = `${start.slice(5)}-${end.slice(5)}`;
        const bucket = buckets.get(label) || { label, count: 0, budget: 0, actual: 0 };
        bucket.count += 1;
        bucket.budget += row.budget || 0;
        bucket.actual += row.actual || 0;
        buckets.set(label, bucket);
      }
      return Array.from(buckets.values());
    }

    for (let key = fromDate; key <= toDate; key = addDays(key, 1)) {
      buckets.set(key, { label: key.slice(5), count: 0, budget: 0, actual: 0 });
    }
    for (const row of rows) {
      const bucket = buckets.get(row.dateKey);
      if (!bucket) continue;
      bucket.count += 1;
      bucket.budget += row.budget || 0;
      bucket.actual += row.actual || 0;
    }
    return Array.from(buckets.values());
  }, [fromDate, rows, toDate]);

  const varianceCallouts = useMemo(() => {
    const completeRows = metrics.completeRows;
    return {
      highest: [...completeRows].sort((a, b) => (b.variance || 0) - (a.variance || 0)).slice(0, 3),
      lowest: [...completeRows].sort((a, b) => (a.variance || 0) - (b.variance || 0)).slice(0, 3),
      explained: (rows || [])
        .filter((row) => row.hasNotes && (row.isVariation || (row.variance !== null && row.variance !== 0)))
        .sort((a, b) => Math.abs(b.variance || 0) - Math.abs(a.variance || 0))
        .slice(0, 5),
    };
  }, [metrics.completeRows, rows]);

  const filteredRows = useMemo(() => {
    const reportRows = rows || [];
    const filtered = reportRows.filter((row) => {
      if (quickFilter === "over") return (row.variance || 0) > 0;
      if (quickFilter === "under") return (row.variance || 0) < 0;
      if (quickFilter === "variation") return row.isVariation;
      if (quickFilter === "missing") return typeof row.budget !== "number" || typeof row.actual !== "number";
      if (quickFilter === "notes") return row.hasNotes;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === "job") return a.job.jobNumber - b.job.jobNumber;
      if (sortKey === "date") return a.installTs - b.installTs;
      if (sortKey === "actual") return (a.actual ?? -Infinity) - (b.actual ?? -Infinity);
      return (a.variance ?? -Infinity) - (b.variance ?? -Infinity);
    });
    return sortDescending ? sorted.reverse() : sorted;
  }, [quickFilter, rows, sortDescending, sortKey]);

  const maxUsage = Math.max(metrics.totalActual, metrics.totalBudget, 1);
  const distributionMax = Math.max(metrics.under, metrics.onBudget, metrics.over, 1);
  const hasResults = rows !== null;

  return (
    <div className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
      <div className="mx-auto max-w-7xl px-4 py-5">
        <div className="mb-5 rounded-xl border border-[#1a3a4a]/10 bg-white p-4 shadow-sm md:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-widest text-[#e85d04]">Reports</div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-950">Usage Dashboard</h1>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">
                Installed jobs by NZ install date, comparing budgeted bags with actual usage and the notes behind any movement.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_160px_auto]">
              <div>
                <label className="text-xs font-medium text-gray-500">From date</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1a3a4a]/20"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">To date</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1a3a4a]/20"
                />
              </div>
              <button
                onClick={runReport}
                disabled={loading || !fromDate || !toDate || dateRangeInvalid}
                className="self-end rounded-lg bg-[#1a3a4a] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#14313f] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Loading..." : "Run dashboard"}
              </button>
            </div>
          </div>

          {dateRangeInvalid && <p className="mt-3 text-xs font-medium text-red-600">From date must be before or equal to To date.</p>}
          {error && <p className="mt-3 text-xs font-medium text-red-600">{error}</p>}
        </div>

        {!hasResults && (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-12 text-center shadow-sm">
            <div className="text-sm font-semibold text-gray-900">Choose a date range and run the dashboard.</div>
            <p className="mt-1 text-sm text-gray-500">The report will include installed jobs from Installation, Invoice, and Completed stages.</p>
          </div>
        )}

        {hasResults && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
              <KpiCard label="Installed jobs" value={String(rows.length)} detail={`${fromDate} to ${toDate}`} tone="brand" />
              <KpiCard label="Budget bags" value={formatNumber(metrics.totalBudget)} detail="complete rows only" />
              <KpiCard label="Actual bags" value={formatNumber(metrics.totalActual)} detail="complete rows only" />
              <KpiCard
                label="Net variance"
                value={formatSigned(metrics.netVariance)}
                detail={formatPercent(metrics.variancePct)}
                tone={metrics.netVariance > 0 ? "bad" : metrics.netVariance < 0 ? "good" : "neutral"}
              />
              <KpiCard
                label="Missing data"
                value={String(metrics.missingChecksheetValues)}
                detail={`${metrics.missingBudget} budget / ${metrics.missingActual} actual`}
                tone={metrics.missingChecksheetValues ? "warn" : "good"}
              />
              <KpiCard
                label="Variations"
                value={String(metrics.variationCount)}
                detail={formatPercent(metrics.variationPct)}
                tone={metrics.variationCount ? "warn" : "neutral"}
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
              <Section title="Budget vs actual" subtitle="Budget and actual bag totals for jobs with both values present.">
                <div className="space-y-5">
                  <ProgressBar label="Budget bags" value={metrics.totalBudget} max={maxUsage} color="bg-[#1a3a4a]" />
                  <ProgressBar label="Actual bags" value={metrics.totalActual} max={maxUsage} color="bg-[#e85d04]" />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-gray-50 px-4 py-3">
                      <div className="text-xs font-semibold text-gray-500">Usage intensity</div>
                      <div className="mt-1 text-xl font-bold text-gray-900">{formatNumber(metrics.avgIntensity, 2)}</div>
                      <div className="text-xs text-gray-500">bags per installed m², {metrics.intensityCoverage} jobs</div>
                    </div>
                    <div className="rounded-xl bg-gray-50 px-4 py-3">
                      <div className="text-xs font-semibold text-gray-500">Complete usage rows</div>
                      <div className="mt-1 text-xl font-bold text-gray-900">{metrics.completeRows.length}</div>
                      <div className="text-xs text-gray-500">of {rows.length} installed jobs</div>
                    </div>
                  </div>
                </div>
              </Section>

              <Section title="Variance distribution" subtitle="Jobs grouped by actual bags compared with budget.">
                <div className="space-y-4">
                  <ProgressBar label="Under budget" value={metrics.under} max={distributionMax} color="bg-emerald-500" meta={`${metrics.under} jobs`} />
                  <ProgressBar label="On budget" value={metrics.onBudget} max={distributionMax} color="bg-gray-400" meta={`${metrics.onBudget} jobs`} />
                  <ProgressBar label="Over budget" value={metrics.over} max={distributionMax} color="bg-red-500" meta={`${metrics.over} jobs`} />
                  <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                    Variation jobs are install-status based. A job can be marked as a variation even when bag usage is on budget.
                  </div>
                </div>
              </Section>
            </div>

            <Section title="Usage trend" subtitle={daysBetween(fromDate, toDate) > 31 ? "Weekly buckets for longer ranges. Orange is actual, muted teal is budget." : "Daily buckets. Orange is actual, muted teal is budget."}>
              <TrendBars points={trendPoints} />
            </Section>

            <div className="grid gap-5 lg:grid-cols-2">
              <Section title="Largest overages">
                <div className="space-y-2">
                  {varianceCallouts.highest.length === 0 && <p className="text-sm text-gray-500">No complete usage rows.</p>}
                  {varianceCallouts.highest.map((row) => (
                    <a key={row.job._id} href={jobHref(row.job._id)} className="block rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm hover:bg-red-100">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-gray-900">#{row.job.jobNumber}</span>
                        <span className="font-bold text-red-700">{formatSigned(row.variance)}</span>
                      </div>
                      <div className="truncate text-xs text-gray-600">{row.customer}</div>
                    </a>
                  ))}
                </div>
              </Section>

              <Section title="Largest savings">
                <div className="space-y-2">
                  {varianceCallouts.lowest.length === 0 && <p className="text-sm text-gray-500">No complete usage rows.</p>}
                  {varianceCallouts.lowest.map((row) => (
                    <a key={row.job._id} href={jobHref(row.job._id)} className="block rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm hover:bg-emerald-100">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-gray-900">#{row.job.jobNumber}</span>
                        <span className="font-bold text-emerald-700">{formatSigned(row.variance)}</span>
                      </div>
                      <div className="truncate text-xs text-gray-600">{row.customer}</div>
                    </a>
                  ))}
                </div>
              </Section>
            </div>

            <Section title="Explain the variance" subtitle="Notes and checksheet comments attached to variation or non-zero variance jobs.">
              {varianceCallouts.explained.length === 0 ? (
                <div className="rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">No explanatory notes found for this range.</div>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {varianceCallouts.explained.map((row) => (
                    <a key={row.job._id} href={jobHref(row.job._id)} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 hover:bg-gray-100">
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-gray-900">#{row.job.jobNumber} · {row.customer}</div>
                          <div className="text-xs text-gray-500">{row.statusLabel} · variance {formatSigned(row.variance)}</div>
                        </div>
                        {row.isVariation && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">Variation</span>}
                      </div>
                      {row.installNote && <p className="text-xs text-gray-700"><span className="font-semibold">Install:</span> {row.installNote}</p>}
                      {row.commentsOrIssues && <p className="mt-1 text-xs text-gray-700"><span className="font-semibold">Checksheet:</span> {row.commentsOrIssues}</p>}
                    </a>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Installed jobs" subtitle={`${filteredRows.length} of ${rows.length} jobs shown`}>
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2">
                  {QUICK_FILTERS.map((filter) => (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => setQuickFilter(filter.key)}
                      className={classNames(
                        "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                        quickFilter === filter.key
                          ? "border-[#e85d04] bg-[#e85d04] text-white"
                          : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                      )}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <SortButton label="Date" sortKey="date" activeSort={sortKey} descending={sortDescending} onClick={handleSort} />
                  <SortButton label="Variance" sortKey="variance" activeSort={sortKey} descending={sortDescending} onClick={handleSort} />
                  <SortButton label="Actual" sortKey="actual" activeSort={sortKey} descending={sortDescending} onClick={handleSort} />
                  <SortButton label="Job #" sortKey="job" activeSort={sortKey} descending={sortDescending} onClick={handleSort} />
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="min-w-[1100px] w-full text-left text-sm">
                  <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-3 font-semibold">Job</th>
                      <th className="px-3 py-3 font-semibold">Customer</th>
                      <th className="px-3 py-3 font-semibold">Install</th>
                      <th className="px-3 py-3 text-right font-semibold">Budget</th>
                      <th className="px-3 py-3 text-right font-semibold">Actual</th>
                      <th className="px-3 py-3 text-right font-semibold">Variance</th>
                      <th className="px-3 py-3 text-right font-semibold">Variance %</th>
                      <th className="px-3 py-3 text-right font-semibold">Bags/m²</th>
                      <th className="px-3 py-3 font-semibold">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-3 py-8 text-center text-sm text-gray-500">No jobs match this filter.</td>
                      </tr>
                    )}
                    {filteredRows.map((row) => {
                      const missing = typeof row.budget !== "number" || typeof row.actual !== "number";
                      const over = (row.variance || 0) > 0;
                      const under = (row.variance || 0) < 0;
                      return (
                        <tr
                          key={row.job._id}
                          className={classNames(
                            "align-top",
                            missing && "bg-amber-50/50",
                            over && "bg-red-50/40",
                            under && "bg-emerald-50/40",
                            row.isVariation && "shadow-[inset_3px_0_0_#f59e0b]"
                          )}
                        >
                          <td className="px-3 py-3">
                            <a href={jobHref(row.job._id)} className="font-bold text-[#1a3a4a] hover:underline">#{row.job.jobNumber}</a>
                            <div className="mt-1 text-[11px] text-gray-500">{row.job.stage}</div>
                          </td>
                          <td className="max-w-[260px] px-3 py-3">
                            <div className="font-semibold text-gray-900">{row.customer}</div>
                            <div className="mt-1 line-clamp-2 text-xs text-gray-500">{row.address || "No address"}</div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="font-medium text-gray-900">{formatNzDate(row.job.installation?.installDate)}</div>
                            <div className={classNames(
                              "mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                              row.isVariation ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                            )}>
                              {row.statusLabel}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-gray-900">{formatNumber(row.budget)}</td>
                          <td className="px-3 py-3 text-right font-semibold text-gray-900">{formatNumber(row.actual)}</td>
                          <td className={classNames("px-3 py-3 text-right font-bold", over ? "text-red-700" : under ? "text-emerald-700" : "text-gray-700")}>{formatSigned(row.variance)}</td>
                          <td className={classNames("px-3 py-3 text-right font-semibold", over ? "text-red-700" : under ? "text-emerald-700" : "text-gray-700")}>{formatPercent(row.variancePct)}</td>
                          <td className="px-3 py-3 text-right font-semibold text-gray-700">{formatNumber(row.intensity, 2)}</td>
                          <td className="max-w-[320px] px-3 py-3 text-xs text-gray-600">
                            {row.installNote || row.commentsOrIssues ? (
                              <div className="space-y-1">
                                {row.installNote && <div><span className="font-semibold text-gray-800">Install:</span> {row.installNote}</div>}
                                {row.commentsOrIssues && <div><span className="font-semibold text-gray-800">Checksheet:</span> {row.commentsOrIssues}</div>}
                              </div>
                            ) : (
                              <span className="text-gray-400">No notes</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
