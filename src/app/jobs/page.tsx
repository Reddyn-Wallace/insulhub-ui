"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import dynamic from "next/dynamic";
import { gql } from "@/lib/graphql";
import { JOBS_QUERY } from "@/lib/queries";
import StageTabs from "@/components/StageTabs";
import JobCard from "@/components/JobCard";
import { getSplitRevision, loadSplits } from "@/lib/installation-splits/client";
import { searchVisits } from "@/lib/installation-splits/views";
import { isBoardStage, loadBoard, recentBoard, warmBoard, type BoardJob as Job, type BoardRows, type JobsData } from "@/lib/crm-read/board";
import { loadSalesDirectory } from "@/lib/crm-read/directory";
import { calendarDataRevision, calendarLastWrite, calendarLastWriteKey } from "@/lib/calendar/cache";
import { clearCrmReadSnapshots, isCrmReadDenied } from "@/lib/crm-read/session";
import { crmFreshMs } from "@/lib/crm-read/client";
import { boardPageSize as PAGE_SIZE, compareQuoteDate, loadQuoteContacts, quoteContactsKey, readInitialOpenQuotes, QuoteSelectionChanged, quoteState, recentQuoteContacts, type QuoteContacts } from "@/lib/crm-read/quotes";
import { laterSend, loadCrmEmailIndex, readCachedCrmEmailIndex, readRecordedSend, sendReceiptPrefix } from "@/lib/crm-read/sent-index";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import { LEAD_SOURCE_OPTIONS, canonicalLeadSourceLabel, normalizeLeadSourceValue } from "@/lib/lead-sources";

const UNASSIGNED_SALESPERSON = "UNASSIGNED";
const SORT_PREFERENCE_KEY = "jobs-sort-order";
const noJobs: Job[] = [];
interface User { _id: string; firstname: string; lastname: string; role?: string }

const isQuoteBooked = (job: Job) => Boolean(job.lead?.quoteBookingDate);
const isCallbackLead = (job: Job) => ["CALLBACK", "ON_HOLD"].includes((job.lead?.leadStatus || "").toUpperCase());
const isNewLead = (job: Job) => (!job.lead?.leadStatus || job.lead.leadStatus === "NEW") && !isQuoteBooked(job);

function JobsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initSearch = searchParams.get("search") || "";
  const requestedStage = searchParams.get("stage") || "LEAD";
  const initStage = requestedStage === "AWAITING_COMPLETION" ? "JOBS" : requestedStage;
  useEffect(() => {
    if (requestedStage !== "AWAITING_COMPLETION") return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("stage", "JOBS");
    params.delete("subTab");
    router.replace(`/jobs?${params.toString()}`);
  }, [requestedStage, router, searchParams]);
  const initSubTab = searchParams.get("subTab") || (initStage === "QUOTE" ? "OPEN" : initStage === "LEAD" ? "NEW" : "ALL");
  const initSalespersonFilters = useMemo(() => searchParams.getAll("salesperson").filter(Boolean), [searchParams]);
  const initLeadSourceFilters = useMemo(() => searchParams.getAll("leadSource").map(normalizeLeadSourceValue).filter(Boolean), [searchParams]);

  const activeStage = initStage;
  const [subTab, setSubTab] = useState(initSubTab);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState(initSearch);
  const [searchInput, setSearchInput] = useState(initSearch);
  const [searchMode, setSearchMode] = useState(initSearch.trim().length > 0);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("oldest");
  const [salespersonFilters, setSalespersonFilters] = useState<string[]>(initSalespersonFilters);
  const [initialOpenQuotes, setInitialOpenQuotes] = useState<{ rows: Job[]; writeAt: number; revision: number } | null>(null);
  const [result, setResult] = useState<(BoardRows & { key: string }) | null>(null);
  const needsQuoteSalespeople = !searchMode && activeStage === "QUOTE" && salespersonFilters.length > 0;
  const resultKey = searchMode ? `search:${search}:${page}` : `stage:${activeStage}${needsQuoteSalespeople ? ":with-salespeople" : ""}`;
  const stageHydrated = result?.key === resultKey;
  const jobs = stageHydrated ? result.jobs : noJobs;
  const [users, setUsers] = useState<User[]>([]);
  const [leadSourceFilters, setLeadSourceFilters] = useState<string[]>(initLeadSourceFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [leadSourceMenuOpen, setLeadSourceMenuOpen] = useState(false);
  const [quoteCards, setQuoteCards] = useState<{ key: string; data: QuoteContacts } | null>(null);
  const [quoteCardsError, setQuoteCardsError] = useState<{ key: string; message: string } | null>(null);
  const [quoteCardsRetry, setQuoteCardsRetry] = useState(0);
  const [recordedQuoteSends, setRecordedQuoteSends] = useState<Record<string, string>>({});
  const [quoteSentByEmail, setQuoteSentByEmail] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const error = loadError?.key === resultKey ? loadError.message : "";
  const loading = !stageHydrated && !error;

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0);
  const leadSourceMenuRef = useRef<HTMLDivElement | null>(null);
  const sortPreferenceKey = useCallback((stage: string) => `${SORT_PREFERENCE_KEY}:${stage}`, []);
  const viewedStage = useRef<string | null>(null);
  const recoveredBoard = useRef(false);
  const recoveredQuoteCards = useRef(false);
  const initialQuoteRead = useRef(false);
  const refreshedQuoteSelection = useRef<string | null>(null);

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
    search?: string;
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

    const query = next.search ?? search;
    if (query.trim()) params.set("search", query);
    else params.delete("search");

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

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearchInput(initSearch);
    setSearch(initSearch);
    setSearchMode(initSearch.trim().length > 0);
    setPage(0);
  }, [initSearch]);

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  // Sync state with URL changes (back/forward or tab click)
  // Preserve the open source picker while its selections update the URL.
  useEffect(() => {
    setSubTab(initSubTab);
    setSalespersonFilters(initSalespersonFilters);
    setLeadSourceFilters(initLeadSourceFilters);
    setPage(0);
  }, [initStage, initSubTab, initSalespersonFilters, initLeadSourceFilters]);

  useEffect(() => {
    setLeadSourceMenuOpen(false);
  }, [initStage, initSubTab]);

  useEffect(() => {
    if (!filtersOpen) setLeadSourceMenuOpen(false);
  }, [filtersOpen]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!leadSourceMenuOpen) return;
      const target = event.target as Node | null;
      if (target && leadSourceMenuRef.current && !leadSourceMenuRef.current.contains(target)) {
        setLeadSourceMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setLeadSourceMenuOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [leadSourceMenuOpen]);

  const allowOpenPreview = activeStage === "QUOTE" && initSubTab === "OPEN" && subTab === "OPEN" &&
    !searchMode && !initSearch.trim() && salespersonFilters.length === 0 && leadSourceFilters.length === 0 &&
    initSalespersonFilters.length === 0 && initLeadSourceFilters.length === 0 && page === 0;
  const openPreviewAllowed = useRef(allowOpenPreview);
  openPreviewAllowed.current = allowOpenPreview;
  const coldQuoteCheck = searchParams.get("quoteReadCheck") === "cold" && activeStage === "QUOTE";
  const searchPage = searchMode ? page : 0;
  const fetchJobs = useCallback(async (force = false) => {
    const token = localStorage.getItem("token");
    if (!token) { router.push("/login"); return; }
    const currentFetchId = ++fetchIdRef.current;
    const revision = getSplitRevision();
    const current = () => currentFetchId === fetchIdRef.current && localStorage.getItem("token") === token;
    setLoadError(null);
    if (!force) {
      setInitialOpenQuotes(null);
      initialQuoteRead.current = false;
    }

    try {
      if (searchMode) {
        const data = await gql<JobsData>(JOBS_QUERY, { skip: searchPage * PAGE_SIZE, limit: PAGE_SIZE, search }, { token });
        if (!current()) return;
        const splits = await loadSplits(data.jobs.results.map(job => job._id), token);
        if (!current()) return;
        if (revision !== getSplitRevision()) throw Error("Visits changed while loading. Please retry.");
        setResult({ key: resultKey, jobs: searchVisits(data.jobs.results, splits).filter(job => !job.archivedAt),
          total: data.jobs.total });
        return;
      }

      if (!isBoardStage(activeStage)) throw Error("This job stage is unavailable.");
      const cached = coldQuoteCheck ? null : await recentBoard(activeStage, token, needsQuoteSalespeople);
      if (!current()) return;
      if (cached && !force) {
        recoveredBoard.current = cached.recovered === true;
        setResult({ key: resultKey, ...cached.data });
      }
      if (!force && cached && !cached.recovered && Date.now() - cached.checkedAt < crmFreshMs) return;
      if (!cached && !force && openPreviewAllowed.current) {
        initialQuoteRead.current = true;
        const writeAt = calendarLastWrite();
        const writeRevision = calendarDataRevision();
        void readInitialOpenQuotes(token).then(rows => {
          if (current() && initialQuoteRead.current && calendarLastWrite() === writeAt && calendarDataRevision() === writeRevision) {
            setInitialOpenQuotes({ rows, writeAt, revision: writeRevision });
          }
        }).catch(() => {});
      }
      const data = await loadBoard(activeStage, token, needsQuoteSalespeople);
      if (current()) {
        recoveredBoard.current = false;
        setResult({ key: resultKey, ...data });
      }
    } catch (err) {
      if (!current()) return;
      const message = err instanceof Error ? err.message : "Failed to load jobs.";
      if (isCrmReadDenied(err)) {
        initialQuoteRead.current = false;
        recoveredBoard.current = false;
        recoveredQuoteCards.current = false;
        clearCrmReadSnapshots();
        setResult(null);
        setInitialOpenQuotes(null);
      }
      setLoadError({ key: resultKey, message });
    }
  }, [activeStage, coldQuoteCheck, needsQuoteSalespeople, search, searchMode, searchPage, resultKey, router]);

  useEffect(() => {
    void fetchJobs();
    return () => { ++fetchIdRef.current; };
  }, [fetchJobs]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const onSharedStorage = (event: StorageEvent) => {
      if (event.key === calendarLastWriteKey && localStorage.getItem("token") === token &&
          (recoveredBoard.current || recoveredQuoteCards.current || initialQuoteRead.current)) {
        initialQuoteRead.current = false;
        recoveredBoard.current = false;
        recoveredQuoteCards.current = false;
        setResult(null);
        setInitialOpenQuotes(null);
        setQuoteCards(null);
        void fetchJobs(true);
        return;
      }
      if ((event.key === "token" || event.key === null) && localStorage.getItem("token") !== token) {
        ++fetchIdRef.current;
        setResult(null);
        setInitialOpenQuotes(null);
        setUsers([]);
        setQuoteSentByEmail({});
        setRecordedQuoteSends({});
        setQuoteCards(null);
        viewedStage.current = null;
        if (localStorage.getItem("token")) window.location.reload();
        else router.replace("/login");
      }
    };
    window.addEventListener("storage", onSharedStorage);
    return () => window.removeEventListener("storage", onSharedStorage);
  }, [fetchJobs, router]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!filtersOpen || !token) return;
    let current = true;
    void loadSalesDirectory(token).then(users => {
      if (current && localStorage.getItem("token") === token) setUsers(users);
    }).catch(() => {});
    return () => { current = false; };
  }, [filtersOpen]);

  // Debounced search
  function handleSearchInput(val: string) {
    setSearchInput(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const isSearchMode = val.trim().length > 0;
      setSearch(val);
      setSearchMode(isSearchMode);
      setPage(0);
      router.replace(buildJobsUrl({ search: val }), { scroll: false });
    }, 400);
  }

  function clearSearch() {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    router.replace(buildJobsUrl({ search: "" }), { scroll: false });
    setSearchInput("");
    setSearch("");
    setSearchMode(false);
    setPage(0);
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


  const counts = useMemo(() => ({
    ALL: jobs.length,
    NEW: jobs.filter((j) => isNewLead(j)).length,
    CALLBACK: jobs.filter((j) => activeStage === "QUOTE" ? quoteState(j) === "CALLBACK" : isCallbackLead(j)).length,
    QUOTE_BOOKED: jobs.filter((j) => isQuoteBooked(j)).length,
    OPEN: jobs.filter((j) => quoteState(j) === "OPEN").length,
    DEAD: jobs.filter((j) => activeStage === "QUOTE" ? quoteState(j) === "DEAD" : j.lead?.leadStatus === "DEAD").length,
  }), [activeStage, jobs]);

  const salespersonOptions = useMemo(() => (
    [
      { _id: UNASSIGNED_SALESPERSON, firstname: "Unassigned", lastname: "" },
      ...[...users].sort((a, b) => `${a.firstname} ${a.lastname}`.localeCompare(`${b.firstname} ${b.lastname}`)),
    ]
  ), [users]);

  const selectedSalespersonLabel = salespersonFilters.length === 0 ? "All" : `${salespersonFilters.length} selected`;
  const selectedLeadSourceLabels = useMemo(
    () => leadSourceFilters.map((value) => canonicalLeadSourceLabel(value)),
    [leadSourceFilters],
  );
  const selectedLeadSourceLabel = selectedLeadSourceLabels.length === 0
    ? "All"
    : selectedLeadSourceLabels.length <= 2
      ? selectedLeadSourceLabels.join(", ")
      : `${selectedLeadSourceLabels.slice(0, 2).join(", ")} +${selectedLeadSourceLabels.length - 2}`;
  const leadSourceSelectedCountLabel = selectedLeadSourceLabels.length === 0 ? "All sources" : `${selectedLeadSourceLabels.length} selected`;
  const activeFilterCount = salespersonFilters.length + leadSourceFilters.length;

  // Client-side sub-tab filter
  const filtered = useMemo(() => jobs.filter((job) => {
    if (salespersonFilters.length > 0 && !salespersonFilters.includes(job.lead?.allocatedTo?._id || UNASSIGNED_SALESPERSON)) return false;
    if (leadSourceFilters.length > 0) {
      const jobLeadSources = (job.lead?.leadSource || []).map(normalizeLeadSourceValue).filter(Boolean);
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
  }), [activeStage, jobs, leadSourceFilters, salespersonFilters, searchMode, subTab]);

  const sortedJobs = useMemo(() => {
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

      if (activeStage === "QUOTE") return compareQuoteDate(a, b, sortOrder === "newest");

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
    if (!searchMode && !loading && !error && page > 0 && sortedJobs.length > 0 && page * PAGE_SIZE >= sortedJobs.length) {
      setPage(0);
      return;
    }
    if (!searchMode && !loading && !error && page > 0 && jobs.length > 0 && sortedJobs.length === 0) {
      setPage(0);
    }
  }, [loading, error, page, jobs.length, sortedJobs.length, searchMode]);

  useEffect(() => { setPage(0); }, [subTab, salespersonFilters, leadSourceFilters]);

  // Client-side paginate after filtering/sorting.
  const visibleRows = useMemo(() => (
    searchMode ? sortedJobs : sortedJobs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  ), [page, searchMode, sortedJobs]);
  const quoteCardKey = !searchMode && activeStage === "QUOTE" ? quoteContactsKey(visibleRows) : "";
  const contacts = quoteCardKey && quoteCards?.key === quoteCardKey ? quoteCards.data : null;
  const quoteError = quoteCardsError?.key === quoteCardKey ? quoteCardsError.message : "";
  const quoteCardsLoading = Boolean(quoteCardKey && !contacts && !quoteError);

  useEffect(() => {
    if (!quoteCardKey) return;
    const token = localStorage.getItem("token");
    if (!token) return;
    let active = true;
    setQuoteCardsError(null);
    const selection = visibleRows.map(job => job._id).sort().join(",");
    void recentQuoteContacts(visibleRows, token).then(prior => {
      if (!active || localStorage.getItem("token") !== token) return;
      if (prior) {
        recoveredQuoteCards.current = prior.recovered === true;
        setQuoteCards({ key: quoteCardKey, data: prior.data });
      }
      return loadQuoteContacts(visibleRows, token);
    })
      .then(data => {
        if (!data || !active || localStorage.getItem("token") !== token) return;
        refreshedQuoteSelection.current = null;
        recoveredQuoteCards.current = false;
        setQuoteCards({ key: quoteCardKey, data });
      })
      .catch(err => {
        if (active && localStorage.getItem("token") === token) {
          recoveredQuoteCards.current = false;
          setQuoteCards(null);
          if (isCrmReadDenied(err) || err instanceof QuoteSelectionChanged) {
            setInitialOpenQuotes(null);
            initialQuoteRead.current = false;
          }
          if (isCrmReadDenied(err)) {
            ++fetchIdRef.current;
            recoveredBoard.current = false;
            clearCrmReadSnapshots();
            setResult(null);
            setLoadError({ key: resultKey, message: "Could not access this quote list." });
          }
          setQuoteCardsError({ key: quoteCardKey, message: err instanceof Error ? err.message : "Could not load quote cards." });
          if (err instanceof QuoteSelectionChanged && refreshedQuoteSelection.current !== selection) {
            refreshedQuoteSelection.current = selection;
            void fetchJobs(true);
          }
        }
      });
    return () => { active = false; };
  }, [fetchJobs, quoteCardKey, quoteCardsRetry, result, resultKey, visibleRows]);

  const firstOpenCards = useMemo(() =>
    [...(initialOpenQuotes?.rows || noJobs)].sort((a, b) => compareQuoteDate(a, b, sortOrder === "newest")).slice(0, PAGE_SIZE),
  [initialOpenQuotes, sortOrder]);
  const showOpenPreview = allowOpenPreview && !!initialOpenQuotes &&
    initialOpenQuotes.writeAt === calendarLastWrite() && initialOpenQuotes.revision === calendarDataRevision() &&
    firstOpenCards.length > 0 &&
    (!stageHydrated || (quoteCardsLoading && firstOpenCards.length === visibleRows.length &&
      firstOpenCards.every((row, index) => row._id === visibleRows[index]._id && row.updatedAt === visibleRows[index].updatedAt)));

  useEffect(() => {
    if (stageHydrated && !showOpenPreview && initialQuoteRead.current) {
      initialQuoteRead.current = false;
      setInitialOpenQuotes(null);
    }
  }, [stageHydrated, showOpenPreview]);

  const displayedJobs = useMemo(() => {
    if (showOpenPreview) return firstOpenCards;
    if (!quoteCardKey) return visibleRows;
    if (!contacts) return noJobs;
    return visibleRows.flatMap(job => {
      const detail = contacts[job._id];
      return detail ? [{ ...job, client: detail.client, lead: { ...job.lead, allocatedTo: detail.lead?.allocatedTo } }] : [];
    });
  }, [contacts, firstOpenCards, quoteCardKey, showOpenPreview, visibleRows]);

  const paginatedResults = useMemo(() => displayedJobs.map(job => {
    const email = job.client?.contactDetails?.email?.trim().toLowerCase();
    const sentAt = email ? laterSend(quoteSentByEmail[email], recordedQuoteSends[`${job._id}:${email}`]) : undefined;
    return sentAt ? { ...job, quoteLastSentAt: sentAt } : job;
  }), [displayedJobs, quoteSentByEmail, recordedQuoteSends]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if ((!stageHydrated && !showOpenPreview) || !token || (!searchMode && activeStage !== "QUOTE") ||
        !displayedJobs.some(job => job.stage === "QUOTE" && job.client?.contactDetails?.email)) return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && localStorage.getItem("token") === token;
    const showHistory = (index: { quote: Record<string, string> } | null) => {
      if (index && current()) setQuoteSentByEmail(index.quote);
    };
    if (stageHydrated || error) void loadCrmEmailIndex(token, showHistory, controller.signal).catch(() => {});
    else void readCachedCrmEmailIndex(token).then(showHistory).catch(() => {});
    const records = displayedJobs.flatMap(job => {
      const email = job.stage === "QUOTE" && job.client?.contactDetails?.email?.trim().toLowerCase();
      return email ? [{ id: job._id, email }] : [];
    });
    async function loadReceipts() {
      if (!token) return;
      const entries = await Promise.all(records.map(async ({ id, email }) => [
        `${id}:${email}`, await readRecordedSend("quote", id, email, token),
      ] as const));
      const confirmed: Record<string, string> = {};
      for (const [key, sentAt] of entries) if (sentAt) confirmed[key] = sentAt;
      if (current()) setRecordedQuoteSends(confirmed);
    }
    function onReceipt(event: StorageEvent) {
      if (event.key?.startsWith(sendReceiptPrefix)) void loadReceipts().catch(() => {});
    }
    void loadReceipts().catch(() => {});
    window.addEventListener("storage", onReceipt);
    return () => { controller.abort(); window.removeEventListener("storage", onReceipt); };
  }, [activeStage, displayedJobs, error, searchMode, showOpenPreview, stageHydrated]);

  useEffect(() => {
    if (!stageHydrated || quoteCardsLoading || searchMode || viewedStage.current !== null) return;
    const timer = window.setTimeout(async () => {
      if (document.visibilityState !== "visible") return;
      viewedStage.current = activeStage;
      for (const stage of ["LEAD", "QUOTE", "JOBS"]) {
        if (stage !== activeStage) await warmBoard(stage).catch(() => {});
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [activeStage, quoteCardsLoading, searchMode, stageHydrated]);

  const rowCount = searchMode && stageHydrated ? result.total : sortedJobs.length;
  const totalPages = Math.max(1, Math.ceil(rowCount / PAGE_SIZE));
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
        counts={showSubTabs && stageHydrated ? counts : undefined}
        loadFollowupCount={stageHydrated && !searchMode && !quoteCardsLoading && !quoteError}
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
                Lead source: {selectedLeadSourceLabel}
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
                <p className="text-[11px] text-gray-400">Choose one or more salespeople and lead source options.</p>
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
                      aria-pressed={active}
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
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Lead source</span>
                <span className="text-[11px] text-gray-400">{leadSourceSelectedCountLabel}</span>
              </div>
              <div className="relative" ref={leadSourceMenuRef}>
                <button
                  type="button"
                  onClick={() => setLeadSourceMenuOpen((open) => !open)}
                  aria-expanded={leadSourceMenuOpen}
                  aria-controls="lead-source-options"
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                    leadSourceMenuOpen
                      ? "border-[#e85d04] bg-orange-50 text-gray-800"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {selectedLeadSourceLabels.length === 0
                      ? "All lead sources"
                      : selectedLeadSourceLabel}
                  </span>
                  <span className="text-xs font-semibold text-gray-400">{leadSourceMenuOpen ? "Close" : "Select"}</span>
                </button>
                {leadSourceMenuOpen && (
                  <div id="lead-source-options" className="absolute left-0 right-0 top-full z-20 mt-2 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
                    <div className="max-h-60 overflow-y-auto pr-1">
                      <div className="grid gap-1">
                        {LEAD_SOURCE_OPTIONS.map((source) => {
                          const key = normalizeLeadSourceValue(source);
                          const active = leadSourceFilters.includes(key);
                          return (
                            <button
                              key={source}
                              type="button"
                              aria-pressed={active}
                              onClick={() => updateLeadSourceFilters(toggleMultiSelectValue(leadSourceFilters, key))}
                              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                                active
                                  ? "bg-orange-50 text-[#e85d04]"
                                  : "text-gray-700 hover:bg-gray-50"
                              }`}
                            >
                              <span>{source}</span>
                              <span className={`ml-3 inline-flex h-4 w-16 items-center justify-center rounded border px-1 text-[10px] font-bold ${active ? "border-[#e85d04] bg-[#e85d04] text-white" : "border-gray-300 text-transparent"}`}>
                                Selected
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
                      <button type="button" onClick={() => updateLeadSourceFilters([])} disabled={leadSourceFilters.length === 0} className="rounded-lg px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40">Clear sources</button>
                      <button type="button" onClick={() => setLeadSourceMenuOpen(false)} className="rounded-lg bg-[#e85d04] px-4 py-2 text-xs font-semibold text-white">Done</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Pagination */}
      {stageHydrated && totalPages > 1 && (
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
            <span className="text-[10px] text-gray-400">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, rowCount)} of {rowCount}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setPage((p) => Math.min(totalPages - 1, p + 1)); window.scrollTo(0, 0); }}
              disabled={page >= totalPages - 1}
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
      <div className={`flex-1 transition-opacity duration-200 ${loading && !showOpenPreview ? "opacity-50 pointer-events-none" : "opacity-100"}`}>
        {error && (
          <div role="status" className="mx-4 mt-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {showOpenPreview ? "Couldn’t verify the full Open list. Showing the quotes already loaded." : stageHydrated ? "Couldn’t update this list. Showing the last loaded results." : error}
            <button onClick={() => void fetchJobs(true)} className="ml-2 underline">Retry</button>
          </div>
        )}
        {quoteError && !error && (
          <div role="status" className="mx-4 mt-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {quoteError}
            <button onClick={() => {
              void fetchJobs(true);
              setQuoteCardsRetry(value => value + 1);
            }} className="ml-2 underline">Retry</button>
          </div>
        )}
        {showOpenPreview && !error && <p role="status" className="px-4 pb-1 pt-2 text-xs text-gray-600">Checking for more open quotes…</p>}
        {(loading || quoteCardsLoading) && !showOpenPreview ? <LoadingSkeleton /> : !showOpenPreview && (!stageHydrated || (quoteError && !contacts)) ? null : paginatedResults.length === 0 ? (
          <div className="px-4 pt-8 text-center text-gray-400 text-sm">
            {searchMode ? `No results for "${searchInput}"` : "No jobs found"}
          </div>
        ) : (
          <div className="px-4 pt-1">
            {paginatedResults.map((job) => (
              <JobCard key={`${job._id}:${job.splitVisit?.id || "job"}`} job={job} />
            ))}
          </div>
        )}
      </div>


    </div>
  );
}

const QuoteFirstPageCheck = dynamic(() => import("@/components/QuoteFirstPageCheck"));

function JobsScreen() {
  const params = useSearchParams();
  if (params.get("quoteReadCheck") === "1" && params.get("stage") === "QUOTE") return <QuoteFirstPageCheck />;
  return <JobsPageContent />;
}

export default function JobsPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <JobsScreen />
    </Suspense>
  );
}
