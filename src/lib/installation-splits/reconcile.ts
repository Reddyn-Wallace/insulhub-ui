import "server-only";
import { toNzDateKey } from "@/lib/reports/sales-installs-types";
import type { SavedSplit, SourceJob } from "./projection";
import { readSplits, saveSplit, SplitError } from "./store";
import { CALENDAR_STAGES } from "./views";

const installedStatuses = new Set(["INSTALLED_AS_QUOTED", "INSTALLED_WITH_VARIATIONS_FROM_QUOTE"]);

function pastRevisits(split: SavedSplit, today: string) {
  return split.visits.filter((visit, index) =>
    index > 0 && visit.state === "planned" && visit.date && visit.date < today,
  );
}

export async function reconcilePastRevisits(
  split: SavedSplit,
  job: SourceJob,
  now = new Date(),
): Promise<SavedSplit> {
  const installStatus = job.installation?.installStatus ?? "";
  if (job._id !== split.id || job.archivedAt || !CALENDAR_STAGES.includes(job.stage ?? "") ||
      !installedStatuses.has(installStatus)) return split;

  const visits = pastRevisits(split, toNzDateKey(now.toISOString()));
  if (!visits.length) return split;

  const visitIds = visits.map(visit => visit.id);
  const completed = new Set(visitIds);
  const next: SavedSplit = {
    ...split,
    visits: split.visits.map(visit => completed.has(visit.id) ? { ...visit, state: "completed" } : visit),
    history: [...split.history, `${now.toISOString()} · system · Whole job installed. Automatically marked past revisits done using their scheduled dates: ${visits.map(visit => visit.date).join(", ")}.`],
  };
  try {
    return await saveSplit(next, split.version, "system", {
      action: "complete-past-revisits",
      installStatus,
      dateBasis: "scheduled",
      visitIds,
    });
  } catch (error) {
    if (!(error instanceof SplitError) || error.status !== 409) throw error;
    // Preserve any edits made since the source read. The next fresh load can
    // reconcile whatever is still eligible.
    const latest = (await readSplits([split.id]))[split.id];
    if (!latest) throw error;
    return latest;
  }
}

export async function reconcileKnownSplits(
  splits: Record<string, SavedSplit>,
  jobs: Iterable<SourceJob>,
  now = new Date(),
) {
  const reconciled = { ...splits };
  const pending: Promise<void>[] = [];
  for (const job of jobs) {
    const split = splits[job._id];
    if (split) pending.push(reconcilePastRevisits(split, job, now).then(saved => {
      reconciled[job._id] = saved;
    }));
  }
  await Promise.all(pending);
  return reconciled;
}

export async function reconcileListedSplits(splits: Record<string, SavedSplit>, token: string) {
  const now = new Date();
  const today = toNzDateKey(now.toISOString());
  const candidates = Object.values(splits).filter(split => pastRevisits(split, today).length);
  const sources: SourceJob[] = [];
  for (let start = 0; start < candidates.length; start += 25) {
    const batch = candidates.slice(start, start + 25);
    const declarations = batch.map((_, index) => `$job${index}: ObjectId!`).join(", ");
    const fields = batch.map((_, index) =>
      `parent${index}: job(_id: $job${index}) { _id stage archivedAt installation { installStatus } }`,
    ).join("\n");
    const response = await fetch("https://api.insulhub.nz/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", "x-access-token": token },
      body: JSON.stringify({
        query: `query VerifyPastRevisits(${declarations}) { ${fields} }`,
        variables: Object.fromEntries(batch.map((split, index) => [`job${index}`, split.id])),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new SplitError("Could not verify installation status.", 503);
    const result = await response.json();
    if (result.errors?.length) throw new SplitError("Could not verify installation status.", 503);
    for (const [index, split] of batch.entries()) {
      const source = result.data?.[`parent${index}`] as SourceJob | null | undefined;
      if (source === undefined || (source && source._id !== split.id))
        throw new SplitError("Could not verify installation status.", 503);
      if (source) sources.push(source);
    }
  }
  return reconcileKnownSplits(splits, sources, now);
}
