import { gql } from "@/lib/graphql";
import type { BoardJob } from "./board";
import { crmFreshMs, loadCrmRead, recentCrmRead } from "./client";

export const boardPageSize = 40;
export const quoteSortPreference = "jobs-sort-order:QUOTE";
export type QuoteContacts = Record<string, Pick<BoardJob, "client" | "lead">>;
type QuoteVersion = Pick<BoardJob, "_id" | "updatedAt">;
type VisibleQuote = QuoteVersion & Pick<BoardJob, "stage" | "archivedAt" | "client" | "lead">;

export class QuoteSelectionChanged extends Error {
  constructor() {
    super("These quotes changed while loading. Retry to see the latest list.");
  }
}

export function quoteContactsKey(rows: QuoteVersion[]) {
  return rows.map(row => `${row._id}:${row.updatedAt}`).sort().join(",");
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

async function readContacts(rows: QuoteVersion[], token: string) {
  const ids = rows.map(row => row._id);
  const declarations = ids.map((_, index) => `$quote${index}: ObjectId!`).join(", ");
  const fields = ids.map((_, index) => `card${index}: job(_id: $quote${index}) {
    _id stage archivedAt updatedAt
    lead { allocatedTo { _id firstname lastname } }
    client { contactDetails { name email phoneMobile streetAddress suburb city } }
  }`).join("\n");
  const cards = await gql<Record<string, VisibleQuote | null>>(
    `query QuoteCardDetails(${declarations}) { ${fields} }`,
    Object.fromEntries(ids.map((id, index) => [`quote${index}`, id])),
    { token },
  );
  return Object.fromEntries(rows.map((row, index) => {
    const card = cards?.[`card${index}`];
    if (card === undefined || (card && card._id !== row._id)) throw Error("Could not verify quote details. Please retry.");
    if (!card || card.stage !== "QUOTE" || card.archivedAt || card.updatedAt !== row.updatedAt) throw new QuoteSelectionChanged();
    return [row._id, { client: card.client, lead: card.lead }];
  }));
}

export const recentQuoteContacts = (rows: QuoteVersion[], token: string) =>
  recentCrmRead<QuoteContacts>("quote-cards", quoteContactsKey(rows), token);

export async function readQuoteContacts(rows: QuoteVersion[], token: string) {
  if (!rows.length) return {};
  const sorted = [...rows].sort((a, b) => a._id.localeCompare(b._id));
  const first = readContacts(sorted.slice(0, 20), token);
  if (sorted.length <= 20) return first;
  const [left, right] = await Promise.all([first, readContacts(sorted.slice(20), token)]);
  return { ...left, ...right };
}

export async function loadQuoteContacts(rows: QuoteVersion[], token: string) {
  if (!rows.length) return {};
  const key = quoteContactsKey(rows);
  const cached = await recentCrmRead<QuoteContacts>("quote-cards", key, token, crmFreshMs);
  if (cached && !cached.recovered) return cached.data;
  return (await loadCrmRead("quote-cards", key, token, () => readQuoteContacts(rows, token))).data;
}
