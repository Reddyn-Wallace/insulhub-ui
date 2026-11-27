import type { QuoteMutation } from "./mutation";
import { quoteDiff, record, snapshotQuote, type QuoteSnapshot } from "./model";
import type { Confirmation } from "./server";

export async function confirmQuoteMutation(operation: QuoteMutation, response: unknown,
  before: QuoteSnapshot | null, read: () => Promise<QuoteSnapshot | null>): Promise<Confirmation | null> {
  const envelope = record(response);
  if (Array.isArray(envelope.errors) && envelope.errors.length) return null;
  const data = record(envelope.data);

  if (operation.kind === "files") {
    const ok = operation.added.length ? data.addFiles : data.removeFile;
    if (ok == null || ok === false) return null;
    const snapshot = await read();
    const oldFiles = (before?.files_QuoteSitePlan ?? []) as string[];
    const expected = [...new Set([...oldFiles, ...operation.added])].filter(file => !operation.removed.includes(file)).sort();
    const actual = (snapshot?.files_QuoteSitePlan ?? []) as string[];
    const confirmed = expected.length === actual.length && expected.every((file, index) => file === actual[index]) &&
      quoteDiff(before, snapshot).keys.every(key => key === "files_QuoteSitePlan");
    return { snapshot, kind: confirmed ? "files" : "external" };
  }

  const updated = record(data.updateJob);
  if (updated._id !== operation.id || typeof updated.stage !== "string" || !("quote" in updated)) return null;
  const snapshot = snapshotQuote(updated);
  if (!snapshot) return { snapshot, kind: "edit" };
  if (operation.kind === "send") return { snapshot, kind: "send" };
  if (operation.kind === "accepted" && updated.stage === "SCHEDULED" &&
      snapshot.status === "ACCEPTED" && before?.status !== "ACCEPTED") return { snapshot, kind: "accepted" };
  return { snapshot, kind: "edit" };
}

export function confirmQuotePdf(before: QuoteSnapshot | null, intended: QuoteSnapshot | null,
  snapshot: QuoteSnapshot | null): Confirmation {
  const unexpected = new Set(quoteDiff(intended, snapshot).keys);
  const matchesRequest = quoteDiff(before, snapshot).keys.every(key => !unexpected.has(key));
  return { snapshot, kind: matchesRequest ? "pdf" : "external" };
}
