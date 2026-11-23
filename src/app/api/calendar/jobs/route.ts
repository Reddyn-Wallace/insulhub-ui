import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { CALENDAR_STAGES, calendarVisits } from "@/lib/installation-splits/views";
import { reconcilePastRevisits } from "@/lib/installation-splits/reconcile";
import { readCalendarSplits } from "@/lib/installation-splits/store";
import { calendarDateBounds, calendarDay } from "@/lib/calendar/dates";
import { requireInsulhubAuth, tokenFromRequest } from "@/lib/insulhub-auth";
import { ensureOverlaySchema } from "@/lib/overlay-db";
import { forgetSharedSchedule, readSharedSchedule, sharedScheduleTtlSeconds, writeSharedSchedule } from "@/lib/calendar/shared-schedule";

interface CalendarJob {
  _id: string;
  jobNumber: number;
  stage: string;
  archivedAt?: string | null;
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

interface JobsData {
  jobs: {
    results: CalendarJob[];
    total: number;
  };
}

const INSULHUB_GRAPHQL_URL = "https://api.insulhub.nz/graphql";
const CALENDAR_JOB_FIELDS = `
  _id
  jobNumber
  stage
  archivedAt
  notes
  installation {
    installDate
    installNote
    installStatus
    checkSheetSignedAsComplete
  }
  installerChecksheet {
    _id
    complete
  }
  client {
    contactDetails {
      name
      email
      phoneMobile
      phoneSecondary
      streetAddress
      suburb
      city
    }
  }
  quote {
    c_total
    wall { SQM c_bagCount }
    ceiling { SQM }
  }
`;
const CALENDAR_JOBS_QUERY = `
  query CalendarJobs($stages: [JobStage!], $skip: Int, $limit: Int, $installStartDate: DateTimeISO, $installEndDate: DateTimeISO) {
    jobs(stages: $stages, skip: $skip, limit: $limit, installStartDate: $installStartDate, installEndDate: $installEndDate) {
      total
      results { ${CALENDAR_JOB_FIELDS} }
    }
  }
`;
const pageSize = 250;
const sourceBatchSize = 40;
const stages: ReadonlySet<string> = new Set(CALENDAR_STAGES);

type CalendarResponse = { jobs: CalendarJob[]; unscheduled: CalendarJob[]; checkedAt: number };
const snapshots = new Map<string, CalendarResponse>();
const snapshotMaxAge = sharedScheduleTtlSeconds * 1000;
const maxSnapshots = 64;

function snapshotScope(token: string) {
  return `${createHash("sha256").update(token).digest("hex")}:`;
}

async function forgetSchedules(token: string) {
  const scope = snapshotScope(token);
  for (const key of snapshots.keys()) {
    if (key.startsWith(scope)) snapshots.delete(key);
  }
  await forgetSharedSchedule(scope);
}

function rememberSchedule(key: string, snapshot: CalendarResponse) {
  if ((snapshots.get(key)?.checkedAt ?? 0) > snapshot.checkedAt) return false;
  snapshots.delete(key);
  snapshots.set(key, snapshot);
  while (snapshots.size > maxSnapshots) {
    const oldest = snapshots.keys().next().value;
    if (oldest !== undefined) snapshots.delete(oldest);
  }
  return true;
}


class CalendarReadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type GraphQLError = {
  message?: string;
  path?: (string | number)[];
  extensions?: { code?: string; exception?: { statusCode?: number } };
};

function isUnavailableSource(error: GraphQLError, data: Record<string, unknown>) {
  const alias = error.path?.[0];
  return typeof alias === "string" && /^source\d+$/.test(alias) && data?.[alias] === null &&
    (["NOT_FOUND", "FORBIDDEN"].includes(error.extensions?.code ?? "") ||
      [403, 404].includes(error.extensions?.exception?.statusCode ?? 0));
}

async function graphql<T>(
  token: string, query: string, variables: object, signal: AbortSignal, allowUnavailableSources = false,
): Promise<T> {
  const response = await fetch(INSULHUB_GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-access-token": token },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new CalendarReadError("Failed to load calendar jobs", response.status);
  const json = await response.json();
  const errors = (json.errors as GraphQLError[] | undefined)?.filter(error =>
    !allowUnavailableSources || !isUnavailableSource(error, json.data),
  );
  if (errors?.length) {
    const message = errors[0].message || "Failed to load calendar jobs";
    const status = /unauthorized|unauthenticated/i.test(message) ? 401 : 502;
    throw new CalendarReadError(status === 401 ? "Unauthorized" : "Failed to load calendar jobs", status);
  }
  return json.data as T;
}

async function jobsInRange(token: string, bounds: { start: string; end: string }, signal: AbortSignal) {
  const jobs = new Map<string, CalendarJob>();
  let total: number | undefined;
  for (let page = 0; page < 100; page++) {
    const data = await graphql<JobsData>(token, CALENDAR_JOBS_QUERY, {
      stages: CALENDAR_STAGES,
      skip: jobs.size,
      limit: pageSize,
      installStartDate: bounds.start,
      installEndDate: bounds.end,
    }, signal);
    const result = data?.jobs;
    if (!Array.isArray(result?.results) || !Number.isSafeInteger(result.total) || result.total < 0) break;
    total ??= result.total;
    if (total !== result.total) throw new Error("Jobs changed while loading. Refresh the calendar.");
    for (const job of result.results) {
      if (!job?._id || jobs.has(job._id)) throw new Error("Calendar results are incomplete. Refresh before scheduling.");
      jobs.set(job._id, job);
    }
    if (jobs.size === total) return jobs;
    if (!result.results.length || jobs.size > total) break;
  }
  throw new Error("Calendar results are incomplete. Refresh before scheduling.");
}

async function loadRevisitSources(token: string, ids: string[], signal: AbortSignal) {
  const sources: CalendarJob[] = [];
  for (let start = 0; start < ids.length; start += sourceBatchSize) {
    const batch = ids.slice(start, start + sourceBatchSize);
    const declarations = batch.map((_, index) => `$id${index}: ObjectId!`).join(", ");
    const selections = batch.map((_, index) => `source${index}: job(_id: $id${index}) { ${CALENDAR_JOB_FIELDS} }`).join("\n");
    const variables = Object.fromEntries(batch.map((id, index) => [`id${index}`, id]));
    const data = await graphql<Record<string, CalendarJob | null>>(
      token, `query CalendarRevisitSources(${declarations}) { ${selections} }`, variables, signal, true,
    );
    for (const [index, id] of batch.entries()) {
      const job = data?.[`source${index}`];
      if (job === undefined || (job !== null && job._id !== id)) {
        throw new Error("Calendar revisit results are incomplete. Refresh before scheduling.");
      }
      if (job) sources.push(job);
    }
  }
  return sources;
}

export async function GET(request: NextRequest) {
  const timings: string[] = [];
  const speculation = new AbortController();
  const timed = async <T,>(name: string, work: Promise<T>) => {
    const start = performance.now();
    try {
      return await work;
    } finally {
      timings.push(`${name};dur=${(performance.now() - start).toFixed(1)}`);
    }
  };
  const headers = () => ({ "Cache-Control": "private, no-store", "Server-Timing": timings.join(", ") });
  const token = tokenFromRequest(request);
  try {
    const { searchParams } = new URL(request.url);
    const start = calendarDay(searchParams.get("start"));
    const end = calendarDay(searchParams.get("end"));
    if (!start || !end || start > end) {
      return NextResponse.json({ error: "Valid start and end query params are required" }, { status: 400 });
    }
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const includeUnscheduled = searchParams.get("includeUnscheduled") !== "0";
    const read = searchParams.get("read");
    const monthSize = Date.parse(end) - Date.parse(start) <= 41 * 86_400_000;
    const key = !includeUnscheduled && monthSize && (read === "recent" || read === "live")
      ? `${snapshotScope(token)}${start}:${end}` : null;
    const checkedAt = Date.now();
    const inMemory = key && read === "recent" ? snapshots.get(key) : undefined;
    const memoryIsRecent = inMemory && checkedAt - inMemory.checkedAt < snapshotMaxAge;
    const shared = key && read === "recent" && !memoryIsRecent && process.env.VERCEL === "1"
      ? await timed("snapshot_lookup", readSharedSchedule<CalendarResponse>(token, key))
      : undefined;
    const recent = memoryIsRecent ? inMemory : shared;
    const useRecent = recent && checkedAt - recent.checkedAt < snapshotMaxAge;
    // Recheck the legacy session on a hit. A live read also asks the jobs API,
    // whose current permission decision supersedes an older overlay memo.
    const authorize = timed("auth", useRecent ? requireInsulhubAuth(request, 0) : requireInsulhubAuth(request))
      .then(denied => {
        if (denied) {
          throw new CalendarReadError(denied.status === 401 ? "Unauthorized" : "Could not verify calendar access", denied.status);
        }
      });
    if (useRecent) {
      await authorize;
      if (key && shared) rememberSchedule(key, recent);
      timings.push(shared ? "snapshot_shared;dur=0" : "snapshot;dur=0");
      return NextResponse.json(recent, { headers: headers() });
    }
    if (key && inMemory) snapshots.delete(key);

    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12000)]);
    let dateSources: Map<string, CalendarJob> | undefined;
    const dateLoad = timed("jobs", jobsInRange(token, calendarDateBounds(start, end), signal))
      .then(sources => {
        dateSources = sources;
        return sources;
      });
    const splitLoad = authorize.then(async () => {
      await ensureOverlaySchema();
      const splits = await timed("splits", readCalendarSplits(start, end, includeUnscheduled));
      const sourceIds = Object.entries(splits)
        .filter(([id, split]) => split && !dateSources?.has(id))
        .map(([id]) => id);

      // Overlap the two upstream reads when the index arrives first. A date
      // response that already has every source can skip the speculative work.
      const pending = sourceIds.length
        ? timed("revisits", loadRevisitSources(token, sourceIds, AbortSignal.any([signal, speculation.signal])))
          .then(rows => ({ rows }), (error: unknown) => ({ error }))
        : null;
      return { splits, sourceIds, pending };
    });
    const [sources, { splits, sourceIds, pending }] = await Promise.all([dateLoad, splitLoad]);
    const missingIds = sourceIds.filter(id => !sources.has(id));
    if (pending && missingIds.length) {
      const result = await pending;
      if ("error" in result && missingIds.length === sourceIds.length) throw result.error;
      const revisits = "rows" in result
        ? result.rows
        : await timed("retry_revisits", loadRevisitSources(token, missingIds, signal));
      for (const job of revisits) {
        if (!sources.has(job._id)) sources.set(job._id, job);
      }
    }

    const jobs = [];
    const unscheduled = [];
    const now = new Date(checkedAt);
    for (const job of sources.values()) {
      if (job.archivedAt || !stages.has(job.stage) || splits[job._id] === null) continue;
      const stored = splits[job._id];
      const split = stored ? await reconcilePastRevisits(stored, job, now) : null;
      for (const visit of calendarVisits(job, split)) {
        const day = calendarDay(visit.installation?.installDate);
        if (day && day >= start && day <= end) jobs.push(visit);
        if (includeUnscheduled && !day && visit.splitVisit?.state === "planned") unscheduled.push(visit);
      }
    }
    const result = { jobs, unscheduled, checkedAt };
    if (key && rememberSchedule(key, result)) {
      await timed("snapshot_store", writeSharedSchedule(token, key, snapshotScope(token), result, read === "live"));
    }
    return NextResponse.json(result, { headers: headers() });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    const status = error instanceof CalendarReadError ? error.status : timedOut ? 504 : 500;
    if (token && (status === 401 || status === 403)) await forgetSchedules(token);
    const message = timedOut ? "The calendar source took too long to respond" :
      error instanceof Error ? error.message : "Failed to load calendar jobs";
    return NextResponse.json({ error: message }, { status, headers: headers() });
  } finally {
    speculation.abort();
  }
}
