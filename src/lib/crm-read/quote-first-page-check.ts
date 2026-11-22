import { readBoardSource, type BoardJob, type JobsData } from "./board";
import { boardPageSize, compareQuoteDate, quoteState, readQuoteContacts, readOpenQuoteCandidate } from "./quotes";


const variants = [
  { name: "New lead + unset quote", lead: "NEW", quote: "UNSET" },
  { name: "Unset quote", quote: "UNSET" },
  { name: "New lead", lead: "NEW" },
] as const;
const sampleCount = 20;
export const quoteFirstPageBudgetMs = 2000;

type Outcome = { match: boolean; ms: number; returned: number };
type VariantResult = {
  name: string;
  match: boolean;
  returned: number;
  samples: number[];
  reason?: string;
};
export type QuoteFirstPageReport = { expected: number; baselineMs: number; results: VariantResult[] };

function openRows(rows: BoardJob[], newest: boolean) {
  return rows.filter(job => job.stage === "QUOTE" && !job.archivedAt && quoteState(job) === "OPEN")
    .sort((a, b) => compareQuoteDate(a, b, newest));
}

function cardFields(job: BoardJob) {
  const contact = job.client?.contactDetails;
  const person = job.lead?.allocatedTo;
  return JSON.stringify([
    job._id, job.updatedAt, job.jobNumber,
    job.quote?.quoteNumber, job.quote?.status, job.quote?.date, job.quote?.c_total,
    person?._id, person?.firstname, person?.lastname,
    contact?.name, contact?.email, contact?.phoneMobile, contact?.streetAddress, contact?.suburb, contact?.city,
  ]);
}

export function matchesQuoteFirstPage(page: JobsData["jobs"], expected: BoardJob[], newest: boolean): boolean {
  // A candidate can be filtered and sorted locally only if the entire small
  // subset was verified. A truncated subset could be missing the oldest cards.
  if (!Array.isArray(page?.results) || page.total !== page.results.length) return false;
  const actual = openRows(page.results, newest);
  if (actual.length !== expected.length || new Set(actual.map(job => job._id)).size !== actual.length) return false;
  return actual.slice(0, boardPageSize).every((job, index) => {
    const original = expected[index];
    return original && cardFields(original) === cardFields(job);
  });
}

export async function checkQuoteFirstPage(token: string, newest: boolean, signal: AbortSignal): Promise<QuoteFirstPageReport> {
  const started = performance.now();
  const board = await readBoardSource("QUOTE", token);
  signal.throwIfAborted();
  const expected = openRows(board.jobs, newest);
  const contactDetails = await readQuoteContacts(expected.slice(0, boardPageSize), token);
  const displayed = expected.map(row => {
    const details = contactDetails[row._id];
    return details ? { ...row, client: details.client, lead: { ...row.lead, allocatedTo: details.lead?.allocatedTo },
      quote: details.quote ? { ...row.quote, ...details.quote } : row.quote } : row;
  });
  const baselineMs = Math.round(performance.now() - started);
  async function check(variant: typeof variants[number]): Promise<Outcome> {
    signal.throwIfAborted();
    if (localStorage.getItem("token") !== token) throw Error("Your sign-in changed.");
    const t = performance.now();
    const jobs = await readOpenQuoteCandidate(token, variant);
    if (localStorage.getItem("token") !== token) throw Error("Your sign-in changed.");
    return {
      match: matchesQuoteFirstPage(jobs, displayed, newest),
      ms: Math.round(performance.now() - t),
      returned: jobs?.total ?? 0,
    };
  }

  const results: VariantResult[] = [];
  for (const variant of variants) {
    signal.throwIfAborted();
    try {
      const first = await check(variant);
      const result: VariantResult = { name: variant.name, match: first.match, returned: first.returned, samples: [first.ms] };
      if (first.match) {
        let misses = Number(first.ms > quoteFirstPageBudgetMs);
        for (let sample = 1; sample < sampleCount; sample++) {
          const next = await check(variant);
          result.samples.push(next.ms);
          misses += Number(next.ms > quoteFirstPageBudgetMs);
          if (!next.match) {
            result.match = false;
            break;
          }
          if (misses > 1) break;
        }
      }
      results.push(result);
      if (result.match && result.samples.length === sampleCount &&
          [...result.samples].sort((a, b) => a - b)[18] <= quoteFirstPageBudgetMs) break;
    } catch {
      signal.throwIfAborted();
      if (localStorage.getItem("token") !== token) throw Error("Your sign-in changed.");
      results.push({ name: variant.name, match: false, returned: 0, samples: [], reason: "The CRM could not return this candidate." });
    }
  }
  return { expected: expected.length, baselineMs, results };
}
