import { gql } from "@/lib/graphql";
import { JOBS_QUERY } from "@/lib/queries";
import { getSplitRevision, loadPendingSplits } from "@/lib/installation-splits/client";
import { queueVisits } from "@/lib/installation-splits/views";
import type { SavedSplit, VisitLabel } from "@/lib/installation-splits/projection";
import { crmFreshMs, loadCrmRead, recentCrmRead } from "./client";
import { boardPageSize, compareQuoteDate, loadQuoteContacts, quoteSortPreference, quoteState } from "./quotes";

export interface BoardJob {
  _id: string;
  jobNumber: number;
  stage: string;
  createdAt?: string;
  updatedAt: string;
  archivedAt?: string;
  splitVisit?: VisitLabel;
  quoteLastSentAt?: string;
  installation?: { installDate?: string; installStatus?: string };
  lead?: {
    leadStatus?: string;
    leadSource?: string[];
    allocatedTo?: { _id: string; firstname: string; lastname: string };
    callbackDate?: string;
    quoteBookingDate?: string;
  };
  quote?: { quoteNumber?: string; date?: string; status?: string; deferralDate?: string; c_total?: number };
  client?: { contactDetails?: { name?: string; email?: string; phoneMobile?: string; streetAddress?: string; suburb?: string; city?: string } };
}

export type BoardRows = { jobs: BoardJob[]; total: number };
export type JobsData = { jobs: { total: number; results: BoardJob[] } };
const activeStages = ["SCHEDULED", "INSTALLATION", "INVOICE"];
const salesFields = `
  _id jobNumber stage createdAt updatedAt archivedAt
  lead { leadStatus leadSource allocatedTo { _id firstname lastname } callbackDate quoteBookingDate }
  quote { quoteNumber date status deferralDate c_total }
  client { contactDetails { name email phoneMobile streetAddress suburb city } }
`;
const salesQuery = `
  query Jobs($stages: [JobStage!], $skip: Int, $limit: Int) {
    jobs(stages: $stages, skip: $skip, limit: $limit) { total results { ${salesFields} } }
  }
`;
const quoteIndexQuery = `
  query Jobs($stages: [JobStage!], $skip: Int, $limit: Int) {
    jobs(stages: $stages, skip: $skip, limit: $limit) { total results {
      _id jobNumber stage createdAt updatedAt archivedAt
      lead { leadStatus leadSource allocatedTo { _id } callbackDate quoteBookingDate }
      quote { quoteNumber date status deferralDate c_total }
    } }
  }
`;
const revisitFields = `${salesFields}
  installation { installDate installStatus checkSheetSignedAsComplete }
  installerChecksheet { complete }
  ebaForm { complete clientApproved }
  council { files_Other files_CouncilApprovalLetters }
  finalInvoice { _id }
  certificateSentAt
`;

export const isBoardStage = (stage: string) =>
  ["LEAD", "QUOTE", "JOBS", "COMPLETED", ...activeStages].includes(stage);

async function readAll(stage: string, token: string) {
  const stages = stage === "JOBS" ? activeStages : [stage];
  const query = stage === "QUOTE" ? quoteIndexQuery : stage === "LEAD" ? salesQuery : JOBS_QUERY;
  const jobs = new Map<string, BoardJob>();
  let total: number | undefined;
  for (let page = 0; page < 100; page++) {
    const result: JobsData = await gql(query, { stages, skip: jobs.size, limit: page === 0 ? 5000 : 1000 }, { token });
    const next = result?.jobs;
    if (!next || !Array.isArray(next.results) || !Number.isSafeInteger(next.total) || next.total < 0) break;
    total ??= next.total;
    if (next.total !== total) break;
    for (const job of next.results) {
      if (!job?._id || jobs.has(job._id)) throw Error("Job results changed while loading. Please retry.");
      jobs.set(job._id, job);
    }
    if (jobs.size === total) return { jobs: [...jobs.values()], total };
    if (!next.results.length || jobs.size > total) break;
  }
  throw Error("Job results changed while loading. Please retry.");
}

async function addRevisits(rows: BoardRows, splits: Record<string, SavedSplit>, token: string): Promise<BoardRows> {
  const known = new Set(rows.jobs.map(job => job._id));
  const missing = Object.keys(splits).filter(id => !known.has(id));
  const source = [...rows.jobs];
  // Only completed parents with a pending revisit can be absent from the
  // active stages. Fetch those individual records, never completed history.
  for (let start = 0; start < missing.length; start += 25) {
    const ids = missing.slice(start, start + 25);
    const declarations = ids.map((_, index) => `$job${index}: ObjectId!`).join(", ");
    const fields = ids.map((_, index) => `parent${index}: job(_id: $job${index}) { ${revisitFields} }`).join("\n");
    const parents = await gql<Record<string, BoardJob | null>>(
      `query BoardRevisitParents(${declarations}) { ${fields} }`,
      Object.fromEntries(ids.map((id, index) => [`job${index}`, id])),
      { token },
    );
    for (const [index, id] of ids.entries()) {
      const job = parents?.[`parent${index}`];
      if (job === undefined || (job && job._id !== id)) throw Error("Could not verify revisit records. Please retry.");
      if (job && (activeStages.includes(job.stage) || job.stage === "COMPLETED")) source.push(job);
    }
  }
  const jobs = queueVisits(source, splits).map(({ splitSource: _source, installationSplit: _split, ...job }) => job);
  return { jobs, total: jobs.length };
}

export const recentBoard = (stage: string, token: string) => recentCrmRead<BoardRows>("board", stage === "QUOTE" ? "quote-index" : stage, token);

export async function loadBoard(stage: string, token: string) {
  const revision = getSplitRevision();
  return (await loadCrmRead("board", stage === "QUOTE" ? "quote-index" : stage, token, async () => {
    if (stage === "JOBS") {
      const [rows, splits] = await Promise.all([readAll(stage, token), loadPendingSplits(token)]);
      const result = await addRevisits(rows, splits, token);
      if (revision !== getSplitRevision()) throw Error("Visits changed while loading. Please retry.");
      return result;
    }
    const rows = await readAll(stage, token);
    const jobs = rows.jobs.filter(job => !job.archivedAt);
    return { jobs, total: stage === "COMPLETED" ? jobs.length : rows.total };
  }, revision)).data;
}

export async function warmBoard(stage: string) {
  const token = localStorage.getItem("token");
  if (!token || !isBoardStage(stage)) return;
  const cached = await recentBoard(stage, token);
  const rows = cached && !cached.recovered && Date.now() - cached.checkedAt < crmFreshMs ? cached.data : await loadBoard(stage, token);
  if (stage === "QUOTE") {
    const newest = localStorage.getItem(quoteSortPreference) === "newest";
    const open = rows.jobs.filter(job => quoteState(job) === "OPEN")
      .sort((a, b) => compareQuoteDate(a, b, newest))
      .slice(0, boardPageSize);
    await loadQuoteContacts(open, token);
  }
}
