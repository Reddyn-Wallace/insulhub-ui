"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { gql } from "@/lib/graphql";
import { JOBS_QUERY } from "@/lib/queries";
import StageTabs from "@/components/StageTabs";
import JobCard from "@/components/JobCard";
import LoadingSkeleton from "@/components/LoadingSkeleton";

const PAGE_SIZE = 40;

interface ContactDetails {
  name?: string;
  email?: string;
  mobilePhone?: string;
  streetAddress?: string;
  suburb?: string;
  city?: string;
  postCode?: string;
}

interface Job {
  _id: string;
  jobNumber: number;
  stage: string;
  updatedAt: string;
  archivedAt?: string;
  lead?: {
    leadStatus?: string;
    allocatedTo?: { _id: string; firstname: string; lastname: string };
    callbackDate?: string;
  };
  quote?: {
    quoteNumber?: string;
    c_total?: number;
  };
  client?: {
    contactDetails?: ContactDetails;
  };
}

interface JobsData {
  jobs: { total: number; results: Job[] };
}

export default function JobsPage() {
  const router = useRouter();
  const [activeStage, setActiveStage] = useState("LEAD");
  const [leadSubTab, setLeadSubTab] = useState("ALL");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await gql<JobsData>(JOBS_QUERY, {
        stages: [activeStage],
        skip: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      });
      setJobs(data.jobs.results);
      setTotal(data.jobs.total);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load jobs";
      if (msg === "Unauthorized") return;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [activeStage, page]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { router.push("/login"); return; }
    fetchJobs();
  }, [fetchJobs, router]);

  function handleStageChange(stage: string) {
    setActiveStage(stage);
    setLeadSubTab("ALL");
    setPage(0);
    setSearch("");
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("me");
    router.push("/login");
  }

  // Filter by lead sub-tab and search
  const filtered = jobs.filter((job) => {
    // Sub-tab filter (leads only)
    if (activeStage === "LEAD" && leadSubTab !== "ALL") {
      const status = (job.lead?.leadStatus || "NEW").toUpperCase();
      if (leadSubTab !== status) return false;
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      const c = job.client?.contactDetails;
      const haystack = [
        c?.name, c?.email, c?.mobilePhone, c?.streetAddress,
        c?.suburb, c?.city, String(job.jobNumber),
        job.quote?.quoteNumber,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    }

    return true;
  });

  // Lead sub-tab counts
  const leadCounts = {
    ALL: jobs.length,
    NEW: jobs.filter((j) => !j.lead?.leadStatus || j.lead.leadStatus === "NEW").length,
    CALLBACK: jobs.filter((j) => j.lead?.leadStatus === "CALLBACK").length,
    DEAD: jobs.filter((j) => j.lead?.leadStatus === "DEAD").length,
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-[#1a3a4a] px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-white text-xs font-semibold tracking-wide">InsulMAX</p>
          <p className="text-[#e85d04] text-lg font-bold tracking-widest leading-tight">
            INSULHUB
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-gray-300 text-sm">{total} jobs</span>
          <button
            onClick={handleLogout}
            className="text-gray-300 hover:text-white text-sm px-3 py-1.5 rounded-lg border border-gray-600 hover:border-gray-400 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Tabs */}
      <StageTabs
        activeStage={activeStage}
        onStageChange={handleStageChange}
        leadSubTab={leadSubTab}
        onLeadSubTabChange={(tab) => { setLeadSubTab(tab); setPage(0); }}
        leadCounts={activeStage === "LEAD" ? leadCounts : undefined}
      />

      {/* Search */}
      <div className="px-4 pt-3 pb-1">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, address, phone, job #..."
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-[#e85d04] focus:border-transparent"
        />
      </div>

      {/* Content */}
      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <div className="px-4 pt-4">
          <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">
            {error}
            <button onClick={fetchJobs} className="ml-2 underline">Retry</button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-4 pt-8 text-center text-gray-400 text-sm">
          No jobs found
        </div>
      ) : (
        <div className="px-4 pt-3">
          {filtered.map((job) => (
            <JobCard key={job._id} job={job} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && total > PAGE_SIZE && (
        <div className="px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-xs text-gray-500">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={(page + 1) * PAGE_SIZE >= total}
            className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
