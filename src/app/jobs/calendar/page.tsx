"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getSplitRevision } from "@/lib/installation-splits/client";
import InstallationVisits from "@/components/InstallationVisits";
import { calendarSource, calendarVisits } from "@/lib/installation-splits/views";
import type { SavedSplit, VisitLabel } from "@/lib/installation-splits/projection";
import { useRouter } from "next/navigation";
import { gql } from "@/lib/graphql";
import { CalendarCacheInvalidated, calendarCacheScope, calendarDataRevision, createCalendarCache } from "@/lib/calendar/cache";
import { calendarDateBounds, calendarDay } from "@/lib/calendar/dates";
import BottomSheet from "@/components/BottomSheet";
import InstallPlanningForm, { InstallPlanningActions } from "@/components/InstallPlanningForm";
import { parseInstallMeta } from "@/lib/install-planning";
import { useAppDialog } from "@/components/AppDialog";

interface CalendarJob {
  installationSplit?: SavedSplit | null;
  splitSource?: CalendarJob;
  splitVisit?: VisitLabel;
  _id: string;
  jobNumber: number;
  stage: string;
  notes?: string | null;
  installation?: {
    installDate?: string | null;
    installNote?: string | null;
    installStatus?: string | null;
    checkSheetSignedAsComplete?: boolean | null;
  };
  installerChecksheet?: {
    _id?: string | null;
    complete?: boolean | null;
  } | null;
  client?: {
    contactDetails?: {
      name?: string;
      email?: string;
      phoneMobile?: string;
      phoneSecondary?: string;
      streetAddress?: string;
      suburb?: string;
      city?: string;
    };
  };
  quote?: {
    c_total?: number | null;
    wall?: { SQM?: number | null };
    ceiling?: { SQM?: number | null };
  };
}

interface CalendarPlaceholder {
  source: "overlay";
  kind: "placeholder";
  id: string;
  startsAt: string;
  endsAt?: string | null;
  title: string;
  status: "pencilled" | "confirmed";
  scope: "" | "internal" | "external" | "both";
  note?: string | null;
  linkedJobId?: string | null;
}

interface InstallPlanningMeta {
  source?: "overlay";
  jobId?: string;
  status: "confirmed" | "pencilled";
  note: string;
  scope: "internal" | "external" | "both" | "";
}

type InstallScope = InstallPlanningMeta["scope"];

interface InstallPlanningApiRow {
  jobId?: string;
  status?: "confirmed" | "pencilled";
  note?: string;
  installScope?: "internal" | "external" | "both" | "";
  scope?: "internal" | "external" | "both" | "";
}

function toCalendarInstallPlanning(row: InstallPlanningApiRow): InstallPlanningMeta {
  return {
    source: "overlay",
    jobId: row.jobId,
    status: row.status || "confirmed",
    note: row.note || "",
    scope: row.installScope || row.scope || "",
  };
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const UPDATE_INSTALLATION = `
  mutation UpdateInstallation($input: UpdateJobInput!) {
    updateJob(input: $input) {
      _id
      installation {
        installDate
        installNote
        installStatus
        checkSheetSignedAsComplete
      }
    }
  }
`;

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function startOfWeekMonday(date: Date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, amount: number) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + amount);
  return d;
}

function dateKeyLocal(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatMonth(date: Date) {
  return new Intl.DateTimeFormat("en-NZ", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function sameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function scrollToPageTop(behavior: ScrollBehavior = "smooth") {
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior });
  });
}

function formatCurrency(value?: number | null) {
  const amount = value || 0;
  return `$${amount.toLocaleString("en-NZ", { maximumFractionDigits: 0 })}`;
}

function formatSqm(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} sqm`;
}

function installScopeBadge(scope: InstallScope) {
  if (scope === "internal") {
    return {
      label: "Internal",
      shortLabel: "INT",
      className: "border-blue-200 bg-blue-100 text-blue-800",
      dotClassName: "bg-blue-600",
    };
  }

  if (scope === "external") {
    return {
      label: "External",
      shortLabel: "EXT",
      className: "border-teal-200 bg-teal-100 text-teal-800",
      dotClassName: "bg-teal-600",
    };
  }

  if (scope === "both") {
    return {
      label: "Internal + External",
      shortLabel: "BOTH",
      className: "border-fuchsia-200 bg-fuchsia-100 text-fuchsia-800",
      dotClassName: "bg-fuchsia-600",
    };
  }

  return {
    label: "Scope not set",
    shortLabel: "SET",
    className: "border-red-200 bg-red-50 text-red-700",
    dotClassName: "bg-red-500",
  };
}

function combinedSqm(job: CalendarJob) {
  return (job.quote?.wall?.SQM || 0) + (job.quote?.ceiling?.SQM || 0);
}

function normalizedInstallStatus(job: CalendarJob) {
  return (job.installation?.installStatus || "").trim().toUpperCase();
}

function isCompleteForCalendar(job: CalendarJob) {
  if (job.splitVisit) return job.splitVisit.state === "completed";
  if (job.stage === "COMPLETED") return true;
  return ["INSTALLED_AS_QUOTED", "INSTALLED_WITH_VARIATIONS_FROM_QUOTE"].includes(normalizedInstallStatus(job));
}

function calendarStatusLabel(job: CalendarJob) {
  const installStatus = normalizedInstallStatus(job);
  if (installStatus === "INSTALLED_WITH_VARIATIONS_FROM_QUOTE") return "Variation";
  if (installStatus === "INSTALLED_AS_QUOTED") return "Installed";
  if (job.stage === "COMPLETED") return "Completed";
  return "Planned";
}

function checksheetBadge(job: CalendarJob) {
  if (job.installerChecksheet?.complete) {
    return { label: "CS ✓", title: "Checksheet completed", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  }

  if (job.installerChecksheet?._id || job.installation?.checkSheetSignedAsComplete) {
    return { label: "CS draft", title: "Checksheet started, not completed", className: "border-blue-200 bg-blue-50 text-blue-700" };
  }

  return { label: "CS missing", title: "No checksheet found", className: "border-amber-200 bg-amber-50 text-amber-700" };
}

function address(job: CalendarJob) {
  return [
    job.client?.contactDetails?.streetAddress,
    job.client?.contactDetails?.suburb,
    job.client?.contactDetails?.city,
  ].filter(Boolean).join(", ");
}

function customerPhone(job: CalendarJob) {
  return [
    job.client?.contactDetails?.phoneMobile,
    job.client?.contactDetails?.phoneSecondary,
  ].map((phone) => phone?.trim()).find(Boolean) || "";
}

function toDatetimeLocal(iso?: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromDatetimeLocal(value: string) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function sameInstallDate(a?: string | null, b?: string | null) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const aTime = new Date(a).getTime();
  const bTime = new Date(b).getTime();
  return !Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime === bTime;
}

function timeFromDatetimeLocal(value?: string | null) {
  const local = toDatetimeLocal(value);
  if (!local || !local.includes("T")) return "";
  return local.split("T")[1]?.slice(0, 5) || "";
}

function mergeDateAndTime(date: Date, time: string) {
  const safeTime = /^\d{2}:\d{2}$/.test(time) ? time : "12:00";
  return `${dateKeyLocal(date)}T${safeTime}`;
}

const refreshAfterMs = 30_000;
const jobsCache = createCalendarCache<CalendarJob[]>("jobs");
const placeholderCache = createCalendarCache<CalendarPlaceholder[]>("placeholders");
const planningCache = createCalendarCache<Record<string, InstallPlanningMeta>>("planning");
const noJobs: CalendarJob[] = [];
const noPlaceholders: CalendarPlaceholder[] = [];

function calendarRangeForMonth(month: Date) {
  const calendarStart = startOfWeekMonday(month);
  const calendarEnd = addDays(startOfWeekMonday(endOfMonth(month)), 6);
  const from = dateKeyLocal(calendarStart);
  const to = dateKeyLocal(calendarEnd);
  return { calendarStart, calendarEnd, from, to, key: `${from}_${to}` };
}

type MonthRange = ReturnType<typeof calendarRangeForMonth>;
type CalendarRead = "jobs" | "placeholders" | "planning";

function inWindow(key: string, date?: string | null) {
  const day = calendarDay(date);
  const [from, to] = key.split("_");
  return day >= from && day <= to;
}

class CalendarRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function readCalendar<T>(path: string, token: string, errorMessage: string): Promise<T> {
  const response = await fetch(path, {
    headers: { "x-access-token": token },
    cache: "no-store",
    signal: AbortSignal.timeout(14_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new CalendarRequestError(data?.error || errorMessage, response.status);
  return data as T;
}

function loadMonthJobs(scope: string, token: string, range: MonthRange) {
  return jobsCache.refresh(scope, range.key, async () => {
    const revision = calendarDataRevision();
    const splitRevision = getSplitRevision();
    const params = new URLSearchParams({ start: range.from, end: range.to, includeUnscheduled: "0" });
    const data = await readCalendar<{ jobs: CalendarJob[] }>(
      `/api/calendar/jobs?${params}`, token, "Could not load scheduled jobs.",
    );
    if (revision !== calendarDataRevision() || splitRevision !== getSplitRevision()) throw new CalendarCacheInvalidated();
    if (!Array.isArray(data.jobs)) throw Error("The calendar returned an incomplete schedule.");
    return data.jobs;
  });
}

export default function JobsCalendarPage() {
  const router = useRouter();
  const { confirm, dialog } = useAppDialog();
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const range = useMemo(() => calendarRangeForMonth(monthCursor), [monthCursor]);
  const [jobView, setJobView] = useState<{ key: string; rows: CalendarJob[] } | null>(null);
  const [placeholderView, setPlaceholderView] = useState<{ key: string; rows: CalendarPlaceholder[] } | null>(null);
  const [issues, setIssues] = useState<Partial<Record<CalendarRead, string>>>({});
  const hasJobs = jobView?.key === range.key;
  const jobs = hasJobs ? jobView.rows : noJobs;
  const placeholders = placeholderView?.key === range.key ? placeholderView.rows : noPlaceholders;
  const loading = !hasJobs && !issues.jobs;
  const scopeRef = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const calendarStartedAt = useRef<number | null>(null);
  const loads = useRef({ jobs: 0, placeholders: 0, planning: 0 });
  const [visitsEditing,setVisitsEditing] = useState(false);
  const [installPlanningByJobId, setInstallPlanningByJobId] = useState<Record<string, InstallPlanningMeta>>({});
  const [verifiedPlanningKey, setVerifiedPlanningKey] = useState("");
  const [planningDraft, setPlanningDraft] = useState<{ jobId: string; original: InstallPlanningMeta } | null>(null);
  const [error, setError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [placeholderSheetOpen, setPlaceholderSheetOpen] = useState(false);
  const [placeholderDate, setPlaceholderDate] = useState<Date | null>(null);
  const [selectedPlaceholder, setSelectedPlaceholder] = useState<CalendarPlaceholder | null>(null);
  const [placeholderForm, setPlaceholderForm] = useState({
    title: "",
    time: "12:00",
    note: "",
  });
  const [selectedJob, setSelectedJob] = useState<CalendarJob | null>(null);
  const [installStatus, setInstallStatus] = useState<"confirmed" | "pencilled">("confirmed");
  const [installScope, setInstallScope] = useState<"internal" | "external" | "both" | "">("");
  const [installMetaNote, setInstallMetaNote] = useState("");
  const [installDate, setInstallDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const calendarHeaderRef = useRef<HTMLDivElement | null>(null);
  const todayWeekRef = useRef<HTMLDivElement | null>(null);
  const todayScrollTimeoutRef = useRef<number | null>(null);
  const shouldScrollToTodayRef = useRef(true);
  const [todayAnchor, setTodayAnchor] = useState(() => new Date());
  const todayMonth = useMemo(() => startOfMonth(todayAnchor), [todayAnchor]);
  const todayKey = useMemo(() => dateKeyLocal(todayAnchor), [todayAnchor]);
  const todayWeekStartKey = useMemo(() => dateKeyLocal(startOfWeekMonday(todayAnchor)), [todayAnchor]);

  const reportIssue = useCallback((source: CalendarRead, message?: string) => {
    setIssues(previous => previous[source] === message ? previous : { ...previous, [source]: message });
  }, []);

  const clearScopedCalendar = useCallback(() => {
    ++loads.current.jobs;
    ++loads.current.placeholders;
    ++loads.current.planning;
    const scope = scopeRef.current;
    if (scope) {
      jobsCache.patch(scope, () => undefined);
      placeholderCache.patch(scope, () => undefined);
      planningCache.patch(scope, () => undefined);
    }
    scopeRef.current = null;
    setJobView(null);
    setPlaceholderView(null);
    setInstallPlanningByJobId({});
    setVerifiedPlanningKey("");
    setSheetOpen(false);
    setSelectedJob(null);
    setPlaceholderSheetOpen(false);
    setSelectedPlaceholder(null);
    setRefreshing(false);
    setIssues({});
  }, []);

  const load = useCallback(async (force = false) => {
    const token = localStorage.getItem("token");
    if (!token) return;
    const sequence = ++loads.current.jobs;
    const current = () => sequence === loads.current.jobs && localStorage.getItem("token") === token;
    reportIssue("jobs");
    if (calendarStartedAt.current === null) {
      const navigation = performance.getEntriesByType("navigation")[0];
      const menuClick = performance.getEntriesByName("installation-calendar-navigation", "mark").at(-1);
      calendarStartedAt.current = menuClick?.startTime ?? (navigation?.name === window.location.href ? 0 : performance.now());
      performance.clearMarks("installation-calendar-navigation");
    }
    const scope = await calendarCacheScope(token);
    if (!current()) return;
    scopeRef.current = scope;
    const cached = jobsCache.read(scope, range.key);
    if (cached) setJobView({ key: range.key, rows: cached.data });
    if (!force && cached && Date.now() - cached.at < refreshAfterMs) {
      setRefreshing(false);
      return;
    }
    setRefreshing(true);
    try {
      const rows = await loadMonthJobs(scope, token, range);
      if (current()) setJobView({ key: range.key, rows });
    } catch (err) {
      if (!current() || err instanceof CalendarCacheInvalidated) return;
      if (err instanceof CalendarRequestError && [401, 403].includes(err.status)) {
        clearScopedCalendar();
      }
      reportIssue("jobs", err instanceof Error ? err.message : "Could not load scheduled jobs.");
    } finally {
      if (current()) setRefreshing(false);
    }
  }, [clearScopedCalendar, range, reportIssue]);

  const updateJob = (jobId: string, replacement: CalendarJob[]) => {
    const patch = (key: string, rows: CalendarJob[]) => {
      const additions = replacement.filter(job => inWindow(key, job.installation?.installDate));
      if (!additions.length && !rows.some(job => job._id === jobId)) return rows;
      return [...rows.filter(job => job._id !== jobId), ...additions];
    };
    if (scopeRef.current) jobsCache.patch(scopeRef.current, patch);
    setJobView(view => view ? { ...view, rows: patch(view.key, view.rows) } : view);
  };

  const updatePlaceholder = (id: string, replacement?: CalendarPlaceholder) => {
    const patch = (key: string, rows: CalendarPlaceholder[]) => {
      const remaining = rows.filter(row => row.id !== id);
      return replacement && inWindow(key, replacement.startsAt) ? [...remaining, replacement] : remaining;
    };
    if (scopeRef.current) placeholderCache.patch(scopeRef.current, patch);
    setPlaceholderView(view => {
      const current = view?.key === range.key ? view.rows : noPlaceholders;
      return { key: range.key, rows: patch(range.key, current) };
    });
  };

  const getInstallPlanning = useCallback((job: CalendarJob): InstallPlanningMeta => {
    return installPlanningByJobId[job._id] || parseInstallMeta(job.notes);
  }, [installPlanningByJobId]);

  const saveInstallPlanningMeta = useCallback(async (
    jobId: string,
    planning: Partial<InstallPlanningMeta>,
  ) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) throw new Error("Missing auth token");

    const res = await fetch("/api/install-planning", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-access-token": token,
      },
      body: JSON.stringify({
        jobId,
        status: planning.status,
        installScope: planning.scope,
        planningNote: planning.note,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Could not save install planning");
    const nextPlanning = toCalendarInstallPlanning(json.planning);
    if (scopeRef.current) planningCache.patch(scopeRef.current, (ids, data) =>
      ids.split(",").includes(jobId) ? { ...data, [jobId]: nextPlanning } : data,
    );
    setInstallPlanningByJobId((prev) => ({ ...prev, [jobId]: nextPlanning }));
    return nextPlanning;
  }, []);

  const loadPlaceholders = useCallback(async (force = false) => {
    const token = localStorage.getItem("token");
    if (!token) return;
    const sequence = ++loads.current.placeholders;
    const current = () => sequence === loads.current.placeholders && localStorage.getItem("token") === token;
    reportIssue("placeholders");
    const scope = await calendarCacheScope(token);
    if (!current()) return;
    const entry = placeholderCache.read(scope, range.key);
    if (entry) setPlaceholderView({ key: range.key, rows: entry.data });
    if (!force && entry && Date.now() - entry.at < refreshAfterMs) return;

    try {
      const rows = await placeholderCache.refresh(scope, range.key, async () => {
        const params = new URLSearchParams(calendarDateBounds(range.from, range.to));
        const data = await readCalendar<{ placeholders: CalendarPlaceholder[] }>(
          `/api/calendar/placeholders?${params}`, token, "Could not load placeholders.",
        );
        if (!Array.isArray(data.placeholders)) throw Error("The calendar returned incomplete placeholders.");
        return data.placeholders;
      });
      if (current()) setPlaceholderView({ key: range.key, rows });
    } catch (err) {
      if (!current() || err instanceof CalendarCacheInvalidated) return;
      reportIssue("placeholders", err instanceof Error ? err.message : "Could not load placeholders.");
    }
  }, [range, reportIssue]);

  const planningKey = useMemo(() => [...new Set(jobs.map(job => job._id))].sort().join(","), [jobs]);
  const loadInstallPlanning = useCallback(async (force = false) => {
    const token = localStorage.getItem("token");
    const sequence = ++loads.current.planning;
    const current = () => sequence === loads.current.planning && localStorage.getItem("token") === token;
    reportIssue("planning");
    if (!token || !planningKey) return;
    const scope = await calendarCacheScope(token);
    if (!current()) return;
    const entry = planningCache.read(scope, planningKey);
    if (entry) setInstallPlanningByJobId(entry.data);
    if (!force && entry && Date.now() - entry.at < refreshAfterMs) {
      setVerifiedPlanningKey(planningKey);
      return;
    }
    setVerifiedPlanningKey("");

    try {
      const rows = await planningCache.refresh(scope, planningKey, async () => {
        const ids = planningKey.split(",");
        const requests = [];
        for (let index = 0; index < ids.length; index += 75) {
          const params = new URLSearchParams({ jobIds: ids.slice(index, index + 75).join(",") });
          requests.push(readCalendar<{ planning: InstallPlanningApiRow[] }>(
            `/api/install-planning?${params}`, token, "Could not load install planning.",
          ));
        }
        const next: Record<string, InstallPlanningMeta> = {};
        for (const { planning } of await Promise.all(requests)) {
          for (const row of planning) {
            if (row.jobId) next[row.jobId] = toCalendarInstallPlanning(row);
          }
        }
        return next;
      });
      if (current()) {
        setInstallPlanningByJobId(rows);
        setVerifiedPlanningKey(planningKey);
      }
    } catch (err) {
      if (!current() || err instanceof CalendarCacheInvalidated) return;
      reportIssue("planning", err instanceof Error ? err.message : "Could not load install planning.");
    }
  }, [planningKey, reportIssue]);

  useEffect(() => {
    const sessionToken = localStorage.getItem("token");
    if (!sessionToken) {
      router.push("/login");
      return;
    }
    void load();
    void loadPlaceholders();
    const renew = () => {
      if (document.visibilityState !== "visible") return;
      void load();
      void loadPlaceholders();
    };
    const sessionChanged = (event: StorageEvent) => {
      if (event.key !== "token" && event.key !== null) return;
      const token = localStorage.getItem("token");
      if (token === sessionToken) return;
      clearScopedCalendar();
      if (token) window.location.reload();
      else router.replace("/login");
    };
    window.addEventListener("focus", renew);
    window.addEventListener("storage", sessionChanged);
    return () => {
      window.removeEventListener("focus", renew);
      window.removeEventListener("storage", sessionChanged);
      ++loads.current.jobs;
      ++loads.current.placeholders;
    };
  }, [clearScopedCalendar, load, loadPlaceholders, router]);

  useEffect(() => {
    void loadInstallPlanning();
    const renew = () => {
      if (document.visibilityState === "visible") void loadInstallPlanning();
    };
    window.addEventListener("focus", renew);
    return () => {
      window.removeEventListener("focus", renew);
      ++loads.current.planning;
    };
  }, [loadInstallPlanning]);

  useEffect(() => {
    if (!hasJobs || refreshing || issues.jobs) return;
    const scope = scopeRef.current;
    const token = localStorage.getItem("token");
    if (!scope || !token) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      for (const distance of [1, -1]) {
        if (!active || document.visibilityState !== "visible" || localStorage.getItem("token") !== token) break;
        const neighbour = calendarRangeForMonth(addMonths(monthCursor, distance));
        if (!jobsCache.read(scope, neighbour.key)) {
          await loadMonthJobs(scope, token, neighbour).catch(() => {});
        }
      }
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [hasJobs, issues.jobs, monthCursor, refreshing]);

  useEffect(() => {
    const grid = gridRef.current;
    if (hasJobs && grid && calendarStartedAt.current !== null) {
      grid.dataset.calendarReadyMs = String(Math.round(performance.now() - calendarStartedAt.current));
    }
  }, [hasJobs, range.key]);

  const refreshCalendar = () => {
    setError("");
    void load(true);
    void loadPlaceholders(true);
    void loadInstallPlanning(true);
  };

  const placeholdersByDay = useMemo(() => {
    const map = new Map<string, CalendarPlaceholder[]>();
    for (const placeholder of placeholders) {
      const key = calendarDay(placeholder.startsAt);
      if (!key) continue;
      const arr = map.get(key) || [];
      arr.push(placeholder);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    }
    return map;
  }, [placeholders]);

  const openPlaceholderSheet = (date: Date, jobsForDay: CalendarJob[]) => {
    const sortedJobs = [...jobsForDay].sort((a, b) => {
      const aTs = new Date(a.installation?.installDate || 0).getTime();
      const bTs = new Date(b.installation?.installDate || 0).getTime();
      return aTs - bTs;
    });
    const lastJob = sortedJobs[sortedJobs.length - 1];
    const lastJobDate = lastJob?.installation?.installDate ? new Date(lastJob.installation.installDate) : null;
    const afterLastJob = lastJobDate && !Number.isNaN(lastJobDate.getTime())
      ? toDatetimeLocal(new Date(lastJobDate.getTime() + 60 * 60 * 1000).toISOString())
      : "";
    const defaultTime = afterLastJob.split("T")[1]?.slice(0, 5) || "12:00";
    setPlaceholderDate(date);
    setSelectedPlaceholder(null);
    setPlaceholderForm({
      title: "",
      time: defaultTime,
      note: "",
    });
    setPlaceholderSheetOpen(true);
  };

  const openEditPlaceholderSheet = (placeholder: CalendarPlaceholder) => {
    const startsAt = new Date(placeholder.startsAt);
    setPlaceholderDate(Number.isNaN(startsAt.getTime()) ? null : startsAt);
    setSelectedPlaceholder(placeholder);
    setPlaceholderForm({
      title: placeholder.title || "",
      time: timeFromDatetimeLocal(placeholder.startsAt) || "12:00",
      note: placeholder.note || "",
    });
    setPlaceholderSheetOpen(true);
  };

  const closePlaceholderSheet = () => {
    if (saving) return;
    setPlaceholderSheetOpen(false);
    setPlaceholderDate(null);
    setSelectedPlaceholder(null);
  };

  const savePlaceholder = async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token || !placeholderDate) return;
    if (!placeholderForm.title.trim()) {
      setError("Placeholder title is required.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const startsAt = fromDatetimeLocal(mergeDateAndTime(placeholderDate, placeholderForm.time));
      const res = await fetch(
        selectedPlaceholder ? `/api/calendar/placeholders/${selectedPlaceholder.id}` : "/api/calendar/placeholders",
        {
          method: selectedPlaceholder ? "PATCH" : "POST",
          headers: {
            "content-type": "application/json",
            "x-access-token": token,
          },
          body: JSON.stringify({
            startsAt,
            title: placeholderForm.title,
            note: placeholderForm.note,
          }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not save placeholder");
      updatePlaceholder(json.placeholder.id, json.placeholder);
      void loadPlaceholders(true);
      closePlaceholderSheet();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save placeholder");
    } finally {
      setSaving(false);
    }
  };

  const deletePlaceholder = async (placeholderId: string) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) return;
    const shouldDelete = await confirm({
      title: "Remove placeholder?",
      description: "This will remove the pencilled calendar entry from the installation planner.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!shouldDelete) return;

    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/calendar/placeholders/${placeholderId}`, {
        method: "DELETE",
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not remove placeholder");
      updatePlaceholder(placeholderId);
      void loadPlaceholders(true);
      if (selectedPlaceholder?.id === placeholderId) {
        setPlaceholderSheetOpen(false);
        setPlaceholderDate(null);
        setSelectedPlaceholder(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove placeholder");
    } finally {
      setSaving(false);
    }
  };

  const planningVerified = !!planningKey && verifiedPlanningKey === planningKey && !issues.planning;
  const canEditPlanning = planningVerified && !!planningDraft && selectedJob?._id === planningDraft.jobId;

  useEffect(() => {
    if (!selectedJob || !planningVerified || selectedJob._id === planningDraft?.jobId) return;
    const meta = getInstallPlanning(selectedJob);
    setInstallStatus(meta.status);
    setInstallScope(meta.scope || "");
    setInstallMetaNote(meta.note);
    setPlanningDraft({ jobId: selectedJob._id, original: meta });
  }, [getInstallPlanning, planningDraft, planningVerified, selectedJob]);

  const openJobSheet = (job: CalendarJob) => {
    setError("");
    setPlanningDraft(null);
    setSelectedJob(job);
    setInstallDate(toDatetimeLocal(job.installation?.installDate));
    setSheetOpen(true);
  };

  const closeSheet = () => {
    if (saving) return;
    setSheetOpen(false);
    setSelectedJob(null);
  };

  const openInstallInviteTemplatesPage = () => {
    if (!selectedJob) return;
    const startIso = fromDatetimeLocal(installDate);
    if (!startIso) return;

    const contact = selectedJob.client?.contactDetails;
    const params = new URLSearchParams({
      start: startIso,
      address: address(selectedJob),
      name: contact?.name || "",
      phone: contact?.phoneMobile || "",
      email: contact?.email || "",
      scope: installScope || "",
      note: installMetaNote || "",
      jobNumber: String(selectedJob.jobNumber),
      returnTo: "/jobs/calendar",
    });

    router.push(`/jobs/${selectedJob._id}/calendar-invite?${params.toString()}`);
  };

  const saveInstallMeta = async () => {
    if (!selectedJob || !canEditPlanning || !planningDraft) return;
    if (!installScope) {
      setError("Select install scope: Internal, External, or both.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const nextInstallDate = fromDatetimeLocal(installDate);
      const nextPlanning = {
        status: installStatus,
        note: installMetaNote,
        scope: installScope,
      };
      const original = planningDraft.original;
      const changed: Partial<InstallPlanningMeta> = {};
      if (nextPlanning.status !== original.status) changed.status = nextPlanning.status;
      if (nextPlanning.scope !== original.scope) changed.scope = nextPlanning.scope;
      if (nextPlanning.note !== original.note) changed.note = nextPlanning.note;
      const installDateChanged = !selectedJob.installationSplit && !sameInstallDate(selectedJob.installation?.installDate, nextInstallDate);
      const job = selectedJob;
      const requests: Promise<unknown>[] = [];
      if (Object.keys(changed).length) {
        requests.push(saveInstallPlanningMeta(job._id, installPlanningByJobId[job._id] ? changed : nextPlanning));
      }
      if (installDateChanged) {
        requests.push(gql<{ updateJob: CalendarJob }>(UPDATE_INSTALLATION, {
          input: {
            _id: job._id,
            installation: {
              installDate: nextInstallDate,
              installNote: job.installation?.installNote || "",
              installStatus: job.installation?.installStatus || "JOB_NOT_STARTED_YET",
              checkSheetSignedAsComplete: job.installation?.checkSheetSignedAsComplete ?? false,
            },
          },
        }, { calendarCacheHandled: true }).then(({ updateJob: saved }) => {
          updateJob(job._id, [{ ...job, installation: { ...job.installation, ...saved.installation } }]);
        }));
      }
      const results = await Promise.allSettled(requests);
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      setSheetOpen(false);
      setSelectedJob(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save install planning details");
    } finally {
      setSaving(false);
    }
  };

  const clearInstallDate = async () => {
    if (!selectedJob || selectedJob.installationSplit) return;
    setSaving(true);
    setError("");
    try {
      await gql(UPDATE_INSTALLATION, {
        input: {
          _id: selectedJob._id,
          installation: {
            installDate: null,
            installNote: selectedJob.installation?.installNote || "",
            installStatus: selectedJob.installation?.installStatus || "JOB_NOT_STARTED_YET",
            checkSheetSignedAsComplete: selectedJob.installation?.checkSheetSignedAsComplete ?? false,
          },
        },
      }, { calendarCacheHandled: true });
      updateJob(selectedJob._id, []);
      setInstallDate("");
      setSheetOpen(false);
      setSelectedJob(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove install date");
    } finally {
      setSaving(false);
    }
  };

  const jobsByDay = useMemo(() => {
    const map = new Map<string, CalendarJob[]>();
    for (const job of jobs) {
      const key = calendarDay(job.installation?.installDate);
      if (!key) continue;
      const arr = map.get(key) || [];
      arr.push(job);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const aTs = new Date(a.installation?.installDate || 0).getTime();
        const bTs = new Date(b.installation?.installDate || 0).getTime();
        return aTs - bTs || a.jobNumber - b.jobNumber;
      });
    }
    return map;
  }, [jobs]);

  const weeks = useMemo(() => {
    const monthStart = startOfMonth(monthCursor);
    const { calendarStart: gridStart, calendarEnd: lastGridDay } = range;

    const rows: Array<{
      weekStart: Date;
      days: Array<{
        date: Date;
        key: string;
        jobs: CalendarJob[];
        placeholders: CalendarPlaceholder[];
        items: Array<
          | { type: "job"; sortTs: number; job: CalendarJob }
          | { type: "placeholder"; sortTs: number; placeholder: CalendarPlaceholder }
        >;
        inMonth: boolean;
      }>;
      totals: { jobs: number; placeholders: number; sqm: number; amount: number };
    }> = [];

    let cursor = gridStart;
    while (cursor <= lastGridDay) {
      const days = Array.from({ length: 7 }, (_, idx) => {
        const date = addDays(cursor, idx);
        const key = dateKeyLocal(date);
        const dayJobs = jobsByDay.get(key) || [];
        const dayPlaceholders = placeholdersByDay.get(key) || [];
        const items = [
          ...dayJobs.map((job) => ({
            type: "job" as const,
            sortTs: new Date(job.installation?.installDate || `${key}T00:00`).getTime(),
            job,
          })),
          ...dayPlaceholders.map((placeholder) => ({
            type: "placeholder" as const,
            sortTs: new Date(placeholder.startsAt).getTime(),
            placeholder,
          })),
        ].sort((a, b) => a.sortTs - b.sortTs);
        return {
          date,
          key,
          jobs: dayJobs,
          placeholders: dayPlaceholders,
          items,
          inMonth: date.getMonth() === monthStart.getMonth(),
        };
      });

      rows.push({
        weekStart: cursor,
        days,
        totals: days.reduce(
          (acc, day) => {
            acc.jobs += day.jobs.length;
            acc.placeholders += day.placeholders.length;
            acc.sqm += day.jobs.reduce((sum, job) => sum + combinedSqm(job), 0);
            acc.amount += day.jobs.reduce((sum, job) => sum + (job.quote?.c_total || 0), 0);
            return acc;
          },
          { jobs: 0, placeholders: 0, sqm: 0, amount: 0 }
        ),
      });

      cursor = addDays(cursor, 7);
    }

    return rows;
  }, [jobsByDay, monthCursor, placeholdersByDay, range]);

  const scrollToTodayWeek = useCallback((behavior: ScrollBehavior = "smooth") => {
    const node = todayWeekRef.current;
    if (!node) return false;
    if (todayScrollTimeoutRef.current) {
      window.clearTimeout(todayScrollTimeoutRef.current);
    }
    const scroll = () => {
      const headerBottom = calendarHeaderRef.current?.getBoundingClientRect().bottom || 0;
      const top = node.getBoundingClientRect().top + window.scrollY - headerBottom - 12;
      window.scrollTo({ top: Math.max(0, top), behavior });
    };
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(scroll);
    });
    todayScrollTimeoutRef.current = window.setTimeout(scroll, 250);
    return true;
  }, []);

  useEffect(() => {
    if (loading || !shouldScrollToTodayRef.current || !sameMonth(monthCursor, todayMonth)) return;
    if (scrollToTodayWeek("auto")) {
      shouldScrollToTodayRef.current = false;
    }
  }, [loading, monthCursor, scrollToTodayWeek, todayMonth, weeks]);

  useEffect(() => {
    return () => {
      if (todayScrollTimeoutRef.current) {
        window.clearTimeout(todayScrollTimeoutRef.current);
      }
    };
  }, []);

  const goToToday = useCallback(() => {
    const nextToday = new Date();
    const nextTodayMonth = startOfMonth(nextToday);
    shouldScrollToTodayRef.current = true;
    setTodayAnchor(nextToday);
    if (!sameMonth(monthCursor, nextTodayMonth)) calendarStartedAt.current = performance.now();
    setMonthCursor(nextTodayMonth);
    if (sameMonth(monthCursor, nextTodayMonth)) {
      if (scrollToTodayWeek()) {
        shouldScrollToTodayRef.current = false;
      }
    }
  }, [monthCursor, scrollToTodayWeek]);

  const changeMonth = useCallback((amount: number) => {
    shouldScrollToTodayRef.current = false;
    calendarStartedAt.current = performance.now();
    setMonthCursor((curr) => addMonths(curr, amount));
    scrollToPageTop();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {dialog}
      <div ref={calendarHeaderRef} className="px-4 py-4 border-b border-gray-100 bg-white sticky z-30" style={{ top: "var(--nav-height, 80px)" }}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Installation Calendar</h1>

            <p className="text-sm text-gray-500">Accepted, in-progress, invoice, and completed jobs with install dates.</p>
          </div>
          <button
            onClick={refreshCalendar}
            disabled={refreshing}
            className="px-3 py-2 text-xs font-semibold rounded-lg border border-gray-200 bg-white text-gray-700 disabled:opacity-50"
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => changeMonth(-1)}
            className="px-3 py-2 rounded-lg text-sm font-semibold bg-white border border-gray-200 text-gray-700"
          >
            ← Prev month
          </button>
          <div className="text-center">
            <div className="text-lg font-bold text-gray-900">{formatMonth(monthCursor)}</div>
            <div className="text-xs text-gray-500">Monday to Sunday view</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={goToToday}
              className="px-3 py-2 rounded-lg text-sm font-semibold bg-[#e85d04] text-white border border-[#e85d04]"
            >
              Today
            </button>
            <button
              onClick={() => changeMonth(1)}
              className="px-3 py-2 rounded-lg text-sm font-semibold bg-white border border-gray-200 text-gray-700"
            >
              Next month →
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 py-4">
        {error && !sheetOpen && !placeholderSheetOpen && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        {issues.jobs && (
          <div role="status" className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {hasJobs ? "Scheduled jobs couldn’t refresh. Showing the last loaded schedule." : issues.jobs}
            <button type="button" onClick={() => void load(true)} className="ml-2 underline">Retry</button>
          </div>
        )}
        {issues.placeholders && (
          <div role="status" className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Placeholders couldn’t refresh. Placeholder entries may be incomplete.
            <button type="button" onClick={() => void loadPlaceholders(true)} className="ml-2 underline">Retry placeholders</button>
          </div>
        )}
        {issues.planning && (
          <div role="status" className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Install planning couldn’t refresh. Check booking details before making changes.
            <button type="button" onClick={() => void loadInstallPlanning(true)} className="ml-2 underline">Retry install planning</button>
          </div>
        )}
        {loading && (
          <div role="status" className="bg-white border border-gray-100 rounded-2xl p-8 flex flex-col items-center justify-center gap-3">
            <div className="h-8 w-8 rounded-full border-2 border-[#e85d04] border-t-transparent animate-spin" />
            <div className="text-sm text-gray-500">Loading calendar</div>
          </div>
        )}
        {hasJobs && (
          <div key={range.key} ref={gridRef} data-calendar-ready={range.key} className="space-y-4 overflow-x-auto pb-4">
            <div className="min-w-[1100px]">
              <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_150px] gap-2 mb-3">
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label} className="text-xs font-bold uppercase tracking-wide text-gray-500 px-1">
                    {label}
                  </div>
                ))}
                <div className="text-xs font-bold uppercase tracking-wide text-gray-500 px-1">Week totals</div>
              </div>

              <div className="space-y-3">
                {weeks.map((week) => {
                  const isTodayWeek = sameMonth(monthCursor, todayMonth) && dateKeyLocal(week.weekStart) === todayWeekStartKey;
                  return (
                    <div
                      key={week.weekStart.toISOString()}
                      ref={isTodayWeek ? todayWeekRef : null}
                      className={`grid scroll-mt-36 grid-cols-[repeat(7,minmax(0,1fr))_150px] gap-2 items-start ${isTodayWeek ? "rounded-2xl ring-2 ring-[#e85d04]/30 ring-offset-2 ring-offset-gray-50" : ""}`}
                    >
                      {week.days.map((day) => (
                        <div
                          key={day.key}
                          className={`rounded-2xl border min-h-[180px] p-1.5 ${sameMonth(monthCursor, todayMonth) && day.key === todayKey ? "bg-orange-50 border-[#e85d04]/40" : day.inMonth ? "bg-white border-gray-100" : "bg-gray-100/70 border-gray-200"}`}
                        >
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-sm font-bold ${sameMonth(monthCursor, todayMonth) && day.key === todayKey ? "text-[#c2410c]" : day.inMonth ? "text-gray-900" : "text-gray-400"}`}>
                            {day.date.getDate()}
                          </span>
                          <div className="flex items-center gap-1">
                            {day.placeholders.length > 0 && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">
                                {day.placeholders.length} hold{day.placeholders.length === 1 ? "" : "s"}
                              </span>
                            )}
                            {day.jobs.length > 0 && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#e85d04]/10 text-[#e85d04]">
                                {day.jobs.length} job{day.jobs.length === 1 ? "" : "s"}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2">
                          {day.items.map((item) => {
                            if (item.type === "placeholder") {
                              const placeholder = item.placeholder;
                              return (
                                <div key={placeholder.id} className="w-full rounded-xl border border-dashed border-violet-300 bg-violet-50/70 p-1.5 shadow-sm">
                                  <div className="mb-1">
                                    <div className="text-[10px] uppercase tracking-wide font-bold text-violet-700 mb-0.5">Placeholder</div>
                                    <div className="text-[15px] leading-5 font-semibold text-gray-900 line-clamp-2">{placeholder.title}</div>
                                  </div>
                                  <div className="mb-1.5 text-[11px] text-gray-700">
                                    {timeFromDatetimeLocal(placeholder.startsAt) || "Any time"}
                                  </div>
                                  {placeholder.note && (
                                    <div className="text-[11px] text-gray-600 line-clamp-2 rounded-lg bg-white/70 border border-violet-100 px-2 py-1.5">
                                      {placeholder.note}
                                    </div>
                                  )}
                                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                                    <button
                                      onClick={() => openEditPlaceholderSheet(placeholder)}
                                      disabled={saving}
                                      className="h-8 text-[11px] font-semibold text-violet-700 bg-white border border-violet-100 rounded-lg disabled:opacity-50"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => deletePlaceholder(placeholder.id)}
                                      disabled={saving}
                                      className="h-8 text-[11px] font-semibold text-red-600 bg-white border border-red-100 rounded-lg disabled:opacity-50"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              );
                            }

                            const job = item.job;
                            const meta = getInstallPlanning(job);
                            const isInstalled = isCompleteForCalendar(job);
                            const isPencilled = meta.status === "pencilled";
                            const scopeBadge = installScopeBadge(meta.scope);
                            const installTime = job.splitVisit ? "" : timeFromDatetimeLocal(job.installation?.installDate);
                            const statusLabel = job.splitVisit ? `${job.splitVisit.percent}% · ${job.splitVisit.state === "completed" ? "Work recorded" : "Planned"}` : isInstalled ? calendarStatusLabel(job) : isPencilled ? "Pencilled" : "Confirmed";
                            const csBadge = checksheetBadge(job);
                            const phone = customerPhone(job);
                            return (
                              <div key={`${job._id}:${job.splitVisit?.id || "job"}`} data-split-visit={job.splitVisit && job.splitVisit.count !== 1 ? "true" : undefined} className={`group w-full rounded-xl border p-2 shadow-sm transition-colors border-l-4 ${job.splitVisit && job.splitVisit.count !== 1 ? "border-blue-200 bg-blue-50 hover:bg-blue-100/70" : isInstalled ? "border-emerald-200 bg-emerald-50/70 hover:bg-emerald-50" : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/70"} ${job.splitVisit && job.splitVisit.count !== 1 ? "border-l-blue-500" : isPencilled ? "border-l-amber-500" : "border-l-emerald-500"}`}>
                                <button onClick={() => openJobSheet(job)} className="w-full text-left">
                                  <div className="mb-1 flex items-start justify-between gap-2">
                                    <div className="min-w-0 text-[15px] leading-5 font-semibold text-gray-900 line-clamp-2">
                                      {job.client?.contactDetails?.name || "Unknown customer"}
                                    </div>
                                    <div className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${scopeBadge.className}`} title={scopeBadge.label}>
                                      <span className={`h-1.5 w-1.5 rounded-full ${scopeBadge.dotClassName}`} />
                                      {scopeBadge.shortLabel}
                                    </div>
                                  </div>

                                  <div className="mb-1 text-[13px] leading-4 font-semibold text-gray-800 line-clamp-3">
                                    {address(job) || "No address"}
                                  </div>

                                  {phone && (
                                    <div className="mb-1 text-[12px] leading-4 font-semibold text-gray-600 tabular-nums">
                                      {phone}
                                    </div>
                                  )}

                                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                                    {job.splitVisit && job.splitVisit.count !== 1 && <span className="rounded-full border border-blue-200 bg-blue-100 px-1.5 py-0.5 font-black text-blue-800">Split job</span>}
                                    {installTime && <span>{installTime}</span>}
                                    {installTime && <span className="text-gray-300">/</span>}
                                    <span className={isInstalled ? "font-black text-emerald-700" : ""}>{statusLabel}</span>
                                    <span className="text-gray-300">/</span>
                                    <span title={csBadge.title} className={`rounded-full border px-1.5 py-0.5 font-black ${csBadge.className}`}>{csBadge.label}</span>
                                  </div>

                                  <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] font-semibold text-gray-800">
                                    <span>{formatSqm(combinedSqm(job))}</span>
                                    <span className="text-gray-300">/</span>
                                    <span className="tabular-nums">{formatCurrency(job.quote?.c_total || 0)}</span>
                                  </div>

                                  {meta.note && (
                                    <div className="border-t border-gray-100 pt-1.5 text-[11px] leading-4 text-gray-500 line-clamp-2">
                                      {meta.note}
                                    </div>
                                  )}
                                </button>
                              </div>
                            );
                          })}
                          {day.items.length === 0 && <div className="text-xs text-gray-300 pt-2">No jobs or placeholders</div>}
                          <button
                            onClick={() => openPlaceholderSheet(day.date, day.jobs)}
                            className="w-full h-8 text-[11px] font-semibold rounded-lg border border-dashed border-gray-300 text-gray-500 bg-white/70 hover:bg-gray-50"
                          >
                            + Add placeholder
                          </button>
                        </div>
                      </div>
                    ))}

                    <div className="rounded-2xl border border-gray-200 bg-[#1a3a4a] text-white p-4 min-h-[220px]">
                      <div className="text-xs uppercase tracking-wide text-white/60 font-semibold mb-3">Week totals</div>
                      <div className="space-y-3">
                        <div>
                          <div className="text-[11px] text-white/60">Jobs</div>
                          <div className="text-2xl font-bold">{week.totals.jobs}</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-white/60">Square metres</div>
                          <div className="text-xl font-bold">{formatSqm(week.totals.sqm)}</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-white/60">Dollar amount</div>
                          <div className="text-xl font-bold">{formatCurrency(week.totals.amount)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>


      <BottomSheet open={placeholderSheetOpen} onClose={closePlaceholderSheet} title={selectedPlaceholder ? "Edit placeholder" : "Add placeholder"}>
        {placeholderDate && (
          <div className="space-y-4">
            <div className="rounded-xl border border-violet-100 bg-violet-50 px-3 py-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-violet-700 mb-1">Calendar overlay</div>
              <div className="text-sm font-semibold text-gray-900">
                {placeholderDate.toLocaleDateString("en-NZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5 block">Title</label>
              <input
                value={placeholderForm.title}
                onChange={(e) => setPlaceholderForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="Hold for install gap"
                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
              />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5 block">Time</label>
              <input
                type="time"
                value={placeholderForm.time}
                onChange={(e) => setPlaceholderForm((prev) => ({ ...prev, time: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
              />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5 block">Note</label>
              <textarea
                value={placeholderForm.note}
                onChange={(e) => setPlaceholderForm((prev) => ({ ...prev, note: e.target.value }))}
                rows={4}
                placeholder="Why this gap is being held..."
                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04] resize-none"
              />
            </div>

            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <div className="flex gap-2">
              <button onClick={closePlaceholderSheet} className="flex-1 bg-gray-100 text-gray-700 font-semibold py-3 rounded-xl">Cancel</button>
              {selectedPlaceholder && (
                <button
                  onClick={() => deletePlaceholder(selectedPlaceholder.id)}
                  disabled={saving}
                  className="flex-1 bg-white text-red-600 border border-red-100 font-semibold py-3 rounded-xl disabled:opacity-50"
                >
                  Remove
                </button>
              )}
              <button
                onClick={savePlaceholder}
                disabled={saving || !placeholderForm.title.trim()}
                className="flex-1 bg-[#e85d04] text-white font-semibold py-3 rounded-xl disabled:opacity-50"
              >
                {saving ? "Saving..." : selectedPlaceholder ? "Save changes" : "Add placeholder"}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={sheetOpen} onClose={closeSheet} title="Installation planning">
        {selectedJob && (
          <div className="space-y-4">
            <div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{selectedJob.client?.contactDetails?.name || `Job #${selectedJob.jobNumber}`}</div>
                  <div className="text-xs text-gray-500 mt-1">Job #{selectedJob.jobNumber} • {address(selectedJob) || "No address"}</div>
                </div>
                <Link
                  href={`/jobs/${selectedJob._id}?returnTo=${encodeURIComponent("/jobs/calendar")}`}
                  className="text-xs font-semibold text-[#1a3a4a] bg-white border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50"
                >
                  Open job
                </Link>
              </div>
            </div>

            <InstallationVisits key={selectedJob._id} jobId={selectedJob._id}
              initialData={selectedJob.installationSplit !== undefined ? {job:calendarSource(selectedJob),split:selectedJob.installationSplit} : undefined}
              onEditingChange={setVisitsEditing}
              calendarCacheHandled
              onSaved={(split) => {
                const cards = calendarVisits(calendarSource(selectedJob), split);
                updateJob(selectedJob._id, cards);
                setSelectedJob(cards.find(card => card.splitVisit?.id === selectedJob.splitVisit?.id) || cards[0]);
              }} />
            {canEditPlanning ? <InstallPlanningForm
              hideDate={!!selectedJob.installationSplit}
              installDate={installDate}
              onInstallDateChange={setInstallDate}
              saving={saving}
              canCreateInvite={!!installDate}
              hasInstallDate={!!selectedJob?.installation?.installDate}
              onClearDate={clearInstallDate}
              onCreateInvite={openInstallInviteTemplatesPage}
              status={installStatus}
              onStatusChange={setInstallStatus}
              scope={installScope}
              onScopeChange={setInstallScope}
              note={installMetaNote}
              onNoteChange={setInstallMetaNote}
            /> : (
              <div role="status" className="text-sm text-gray-600">
                {issues.planning || !planningKey ? "Install planning is unavailable." : "Checking install planning…"}
                {issues.planning && (
                  <button type="button" onClick={() => void loadInstallPlanning(true)} className="ml-2 underline">Retry</button>
                )}
              </div>
            )}

            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <InstallPlanningActions
              saving={saving}
              canSave={canEditPlanning && !visitsEditing && (!!selectedJob.installationSplit || !!installDate) && !!installScope}
              onCancel={closeSheet}
              onSave={saveInstallMeta}
            />
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
