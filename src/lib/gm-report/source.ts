import "server-only";
import { overlaySql } from "@/lib/overlay-db";
import { readSplits } from "@/lib/installation-splits/store";
import { sourceQuery } from "./access";
import { buildSnapshot, isSaleCandidate, ReportError } from "./model";
import { SourceReadError } from "./source-error";
import {
  readUnchangedAcceptanceDates,
  writeAcceptanceFacts,
  type AcceptanceFact,
} from "./accepted-date-cache";
import type { Job, Placeholder, Settings } from "./types";
// acceptedAt is non-null in the schema but absent from bulk job results. Read it
// through job(_id:) below, as the existing Sales & Usage report does.
export const GM_JOBS_QUERY = `query GMReportJobs($skip:Int,$limit:Int){jobs(stages:[LEAD,QUOTE,SCHEDULED,INSTALLATION,INVOICE,COMPLETED],skip:$skip,limit:$limit){total results{_id jobNumber stage archivedAt createdAt updatedAt quote{status c_total consentFee c_gst totalOverridden wall{SQM c_bagCount} ceiling{SQM c_bagCount} extras{name price}} installation{installDate installStatus checkSheetSignedAsComplete} installerChecksheet{complete actualBags} client{contactDetails{name}}}}}`;
export async function loadSnapshot(
  token: string,
  week: string,
  settings: Settings,
) {
  const jobs: Job[] = [];
  let total: number | null = null;
  for (let skip = 0; skip < 25000; skip += 250) {
    const data = await sourceQuery<{ jobs: { total: number; results: Job[] } }>(
      token,
      GM_JOBS_QUERY,
      { skip, limit: 250 },
    );
    if (
      !data.jobs ||
      !Number.isInteger(data.jobs.total) ||
      !Array.isArray(data.jobs.results) ||
      data.jobs.results.some((j) => !j || typeof j._id !== "string")
    )
      throw new ReportError("CRM returned incomplete job data.", 503);
    if (total === null) total = data.jobs.total;
    if (total !== data.jobs.total)
      throw new ReportError(
        "CRM jobs changed while loading. Refresh again.",
        409,
      );
    jobs.push(...data.jobs.results);
    if (jobs.length >= total) break;
    if (!data.jobs.results.length)
      throw new ReportError("CRM job load was incomplete.", 503);
  }
  if (total !== jobs.length || new Set(jobs.map((j) => j._id)).size !== total)
    throw new ReportError("CRM job load was incomplete. Please retry.", 503);
  const accepted = jobs.filter(
    (job) => !job.acceptedAt && isSaleCandidate(job),
  );
  const cachedDates = await readUnchangedAcceptanceDates(accepted);
  const pending = accepted.filter((j) => {
    const date = cachedDates.get(j._id);
    if (!date) return true;
    j.acceptedAt = date;
    return false;
  });
  const facts: AcceptanceFact[] = [];
  for (let i = 0; i < pending.length; i += 24)
    await Promise.all(
      pending.slice(i, i + 24).map(async (j) => {
        // Start time ensures an edit during this request invalidates the cache.
        const checkedAt = new Date().toISOString();
        try {
          const d = await sourceQuery<{
            job: { _id: string; acceptedAt?: string | null };
          }>(
            token,
            "query GMReportAcceptedAt($_id:ObjectId!){job(_id:$_id){_id acceptedAt}}",
            { _id: j._id },
          );
          if (d.job?._id !== j._id)
            throw new ReportError(
              "Sale acceptance date lookup was incomplete.",
              503,
            );
          j.acceptedAt = d.job.acceptedAt;
          j.acceptedAtMissing = !d.job.acceptedAt;
        } catch (error) {
          // A legacy job without a date is a known data gap, not a failed refresh.
          // All network/auth/other field errors still abort and retain the old snapshot.
          if (
            !(error instanceof SourceReadError) ||
            !error.isMissingAcceptanceDate
          )
            throw error;
          j.acceptedAt = null;
          j.acceptedAtMissing = true;
        }
        facts.push({
          jobId: j._id,
          acceptedAt: j.acceptedAt || null,
          checkedAt,
        });
      }),
    );
  await writeAcceptanceFacts(facts);
  const [splits, ph] = await Promise.all([
    readSplits(jobs.map((j) => j._id)),
    overlaySql`SELECT id,starts_at,ends_at,title,note FROM calendar_placeholders WHERE resolved_at IS NULL`,
  ]);
  const placeholders: Placeholder[] = ph.map((p) => ({
    id: String(p.id),
    startsAt: new Date(String(p.starts_at)).toISOString(),
    endsAt: p.ends_at ? new Date(String(p.ends_at)).toISOString() : null,
    title: String(p.title),
    note: p.note ? String(p.note) : null,
  }));
  return buildSnapshot(week, jobs, splits, placeholders, settings);
}
