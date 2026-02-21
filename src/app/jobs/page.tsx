"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
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

function JobsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initStage = searchParams.get("stage") || "LEAD";

  const [activeStage, setActiveStage] = useState<string>(initStage);
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
  const fetchIdRef = useRef(0);
  // Cache for first page of stage jobs to enable instant switching
  const cacheRef = useRef<Record<string, { jobs: Job[]; total: number }>>({});

  const prefetchJobsForStage = useCallback(async (stage: string) => {
    try {
      const data = await gql<JobsData>(JOBS_QUERY, {
        stages: [stage],
        skip: 0,
        limit: PAGE_SIZE,
      });
      const activeJobs = data.jobs.results.filter((j) => !j.archivedAt);
      cacheRef.current[stage] = { jobs: activeJobs, total: data.jobs.total };
      return cacheRef.current[stage];
    } catch (err) {
      console.warn(`[Prefetch] Failed for ${stage}:`, err);
    }
  }, []);

  // Sync state with URL changes (back/forward or tab click)
  // Only dependent on initStage to prevent toggle-back loops
  useEffect(() => {
    setActiveStage(initStage);
    setSubTab("ALL");
    setPage(0);

    // If we have cached data for this stage and we're not searching, use it immediately
    const cached = cacheRef.current[initStage];
    if (cached && !searchMode) {
      setJobs(cached.jobs);
      setTotal(cached.total);
      setLoading(false);
    } else {
      // Otherwise show loading state
      setJobs([]);
      setLoading(true);
    }
  }, [initStage, searchMode]); // Depend on searchMode too to ensure we clear/show correctly

  const fetchJobs = useCallback(async () => {
    const currentFetchId = ++fetchIdRef.current;
    setError("");
    // We don't set loading(true) here because it might already be true from handleStageChange
    // and we want it to stay true.

    const isSearching = searchMode;
    const q = search;

    try {
      const data = await gql<JobsData>(JOBS_QUERY, {
        ...(isSearching ? {} : { stages: [activeStage] }),
        skip: page * PAGE_SIZE,
        limit: PAGE_SIZE,
        ...(q ? { search: q } : {}),
      });

      // Ignore stale responses
      if (currentFetchId !== fetchIdRef.current) return;

      const allFetched = data.jobs.results;

      // DEBUG: Specifically look for the job the user mentioned
      const targetJob = allFetched.find(j => j._id === "699177c3a5185b0a06c01f07");
      if (targetJob) {
        console.log("[Debug] Found target job:", {
          id: targetJob._id,
          archivedAt: targetJob.archivedAt,
          stage: targetJob.stage,
          leadStatus: targetJob.lead?.leadStatus
        });
      }

      // Filter out archived jobs as requested
      const activeJobs = allFetched.filter(j => !j.archivedAt);

      setJobs(activeJobs);
      setTotal(data.jobs.total);

      // Update cache for stage first page
      if (!isSearching && page === 0) {
        cacheRef.current[activeStage] = { jobs: activeJobs, total: data.jobs.total };
      }
    } catch (err) {
      if (currentFetchId !== fetchIdRef.current) return;
      const msg = err instanceof Error ? err.message : "Failed to load jobs";
      if (msg !== "Unauthorized") setError(msg);
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [activeStage, page, search, searchMode]);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) { router.push("/login"); return; }
    fetchJobs();
  }, [fetchJobs, router]);

  // Initial prefetch - only once on mount
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (token) {
      prefetchJobsForStage("LEAD");
      prefetchJobsForStage("QUOTE");
    }
  }, [prefetchJobsForStage]);

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
    if (stage === activeStage) return;
    // We only update the URL. The useEffect above will sync the local state.
    // This maintains a single source of truth and prevents state-toggling bugs.
    router.replace(`/jobs?stage=${stage}`);
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("me");
    router.push("/login");
  }

  // Calculate counts for sub-tabs across all fetched non-archived jobs for this stage
  const counts = {
    ALL: jobs.length,
    NEW: jobs.filter((j) => !j.lead?.leadStatus || j.lead.leadStatus === "NEW").length,
    CALLBACK: jobs.filter((j) => j.lead?.leadStatus === "CALLBACK").length,
    DEAD: jobs.filter((j) => j.lead?.leadStatus === "DEAD").length,
  };

  // Client-side sub-tab filter
  const filtered = jobs.filter((job) => {
    if (!searchMode && subTab !== "ALL" && (activeStage === "LEAD" || activeStage === "QUOTE")) {
      const status = (job.lead?.leadStatus || "NEW").toUpperCase();
      return subTab === status;
    }
    return true;
  });

  const showSubTabs = !searchMode && (activeStage === "LEAD" || activeStage === "QUOTE");

  // With server-side pagination, 'filtered' is already limited to the current page.
  const paginatedResults = filtered;

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

      {/* Pagination */}
      {!loading && !error && total > PAGE_SIZE && (
        <div className="px-4 pb-2 pt-1 flex items-center justify-between">
          <button
            onClick={() => { setPage((p) => Math.max(0, p - 1)); window.scrollTo(0, 0); }}
            disabled={page === 0}
            className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-700 disabled:opacity-40 font-medium"
          >
            ← Prev
          </button>
          <span className="text-[10px] text-gray-500 font-medium bg-gray-100 px-2 py-1 rounded-full uppercase tracking-wider">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <button
            onClick={() => { setPage((p) => p + 1); window.scrollTo(0, 0); }}
            disabled={(page + 1) * PAGE_SIZE >= total}
            className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-700 disabled:opacity-40 font-medium"
          >
            Next →
          </button>
        </div>
      )}

      {/* Content */}
      <div className={`flex-1 transition-opacity duration-200 ${loading ? "opacity-50 pointer-events-none" : "opacity-100"}`}>
        {loading && jobs.length === 0 ? (
          <LoadingSkeleton />
        ) : error ? (
          <div className="px-4 pt-2">
            <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">
              {error}
              <button onClick={() => fetchJobs()} className="ml-2 underline">Retry</button>
            </div>
          </div>
        ) : paginatedResults.length === 0 ? (
          <div className="px-4 pt-8 text-center text-gray-400 text-sm">
            {searchMode ? `No results for "${searchInput}"` : "No jobs found"}
          </div>
        ) : (
          <div className="px-4 pt-1">
            {paginatedResults.map((job) => (
              <JobCard key={job._id} job={job} />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

export default function JobsPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <JobsPageContent />
    </Suspense>
  );
}
