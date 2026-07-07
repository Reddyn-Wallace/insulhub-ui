import "server-only";

import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";
import {
  addDays,
  defaultFromDate,
  todayNzKey,
  toNzDateKey,
  type ReportJob,
  type ReportResponse,
  type ReportResult,
} from "./sales-installs-types";

type InstallPlanningRow = {
  insulhub_job_id?: unknown;
  status?: unknown;
};

type ReportCacheStatus = ReportResponse["cache"]["status"];

const INSULHUB_GRAPHQL_URL = "https://api.insulhub.nz/graphql";
const REPORT_KEY = "sales-installs";
const REPORT_STAGES = ["LEAD", "QUOTE", "SCHEDULED", "INSTALLATION", "INVOICE", "COMPLETED"];
const SCHEDULED_STAGES = new Set(["SCHEDULED", "INSTALLATION", "INVOICE"]);
const INSTALL_REPORT_STAGES = new Set(["SCHEDULED", "INSTALLATION", "INVOICE", "COMPLETED"]);
const ACCEPTED_AT_FETCH_CONCURRENCY = 32;
const MISSING_ACCEPTED_AT_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
const CURRENT_WEEK_TTL_MS = 10 * 60 * 1000;
const PREVIOUS_WEEK_TTL_MS = 24 * 60 * 60 * 1000;

const REPORT_QUERY = `
  query WeeklyTeamReport($stages: [JobStage!], $skip: Int, $limit: Int) {
    jobs(stages: $stages, skip: $skip, limit: $limit) {
      total
      results {
        _id
        jobNumber
        stage
        notes
        createdAt
        archivedAt
        lead {
          allocatedTo { _id firstname lastname }
        }
        quote {
          status
          c_total
          wall { SQM }
          ceiling { SQM }
        }
        installation {
          installDate
          installStatus
        }
        client {
          contactDetails {
            name
            streetAddress
            suburb
            city
            postCode
          }
        }
      }
    }
  }
`;

const ACCEPTED_AT_QUERY = `
  query WeeklyTeamReportAcceptedAt($_id: ObjectId!) {
    job(_id: $_id) {
      _id
      acceptedAt
    }
  }
`;

function parseDateKey(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function snapshotTtlMs(fromDate: string, toDate: string, today: string): number {
  const currentFrom = defaultFromDate(today);
  const currentTo = addDays(currentFrom, 6);
  if (fromDate === currentFrom && toDate >= currentFrom && toDate <= currentTo) {
    return CURRENT_WEEK_TTL_MS;
  }
  return PREVIOUS_WEEK_TTL_MS;
}

function isAcceptedJob(job: ReportJob): boolean {
  const status = (job.quote?.status || "").toUpperCase();
  return status === "ACCEPTED" || status === "INSTALL" || SCHEDULED_STAGES.has(job.stage || "");
}

function isActivePipelineJob(job: ReportJob): boolean {
  return SCHEDULED_STAGES.has(job.stage || "")
    && !["INSTALLED_AS_QUOTED", "INSTALLED_WITH_VARIATIONS_FROM_QUOTE"].includes(job.installation?.installStatus || "");
}

function parseInstallMetaStatus(notes?: string | null): "confirmed" | "pencilled" | null {
  const text = notes || "";
  const start = text.indexOf("[INSTALL_META]");
  const end = text.indexOf("[/INSTALL_META]");
  if (start === -1 || end === -1 || end < start) return null;
  const body = text.slice(start, end);
  const statusMatch = body.match(/^status:\s*(.+)$/im);
  return statusMatch?.[1]?.trim().toLowerCase() === "pencilled" ? "pencilled" : "confirmed";
}

async function insulhubGql<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch(INSULHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-access-token": token,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`InsulHub request failed: ${response.status}`);
  }

  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message || "InsulHub request failed");
  }

  return json.data as T;
}

async function fetchInstallPlanningStatuses(jobIds: string[]): Promise<Record<string, "confirmed" | "pencilled">> {
  if (jobIds.length === 0) return {};

  const rows = await overlaySql`
    SELECT insulhub_job_id, status
    FROM job_install_planning
    WHERE insulhub_job_id = ANY(${jobIds}::text[])
  `;

  const statuses: Record<string, "confirmed" | "pencilled"> = {};
  for (const row of rows as InstallPlanningRow[]) {
    const jobId = String(row.insulhub_job_id || "");
    const status = String(row.status || "");
    if (jobId && (status === "confirmed" || status === "pencilled")) {
      statuses[jobId] = status;
    }
  }
  return statuses;
}

async function readAcceptedDateCache(jobIds: string[]) {
  if (jobIds.length === 0) return new Map<string, string | null>();

  const rows = await overlaySql`
    SELECT insulhub_job_id, accepted_at, accepted_at_missing, last_checked_at
    FROM report_accepted_dates
    WHERE insulhub_job_id = ANY(${jobIds}::text[])
  `;

  const now = Date.now();
  const cache = new Map<string, string | null>();
  for (const row of rows) {
    const jobId = String(row.insulhub_job_id || "");
    if (!jobId) continue;

    if (row.accepted_at) {
      cache.set(jobId, new Date(String(row.accepted_at)).toISOString());
      continue;
    }

    const checkedAt = row.last_checked_at ? new Date(String(row.last_checked_at)).getTime() : 0;
    if (row.accepted_at_missing === true && now - checkedAt < MISSING_ACCEPTED_AT_RECHECK_MS) {
      cache.set(jobId, null);
    }
  }

  return cache;
}

async function writeAcceptedDateCache(jobId: string, acceptedAt: string | null, lastError = "") {
  await overlaySql`
    INSERT INTO report_accepted_dates (
      insulhub_job_id,
      accepted_at,
      accepted_at_missing,
      last_checked_at,
      last_error
    )
    VALUES (
      ${jobId},
      ${acceptedAt}::timestamptz,
      ${acceptedAt ? false : true},
      now(),
      ${lastError}
    )
    ON CONFLICT (insulhub_job_id)
    DO UPDATE SET
      accepted_at = EXCLUDED.accepted_at,
      accepted_at_missing = EXCLUDED.accepted_at_missing,
      last_checked_at = EXCLUDED.last_checked_at,
      last_error = EXCLUDED.last_error,
      updated_at = now()
  `;
}

async function hydrateAcceptedDates(token: string, jobs: ReportJob[]): Promise<ReportJob[]> {
  const candidates = jobs.filter(isAcceptedJob);
  if (candidates.length === 0) return jobs;

  const cached = await readAcceptedDateCache(candidates.map((job) => job._id));
  const acceptedAtById = new Map<string, string | null | undefined>();
  const missing = candidates.filter((job) => {
    if (cached.has(job._id)) {
      acceptedAtById.set(job._id, cached.get(job._id));
      return false;
    }
    return true;
  });

  for (let i = 0; i < missing.length; i += ACCEPTED_AT_FETCH_CONCURRENCY) {
    const batch = missing.slice(i, i + ACCEPTED_AT_FETCH_CONCURRENCY);
    const detailResults = await Promise.allSettled(
      batch.map((job) => insulhubGql<{ job: Pick<ReportJob, "_id" | "acceptedAt"> }>(token, ACCEPTED_AT_QUERY, { _id: job._id }))
    );

    await Promise.all(detailResults.map(async (result, index) => {
      const fallbackJobId = batch[index]._id;
      if (result.status === "fulfilled" && result.value.job?._id) {
        const jobId = result.value.job._id;
        const acceptedAt = result.value.job.acceptedAt || null;
        acceptedAtById.set(jobId, acceptedAt);
        await writeAcceptedDateCache(jobId, acceptedAt);
        return;
      }

      const error = result.status === "rejected" && result.reason instanceof Error
        ? result.reason.message
        : "Accepted date lookup failed";
      acceptedAtById.set(fallbackJobId, null);
      await writeAcceptedDateCache(fallbackJobId, null, error);
    }));
  }

  if (acceptedAtById.size === 0) return jobs;
  return jobs.map((job) => acceptedAtById.has(job._id)
    ? { ...job, acceptedAt: acceptedAtById.get(job._id) }
    : job);
}

async function buildReport(token: string, fromDate: string, toDate: string): Promise<ReportResult> {
  const data = await insulhubGql<{ jobs: { results: ReportJob[] } }>(token, REPORT_QUERY, {
    stages: REPORT_STAGES,
    skip: 0,
    limit: 5000,
  });

  const allJobs = await hydrateAcceptedDates(token, (data.jobs.results || []).filter((job) => !job.archivedAt));

  const leads = allJobs
    .filter((job) => {
      const key = toNzDateKey(job.createdAt);
      return !!key && key >= fromDate && key <= toDate;
    })
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));

  const sales = allJobs
    .filter((job) => {
      const status = (job.quote?.status || "").toUpperCase();
      const key = toNzDateKey(job.acceptedAt);
      return (status === "ACCEPTED" || status === "INSTALL" || SCHEDULED_STAGES.has(job.stage || ""))
        && !!key
        && key >= fromDate
        && key <= toDate;
    })
    .sort((a, b) => toNzDateKey(a.acceptedAt).localeCompare(toNzDateKey(b.acceptedAt)));

  const installs = allJobs
    .filter((job) => {
      const key = toNzDateKey(job.installation?.installDate);
      return INSTALL_REPORT_STAGES.has(job.stage || "")
        && !!key
        && key >= fromDate
        && key <= toDate;
    })
    .sort((a, b) => (a.installation?.installDate || "").localeCompare(b.installation?.installDate || ""));

  const upcomingJobs = allJobs.filter(isActivePipelineJob);
  const upcomingWithDates = upcomingJobs.filter((job) => !!toNzDateKey(job.installation?.installDate));
  const planningStatuses = await fetchInstallPlanningStatuses(upcomingWithDates.map((job) => job._id));
  const upcoming = {
    unscheduled: upcomingJobs.filter((job) => !toNzDateKey(job.installation?.installDate)),
    pencilled: upcomingWithDates.filter((job) => (planningStatuses[job._id] || parseInstallMetaStatus(job.notes)) === "pencilled"),
    confirmed: upcomingWithDates.filter((job) => (planningStatuses[job._id] || parseInstallMetaStatus(job.notes) || "confirmed") === "confirmed"),
  };

  return { leads, sales, installs, upcoming };
}

async function readFreshSnapshot(fromDate: string, toDate: string): Promise<ReportResponse | null> {
  const rows = await overlaySql`
    SELECT payload, built_at, expires_at
    FROM report_snapshots
    WHERE report_key = ${REPORT_KEY}
      AND from_date = ${fromDate}::date
      AND to_date = ${toDate}::date
      AND build_status = 'ready'
      AND payload IS NOT NULL
      AND expires_at > now()
    LIMIT 1
  `;
  const row = rows[0];
  if (!row?.payload || !row.built_at || !row.expires_at) return null;

  return {
    report: row.payload as ReportResult,
    cache: {
      status: "hit",
      builtAt: new Date(String(row.built_at)).toISOString(),
      expiresAt: new Date(String(row.expires_at)).toISOString(),
    },
  };
}

async function tryStartSnapshotBuild(fromDate: string, toDate: string) {
  const rows = await overlaySql`
    INSERT INTO report_snapshots (
      report_key,
      from_date,
      to_date,
      build_status,
      updated_at
    )
    VALUES (
      ${REPORT_KEY},
      ${fromDate}::date,
      ${toDate}::date,
      'building',
      now()
    )
    ON CONFLICT (report_key, from_date, to_date)
    DO UPDATE SET
      build_status = 'building',
      updated_at = now()
    WHERE report_snapshots.build_status <> 'building'
      OR report_snapshots.updated_at < now() - interval '5 minutes'
    RETURNING report_key
  `;
  return rows.length > 0;
}

async function writeSnapshot(fromDate: string, toDate: string, report: ReportResult, ttlMs: number): Promise<ReportResponse> {
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const rows = await overlaySql`
    INSERT INTO report_snapshots (
      report_key,
      from_date,
      to_date,
      payload,
      build_status,
      built_at,
      expires_at,
      last_error,
      updated_at
    )
    VALUES (
      ${REPORT_KEY},
      ${fromDate}::date,
      ${toDate}::date,
      ${JSON.stringify(report)}::jsonb,
      'ready',
      now(),
      ${expiresAt}::timestamptz,
      '',
      now()
    )
    ON CONFLICT (report_key, from_date, to_date)
    DO UPDATE SET
      payload = EXCLUDED.payload,
      build_status = 'ready',
      built_at = EXCLUDED.built_at,
      expires_at = EXCLUDED.expires_at,
      last_error = '',
      updated_at = now()
    RETURNING built_at, expires_at
  `;

  return {
    report,
    cache: {
      status: "miss",
      builtAt: new Date(String(rows[0].built_at)).toISOString(),
      expiresAt: new Date(String(rows[0].expires_at)).toISOString(),
    },
  };
}

async function markSnapshotFailed(fromDate: string, toDate: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Failed to build report";
  await overlaySql`
    INSERT INTO report_snapshots (
      report_key,
      from_date,
      to_date,
      build_status,
      last_error,
      updated_at
    )
    VALUES (
      ${REPORT_KEY},
      ${fromDate}::date,
      ${toDate}::date,
      'failed',
      ${message},
      now()
    )
    ON CONFLICT (report_key, from_date, to_date)
    DO UPDATE SET
      build_status = 'failed',
      last_error = EXCLUDED.last_error,
      updated_at = now()
  `;
}

async function waitForSnapshot(fromDate: string, toDate: string, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await readFreshSnapshot(fromDate, toDate);
    if (snapshot) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return null;
}

export function parseReportRange(fromParam: string | null, toParam: string | null) {
  const today = todayNzKey();
  const fromDate = parseDateKey(fromParam) || defaultFromDate(today);
  const toDate = parseDateKey(toParam) || today;
  if (fromDate > toDate) {
    throw new Error("from must be before or equal to to");
  }
  return { fromDate, toDate, today };
}

export function defaultWarmRanges() {
  const today = todayNzKey();
  const currentFrom = defaultFromDate(today);
  const currentTo = addDays(currentFrom, 6);
  const previousFrom = addDays(currentFrom, -7);
  const previousTo = addDays(currentFrom, -1);
  return [
    { fromDate: currentFrom, toDate: currentTo },
    { fromDate: previousFrom, toDate: previousTo },
  ];
}

export async function getSalesInstallsReport(
  token: string,
  fromDate: string,
  toDate: string,
  options: { refresh?: boolean } = {},
): Promise<ReportResponse> {
  await ensureOverlaySchema();
  const today = todayNzKey();
  const ttlMs = snapshotTtlMs(fromDate, toDate, today);

  if (!options.refresh) {
    const snapshot = await readFreshSnapshot(fromDate, toDate);
    if (snapshot) return snapshot;
  }

  const canBuild = await tryStartSnapshotBuild(fromDate, toDate);
  if (!canBuild && !options.refresh) {
    const snapshot = await waitForSnapshot(fromDate, toDate);
    if (snapshot) return snapshot;
  }

  try {
    const report = await buildReport(token, fromDate, toDate);
    const response = await writeSnapshot(fromDate, toDate, report, ttlMs);
    return {
      ...response,
      cache: {
        ...response.cache,
        status: options.refresh ? "refresh" : response.cache.status,
      },
    };
  } catch (error) {
    await markSnapshotFailed(fromDate, toDate, error);
    throw error;
  }
}

export async function warmSalesInstallsReports(token: string, ranges = defaultWarmRanges()) {
  const results = [];
  for (const range of ranges) {
    try {
      const report = await getSalesInstallsReport(token, range.fromDate, range.toDate);
      results.push({ ...range, ok: true, cache: report.cache });
    } catch (error) {
      results.push({
        ...range,
        ok: false,
        error: error instanceof Error ? error.message : "Failed to warm report",
      });
    }
  }
  return results;
}
