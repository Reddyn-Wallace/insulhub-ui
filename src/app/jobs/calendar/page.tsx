"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { gql } from "@/lib/graphql";
import { readBrowserCache, writeBrowserCache } from "@/lib/client-cache";
import BottomSheet from "@/components/BottomSheet";
import InstallPlanningForm, { InstallPlanningActions } from "@/components/InstallPlanningForm";
import { useAppDialog } from "@/components/AppDialog";

interface CalendarJob {
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
const INSTALL_META_START = "[INSTALL_META]";
const INSTALL_META_END = "[/INSTALL_META]";

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

function dateKeyFromIsoNz(iso?: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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

function parseInstallMeta(notes?: string | null): { status: "confirmed" | "pencilled"; note: string; scope: "internal" | "external" | "both" | "" } {
  const text = notes || "";
  const start = text.indexOf(INSTALL_META_START);
  const end = text.indexOf(INSTALL_META_END);
  if (start === -1 || end === -1 || end < start) {
    return { status: "confirmed" as "confirmed" | "pencilled", note: "", scope: "" };
  }

  const body = text
    .slice(start + INSTALL_META_START.length, end)
    .trim();

  const statusMatch = body.match(/^status:\s*(.+)$/im);
  const noteMatch = body.match(/^note:\s*([\s\S]*?)(?:\n[a-z_]+:|$)/im);
  const scopeMatch = body.match(/^install_scope:\s*(.+)$/im);
  const rawStatus = (statusMatch?.[1] || "confirmed").trim().toLowerCase();
  const rawScope = (scopeMatch?.[1] || "").trim().toLowerCase();
  return {
    status: rawStatus === "pencilled" ? "pencilled" : "confirmed",
    note: (noteMatch?.[1] || "").trim(),
    scope: rawScope === "internal" || rawScope === "external" || rawScope === "both" ? rawScope : "",
  };
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

function sameInstallPlanning(a: InstallPlanningMeta, b: InstallPlanningMeta) {
  return a.status === b.status && a.scope === b.scope && a.note === b.note;
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

const CALENDAR_RAW_CACHE_PREFIX = "calendar:install-jobs-window:";
const CALENDAR_VIEW_CACHE_PREFIX = "calendar:view:";
const CALENDAR_RAW_CACHE_TTL_MS = 20 * 60 * 1000;
const CALENDAR_VIEW_CACHE_TTL_MS = 20 * 60 * 1000;
const OVERLAY_CACHE_TTL_MS = 60 * 1000;

type CalendarCachePayload = { jobs: CalendarJob[]; ts: number };

const calendarMemoryCache = new Map<string, CalendarCachePayload>();
const rawJobsMemoryCache = new Map<string, CalendarCachePayload>();

function calendarRangeForMonth(month: Date) {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const calendarStart = startOfWeekMonday(monthStart);
  const calendarEnd = addDays(startOfWeekMonday(addDays(monthEnd, 1)), 6);
  const cacheKey = `${dateKeyLocal(calendarStart)}_${dateKeyLocal(calendarEnd)}`;
  return { calendarStart, calendarEnd, cacheKey };
}

function calendarLoadRangeForMonth(month: Date) {
  const previous = calendarRangeForMonth(addMonths(month, -1));
  const next = calendarRangeForMonth(addMonths(month, 1));
  const cacheKey = `${previous.cacheKey}_${next.cacheKey}`;
  return { calendarStart: previous.calendarStart, calendarEnd: next.calendarEnd, cacheKey };
}

function filterJobsForRange(jobs: CalendarJob[], calendarStart: Date, calendarEnd: Date) {
  const startKey = dateKeyLocal(calendarStart);
  const endKey = dateKeyLocal(calendarEnd);
  return jobs.filter((job) => {
    const key = dateKeyFromIsoNz(job.installation?.installDate);
    if (!key) return false;
    return key >= startKey && key <= endKey;
  });
}

function readSessionPayload(key: string): CalendarCachePayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CalendarJob[] | CalendarCachePayload;
    if (Array.isArray(parsed)) return { jobs: parsed, ts: 0 };
    return { jobs: parsed.jobs || [], ts: parsed.ts || 0 };
  } catch {
    return null;
  }
}

function writeSessionPayload(key: string, payload: CalendarCachePayload) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Storage can fail in private mode or when quota is exceeded.
  }
}

function clearCalendarSessionCache() {
  calendarMemoryCache.clear();
  rawJobsMemoryCache.clear();

  if (typeof window === "undefined") return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (
        key?.startsWith(CALENDAR_RAW_CACHE_PREFIX) ||
        key?.startsWith(CALENDAR_VIEW_CACHE_PREFIX) ||
        key?.startsWith("calendar:") ||
        key?.startsWith("install-planning:") ||
        key?.startsWith("calendar-placeholders:")
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    // Best-effort cache invalidation only.
  }
}

export default function JobsCalendarPage() {
  const router = useRouter();
  const { confirm, dialog } = useAppDialog();
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [jobs, setJobs] = useState<CalendarJob[]>([]);
  const [placeholders, setPlaceholders] = useState<CalendarPlaceholder[]>([]);
  const [installPlanningByJobId, setInstallPlanningByJobId] = useState<Record<string, InstallPlanningMeta>>({});
  const [loading, setLoading] = useState(true);
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
  const calendarCache = useRef(calendarMemoryCache);
  const rawJobsCache = useRef(rawJobsMemoryCache);
  const visibleJobsCountRef = useRef(0);
  const calendarHeaderRef = useRef<HTMLDivElement | null>(null);
  const todayWeekRef = useRef<HTMLDivElement | null>(null);
  const todayScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldScrollToTodayRef = useRef(true);
  const [todayAnchor, setTodayAnchor] = useState(() => new Date());
  const todayMonth = useMemo(() => startOfMonth(todayAnchor), [todayAnchor]);
  const todayKey = useMemo(() => dateKeyLocal(todayAnchor), [todayAnchor]);
  const todayWeekStartKey = useMemo(() => dateKeyLocal(startOfWeekMonday(todayAnchor)), [todayAnchor]);

  useEffect(() => {
    visibleJobsCountRef.current = jobs.length;
  }, [jobs.length]);

  const load = useCallback(async (force = false) => {
    setError("");
    const { calendarStart, calendarEnd, cacheKey } = calendarRangeForMonth(monthCursor);
    const loadRange = calendarLoadRangeForMonth(monthCursor);
    const viewCacheKey = `${CALENDAR_VIEW_CACHE_PREFIX}${cacheKey}`;
    const rawCacheKey = `${CALENDAR_RAW_CACHE_PREFIX}${loadRange.cacheKey}`;
    const now = Date.now();
    let renderedFromCache = force && visibleJobsCountRef.current > 0;

    const renderFromRaw = (payload: CalendarCachePayload) => {
      const filtered = filterJobsForRange(payload.jobs, calendarStart, calendarEnd);
      const viewPayload = { jobs: filtered, ts: payload.ts || Date.now() };
      calendarCache.current.set(cacheKey, viewPayload);
      writeSessionPayload(viewCacheKey, viewPayload);
      setJobs(filtered);
      setLoading(false);
      renderedFromCache = true;
    };

    try {
      if (!force) {
        const memoryCached = calendarCache.current.get(cacheKey);
        if (memoryCached) {
          setJobs(memoryCached.jobs);
          setLoading(false);
          renderedFromCache = true;
          if (now - memoryCached.ts < CALENDAR_VIEW_CACHE_TTL_MS) return;
        }

        const viewCached = readSessionPayload(viewCacheKey) || readSessionPayload(`calendar:${cacheKey}`);
        if (viewCached) {
          calendarCache.current.set(cacheKey, viewCached);
          setJobs(viewCached.jobs);
          setLoading(false);
          renderedFromCache = true;
          if (now - viewCached.ts < CALENDAR_VIEW_CACHE_TTL_MS) return;
        }

        const rawCached = rawJobsCache.current.get(loadRange.cacheKey) || readSessionPayload(rawCacheKey);
        if (rawCached?.jobs.length) {
          rawJobsCache.current.set(loadRange.cacheKey, rawCached);
          renderFromRaw(rawCached);
          if (now - rawCached.ts < CALENDAR_RAW_CACHE_TTL_MS) return;
        }
      }

      if (renderedFromCache || force) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      if (!token) throw new Error("Unauthorized");

      const params = new URLSearchParams({
        start: new Date(
          loadRange.calendarStart.getFullYear(),
          loadRange.calendarStart.getMonth(),
          loadRange.calendarStart.getDate(),
          0,
          0,
          0,
          0
        ).toISOString(),
        end: new Date(
          loadRange.calendarEnd.getFullYear(),
          loadRange.calendarEnd.getMonth(),
          loadRange.calendarEnd.getDate(),
          23,
          59,
          59,
          999
        ).toISOString(),
      });

      const res = await fetch(`/api/calendar/jobs?${params.toString()}`, {
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load installation calendar");

      const rawPayload = { jobs: json.jobs || [], ts: Date.now() };
      rawJobsCache.current.set(loadRange.cacheKey, rawPayload);
      writeSessionPayload(rawCacheKey, rawPayload);

      renderFromRaw(rawPayload);

      for (const adjacentMonth of [addMonths(monthCursor, -1), addMonths(monthCursor, 1)]) {
        const adjacentRange = calendarRangeForMonth(adjacentMonth);
        const adjacentPayload = {
          jobs: filterJobsForRange(rawPayload.jobs, adjacentRange.calendarStart, adjacentRange.calendarEnd),
          ts: rawPayload.ts,
        };
        calendarCache.current.set(adjacentRange.cacheKey, adjacentPayload);
        writeSessionPayload(`${CALENDAR_VIEW_CACHE_PREFIX}${adjacentRange.cacheKey}`, adjacentPayload);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load installation calendar";
      if (msg !== "Unauthorized" && !renderedFromCache) setError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [monthCursor]);

  const getInstallPlanning = useCallback((job: CalendarJob): InstallPlanningMeta => {
    return installPlanningByJobId[job._id] || parseInstallMeta(job.notes);
  }, [installPlanningByJobId]);

  const saveInstallPlanningMeta = useCallback(async (
    jobId: string,
    planning: InstallPlanningMeta,
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
    setInstallPlanningByJobId((prev) => ({ ...prev, [jobId]: nextPlanning }));
    return nextPlanning;
  }, []);

  const loadPlaceholders = useCallback(async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) return;

    const { calendarStart, calendarEnd } = calendarRangeForMonth(monthCursor);
    const params = new URLSearchParams({
      start: new Date(calendarStart.getFullYear(), calendarStart.getMonth(), calendarStart.getDate(), 0, 0, 0, 0).toISOString(),
      end: new Date(calendarEnd.getFullYear(), calendarEnd.getMonth(), calendarEnd.getDate(), 23, 59, 59, 999).toISOString(),
    });
    const cacheKey = `calendar-placeholders:${params.toString()}`;
    const cached = readBrowserCache<CalendarPlaceholder[]>(cacheKey, OVERLAY_CACHE_TTL_MS);
    if (cached) setPlaceholders(cached);

    try {
      const res = await fetch(`/api/calendar/placeholders?${params.toString()}`, {
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load placeholders");
      const nextPlaceholders = json.placeholders || [];
      setPlaceholders(nextPlaceholders);
      writeBrowserCache(cacheKey, nextPlaceholders);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load placeholders");
    }
  }, [monthCursor]);

  const loadInstallPlanning = useCallback(async (calendarJobs: CalendarJob[]) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token || calendarJobs.length === 0) return;

    const params = new URLSearchParams({
      jobIds: calendarJobs.map((job) => job._id).join(","),
    });
    const cacheKey = `install-planning:${params.toString()}`;
    const cached = readBrowserCache<Record<string, InstallPlanningMeta>>(cacheKey, OVERLAY_CACHE_TTL_MS);
    if (cached) setInstallPlanningByJobId(cached);

    try {
      const res = await fetch(`/api/install-planning?${params.toString()}`, {
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load install planning");
      const next: Record<string, InstallPlanningMeta> = {};
      for (const row of json.planning || []) {
        next[row.jobId] = toCalendarInstallPlanning(row);
      }
      setInstallPlanningByJobId(next);
      writeBrowserCache(cacheKey, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load install planning");
    }
  }, []);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) {
      router.push("/login");
      return;
    }
    load();
    loadPlaceholders();
  }, [load, loadPlaceholders, router]);

  useEffect(() => {
    loadInstallPlanning(jobs);
  }, [jobs, loadInstallPlanning]);

  const placeholdersByDay = useMemo(() => {
    const map = new Map<string, CalendarPlaceholder[]>();
    for (const placeholder of placeholders) {
      const key = dateKeyFromIsoNz(placeholder.startsAt);
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
      setPlaceholders((prev) => {
        if (!selectedPlaceholder) return [...prev, json.placeholder];
        return prev.map((placeholder) => placeholder.id === selectedPlaceholder.id ? json.placeholder : placeholder);
      });
      clearCalendarSessionCache();
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
      setPlaceholders((prev) => prev.filter((placeholder) => placeholder.id !== placeholderId));
      clearCalendarSessionCache();
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

  const openJobSheet = (job: CalendarJob) => {
    const meta = getInstallPlanning(job);
    setSelectedJob(job);
    setInstallStatus(meta.status);
    setInstallScope(meta.scope || "");
    setInstallMetaNote(meta.note);
    setInstallDate(toDatetimeLocal(job.installation?.installDate));
    setSheetOpen(true);
  };

  const closeSheet = () => {
    if (saving) return;
    setSheetOpen(false);
    setSelectedJob(null);
  };

  const openJobPage = (jobId: string) => {
    router.push(`/jobs/${jobId}?returnTo=${encodeURIComponent("/jobs/calendar")}`);
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
    if (!selectedJob) return;
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
      const originalPlanning = getInstallPlanning(selectedJob);
      const installDateChanged = !sameInstallDate(selectedJob.installation?.installDate, nextInstallDate);
      const planningChanged = !sameInstallPlanning(originalPlanning, nextPlanning);
      const requests: Promise<unknown>[] = [];
      const jobId = selectedJob._id;
      const previousInstallDate = selectedJob.installation?.installDate || null;
      const hadOverlayPlanning = Boolean(installPlanningByJobId[jobId]);

      if (planningChanged) {
        setInstallPlanningByJobId((prev) => ({ ...prev, [jobId]: nextPlanning }));
        requests.push(saveInstallPlanningMeta(jobId, nextPlanning));
      }
      if (installDateChanged) {
        setJobs((prev) => prev.map((job) => job._id === jobId ? {
          ...job,
          installation: {
            ...job.installation,
            installDate: nextInstallDate,
          },
        } : job));
        requests.push(
          gql(UPDATE_INSTALLATION, {
            input: {
              _id: jobId,
              installation: {
                installDate: nextInstallDate,
                installNote: selectedJob.installation?.installNote || "",
                installStatus: selectedJob.installation?.installStatus || "JOB_NOT_STARTED_YET",
                checkSheetSignedAsComplete: selectedJob.installation?.checkSheetSignedAsComplete ?? false,
              },
            },
          })
        );
      }

      setSheetOpen(false);
      setSelectedJob(null);

      try {
        if (requests.length > 0) {
          await Promise.all(requests);
          calendarCache.current.clear();
          rawJobsCache.current.clear();
          clearCalendarSessionCache();
        }
      } catch (err) {
        if (planningChanged) {
          setInstallPlanningByJobId((prev) => {
            const next = { ...prev };
            if (hadOverlayPlanning) next[jobId] = originalPlanning;
            else delete next[jobId];
            return next;
          });
        }
        if (installDateChanged) {
          setJobs((prev) => prev.map((job) => job._id === jobId ? {
            ...job,
            installation: {
              ...job.installation,
              installDate: previousInstallDate,
            },
          } : job));
        }
        throw err;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save install planning details");
    } finally {
      setSaving(false);
    }
  };

  const clearInstallDate = async () => {
    if (!selectedJob) return;
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
      });
      setJobs((prev) => prev.map((job) => job._id === selectedJob._id ? {
        ...job,
        installation: {
          ...job.installation,
          installDate: null,
        },
      } : job));
      calendarCache.current.clear();
      rawJobsCache.current.clear();
      clearCalendarSessionCache();
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
      const key = dateKeyFromIsoNz(job.installation?.installDate);
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
    const gridStart = startOfWeekMonday(monthStart);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const lastGridDay = addDays(startOfWeekMonday(monthEnd), 6);

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
  }, [jobsByDay, monthCursor, placeholdersByDay]);

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
    setMonthCursor(nextTodayMonth);
    if (sameMonth(monthCursor, nextTodayMonth)) {
      if (scrollToTodayWeek()) {
        shouldScrollToTodayRef.current = false;
      }
    }
  }, [monthCursor, scrollToTodayWeek]);

  const changeMonth = useCallback((amount: number) => {
    shouldScrollToTodayRef.current = false;
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
            onClick={() => load(true)}
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
        {loading ? (
          <div className="bg-white border border-gray-100 rounded-2xl p-8 flex flex-col items-center justify-center gap-3">
            <div className="h-8 w-8 rounded-full border-2 border-[#e85d04] border-t-transparent animate-spin" />
            <div className="text-sm text-gray-500">Loading calendar</div>
          </div>
        ) : error ? (
          <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">
            {error}
            <button onClick={() => load(true)} className="ml-2 underline">Retry</button>
          </div>
        ) : (
          <div className="space-y-4 overflow-x-auto pb-4">
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
                            const installTime = timeFromDatetimeLocal(job.installation?.installDate);
                            const statusLabel = isInstalled ? calendarStatusLabel(job) : isPencilled ? "Pencilled" : "Confirmed";
                            const csBadge = checksheetBadge(job);
                            const phone = customerPhone(job);
                            return (
                              <div key={job._id} className={`group w-full rounded-xl border p-2 shadow-sm transition-colors border-l-4 ${isInstalled ? "border-emerald-200 bg-emerald-50/70 hover:bg-emerald-50" : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/70"} ${isPencilled ? "border-l-amber-500" : "border-l-emerald-500"}`}>
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
                <button
                  onClick={() => openJobPage(selectedJob._id)}
                  className="text-xs font-semibold text-[#1a3a4a] bg-white border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50"
                >
                  Open job
                </button>
              </div>
            </div>

            <InstallPlanningForm
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
            />

            <InstallPlanningActions
              saving={saving}
              canSave={!!installDate && !!installScope}
              onCancel={closeSheet}
              onSave={saveInstallMeta}
            />
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
