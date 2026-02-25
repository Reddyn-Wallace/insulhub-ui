"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { gql } from "@/lib/graphql";
import { JOBS_QUERY, USERS_QUERY } from "@/lib/queries";
import StageTabs from "@/components/StageTabs";
import JobCard from "@/components/JobCard";
import LoadingSkeleton from "@/components/LoadingSkeleton";

const PAGE_SIZE = 40;
const STAGE_CACHE_TTL_MS = 5 * 60 * 1000;


interface User {
  _id: string;
  firstname: string;
  lastname: string;
  role?: string;
}

interface Job {
  _id: string;
  jobNumber: number;
  stage: string;
  createdAt?: string;
  updatedAt: string;
  archivedAt?: string;
  quoteLastSentAt?: string;
  lead?: {
    leadStatus?: string;
    allocatedTo?: { _id: string; firstname: string; lastname: string };
    callbackDate?: string;
    quoteBookingDate?: string;
  };
  quote?: { quoteNumber?: string; date?: string; status?: string; deferralDate?: string; c_total?: number };
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
  const initSubTab = searchParams.get("subTab") || (initStage === "QUOTE" ? "OPEN" : "NEW");

  const [activeStage, setActiveStage] = useState<string>(initStage);
  const [subTab, setSubTab] = useState(initSubTab);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("oldest");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [globalCounts, setGlobalCounts] = useState<Record<string, number> | null>(null);
  const [stageHydrated, setStageHydrated] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [salespersonFilter, setSalespersonFilter] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [isFetchingStage, setIsFetchingStage] = useState(false);
  const [error, setError] = useState("");

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0);
  const backgroundRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cache for first page of stage jobs to enable instant switching
  const cacheRef = useRef<Record<string, { jobs: Job[]; total: number }>>({});

  const cacheKey = useCallback((stage: string) => `jobs-cache:${stage}`, []);

  const readStageCache = useCallback((stage: string): { jobs: Job[]; total: number; counts?: Record<string, number>; ts: number } | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem(cacheKey(stage));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { jobs: Job[]; total: number; counts?: Record<string, number>; ts: number };
      if (Date.now() - parsed.ts > STAGE_CACHE_TTL_MS) return null;
      return parsed;
    } catch {
      return null;
    }
  }, [cacheKey]);

  const writeStageCache = useCallback((stage: string, data: { jobs: Job[]; total: number; counts?: Record<string, number> }) => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(cacheKey(stage), JSON.stringify({ ...data, ts: Date.now() }));
  }, [cacheKey]);

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
    setSubTab(initSubTab);
    setPage(0);
    setGlobalCounts(null);

    // If we have cached data for this stage and we're not searching, use it immediately
    const inMemCached = cacheRef.current[initStage];
    const persisted = !searchMode ? readStageCache(initStage) : null;
    const cached = inMemCached || (persisted ? { jobs: persisted.jobs, total: persisted.total } : null);

    if (cached && !searchMode && cached.jobs.length > 0) {
      setJobs(cached.jobs);
      setTotal(cached.total);
      setGlobalCounts(persisted?.counts || null);
      setStageHydrated(true);
      setLoading(false);
    } else {
      // Otherwise show loading state (including empty/expired cache)
      setJobs([]);
      setStageHydrated(false);
      setLoading(true);
    }
  }, [initStage, initSubTab, searchMode, readStageCache]); // Depend on searchMode too to ensure we clear/show correctly

  const fetchJobs = useCallback(async () => {
    const currentFetchId = ++fetchIdRef.current;
    setError("");
    setIsFetchingStage(true);
    if (jobs.length === 0) setLoading(true);

    const isSearching = searchMode;
    const q = search;

    try {
      const shouldFetchAllForStage = !isSearching && (activeStage === "LEAD" || activeStage === "QUOTE");
      const data = await gql<JobsData>(JOBS_QUERY, {
        ...(isSearching ? {} : { stages: [activeStage] }),
        skip: shouldFetchAllForStage ? 0 : page * PAGE_SIZE,
        limit: shouldFetchAllForStage ? 5000 : PAGE_SIZE,
        ...(q ? { search: q } : {}),
      });

      // Ignore stale responses
      if (currentFetchId !== fetchIdRef.current) return;

      const allFetched = data.jobs.results;
      // Filter out archived jobs as requested
      const activeJobs = allFetched.filter(j => !j.archivedAt);

      setJobs(activeJobs);
      setTotal(data.jobs.total);
      setStageHydrated(true);

      if (!isSearching && (activeStage === "LEAD" || activeStage === "QUOTE")) {
        const stageJobs = activeJobs;
        const isQuoteBooked = (job: Job) => Boolean(job.lead?.quoteBookingDate);
        const isCallbackLead = (job: Job) => ["CALLBACK", "ON_HOLD"].includes((job.lead?.leadStatus || "").toUpperCase());
        const isNewLead = (job: Job) => (!job.lead?.leadStatus || job.lead.leadStatus === "NEW") && !isQuoteBooked(job);
        const quoteState = (job: Job) => {
          if (job.lead?.leadStatus === "DEAD" || job.quote?.status === "DECLINED") return "DEAD";
          if (job.quote?.status === "DEFERRED" || isCallbackLead(job)) return "CALLBACK";
          return "OPEN";
        };
        const computedCounts = {
          ALL: stageJobs.length,
          NEW: stageJobs.filter((j) => isNewLead(j)).length,
          CALLBACK: stageJobs.filter((j) => activeStage === "QUOTE" ? quoteState(j) === "CALLBACK" : isCallbackLead(j)).length,
          QUOTE_BOOKED: stageJobs.filter((j) => isQuoteBooked(j)).length,
          OPEN: stageJobs.filter((j) => quoteState(j) === "OPEN").length,
          DEAD: stageJobs.filter((j) => activeStage === "QUOTE" ? quoteState(j) === "DEAD" : j.lead?.leadStatus === "DEAD").length,
        };
        setGlobalCounts(computedCounts);
        writeStageCache(activeStage, { jobs: activeJobs, total: data.jobs.total, counts: computedCounts });
      }

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
        setIsFetchingStage(false);
      }
    }
  }, [activeStage, page, search, searchMode, jobs.length, writeStageCache]);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) { router.push("/login"); return; }

    const canUseWarmCache = !searchMode && !search && page === 0 && (activeStage === "LEAD" || activeStage === "QUOTE");
    const cached = canUseWarmCache ? readStageCache(activeStage) : null;

    if (canUseWarmCache && cached) {
      // Keep navigation feeling instant when cache has data.
      if (cached.jobs.length > 0) {
        if (backgroundRefreshTimerRef.current) clearTimeout(backgroundRefreshTimerRef.current);
        backgroundRefreshTimerRef.current = setTimeout(() => {
          fetchJobs();
        }, 500);
        return;
      }
      // If cache is empty, show loading skeleton and fetch immediately.
      setStageHydrated(false);
      fetchJobs();
      return;
    }

    fetchJobs();
  }, [fetchJobs, router, readStageCache, activeStage, searchMode, search, page]);

  // Initial prefetch - only once on mount
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (token) {
      prefetchJobsForStage("LEAD");
      prefetchJobsForStage("QUOTE");
    }
  }, [prefetchJobsForStage]);


  useEffect(() => {
    return () => {
      if (backgroundRefreshTimerRef.current) clearTimeout(backgroundRefreshTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) return;
    gql<{ users: { results: User[] } }>(USERS_QUERY)
      .then((d) => setUsers((d.users?.results || []).filter((u) => (u.role || "").toUpperCase() !== "INSTALLER")))
      .catch(() => {});
  }, []);

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
    const defaultSub = stage === "QUOTE" ? "OPEN" : "NEW";
    router.replace(`/jobs?stage=${stage}&subTab=${defaultSub}`);
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("me");
    router.push("/login");
  }

  // Calculate counts for sub-tabs across all fetched non-archived jobs for this stage
  const isQuoteBooked = (job: Job) => Boolean(job.lead?.quoteBookingDate);
  const isCallbackLead = (job: Job) => ["CALLBACK", "ON_HOLD"].includes((job.lead?.leadStatus || "").toUpperCase());
  const isNewLead = (job: Job) => (!job.lead?.leadStatus || job.lead.leadStatus === "NEW") && !isQuoteBooked(job);
  const quoteState = (job: Job) => {
    if (job.lead?.leadStatus === "DEAD" || job.quote?.status === "DECLINED") return "DEAD";
    if (job.quote?.status === "DEFERRED" || isCallbackLead(job)) return "CALLBACK";
    return "OPEN";
  };

  const counts = globalCounts || {
    ALL: jobs.length,
    NEW: jobs.filter((j) => isNewLead(j)).length,
    CALLBACK: jobs.filter((j) => activeStage === "QUOTE" ? quoteState(j) === "CALLBACK" : isCallbackLead(j)).length,
    QUOTE_BOOKED: jobs.filter((j) => isQuoteBooked(j)).length,
    OPEN: jobs.filter((j) => quoteState(j) === "OPEN").length,
    DEAD: jobs.filter((j) => activeStage === "QUOTE" ? quoteState(j) === "DEAD" : j.lead?.leadStatus === "DEAD").length,
  };

  // Client-side sub-tab filter
  const filtered = jobs.filter((job) => {
    if (salespersonFilter !== "ALL" && job.lead?.allocatedTo?._id !== salespersonFilter) return false;
    if (!searchMode && subTab !== "ALL" && (activeStage === "LEAD" || activeStage === "QUOTE")) {
      if (activeStage === "QUOTE") return quoteState(job) === subTab;
      if (subTab === "QUOTE_BOOKED") return isQuoteBooked(job);
      if (subTab === "NEW") return isNewLead(job);
      const statusRaw = (job.lead?.leadStatus || "NEW").toUpperCase();
      const status = statusRaw === "ON_HOLD" ? "CALLBACK" : statusRaw;
      return subTab === status;
    }
    return true;
  });

  const sortedJobs = useMemo(() => {
    const quoteSortTs = (job: Job) => {
      if (!job.quote?.date) return Number.MAX_SAFE_INTEGER;
      return new Date(job.quote.date).getTime();
    };
    const leadSortTs = (job: Job) => new Date(job.createdAt || job.updatedAt).getTime();

    const futureFirst = (aTime: number | null, bTime: number | null) => {
      const now = Date.now();
      const aFuture = aTime != null && aTime >= now;
      const bFuture = bTime != null && bTime >= now;
      if (aFuture && !bFuture) return sortOrder === "oldest" ? -1 : 1;
      if (!aFuture && bFuture) return sortOrder === "oldest" ? 1 : -1;
      if (aTime == null && bTime != null) return sortOrder === "oldest" ? 1 : -1;
      if (aTime != null && bTime == null) return sortOrder === "oldest" ? -1 : 1;
      if (aTime == null && bTime == null) return 0;
      const asc = (aTime as number) - (bTime as number);
      return sortOrder === "oldest" ? asc : -asc;
    };

    return [...filtered].sort((a, b) => {
      // Lead tab: Quote booked should sort by quote booking date (next upcoming first)
      if (activeStage === "LEAD" && subTab === "QUOTE_BOOKED") {
        const aTime = a.lead?.quoteBookingDate ? new Date(a.lead.quoteBookingDate).getTime() : null;
        const bTime = b.lead?.quoteBookingDate ? new Date(b.lead.quoteBookingDate).getTime() : null;
        return futureFirst(aTime, bTime);
      }

      // Callback tabs (both Leads + Quotes): sort by callback/deferral date next upcoming first
      if (subTab === "CALLBACK") {
        const aCb = activeStage === "QUOTE"
          ? (a.quote?.deferralDate || a.lead?.callbackDate)
          : a.lead?.callbackDate;
        const bCb = activeStage === "QUOTE"
          ? (b.quote?.deferralDate || b.lead?.callbackDate)
          : b.lead?.callbackDate;
        const aTime = aCb ? new Date(aCb).getTime() : null;
        const bTime = bCb ? new Date(bCb).getTime() : null;
        return futureFirst(aTime, bTime);
      }

      if (activeStage === "QUOTE") {
        const aHasDate = Boolean(a.quote?.date);
        const bHasDate = Boolean(b.quote?.date);
        if (!aHasDate && bHasDate) return -1;
        if (aHasDate && !bHasDate) return 1;
        const aTime = quoteSortTs(a);
        const bTime = quoteSortTs(b);
        return sortOrder === "newest" ? bTime - aTime : aTime - bTime;
      }

      const aTime = leadSortTs(a);
      const bTime = leadSortTs(b);
      return sortOrder === "newest" ? bTime - aTime : aTime - bTime;
    });
  }, [filtered, sortOrder, activeStage, subTab]);

  const showSubTabs = !searchMode && (activeStage === "LEAD" || activeStage === "QUOTE");

  // If current page has no rows after sub-filtering, jump back to page 1 for that view.
  useEffect(() => {
    if (!loading && !error && page > 0 && jobs.length > 0 && sortedJobs.length === 0) {
      setPage(0);
    }
  }, [loading, error, page, jobs.length, sortedJobs.length]);

  useEffect(() => { setPage(0); }, [subTab, salespersonFilter]);

  // Client-side paginate after filtering/sorting.
  const paginatedResults = sortedJobs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(sortedJobs.length / PAGE_SIZE));
  const currentPage = page + 1;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-[#1a3a4a] px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-white text-xs font-semibold tracking-wide">InsulMAX</p>
          <p className="text-[#e85d04] text-lg font-bold tracking-widest leading-tight">INSULHUB</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-300 text-sm">{(globalCounts?.ALL ?? total)} jobs</span>
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
        onSubTabChange={(tab) => { setSubTab(tab); setPage(0); router.replace(`/jobs?stage=${activeStage}&subTab=${tab}`); }}
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
        <div className="mt-2 flex gap-2 justify-end flex-wrap">
          <select
            value={salespersonFilter}
            onChange={(e) => setSalespersonFilter(e.target.value)}
            className="text-xs bg-white border border-gray-200 text-gray-700 px-2 py-1.5 rounded-lg font-medium"
          >
            <option value="ALL">Salesperson: All</option>
            {users.map((u) => (
              <option key={u._id} value={u._id}>{u.firstname} {u.lastname}</option>
            ))}
          </select>
          <button
            onClick={() => setSortOrder((prev) => (prev === "newest" ? "oldest" : "newest"))}
            className="text-xs bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg font-medium hover:bg-gray-50"
          >
            Sort: {activeStage === "QUOTE" ? "Quote date" : "Created"} {sortOrder === "newest" ? "Latest first" : "Earliest first"}
          </button>
        </div>
      </div>

      {/* Pagination */}
      {!loading && !error && sortedJobs.length > PAGE_SIZE && (
        <div className="px-4 pb-2 pt-1 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setPage(0); window.scrollTo(0, 0); }}
              disabled={page === 0}
              className="px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-700 disabled:opacity-40 font-medium"
            >
              « First
            </button>
            <button
              onClick={() => { setPage((p) => Math.max(0, p - 1)); window.scrollTo(0, 0); }}
              disabled={page === 0}
              className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-700 disabled:opacity-40 font-medium"
            >
              ← Prev
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500 font-medium bg-gray-100 px-2 py-1 rounded-full">Page {currentPage} / {totalPages}</span>
            <span className="text-[10px] text-gray-400">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sortedJobs.length)} of {sortedJobs.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setPage((p) => Math.min(totalPages - 1, p + 1)); window.scrollTo(0, 0); }}
              disabled={(page + 1) * PAGE_SIZE >= sortedJobs.length}
              className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-700 disabled:opacity-40 font-medium"
            >
              Next →
            </button>
            <button
              onClick={() => { setPage(totalPages - 1); window.scrollTo(0, 0); }}
              disabled={page >= totalPages - 1}
              className="px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-700 disabled:opacity-40 font-medium"
            >
              Last »
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className={`flex-1 transition-opacity duration-200 ${loading ? "opacity-50 pointer-events-none" : "opacity-100"}`}>
        {(isFetchingStage && paginatedResults.length === 0 && !error) ? (
          <div className="px-4 pt-10 flex flex-col items-center gap-3 text-gray-400 text-sm">
            <div className="w-7 h-7 border-2 border-gray-200 border-t-[#e85d04] rounded-full animate-spin" />
            <span>Loading jobs...</span>
          </div>
        ) : ((loading && jobs.length === 0) || (!stageHydrated && !error)) ? (
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
