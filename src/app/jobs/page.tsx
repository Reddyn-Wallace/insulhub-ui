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
const STAGE_CACHE_TTL_MS = 30 * 60 * 1000;
const SORT_PREFERENCE_KEY = "jobs-sort-order";
const CACHE_KEY_VERSION = "v3";
const EMAIL_LOGS_QUERY = `
  query EmailLogs($skip: Int, $limit: Int) {
    listEmailLogs(skip: $skip, limit: $limit) {
      results {
        createdAt
        type
        to_email
      }
    }
  }
`;


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
  ebaLastSentAt?: string;
  installation?: {
    installDate?: string;
    installStatus?: string;
  };
  lead?: {
    leadStatus?: string;
    leadSource?: string[];
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

interface EmailLogData {
  listEmailLogs: {
    results: { createdAt?: string; type?: string; to_email?: string }[];
  };
}

function normalizeFilterValue(value: string) {
  return value.trim().toLowerCase();
}

function JobsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initStage = searchParams.get("stage") || "LEAD";
  const initSubTab = searchParams.get("subTab") || (initStage === "QUOTE" ? "OPEN" : initStage === "LEAD" ? "NEW" : "ALL");
  const initSalespersonFilters = useMemo(() => searchParams.getAll("salesperson").filter(Boolean), [searchParams]);
  const initLeadSourceFilters = useMemo(() => searchParams.getAll("leadSource").map(normalizeFilterValue).filter(Boolean), [searchParams]);

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
  const [salespersonFilters, setSalespersonFilters] = useState<string[]>(initSalespersonFilters);
  const [leadSourceFilters, setLeadSourceFilters] = useState<string[]>(initLeadSourceFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isFetchingStage, setIsFetchingStage] = useState(false);
  const [quoteSentByEmail, setQuoteSentByEmail] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0);
  // Cache for first page of stage jobs to enable instant switching
  const cacheRef = useRef<Record<string, { jobs: Job[]; total: number }>>({});

  const cacheKey = useCallback((stage: string) => `jobs-cache-${CACHE_KEY_VERSION}:${stage}`, []);
  const sortPreferenceKey = useCallback((stage: string) => `${SORT_PREFERENCE_KEY}:${stage}`, []);

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

  const installedStatuses = useMemo(() => new Set(["INSTALLED_AS_QUOTED", "INSTALLED_WITH_VARIATIONS_FROM_QUOTE"]), []);
  const isInstalledJob = useCallback((job: Job) => installedStatuses.has((job.installation?.installStatus || "").trim().toUpperCase()), [installedStatuses]);
  const isActiveForStage = useCallback((job: Job, stage: string) => {
    if (job.archivedAt) return false;
    if (stage === "JOBS" && isInstalledJob(job)) return false;
    return true;
  }, [isInstalledJob]);

  const prefetchJobsForStage = useCallback(async (stage: string) => {
    try {
      const stageFilter = stage === "JOBS" ? ["SCHEDULED", "INSTALLATION", "INVOICE"] : [stage];
      const data = await gql<JobsData>(JOBS_QUERY, {
        stages: stageFilter,
        skip: 0,
        limit: 5000,
      }, {
        cacheKey: `jobs:${stage}`,
        ttlMs: 2 * 60 * 1000,
      });
      const activeJobs = data.jobs.results.filter((j) => isActiveForStage(j, stage));
      const activeTotal = stage === "JOBS" || stage === "COMPLETED" ? activeJobs.length : data.jobs.total;
      cacheRef.current[stage] = { jobs: activeJobs, total: activeTotal };

      const isQuoteBooked = (job: Job) => Boolean(job.lead?.quoteBookingDate);
      const isCallbackLead = (job: Job) => ["CALLBACK", "ON_HOLD"].includes((job.lead?.leadStatus || "").toUpperCase());
      const isNewLead = (job: Job) => (!job.lead?.leadStatus || job.lead.leadStatus === "NEW") && !isQuoteBooked(job);
      const quoteState = (job: Job) => {
        if (job.quote?.status === "DEFERRED" || isCallbackLead(job) || job.lead?.callbackDate) return "CALLBACK";
        if (job.lead?.leadStatus === "DEAD" || job.quote?.status === "DECLINED") return "DEAD";
        return "OPEN";
      };
      const counts = {
        ALL: activeJobs.length,
        NEW: activeJobs.filter((j) => isNewLead(j)).length,
        CALLBACK: activeJobs.filter((j) => stage === "QUOTE" ? quoteState(j) === "CALLBACK" : isCallbackLead(j)).length,
        QUOTE_BOOKED: activeJobs.filter((j) => isQuoteBooked(j)).length,
        OPEN: activeJobs.filter((j) => quoteState(j) === "OPEN").length,
        DEAD: activeJobs.filter((j) => stage === "QUOTE" ? quoteState(j) === "DEAD" : j.lead?.leadStatus === "DEAD").length,
      };
      if (stage !== "COMPLETED") {
        writeStageCache(stage, { jobs: activeJobs, total: activeTotal, counts });
      }
      return cacheRef.current[stage];
    } catch (err) {
      console.warn(`[Prefetch] Failed for ${stage}:`, err);
    }
  }, [isActiveForStage, writeStageCache]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(sortPreferenceKey(activeStage));
      if (saved === "newest" || saved === "oldest") {
        setSortOrder(saved);
        return;
      }
    } catch {}
    setSortOrder("oldest");
  }, [activeStage, sortPreferenceKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(sortPreferenceKey(activeStage), sortOrder);
    } catch {}
  }, [activeStage, sortOrder, sortPreferenceKey]);

  function buildJobsUrl(next: {
    stage?: string;
    subTab?: string;
    salespersonFilters?: string[];
    leadSourceFilters?: string[];
  }) {
    const params = new URLSearchParams(searchParams.toString());
    const stage = next.stage ?? activeStage;
    const effectiveSubTab = next.subTab ?? subTab;
    const salesperson = next.salespersonFilters ?? salespersonFilters;
    const leadSources = next.leadSourceFilters ?? leadSourceFilters;

    params.set("stage", stage);
    if (stage === "QUOTE") params.set("subTab", effectiveSubTab || "OPEN");
    else if (stage === "LEAD") params.set("subTab", effectiveSubTab || "NEW");
    else params.delete("subTab");

    params.delete("salesperson");
    for (const salespersonId of salesperson) {
      params.append("salesperson", salespersonId);
    }

    params.delete("leadSource");
    for (const source of leadSources) {
      params.append("leadSource", source);
    }

    return `/jobs?${params.toString()}`;
  }

  // Sync state with URL changes (back/forward or tab click)
  // Only dependent on initStage to prevent toggle-back loops
  useEffect(() => {
    setActiveStage(initStage);
    setSubTab(initSubTab);
    setSalespersonFilters(initSalespersonFilters);
    setLeadSourceFilters(initLeadSourceFilters);
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
  }, [
    initStage,
    initSubTab,
    initSalespersonFilters,
    initLeadSourceFilters,
    searchMode,
    readStageCache,
  ]); // Depend on searchMode too to ensure we clear/show correctly

  const fetchJobs = useCallback(async () => {
    const currentFetchId = ++fetchIdRef.current;
    setError("");
    setIsFetchingStage(true);
    if (!stageHydrated) setLoading(true);

    const isSearching = searchMode;
    const q = search;

    try {
      const shouldFetchAllForStage = !isSearching && (activeStage === "LEAD" || activeStage === "QUOTE" || activeStage === "JOBS" || activeStage === "COMPLETED");
      const stageFilter = activeStage === "JOBS" ? ["SCHEDULED", "INSTALLATION", "INVOICE"] : [activeStage];
      const data = await gql<JobsData>(JOBS_QUERY, {
        ...(isSearching ? {} : { stages: stageFilter }),
        skip: shouldFetchAllForStage ? 0 : page * PAGE_SIZE,
        limit: shouldFetchAllForStage ? 5000 : PAGE_SIZE,
        ...(q ? { search: q } : {}),
      });

      // Ignore stale responses
      if (currentFetchId !== fetchIdRef.current) return;

      const allFetched = data.jobs.results;
      // Search is global across leads, quotes, and jobs; only archived records are hidden.
      const activeJobs = isSearching
        ? allFetched.filter((j) => !j.archivedAt)
        : allFetched.filter((j) => isActiveForStage(j, activeStage));

      setJobs(activeJobs);
      setTotal(activeStage === "JOBS" || activeStage === "COMPLETED" ? activeJobs.length : data.jobs.total);
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
        const activeTotal = activeStage === "JOBS" || activeStage === "COMPLETED" ? activeJobs.length : data.jobs.total;
        cacheRef.current[activeStage] = { jobs: activeJobs, total: activeTotal };
        if (activeStage === "JOBS") {
          writeStageCache(activeStage, { jobs: activeJobs, total: activeTotal });
        }
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
  }, [activeStage, isActiveForStage, page, search, searchMode, stageHydrated, writeStageCache]);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) { router.push("/login"); return; }

    const canUseWarmCache = !searchMode && !search && page === 0 && (activeStage === "LEAD" || activeStage === "QUOTE" || activeStage === "JOBS" || activeStage === "COMPLETED");
    const cached = canUseWarmCache ? readStageCache(activeStage) : null;

    if (canUseWarmCache && cached && cached.jobs.length > 0) {
      // Cache-first for snappy tab switches.
      setJobs(cached.jobs);
      setTotal(cached.total);
      if (cached.counts) setGlobalCounts(cached.counts);
      setStageHydrated(true);
      setLoading(false);
      // Stale-while-revalidate: refresh quietly in background.
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
      prefetchJobsForStage("JOBS");
    }
  }, [prefetchJobsForStage]);


  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) return;
    gql<{ users: { results: User[] } }>(USERS_QUERY, undefined, {
      cacheKey: "users",
      ttlMs: 30 * 60 * 1000,
    })
      .then((d) => setUsers((d.users?.results || []).filter((u) => (u.role || "").toUpperCase() !== "INSTALLER")))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) return;

    const cacheKey = "quote-sent-email-map-v2";
    const cacheTtlMs = 30 * 60 * 1000;

    let cachedMap: Record<string, string> = {};
    try {
      const fromSession = sessionStorage.getItem(cacheKey);
      const fromLocal = localStorage.getItem(cacheKey);
      const raw = fromSession || fromLocal;
      if (raw) {
        const parsed = JSON.parse(raw) as { ts: number; map: Record<string, string> };
        if (Date.now() - parsed.ts < cacheTtlMs) {
          cachedMap = parsed.map || {};
          setQuoteSentByEmail(cachedMap);
        }
      }
    } catch {}

    let cancelled = false;
    (async () => {
      try {
        let skip = 0;
        const limit = 500;
        let total = Number.MAX_SAFE_INTEGER;
        const map: Record<string, string> = { ...cachedMap };
        let changed = false;

        while (skip < total) {
          const data = await gql<{ listEmailLogs: { total: number; results: Array<{ createdAt: string; type?: string; subject?: string; to_email?: string }> } }>(
            `query($skip:Int,$limit:Int){listEmailLogs(skip:$skip,limit:$limit){total results{createdAt type subject to_email}}}`,
            { skip, limit }
          );

          total = data.listEmailLogs.total;
          const batch = data.listEmailLogs.results || [];
          for (const row of batch) {
            const to = (row.to_email || "").trim().toLowerCase();
            const subject = (row.subject || "").toLowerCase();
            const type = (row.type || "").toLowerCase();
            if (!to) continue;
            if (!(subject.includes("quote") || type === "quote")) continue;
            const curr = map[to];
            if (!curr || new Date(row.createdAt).getTime() > new Date(curr).getTime()) {
              map[to] = row.createdAt;
              changed = true;
            }
          }

          if (!cancelled && changed) {
            setQuoteSentByEmail({ ...map });
          }

          skip += batch.length;
          if (batch.length === 0) break;
        }

        if (!cancelled && changed) {
          setQuoteSentByEmail({ ...map });
          const payload = JSON.stringify({ ts: Date.now(), map });
          sessionStorage.setItem(cacheKey, payload);
          localStorage.setItem(cacheKey, payload);
        }
      } catch {
        // best-effort only
      }
    })();

    return () => {
      cancelled = true;
    };
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
    router.replace(buildJobsUrl({
      stage,
      subTab: stage === "QUOTE" ? "OPEN" : stage === "LEAD" ? "NEW" : undefined,
    }));
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("me");
    router.push("/login");
  }

  function updateSalespersonFilters(next: string[]) {
    setSalespersonFilters(next);
    setPage(0);
    router.replace(buildJobsUrl({ salespersonFilters: next }));
  }

  function updateLeadSourceFilters(next: string[]) {
    setLeadSourceFilters(next);
    setPage(0);
    router.replace(buildJobsUrl({ leadSourceFilters: next }));
  }

  function clearAllFilters() {
    setSalespersonFilters([]);
    setLeadSourceFilters([]);
    setPage(0);
    router.replace(buildJobsUrl({ salespersonFilters: [], leadSourceFilters: [] }));
  }

  // Calculate counts for sub-tabs across all fetched non-archived jobs for this stage
  const isQuoteBooked = (job: Job) => Boolean(job.lead?.quoteBookingDate);
  const isCallbackLead = (job: Job) => ["CALLBACK", "ON_HOLD"].includes((job.lead?.leadStatus || "").toUpperCase());
  const isNewLead = (job: Job) => (!job.lead?.leadStatus || job.lead.leadStatus === "NEW") && !isQuoteBooked(job);
  const quoteState = (job: Job) => {
    if (job.quote?.status === "DEFERRED" || isCallbackLead(job) || job.lead?.callbackDate) return "CALLBACK";
    if (job.lead?.leadStatus === "DEAD" || job.quote?.status === "DECLINED") return "DEAD";
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

  const decoratedJobs = useMemo(() => (
    jobs.map((j) => {
      const email = j.client?.contactDetails?.email?.trim().toLowerCase();
      const sentAt = email ? quoteSentByEmail[email] : undefined;
      return sentAt ? { ...j, quoteLastSentAt: sentAt } : j;
    })
  ), [jobs, quoteSentByEmail]);

  const salespersonOptions = useMemo(() => (
    [...users].sort((a, b) => `${a.firstname} ${a.lastname}`.localeCompare(`${b.firstname} ${b.lastname}`))
  ), [users]);

  const leadSourceOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const job of jobs) {
      for (const source of job.lead?.leadSource || []) {
        const label = source.trim();
        if (!label) continue;
        const key = normalizeFilterValue(label);
        if (!seen.has(key)) seen.set(key, label);
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [jobs]);

  const selectedSalespersonLabel = salespersonFilters.length === 0 ? "All" : `${salespersonFilters.length} selected`;
  const selectedLeadSourceLabel = leadSourceFilters.length === 0 ? "All" : `${leadSourceFilters.length} selected`;
  const activeFilterCount = salespersonFilters.length + leadSourceFilters.length;

  // Client-side sub-tab filter
  const filtered = decoratedJobs.filter((job) => {
    if (salespersonFilters.length > 0 && !salespersonFilters.includes(job.lead?.allocatedTo?._id || "")) return false;
    if (leadSourceFilters.length > 0) {
      const jobLeadSources = (job.lead?.leadSource || []).map(normalizeFilterValue).filter(Boolean);
      if (!jobLeadSources.some((source) => leadSourceFilters.includes(source))) return false;
    }
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

    return [...filtered].sort((a, b) => {
      // Lead tab: Quote booked should sort strictly by quote booking date
      // and honor selected sort direction.
      if (activeStage === "LEAD" && subTab === "QUOTE_BOOKED") {
        const aTime = a.lead?.quoteBookingDate ? new Date(a.lead.quoteBookingDate).getTime() : null;
        const bTime = b.lead?.quoteBookingDate ? new Date(b.lead.quoteBookingDate).getTime() : null;

        if (aTime == null && bTime != null) return 1;
        if (aTime != null && bTime == null) return -1;
        if (aTime == null && bTime == null) return 0;

        const asc = (aTime as number) - (bTime as number);
        return sortOrder === "oldest" ? asc : -asc;
      }

      // Callback tabs (both Leads + Quotes): sort strictly by callback date
      // and honor selected sort direction (no future-first special casing).
      if (subTab === "CALLBACK") {
        const aCb = a.lead?.callbackDate;
        const bCb = b.lead?.callbackDate;
        const aTime = aCb ? new Date(aCb).getTime() : null;
        const bTime = bCb ? new Date(bCb).getTime() : null;

        if (aTime == null && bTime != null) return 1;
        if (aTime != null && bTime == null) return -1;
        if (aTime == null && bTime == null) return 0;

        const asc = (aTime as number) - (bTime as number);
        return sortOrder === "oldest" ? asc : -asc;
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

      if (activeStage === "JOBS" || activeStage === "COMPLETED") {
        const aInstall = a.installation?.installDate ? new Date(a.installation.installDate).getTime() : null;
        const bInstall = b.installation?.installDate ? new Date(b.installation.installDate).getTime() : null;
        if (aInstall == null && bInstall != null) return -1;
        if (aInstall != null && bInstall == null) return 1;
        if (aInstall == null && bInstall == null) return leadSortTs(a) - leadSortTs(b);
        const asc = (aInstall as number) - (bInstall as number);
        return sortOrder === "newest" ? -asc : asc;
      }

      const aTime = leadSortTs(a);
      const bTime = leadSortTs(b);
      return sortOrder === "newest" ? bTime - aTime : aTime - bTime;
    });
  }, [filtered, sortOrder, activeStage, subTab]);

  const showSubTabs = !searchMode && (activeStage === "LEAD" || activeStage === "QUOTE");

  // If current page has no rows after filtering/pagination, jump back to page 1.
  useEffect(() => {
    if (!loading && !error && page > 0 && sortedJobs.length > 0 && page * PAGE_SIZE >= sortedJobs.length) {
      setPage(0);
      return;
    }
    if (!loading && !error && page > 0 && jobs.length > 0 && sortedJobs.length === 0) {
      setPage(0);
    }
  }, [loading, error, page, jobs.length, sortedJobs.length]);

  useEffect(() => { setPage(0); }, [subTab, salespersonFilters, leadSourceFilters]);

  // Self-heal: if tab counts say there should be rows but current filtered list is empty,
  // force a refetch to resolve stale cache/list mismatches.
  useEffect(() => {
    if (loading || error || searchMode) return;
    if (salespersonFilters.length > 0 || leadSourceFilters.length > 0) return;
    if (!(activeStage === "LEAD" || activeStage === "QUOTE")) return;

    const expected = globalCounts?.[subTab as keyof typeof globalCounts];
    if (typeof expected === "number" && expected > 0 && sortedJobs.length === 0) {
      fetchJobs();
    }
  }, [
    loading,
    error,
    searchMode,
    salespersonFilters,
    leadSourceFilters,
    activeStage,
    subTab,
    globalCounts,
    sortedJobs.length,
    fetchJobs,
  ]);

  // Client-side paginate after filtering/sorting.
  const paginatedResults = sortedJobs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(sortedJobs.length / PAGE_SIZE));
  const currentPage = page + 1;

  function toggleMultiSelectValue(values: string[], value: string) {
    return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Tabs */}
      <StageTabs
        activeStage={activeStage}
        subTab={subTab}
        onSubTabChange={(tab) => {
          setSubTab(tab);
          setPage(0);
          router.replace(buildJobsUrl({ subTab: tab }));
        }}
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
        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${filtersOpen || activeFilterCount > 0 ? "border-[#e85d04] bg-orange-50 text-[#e85d04]" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            Filters
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-[#e85d04] px-1.5 py-0.5 text-[10px] leading-none text-white">{activeFilterCount}</span>
            )}
          </button>
          <button
            onClick={() => setSortOrder((prev) => (prev === "newest" ? "oldest" : "newest"))}
            className="text-xs bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg font-medium hover:bg-gray-50"
          >
            Sort: {activeStage === "QUOTE" ? "Quote date" : activeStage === "JOBS" || activeStage === "COMPLETED" ? "Install date" : "Created"} {sortOrder === "newest" ? "Latest first" : "Earliest first"}
          </button>
        </div>
        {activeFilterCount > 0 && !filtersOpen && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {salespersonFilters.length > 0 && (
              <span className="rounded-full bg-orange-50 px-2 py-1 text-[11px] font-medium text-[#e85d04]">
                Salespeople: {selectedSalespersonLabel}
              </span>
            )}
            {leadSourceFilters.length > 0 && (
              <span className="rounded-full bg-orange-50 px-2 py-1 text-[11px] font-medium text-[#e85d04]">
                Lead sources: {selectedLeadSourceLabel}
              </span>
            )}
            <button
              type="button"
              onClick={clearAllFilters}
              className="rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-500"
            >
              Clear all
            </button>
          </div>
        )}
        {filtersOpen && (
          <div className="mt-2 space-y-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-gray-800">Filter jobs</p>
                <p className="text-[11px] text-gray-400">Choose one or more salespeople and lead sources.</p>
              </div>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="text-[11px] font-semibold text-[#e85d04]"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Salespeople</span>
                <span className="text-[11px] text-gray-400">{selectedSalespersonLabel}</span>
              </div>
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1">
                {salespersonOptions.map((u) => {
                  const active = salespersonFilters.includes(u._id);
                  return (
                    <button
                      key={u._id}
                      type="button"
                      onClick={() => updateSalespersonFilters(toggleMultiSelectValue(salespersonFilters, u._id))}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${active ? "border-[#e85d04] bg-orange-50 text-[#e85d04]" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
                    >
                      {u.firstname} {u.lastname}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Lead sources</span>
                <span className="text-[11px] text-gray-400">{selectedLeadSourceLabel}</span>
              </div>
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1">
                {leadSourceOptions.length > 0 ? (
                  leadSourceOptions.map((source) => {
                    const key = normalizeFilterValue(source);
                    const active = leadSourceFilters.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => updateLeadSourceFilters(toggleMultiSelectValue(leadSourceFilters, key))}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${active ? "border-[#e85d04] bg-orange-50 text-[#e85d04]" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}
                      >
                        {source}
                      </button>
                    );
                  })
                ) : (
                  <span className="px-1.5 py-1 text-[11px] text-gray-400">No lead sources found</span>
                )}
              </div>
            </div>
          </div>
        )}
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
