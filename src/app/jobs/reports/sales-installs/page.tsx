"use client";

import { useState } from "react";
import { gql } from "@/lib/graphql";

// ─── Types ────────────────────────────────────────────────────────────────────

type BulkJob = {
  _id: string;
  stage: string;
  archivedAt?: string | null;
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
  installerChecksheet?: {
    wallAreaInstalled?: number | null;
  } | null;
};

type DetailJob = {
  _id: string;
  acceptedAt?: string | null;
  quote?: {
    c_total?: number | null;
    wall?: { SQM?: number | null } | null;
    ceiling?: { SQM?: number | null } | null;
  } | null;
};

type FutureJob = {
  _id: string;
  notes?: string | null;
  archivedAt?: string | null;
  quote?: {
    c_total?: number | null;
    wall?: { SQM?: number | null } | null;
    ceiling?: { SQM?: number | null } | null;
  } | null;
  installation?: {
    installDate?: string | null;
  } | null;
};

// ─── Queries ──────────────────────────────────────────────────────────────────

const BULK_QUERY = `
  query SalesInstallsBulk($stages: [JobStage!], $skip: Int, $limit: Int) {
    jobs(stages: $stages, skip: $skip, limit: $limit) {
      total
      results {
        _id
        stage
        archivedAt
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
        installerChecksheet {
          wallAreaInstalled
        }
      }
    }
  }
`;

const DETAIL_QUERY = `
  query SalesInstallsDetail($_id: ObjectId!) {
    job(_id: $_id) {
      _id
      acceptedAt
      quote {
        c_total
        wall { SQM }
        ceiling { SQM }
      }
    }
  }
`;

const FUTURE_QUERY = `
  query SalesInstallsFuture($stages: [JobStage!], $skip: Int, $limit: Int) {
    jobs(stages: $stages, skip: $skip, limit: $limit) {
      total
      results {
        _id
        notes
        archivedAt
        quote {
          c_total
          wall { SQM }
          ceiling { SQM }
        }
        installation {
          installDate
        }
      }
    }
  }
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function todayNzKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function jobSqm(job: { quote?: { wall?: { SQM?: number | null } | null; ceiling?: { SQM?: number | null } | null } | null }): number {
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
  return `${new Intl.NumberFormat("en-NZ", { maximumFractionDigits: 1 }).format(sqm)} m²`;
}

function parseInstallMeta(notes?: string | null): string | null {
  if (!notes) return null;
  const match = notes.match(/\[INSTALL_META\]([\s\S]*?)\[\/INSTALL_META\]/i);
  if (!match) return null;
  const statusMatch = match[1].match(/status:\s*(\w+)/i);
  return statusMatch ? statusMatch[1].toLowerCase() : null;
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ value, label, accent }: { value: string; label: string; accent?: string }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4 flex flex-col gap-1 shadow-sm">
      <span className={`text-3xl font-bold tracking-tight ${accent ?? "text-gray-900"}`}>{value}</span>
      <span className="text-xs text-gray-500 font-medium">{label}</span>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">{children}</p>
  );
}

// ─── Pipeline row ─────────────────────────────────────────────────────────────

function PipelineRow({
  label,
  count,
  sqm,
  total,
  color,
}: {
  label: string;
  count: number;
  sqm: number;
  total: number;
  color: "emerald" | "amber";
}) {
  const dot = color === "emerald" ? "bg-emerald-500" : "bg-amber-400";
  const text = color === "emerald" ? "text-emerald-700" : "text-amber-700";
  const bg = color === "emerald" ? "bg-emerald-50 border-emerald-100" : "bg-amber-50 border-amber-100";

  return (
    <div className={`rounded-xl border px-5 py-4 ${bg}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
        <span className={`text-xs font-bold uppercase tracking-wider ${text}`}>{label}</span>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span className="text-2xl font-bold text-gray-900">{count}</span>
        <div className="flex flex-col justify-center">
          <span className="text-xs text-gray-500">jobs</span>
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-gray-700">{formatSqm(sqm)}</span>
          <span className="text-[10px] text-gray-400">total SQM</span>
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-gray-700">{formatNzd(total)}</span>
          <span className="text-[10px] text-gray-400">total value</span>
        </div>
      </div>
    </div>
  );
}

// ─── Result shape ─────────────────────────────────────────────────────────────

type ReportResult = {
  installs: { count: number; sqm: number };
  quotes: { count: number; total: number; sqm: number };
  confirmed: { count: number; sqm: number; total: number };
  pencilled: { count: number; sqm: number; total: number };
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SalesInstallsPage() {
  const todayKey = todayNzKey();
  const [fromDate, setFromDate] = useState(() => {
    // Default: start of current month
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [toDate, setToDate] = useState(todayKey);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReportResult | null>(null);

  async function runReport() {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      // ── Fetch 1: bulk query for date-range sections + future pipeline ────────
      const [bulkData, futureData] = await Promise.all([
        gql<{ jobs: { results: BulkJob[] } }>(BULK_QUERY, {
          stages: ["SCHEDULED", "INSTALLATION", "INVOICE", "COMPLETED"],
          skip: 0,
          limit: 5000,
        }),
        gql<{ jobs: { results: FutureJob[] } }>(FUTURE_QUERY, {
          stages: ["SCHEDULED", "INSTALLATION", "INVOICE"],
          skip: 0,
          limit: 5000,
        }),
      ]);

      const allJobs = bulkData.jobs.results ?? [];

      // ── Installs section ─────────────────────────────────────────────────────
      const installedJobs = allJobs.filter((j) => {
        if (j.archivedAt) return false;
        const status = j.installation?.installStatus ?? "";
        if (!["INSTALLED_AS_QUOTED", "INSTALLED_WITH_VARIATIONS_FROM_QUOTE"].includes(status)) return false;
        const key = toNzDateKey(j.installation?.installDate);
        return !!key && key >= fromDate && key <= toDate;
      });

      const installsSqm = installedJobs.reduce(
        (sum, j) => sum + (j.installerChecksheet?.wallAreaInstalled ?? 0),
        0
      );

      // ── Quotes accepted: candidate filter then individual fetch ──────────────
      const acceptedCandidates = allJobs.filter((j) => {
        if (j.archivedAt) return false;
        const s = j.quote?.status ?? "";
        return s === "ACCEPTED" || s === "INSTALL";
      });

      // Fetch each candidate individually to read acceptedAt
      const detailResults = await Promise.allSettled(
        acceptedCandidates.map((j) =>
          gql<{ job: DetailJob }>(DETAIL_QUERY, { _id: j._id })
        )
      );

      const acceptedInRange: DetailJob[] = [];
      for (const r of detailResults) {
        if (r.status !== "fulfilled") continue;
        const job = r.value.job;
        if (!job?.acceptedAt) continue;
        const key = toNzDateKey(job.acceptedAt);
        if (key && key >= fromDate && key <= toDate) {
          acceptedInRange.push(job);
        }
      }

      const quotesTotal = acceptedInRange.reduce((sum, j) => sum + (j.quote?.c_total ?? 0), 0);
      const quotesSqm = acceptedInRange.reduce((sum, j) => sum + jobSqm(j), 0);

      // ── Future pipeline ──────────────────────────────────────────────────────
      const futureJobs = (futureData.jobs.results ?? []).filter((j) => {
        if (j.archivedAt) return false;
        const key = toNzDateKey(j.installation?.installDate);
        return !!key && key > todayKey;
      });

      let confirmed = { count: 0, sqm: 0, total: 0 };
      let pencilled = { count: 0, sqm: 0, total: 0 };

      for (const j of futureJobs) {
        const status = parseInstallMeta(j.notes);
        const sqm = jobSqm(j);
        const total = j.quote?.c_total ?? 0;
        if (status === "pencilled") {
          pencilled = { count: pencilled.count + 1, sqm: pencilled.sqm + sqm, total: pencilled.total + total };
        } else {
          // No meta or explicitly confirmed → treat as confirmed
          confirmed = { count: confirmed.count + 1, sqm: confirmed.sqm + sqm, total: confirmed.total + total };
        }
      }

      setResult({
        installs: { count: installedJobs.length, sqm: installsSqm },
        quotes: { count: acceptedInRange.length, total: quotesTotal, sqm: quotesSqm },
        confirmed,
        pencilled,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report data");
    } finally {
      setLoading(false);
    }
  }

  const dateRangeInvalid = !!fromDate && !!toDate && fromDate > toDate;

  return (
    <div className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
      <div className="px-4 py-5 max-w-3xl mx-auto">
        {/* Header card */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 md:p-5 mb-4">
          <h1 className="text-lg font-bold text-gray-900 mb-0.5">Sales & Installs Report</h1>
          <p className="text-xs text-gray-400 mb-4">Select a date range to view installation and sales performance, plus the current future job pipeline.</p>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-gray-500">From date</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-[#1a3a4a]/20"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">To date</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-[#1a3a4a]/20"
              />
            </div>
          </div>

          {dateRangeInvalid && (
            <p className="text-xs text-red-600 mb-2">From date must be before or equal to To date.</p>
          )}

          <button
            onClick={runReport}
            disabled={loading || !fromDate || !toDate || dateRangeInvalid}
            className="w-full bg-[#1a3a4a] text-white px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 active:bg-[#152f3c] transition-colors"
          >
            {loading ? "Loading…" : "Run Report"}
          </button>

          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>

        {/* Results */}
        {result && (
          <div className="flex flex-col gap-4">
            {/* Installations */}
            <div className="bg-white border border-gray-100 rounded-2xl p-4 md:p-5">
              <SectionHeading>Installations · {fromDate} – {toDate}</SectionHeading>
              <div className="grid grid-cols-2 gap-3">
                <StatCard value={String(result.installs.count)} label="Jobs Installed" />
                <StatCard value={formatSqm(result.installs.sqm)} label="Total SQM Installed" />
              </div>
            </div>

            {/* Quotes accepted */}
            <div className="bg-white border border-gray-100 rounded-2xl p-4 md:p-5">
              <SectionHeading>Quotes Accepted · {fromDate} – {toDate}</SectionHeading>
              <div className="grid grid-cols-3 gap-3">
                <StatCard value={String(result.quotes.count)} label="Quotes Accepted" />
                <StatCard value={formatNzd(result.quotes.total)} label="Total Value" accent="text-[#1a3a4a]" />
                <StatCard value={formatSqm(result.quotes.sqm)} label="Total SQM" />
              </div>
            </div>

            {/* Future pipeline */}
            <div className="bg-white border border-gray-100 rounded-2xl p-4 md:p-5">
              <SectionHeading>Future Pipeline · as at today</SectionHeading>
              <div className="flex flex-col gap-3">
                <PipelineRow
                  label="Confirmed"
                  count={result.confirmed.count}
                  sqm={result.confirmed.sqm}
                  total={result.confirmed.total}
                  color="emerald"
                />
                <PipelineRow
                  label="Pencilled"
                  count={result.pencilled.count}
                  sqm={result.pencilled.sqm}
                  total={result.pencilled.total}
                  color="amber"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
