import "server-only";
import { overlaySql } from "@/lib/overlay-db";
import type { Job } from "./types";

export type AcceptanceFact = {
  jobId: string;
  acceptedAt: string | null;
  checkedAt: string;
};

// Refresh always reads current job metadata. Only reuse a positive date when
// the CRM says the job has not changed since that date was read.
export async function readUnchangedAcceptanceDates(jobs: Job[]) {
  const dates = new Map<string, string>();
  if (!jobs.length) return dates;
  const rows = await overlaySql`
    SELECT insulhub_job_id, accepted_at, accepted_at_missing, last_checked_at, last_error
    FROM gm_report_accepted_dates
    WHERE insulhub_job_id = ANY(${jobs.map((j) => j._id)}::text[])
  `;
  const modified = new Map(
    jobs.map((j) => [j._id, Date.parse(j.updatedAt || "")]),
  );
  for (const row of rows) {
    const id = String(row.insulhub_job_id || "");
    const updated = modified.get(id);
    const checked = Date.parse(String(row.last_checked_at || ""));
    const accepted = Date.parse(String(row.accepted_at || ""));
    if (
      updated !== undefined &&
      Number.isFinite(updated) &&
      Number.isFinite(checked) &&
      Number.isFinite(accepted) &&
      updated <= checked &&
      !row.accepted_at_missing &&
      !row.last_error
    )
      dates.set(id, new Date(accepted).toISOString());
  }
  return dates;
}

export async function writeAcceptanceFacts(facts: AcceptanceFact[]) {
  if (!facts.length) return;
  await overlaySql`
    INSERT INTO gm_report_accepted_dates (
      insulhub_job_id, accepted_at, accepted_at_missing, last_checked_at, last_error
    )
    SELECT x.job_id, x.accepted_at, x.accepted_at IS NULL, x.checked_at,
      CASE WHEN x.accepted_at IS NULL THEN 'missing-acceptance-date' ELSE '' END
    FROM jsonb_to_recordset(${JSON.stringify(
      facts.map((f) => ({
        job_id: f.jobId,
        accepted_at: f.acceptedAt,
        checked_at: f.checkedAt,
      })),
    )}::jsonb) AS x(job_id text, accepted_at timestamptz, checked_at timestamptz)
    ON CONFLICT (insulhub_job_id) DO UPDATE SET
      accepted_at = EXCLUDED.accepted_at,
      accepted_at_missing = EXCLUDED.accepted_at_missing,
      last_checked_at = EXCLUDED.last_checked_at,
      last_error = EXCLUDED.last_error,
      updated_at = now()
    WHERE gm_report_accepted_dates.last_checked_at <= EXCLUDED.last_checked_at
  `;
}
