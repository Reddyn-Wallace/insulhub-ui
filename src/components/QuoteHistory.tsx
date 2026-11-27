"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { quoteHistoryDate, quoteMoney, type QuoteEvent, type QuoteHistory as History } from "@/lib/quote-history/model";

const labels: Record<QuoteEvent["kind"], string> = {
  baseline: "Starting quote recorded",
  edit: "Quote edited",
  status: "Quote status updated",
  accepted: "Marked accepted",
  send: "Send acknowledged by InsulHub",
  pdf: "Quote changed during PDF generation",
  files: "Site plan attachments updated",
  external: "Change detected outside tracked history",
  recovered: "Change found after an interrupted update",
  unconfirmed: "Interrupted update could not be confirmed",
};
const details: Partial<Record<QuoteEvent["kind"], string>> = {
  baseline: "These were the saved values when tracking began for this job.",
  external: "The editor and exact time are unknown. The timestamp shows when the CRM saw the change.",
  recovered: "The saved quote changed, but the CRM could not verify who made the change or whether an email went out.",
  unconfirmed: "No quote changes were found. If this was a send, check the email log before sending again.",
  send: "The revision refers to the saved quote. The attachment and delivery are unverified.",
};

export default function QuoteHistory({ jobId, refreshKey, legacySentAt }: {
  jobId: string; refreshKey: string; legacySentAt: string | null;
}) {
  const [history, setHistory] = useState<History | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pendingRequest = useRef<AbortController | null>(null);
  const request = useCallback(async (before?: string) => {
    pendingRequest.current?.abort();
    const controller = new AbortController();
    pendingRequest.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/quote-history${before ? `?before=${before}` : ""}`, {
        headers: { "x-access-token": localStorage.getItem("token") || "" },
        cache: "no-store", signal: controller.signal,
      });
      if (response.status === 204) {
        if (!controller.signal.aborted) setHistory(null);
        return;
      }
      if (response.status === 409) throw new Error("Quote history is being updated. Try again shortly.");
      if (!response.ok) throw new Error("Could not load quote history.");
      const result: History = await response.json();
      if (controller.signal.aborted) return;
      if (!result || !Array.isArray(result.events)) throw new Error("Could not load quote history.");
      setHistory(previous => before && previous ? { ...result, events: [...previous.events, ...result.events] } : result);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load quote history.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void request();
    return () => pendingRequest.current?.abort();
  }, [request, refreshKey]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loading) void request();
  }

  return (
    <div className="mb-3 space-y-2">
      {history?.lastSend ? (
        <div className="text-xs text-gray-600">
          <p>Last send acknowledged {quoteHistoryDate(history.lastSend.at)} · Revision {history.lastSend.revision}
            {history.lastSend.total !== null && ` · ${quoteMoney(history.lastSend.total)} incl. GST`}</p>
          {history.changedSinceSend && !history.pending && !error && (
            <p className="mt-1 font-semibold text-amber-800">The saved quote changed since that send.</p>
          )}
        </div>
      ) : legacySentAt && (
        <span className="inline-block rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
          Email log match {quoteHistoryDate(legacySentAt)}
        </span>
      )}
      {(history || error) && (
        <div className="rounded-lg border border-gray-200">
          <button type="button" onClick={toggle} aria-expanded={open}
            className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-semibold text-gray-800">
            Quote history
            <span className="text-xs font-medium text-gray-600">
              {open ? "Hide" : history?.pending ? "Update awaiting confirmation" : history?.revision ? `Revision ${history.revision} · View` : "View"}
            </span>
          </button>
          {open && (
            <div className="border-t border-gray-200 px-3 pb-3">
              {error && <p role="alert" className="py-2 text-sm text-red-700">{error}{" "}
                <button type="button" onClick={() => void request()} className="font-semibold underline">Retry</button>
              </p>}
              {history?.pending && (
                <p role="status" className="py-2 text-sm text-amber-800">
                  An update is awaiting confirmation. Refresh history in a minute before retrying the update.{" "}
                  <button type="button" onClick={() => void request()} className="font-semibold underline">Refresh history</button>
                </p>
              )}
              {loading && <p role="status" className="py-2 text-sm text-gray-600">Loading history…</p>}
              {history?.events.length === 0 && !loading && <p className="pt-3 text-sm text-gray-600">No quote changes recorded yet.</p>}
              <ul className="divide-y divide-gray-100">
                {history?.events.map(entry => (
                  <li key={entry.id} className="py-3">
                    <p className="text-sm font-semibold text-gray-800">{labels[entry.kind]}{entry.actor && ` by ${entry.actor}`}</p>
                    <p className="mt-0.5 text-xs text-gray-600">
                      <time dateTime={entry.at}>{quoteHistoryDate(entry.at)}</time>
                      {entry.revision > 0 && ` · Revision ${entry.revision}`}
                      {entry.total !== null && ` · ${quoteMoney(entry.total)} incl. GST`}
                    </p>
                    {details[entry.kind] && <p className="mt-1 text-xs text-gray-600">{details[entry.kind]}</p>}
                    {!!entry.changes.length && (
                      <details className="mt-2 rounded bg-gray-50 px-2 py-1.5 text-sm">
                        <summary className="cursor-pointer font-medium text-gray-700">
                          {entry.changes.length} {entry.changes.length === 1 ? "change" : "changes"}
                        </summary>
                        <dl className="mt-1 divide-y divide-gray-200">
                          {entry.changes.map((change, index) => (
                            <div key={`${change.label}-${index}`} className="py-2">
                              <dt className="mb-1 text-xs font-medium text-gray-700">{change.label}</dt>
                              <dd className="grid min-w-0 grid-cols-2 gap-2 whitespace-pre-wrap break-words text-xs">
                                <div><span className="block text-gray-500">Before</span>{change.before}</div>
                                <div><span className="block text-gray-500">After</span>{change.after}</div>
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
              {history?.next && (
                <button type="button" disabled={loading} onClick={() => void request(history.next ?? undefined)}
                  className="min-h-10 text-sm font-semibold text-indigo-700 disabled:opacity-50">Load older events</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
