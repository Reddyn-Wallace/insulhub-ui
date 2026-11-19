import { getSplitRevision } from "@/lib/installation-splits/client";
import type { SavedSplit, VisitLabel } from "@/lib/installation-splits/projection";
import { CalendarCacheInvalidated, calendarCacheScope, calendarDataRevision, calendarLastWrite, createCalendarCache } from "./cache";
import { calendarRangeForMonth, startOfMonth, type MonthRange } from "./dates";

export interface CalendarJob {
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

export class CalendarRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function readCalendar<T>(path: string, token: string, errorMessage: string): Promise<T> {
  const response = await fetch(path, {
    headers: { "x-access-token": token },
    cache: "no-store",
    signal: AbortSignal.timeout(14_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new CalendarRequestError(data?.error || errorMessage, response.status);
  return data as T;
}

type CalendarSchedule = { jobs: CalendarJob[]; checkedAt: number };

export const refreshAfterMs = 30_000;
const forceAfterWriteMs = 60_000;
export const jobsCache = createCalendarCache<CalendarSchedule>("jobs-schedule");

export function scheduleIsFresh(data: CalendarSchedule) {
  return Date.now() - data.checkedAt < refreshAfterMs;
}

export function loadMonthJobs(scope: string, token: string, range: MonthRange, force = false) {
  const lastWrite = calendarLastWrite();
  const live = force || Date.now() - lastWrite < forceAfterWriteMs;
  return jobsCache.refresh(scope, range.key, async () => {
    const revision = calendarDataRevision();
    const splitRevision = getSplitRevision();
    const read = live ? "live" : "recent";
    const params = new URLSearchParams({ start: range.from, end: range.to, includeUnscheduled: "0", read });
    const data = await readCalendar<CalendarSchedule>(
      `/api/calendar/jobs?${params}`, token, "Could not load scheduled jobs.",
    );
    if (localStorage.getItem("token") !== token || revision !== calendarDataRevision() ||
      splitRevision !== getSplitRevision() || lastWrite !== calendarLastWrite()) {
      throw new CalendarCacheInvalidated();
    }
    if (!Array.isArray(data.jobs)) throw Error("The calendar returned an incomplete schedule.");
    return { jobs: data.jobs, checkedAt: data.checkedAt ?? Date.now() };
  }, live);
}

export async function warmCurrentCalendar() {
  const token = localStorage.getItem("token");
  if (!token || document.visibilityState !== "visible") return;
  const scope = await calendarCacheScope(token);
  if (localStorage.getItem("token") !== token) return;
  const range = calendarRangeForMonth(startOfMonth(new Date()));
  const entry = jobsCache.read(scope, range.key);
  if (entry && scheduleIsFresh(entry.data) && entry.at >= calendarLastWrite()) return;
  await loadMonthJobs(scope, token, range);
}
