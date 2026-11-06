import "server-only";
import { toNzDateKey } from "@/lib/reports/sales-installs-types";
import { completeVisit, rescheduleVisit, undoLastProgress } from "./model";
import { initialSplit, type SourceJob, type SavedSplit } from "./projection";
import { readSplits, saveSplit, SplitError } from "./store";
export const SPLIT_JOB_FIELDS = `_id jobNumber stage archivedAt client{contactDetails{name}} quote{c_total wall{SQM c_bagCount} ceiling{SQM}} installation{installDate installStatus checkSheetSignedAsComplete} installerChecksheet{complete actualBags}`;
export async function loadSplitSource(token: string, id: string) {
  const response = await fetch("https://api.insulhub.nz/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", "x-access-token": token },
    body: JSON.stringify({
      query: `query InstallationSplitSource($_id:ObjectId!){me{_id} job(_id:$_id){${SPLIT_JOB_FIELDS}}}`,
      variables: { _id: id },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new SplitError(
      "Could not verify access to this job.",
      response.status === 401 ? 401 : 502,
    );
  const json = await response.json();
  if (json.errors?.length || !json.data?.job || !json.data?.me?._id)
    throw new SplitError("Could not load this job and staff identity.", 403);
  return { job: json.data.job as SourceJob, actor: String(json.data.me._id) };
}
export async function changeSplit(
  token: string,
  id: string,
  input: Record<string, unknown>,
) {
  if (!Number.isSafeInteger(input.version) || Number(input.version) < 0)
    throw new SplitError("A valid visit version is required.");
  const { job, actor } = await loadSplitSource(token, id);
  if (
    job.archivedAt ||
    !["SCHEDULED", "INSTALLATION", "INVOICE", "COMPLETED"].includes(
      job.stage || "",
    )
  )
    throw new SplitError(
      "Only active installation jobs can have visit records.",
    );
  const existing = (await readSplits([id]))[id];
  if ((existing?.version ?? 0) !== input.version)
    throw new SplitError(
      "This job changed. Reload the visits before trying again.",
      409,
    );
  if (
    !existing &&
    (job.stage === "COMPLETED" ||
      ["INSTALLED_AS_QUOTED", "INSTALLED_WITH_VARIATIONS_FROM_QUOTE"].includes(
        job.installation?.installStatus || "",
      ) ||
      job.installerChecksheet?.complete ||
      job.installation?.checkSheetSignedAsComplete)
  )
    throw new SplitError(
      "This job already has a completed checksheet. Historical splitting requires reviewed backfill.",
    );
  if (!existing && !toNzDateKey(job.installation?.installDate))
    throw new SplitError(
      "Set the original installation date in job planning before recording partial work. This is required by the existing completion process.",
    );
  let next: SavedSplit = existing || initialSplit(job);
  if (next.visits.length >= 100)
    throw new SplitError("This job has reached the visit limit.");
  if (typeof input.visitId !== "string")
    throw new SplitError("Select a visit.");
  const date =
    input.date === null || input.date === ""
      ? null
      : typeof input.date === "string"
        ? input.date
        : undefined;
  if (date === undefined)
    throw new SplitError("Provide a visit date or leave it unscheduled.");
  try {
    if (input.action === "complete") {
      if (typeof input.percent !== "number")
        throw Error("Enter the percentage completed.");
      // The initial scheduled date may be corrected before any progress is recorded.
      if (!existing && typeof input.completedDate === "string")
        next = {
          ...next,
          visits: [{ ...next.visits[0], date: input.completedDate }],
        };
      next = {
        ...next,
        ...completeVisit(next, input.visitId, input.percent, date),
      };
    } else if (input.action === "undo" && existing) {
      next = {
        ...next,
        ...undoLastProgress(
          {
            ...next,
            checksheet: {
              complete:
                job.installerChecksheet?.complete === true ||
                job.installation?.checkSheetSignedAsComplete === true,
              actualBags: job.installerChecksheet?.actualBags ?? null,
            },
          },
          typeof input.reason === "string" ? input.reason : "",
        ),
      };
    } else if (input.action === "reschedule" && existing)
      next = { ...next, ...rescheduleVisit(next, input.visitId, date) };
    else throw Error("Choose record progress or reschedule remaining work.");
  } catch (e) {
    throw new SplitError(
      e instanceof Error ? e.message : "Invalid visit change.",
    );
  }
  next.history = next.history.map((h, i) =>
    i === next.history.length - 1
      ? `${new Date().toISOString()} · ${actor} · ${h}`
      : h,
  );
  return saveSplit(next, Number(input.version), actor, {
    action: input.action,
    visitId: input.visitId,
    percent: input.percent,
    date,
    completedDate: input.completedDate,
    reason: input.reason,
  });
}
