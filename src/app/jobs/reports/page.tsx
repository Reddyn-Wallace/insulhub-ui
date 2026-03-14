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
  };
  client?: {
    contactDetails?: {
      name?: string;
    };
  };
  installerChecksheet?: {
    budgetBags?: number | null;
    actualBags?: number | null;
  };
};

type UsageJobsResponse = {
  jobs: {
    total: number;
    results: UsageJob[];
  };
};

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
        }
        client {
          contactDetails {
            name
          }
        }
        installerChecksheet {
          budgetBags
          actualBags
        }
      }
    }
  }
`;

function toDateKey(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\n") || text.includes("\"")) {
    return `"${text.replace(/\"/g, '""')}"`;
  }
  return text;
}

export default function ReportsPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  async function generateUsageReport() {
    setLoading(true);
    setError("");
    setPreviewCount(null);
    try {
      const data = await gql<UsageJobsResponse>(USAGE_JOBS_QUERY, {
        stages: ["INSTALLATION", "INVOICE", "COMPLETED"],
        skip: 0,
        limit: 5000,
      });

      const rows = (data.jobs.results || [])
        .filter((job) => ["INSTALLED_AS_QUOTED", "INSTALLED_WITH_VARIATIONS_FROM_QUOTE"].includes(job.installation?.installStatus || ""))
        .filter((job) => {
          const key = toDateKey(job.installation?.installDate);
          return !!key && key >= fromDate && key <= toDate;
        })
        .sort((a, b) => {
          const da = new Date(a.installation?.installDate || 0).getTime();
          const db = new Date(b.installation?.installDate || 0).getTime();
          return da - db;
        });

      const header = [
        "Job Number",
        "Customer",
        "Stage",
        "Install Date",
        "Install Status",
        "Budget Bags",
        "Actual Bags",
        "Variance (Actual-Budget)",
      ];

      const lines = [header.join(",")];
      for (const job of rows) {
        const budget = job.installerChecksheet?.budgetBags;
        const actual = job.installerChecksheet?.actualBags;
        const variance = (typeof actual === "number" && typeof budget === "number") ? (actual - budget) : "";
        lines.push([
          job.jobNumber,
          job.client?.contactDetails?.name || "",
          job.stage,
          job.installation?.installDate || "",
          job.installation?.installStatus || "",
          budget ?? "",
          actual ?? "",
          variance,
        ].map(csvEscape).join(","));
      }

      const csv = lines.join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `usage-report_${fromDate}_to_${toDate}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setPreviewCount(rows.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate usage report");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
      <div className="px-4 py-5 max-w-3xl mx-auto">
        <div className="bg-white border border-gray-100 rounded-2xl p-4 md:p-5">
          <h1 className="text-lg font-bold text-gray-900 mb-1">Reports</h1>
          <p className="text-sm text-gray-500 mb-4">Generate CSV reports from jobs data.</p>

          <div className="rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-800 mb-3">Usage Report</h2>
            <p className="text-xs text-gray-500 mb-3">Installed jobs between selected dates showing budgeted vs actual bags usage.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs text-gray-500">From date</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">To date</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1"
                />
              </div>
            </div>

            <button
              onClick={generateUsageReport}
              disabled={loading || !fromDate || !toDate || fromDate > toDate}
              className="bg-[#1a3a4a] text-white px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
            >
              {loading ? "Generating..." : "Generate CSV"}
            </button>

            {fromDate > toDate && (
              <p className="text-xs text-red-600 mt-2">From date must be before or equal to To date.</p>
            )}
            {previewCount != null && (
              <p className="text-xs text-emerald-700 mt-2">CSV downloaded. Rows: {previewCount}</p>
            )}
            {error && (
              <p className="text-xs text-red-600 mt-2">{error}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
