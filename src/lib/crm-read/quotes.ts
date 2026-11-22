import { gql } from "@/lib/graphql";
import type { BoardJob, JobsData } from "./board";
import { crmFreshMs, loadCrmRead, recentCrmRead } from "./client";
import { calendarDataRevision, calendarLastWrite } from "@/lib/calendar/cache";
import { isCrmReadDenied, isCrmReadTransient } from "./session";

export const boardPageSize = 40;
export const quoteSortPreference = "jobs-sort-order:QUOTE";
export type QuoteContacts = Record<string, Pick<BoardJob, "client" | "lead" | "quote">>;
type QuoteVersion = Pick<BoardJob, "_id" | "updatedAt">;
type VisibleQuote = QuoteVersion & Pick<BoardJob, "stage" | "archivedAt" | "client" | "lead" | "quote">;

export class QuoteSelectionChanged extends Error {
  constructor() {
    super("These quotes changed while loading. Retry to see the latest list.");
  }
}

export function quoteContactsKey(rows: QuoteVersion[]) {
  return rows.length ? `v2:${rows.map(row => `${row._id}:${row.updatedAt}`).sort().join(",")}` : "";
}

export function quoteState(job: BoardJob) {
  const status = (job.lead?.leadStatus || "").toUpperCase();
  if (job.quote?.status === "DEFERRED" || ["CALLBACK", "ON_HOLD"].includes(status) || job.lead?.callbackDate) return "CALLBACK";
  if (job.lead?.leadStatus === "DEAD" || job.quote?.status === "DECLINED") return "DEAD";
  return "OPEN";
}

export function compareQuoteDate(a: BoardJob, b: BoardJob, newest: boolean) {
  if (!a.quote?.date) return b.quote?.date ? -1 : 0;
  if (!b.quote?.date) return 1;
  const difference = Date.parse(a.quote.date) - Date.parse(b.quote.date);
  return newest ? -difference : difference;
}

const openQuoteCandidateQuery = `
  query QuoteFirstPageCheck($lead: LeadStatus, $quote: QuoteStatus, $limit: Int!) {
    jobs(stages: [QUOTE], limit: $limit, leadStatus: $lead, quoteStatus: $quote, showArchived: false) {
      total
      results {
        _id jobNumber stage archivedAt updatedAt
        lead { leadStatus allocatedTo { _id firstname lastname } callbackDate }
        quote { quoteNumber status date deferralDate c_total }
        client { contactDetails { name email phoneMobile streetAddress suburb city } }
      }
    }
  }
`;


export async function readOpenQuoteCandidate(token: string, filter: { lead?: "NEW"; quote?: "UNSET" }) {
  const { jobs } = await gql<JobsData>(openQuoteCandidateQuery, {
    lead: filter.lead,
    quote: filter.quote,
    limit: boardPageSize + 1,
  }, { token, timeoutMs: 10000 });
  return jobs;
}

export async function readInitialOpenQuotes(token: string) {
  const page = await readOpenQuoteCandidate(token, { lead: "NEW", quote: "UNSET" });
  if (!Array.isArray(page?.results) || page.total !== page.results.length || page.total > boardPageSize + 1) return [];
  const eligible = page.results.filter(job => job?.stage === "QUOTE" && !job.archivedAt && quoteState(job) === "OPEN");
  if (eligible.some(job => !job._id || !job.updatedAt) || new Set(eligible.map(job => job._id)).size !== eligible.length) return [];
  return eligible;
}

async function readContacts(rows: QuoteVersion[], token: string) {
  const ids = rows.map(row => row._id);
  const declarations = ids.map((_, index) => `$quote${index}: ObjectId!`).join(", ");
  const fields = ids.map((_, index) => `card${index}: job(_id: $quote${index}) {
    _id stage archivedAt updatedAt
    lead { allocatedTo { _id firstname lastname } }
    quote { quoteNumber c_total }
    client { contactDetails { name email phoneMobile streetAddress suburb city } }
  }`).join("\n");
  const query = `query QuoteCardDetails(${declarations}) { ${fields} }`;
  const variables = Object.fromEntries(ids.map((id, index) => [`quote${index}`, id]));
  const writeAt = calendarLastWrite();
  const revision = calendarDataRevision();
  const read = () => gql<Record<string, VisibleQuote | null>>(query, variables, { token, timeoutMs: 6500 });
  const cards = await read().catch(error => {
    if (isCrmReadDenied(error) || !isCrmReadTransient(error) || localStorage.getItem("token") !== token ||
      writeAt !== calendarLastWrite() || revision !== calendarDataRevision()) throw error;
    return read();
  });
  return Object.fromEntries(rows.map((row, index) => {
    const card = cards?.[`card${index}`];
    if (!card || card._id !== row._id || card.stage !== "QUOTE" || card.archivedAt || card.updatedAt !== row.updatedAt) {
      throw new QuoteSelectionChanged();
    }
    return [row._id, { client: card.client, lead: card.lead, quote: card.quote }];
  }));
}

export const recentQuoteContacts = (rows: QuoteVersion[], token: string) =>
  recentCrmRead<QuoteContacts>("quote-cards", quoteContactsKey(rows), token);

export async function readQuoteContacts(rows: QuoteVersion[], token: string) {
  if (!rows.length) return {};
  const sorted = [...rows].sort((a, b) => a._id.localeCompare(b._id));
  if (sorted.length <= 20) return readContacts(sorted, token);
  let deny!: (error: unknown) => void;
  const denied = new Promise<never>((_, reject) => { deny = reject; });
  const readPart = (part: QuoteVersion[]) => readContacts(part, token).catch(error => {
    if (isCrmReadDenied(error)) deny(error);
    throw error;
  });
  const [left, right] = await Promise.race([
    Promise.allSettled([readPart(sorted.slice(0, 20)), readPart(sorted.slice(20))]),
    denied,
  ]);
  if (left.status === "fulfilled" && right.status === "fulfilled") return { ...left.value, ...right.value };
  const failures = [left, right].filter(result => result.status === "rejected");
  const failure = failures.find(result => result.reason instanceof QuoteSelectionChanged) ?? failures[0];
  throw failure.reason;
}

export async function loadQuoteContacts(rows: QuoteVersion[], token: string) {
  if (!rows.length) return {};
  const key = quoteContactsKey(rows);
  const cached = await recentCrmRead<QuoteContacts>("quote-cards", key, token, crmFreshMs);
  if (cached && !cached.recovered) return cached.data;
  return (await loadCrmRead("quote-cards", key, token, () => readQuoteContacts(rows, token))).data;
}
