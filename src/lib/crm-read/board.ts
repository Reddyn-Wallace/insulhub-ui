import { gql } from "@/lib/graphql";
import { JOBS_QUERY } from "@/lib/queries";
import { getSplitRevision, loadPendingSplits } from "@/lib/installation-splits/client";
import { queueVisits } from "@/lib/installation-splits/views";
import type { SavedSplit, VisitLabel } from "@/lib/installation-splits/projection";
import { crmFreshMs, loadCrmRead, recentCrmRead } from "./client";
import { boardPageSize, compareQuoteDate, loadQuoteContacts, quoteSortPreference, quoteState } from "./quotes";
import { isCrmReadDenied, isCrmReadTransient } from "./session";

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
const quoteIndexQuery = (includeSalespeople: boolean) => `
  query Jobs($stages: [JobStage!], $skip: Int, $limit: Int) {
    jobs(stages: $stages, skip: $skip, limit: $limit, showArchived: false) { total results {
      _id jobNumber stage updatedAt archivedAt
      lead { leadStatus leadSource callbackDate ${includeSalespeople ? "allocatedTo { _id }" : ""} }
      quote { date status deferralDate c_total }
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

const quoteIndexPageSize = 250;
const leanQuoteIndexPageSize = 1500;
const quoteIndexRequestMs = 7000;
const quoteIndexError = "Quote results changed while loading. Please retry.";

async function readQuoteIndex(token: string, includeSalespeople: boolean): Promise<BoardRows> {
  const deadline = performance.now() + 24_000;
  const query = quoteIndexQuery(includeSalespeople);
  const seen = new Set<string>();
  const pages = new Map<number, BoardJob[]>();
  let limit = includeSalespeople ? quoteIndexPageSize : leanQuoteIndexPageSize;
  let stopped = false;

  async function readPage(skip: number, retry = true): Promise<JobsData["jobs"]> {
    const timeLeft = Math.ceil(deadline - performance.now());
    if (stopped || timeLeft <= 0) throw Error("The quote list took too long to load. Please retry.");
    if (localStorage.getItem("token") !== token) throw Error("Your sign-in changed. Please try again.");
    let response: JobsData;
    try {
      response = await gql(query, { stages: ["QUOTE"], skip, limit }, {
        token, timeoutMs: Math.min(timeLeft, quoteIndexRequestMs),
      });
    } catch (error) {
      if (retry && !stopped && !isCrmReadDenied(error) && isCrmReadTransient(error)) {
        return readPage(skip, false);
      }
      throw error;
    }
    const page = response?.jobs;
    if (!page || !Number.isSafeInteger(page.total) || page.total < 0 || !Array.isArray(page.results)) throw Error(quoteIndexError);
    return page;
  }

  try {
    const first = await readPage(0, includeSalespeople).catch(error => {
      const refusedLimit = error instanceof Error && /\blimit\b/i.test(error.message);
      if (includeSalespeople || isCrmReadDenied(error) || (!isCrmReadTransient(error) && !refusedLimit)) throw error;
      limit = quoteIndexPageSize;
      return readPage(0);
    });
    const total = first.total;
    const size = first.results.length;
    if (size > total || (total && !size)) throw Error(quoteIndexError);
    function collect(page: JobsData["jobs"], offset: number, requested: number) {
      if (page.total !== total || page.results.length !== Math.min(requested, total - offset)) throw Error(quoteIndexError);
      for (const job of page.results) {
        if (!job?._id || seen.has(job._id)) throw Error(quoteIndexError);
        seen.add(job._id);
      }
      pages.set(offset, page.results);
    }
    collect(first, 0, size);
    let next = size;
    limit = Math.min(size, quoteIndexPageSize);
    const workers = limit ? Math.min(4, Math.ceil((total - size) / limit)) : 0;
    const outcomes = await Promise.allSettled(Array.from({ length: workers }, async () => {
      try {
        while (!stopped && next < total) {
          const offset = next;
          next += limit;
          collect(await readPage(offset), offset, limit);
        }
      } catch (error) {
        stopped = true;
        throw error;
      }
    }));
    const failures = outcomes.filter(outcome => outcome.status === "rejected");
    const failed = failures.find(outcome => isCrmReadDenied(outcome.reason)) ?? failures[0];
    if (failed) throw failed.reason;
    if (seen.size !== total) throw Error(quoteIndexError);
    return { jobs: [...pages].sort(([a], [b]) => a - b).flatMap(([, rows]) => rows), total };
  } finally {
    stopped = true;
  }
}

export async function readBoardSource(stage: string, token: string, includeQuoteSalespeople = false) {
  if (stage === "QUOTE") return readQuoteIndex(token, includeQuoteSalespeople);
  const stages = stage === "JOBS" ? activeStages : [stage];
  const query = stage === "LEAD" ? salesQuery : JOBS_QUERY;
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

function boardKey(stage: string, includeQuoteSalespeople: boolean) {
  if (stage !== "QUOTE") return stage;
  return includeQuoteSalespeople ? "quote-index:v2:with-salespeople" : "quote-index:v2";
}

export const recentBoard = (stage: string, token: string, includeQuoteSalespeople = false) =>
  recentCrmRead<BoardRows>("board", boardKey(stage, includeQuoteSalespeople), token);

export async function loadBoard(stage: string, token: string, includeQuoteSalespeople = false) {
  const revision = getSplitRevision();
  return (await loadCrmRead("board", boardKey(stage, includeQuoteSalespeople), token, async () => {
    if (stage === "JOBS") {
      const [rows, splits] = await Promise.all([readBoardSource(stage, token), loadPendingSplits(token)]);
      const result = await addRevisits(rows, splits, token);
      if (revision !== getSplitRevision()) throw Error("Visits changed while loading. Please retry.");
      return result;
    }
    const rows = await readBoardSource(stage, token, includeQuoteSalespeople);
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
