"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { gql } from "@/lib/graphql";
import { JOBS_QUERY } from "@/lib/queries";
import StageTabs from "@/components/StageTabs";
import JobCard from "@/components/JobCard";
import LoadingSkeleton from "@/components/LoadingSkeleton";

const PAGE_SIZE = 40;

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
  quote?: { quoteNumber?: string; c_total?: number };
  client?: {
    contactDetails?: {
      name?: string;
      email?: string;
      phoneMobile?: string;
      streetAddress?: string;
      suburb?: string;
      city?: string;
      postCode?: string;
    };
  };
}

interface JobsData {
  jobs: { total: number; results: Job[] };
}

export default function JobsPage() {
  const router = useRouter();
  const [activeStage, setActiveStage] = useState("LEAD");
  const [subTab, setSubTab] = useState("ALL");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchJobs = useCallback(async (overrideSearch?: string, overrideSearchMode?: boolean) => {
    setLoading(true);
    setError("");
    const isSearching = overrideSearchMode ?? searchMode;
    const q = overrideSearch ?? search;
    try {
      const data = await gql<JobsData>(JOBS_QUERY, {
        ...(isSearching ? {} : { stages: [activeStage] }),
        skip: page * PAGE_SIZE,
        limit: PAGE_SIZE,
        ...(q ? { search: q } : {}),
      });
      setJobs(data.jobs.results);
      setTotal(data.jobs.total);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load jobs";
      if (msg !== "Unauthorized") setError(msg);
    } finally {
      setLoading(false);
    }
  }, [activeStage, page, search, searchMode]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { router.push("/login"); return; }
    fetchJobs();
  }, [fetchJobs, router]);

  // Debounced search
  function handleSearchInput(val: string) {
    setSearchInput(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const isSearchMode = val.trim().length > 0;
      setSearch(val);
      setSearchMode(isSearchMode);
      setPage(0);
    }, 400);
  }

  function clearSearch() {
    setSearchInput("");
    setSearch("");
    setSearchMode(false);
    setPage(0);
  }

  function handleStageChange(stage: string) {
    setActiveStage(stage);
    setSubTab("ALL");
    setPage(0);
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("me");
    router.push("/login");
  }

  // Client-side sub-tab filter (by lead.leadStatus)
  const filtered = jobs.filter((job) => {
    if (!searchMode && subTab !== "ALL" && (activeStage === "LEAD" || activeStage === "QUOTE")) {
      const status = (job.lead?.leadStatus || "NEW").toUpperCase();
      if (subTab !== status) return false;
    }
    return true;
  });

  // Counts for sub-tabs
  const counts = {
    ALL: jobs.length,
    NEW: jobs.filter((j) => !j.lead?.leadStatus || j.lead.leadStatus === "NEW").length,
    CALLBACK: jobs.filter((j) => j.lead?.leadStatus === "CALLBACK").length,
    DEAD: jobs.filter((j) => j.lead?.leadStatus === "DEAD").length,
  };

  const showSubTabs = !searchMode && (activeStage === "LEAD" || activeStage === "QUOTE");

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-[#1a3a4a] px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-white text-xs font-semibold tracking-wide">InsulMAX</p>
          <p className="text-[#e85d04] text-lg font-bold tracking-widest leading-tight">INSULHUB</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-300 text-sm">{total} jobs</span>
          <button
            onClick={() => router.push("/jobs/new")}
            className="text-white bg-[#e85d04] text-sm px-3 py-1.5 rounded-lg font-medium"
          >
            + Lead
          </button>
          <button
            onClick={handleLogout}
            className="text-gray-300 hover:text-white text-sm px-2 py-1.5 rounded-lg border border-gray-600"
          >
            Out
          </button>
        </div>
      </div>

      {/* Tabs */}
      <StageTabs
        activeStage={activeStage}
        onStageChange={handleStageChange}
        subTab={subTab}
        onSubTabChange={(tab) => { setSubTab(tab); setPage(0); }}
        counts={showSubTabs ? counts : undefined}
        searchMode={searchMode}
      />

      {/* Search */}
      <div className="px-4 pt-3 pb-1">
        <div className="relative">
          <input
            type="search"
            value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
            placeholder="Search all jobs — name, address, job #..."
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 pr-10 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-[#e85d04] focus:border-transparent"
          />
          {searchInput && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xl"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <div className="px-4 pt-4">
          <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">
            {error}
            <button onClick={() => fetchJobs()} className="ml-2 underline">Retry</button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-4 pt-8 text-center text-gray-400 text-sm">
          {searchMode ? `No results for "${searchInput}"` : "No jobs found"}
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
