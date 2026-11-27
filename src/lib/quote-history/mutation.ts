import { ADD_FILES, REMOVE_FILE, UPDATE_JOB_QUOTE } from "@/lib/mutations";
import { record } from "./model";

export type QuoteMutation = { id: string; kind: "edit" | "send" | "accepted" } |
  { id: string; kind: "files"; added: string[]; removed: string[] };

const compact = (query: string) => query.replace(/\s+/g, "");
const update = compact(UPDATE_JOB_QUOTE);
const add = compact(ADD_FILES);
const remove = compact(REMOVE_FILE);
export const validQuoteJobId = (id: unknown): id is string => typeof id === "string" && /^[a-f\d]{24}$/i.test(id);

export function quoteHistoryMutation(query: string, variables: unknown): QuoteMutation | null {
  const data = record(variables);
  const input = record(data.input);
  const quote = record(input.quote);
  const quoteId = input._id;
  const quoteWrite = validQuoteJobId(quoteId) && Object.keys(quote).length > 0;
  const sitePlanWrite = data.documentType === "QUOTE_SITE_PLAN" && validQuoteJobId(data._id);
  if (!quoteWrite && !sitePlanWrite) return null;
  const operation = compact(query);
  if (quoteWrite && operation === update) {
    const accepted = input.stage === "SCHEDULED" && quote.status === "ACCEPTED";
    return { id: quoteId, kind: data.emailQuoteToCustomer === true ? "send" : accepted ? "accepted" : "edit" };
  }
  if (data.documentType !== "QUOTE_SITE_PLAN" || !validQuoteJobId(data._id)) return null;
  if (operation === add && Array.isArray(data.fileNames) && data.fileNames.every(name => typeof name === "string")) {
    return { id: data._id, kind: "files", added: data.fileNames, removed: [] };
  }
  if (operation === remove && typeof data.fileName === "string") {
    return { id: data._id, kind: "files", added: [], removed: [data.fileName] };
  }
  return null;
}
