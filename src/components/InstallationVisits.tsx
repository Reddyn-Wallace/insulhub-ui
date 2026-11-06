"use client";
import { needsHistoricalSplitReason } from "@/lib/installation-splits/projection";
import { useCallback, useEffect, useState } from "react";
import { toNzDateKey } from "@/lib/reports/sales-installs-types";
import {
  splitRequest,
  invalidateSplitCaches,
} from "@/lib/installation-splits/client";
import {
  reconcileUsage,
  type SourceJob,
  type SavedSplit,
} from "@/lib/installation-splits/projection";
const field =
  "mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
const button =
  "rounded-lg bg-[#e85d04] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40";
export default function InstallationVisits({
  jobId,
  onLoaded,
  onSaved,
}: {
  jobId: string;
  onLoaded?: (split: SavedSplit | null) => void;
  onSaved?: () => void;
}) {
  const [source, setSource] = useState<SourceJob | null>(null),
    [split, setSplit] = useState<SavedSplit | null>(null);
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  const [percent, setPercent] = useState(""),
    [completedDate, setCompletedDate] = useState(""),
    [returnDate, setReturnDate] = useState(""),
    [moveDate, setMoveDate] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await splitRequest<{
        job: SourceJob;
        split: SavedSplit | null;
      }>(`/api/jobs/${jobId}/installation-splits`);
      setSource(data.job);
      setSplit(data.split);
      onLoaded?.(data.split);
      setPercent("");
      const pending = data.split?.visits.find((v) => v.state === "planned");
      setMoveDate(pending?.date || "");
      setCompletedDate(
        pending?.date || toNzDateKey(data.job.installation?.installDate) || "",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load visits.");
    } finally {
      setLoading(false);
    }
  }, [jobId, onLoaded]);
  useEffect(() => {
    void load();
  }, [load]);
  const historical = !split && !!source && needsHistoricalSplitReason(source);
  const pending = split?.visits.find((v) => v.state === "planned");
  const remaining = pending?.percent ?? (split ? 0 : 100);
  const done =
    split?.visits
      .filter((v) => v.state === "completed")
      .reduce((n, v) => n + v.percent, 0) || 0;
  const usage = source && split ? reconcileUsage(source, split) : null;
  async function save(action: "complete" | "reschedule" | "undo") {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await splitRequest<{ split: SavedSplit }>(
        `/api/jobs/${jobId}/installation-splits`,
        {
          action,
          version: split?.version ?? 0,
          visitId: pending?.id || "initial",
          percent: Number(percent),
          completedDate,
          reason,
          date: action === "reschedule" ? moveDate || null : returnDate || null,
        },
      );
      setSplit(result.split);
      onLoaded?.(result.split);
      invalidateSplitCaches();
      setNotice(
        "Visit changes saved. Calendar and usage reports now use these allocations.",
      );
      setPercent("");
      setReturnDate("");
      setMoveDate(
        result.split.visits.find((v) => v.state === "planned")?.date || "",
      );
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save visits.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section
      id="installation-visits"
      className="space-y-3 rounded-xl border border-gray-200 bg-white p-4"
    >
      <div className="flex justify-between gap-3">
        <h2 className="font-bold text-[#1a3a4a]">
          Installation visits & partial completion
        </h2>
        <button
          type="button"
          className="text-xs font-semibold underline"
          disabled={loading || saving}
          onClick={() => void load()}
        >
          Reload visits
        </button>
      </div>
      {loading ? (
        <p className="text-sm text-gray-500">Loading visits…</p>
      ) : (
        <>
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
            >
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
            >
              {notice}
            </p>
          )}
          {source && (
            <>
              <p className="text-sm text-gray-600">
                {done}% completed · {remaining}% remaining. Percentages refer to
                the whole job. This records work without marking the job
                installed or sending customer paperwork.
              </p>
              {split && (
                <>
                  <p className="text-xs text-gray-500">
                    Visit dates below control split scheduling and reporting.
                    The original installation date is retained for legacy
                    records. Existing documents and message templates still use
                    that original date; review them before sending. Quoted area,
                    value and bag budget are fixed at the first split.
                  </p>
                  <div className="space-y-2">
                    {split.visits.map((v, i) => (
                      <div
                        key={v.id}
                        className="flex flex-wrap justify-between gap-2 rounded-lg bg-gray-50 p-3 text-sm"
                      >
                        <span>
                          Visit {i + 1} · {v.date || "Unscheduled"} ·{" "}
                          <strong>{v.percent}%</strong>
                        </span>
                        <span
                          className={
                            v.state === "completed"
                              ? "text-emerald-700"
                              : "text-amber-700"
                          }
                        >
                          {v.state === "completed"
                            ? "Work recorded"
                            : "Remaining work"}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {usage?.warning && (
                <p
                  role="alert"
                  className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
                >
                  {usage.warning}
                </p>
              )}
              {!split && !source.installation?.installDate && (
                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  Set the original installation date in job planning before
                  recording partial work. The existing completion process
                  requires that date.
                </p>
              )}
              {remaining > 0 && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save("complete");
                  }}
                  className="grid gap-3 sm:grid-cols-2"
                >
                  {historical && (
                    <div className="sm:col-span-2 space-y-2">
                      <p className="text-sm text-gray-600">
                        This job is already complete. Record the dates and
                        percentages actually worked, then record the remaining
                        visits. The final checksheet’s bag total will be
                        allocated across them; the job and checksheet stay
                        unchanged.
                      </p>
                      <label className="block text-sm">
                        Reason for historical split
                        <input
                          className={field}
                          required
                          maxLength={500}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </label>
                    </div>
                  )}
                  {!split && (
                    <label className="text-sm">
                      Date work was completed
                      <input
                        aria-label="Date work was completed"
                        className={field}
                        type="date"
                        required
                        value={completedDate}
                        onChange={(e) => setCompletedDate(e.target.value)}
                      />
                    </label>
                  )}
                  <label className="text-sm">
                    Completed this visit (% of whole job)
                    <input
                      className={field}
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={remaining}
                      required
                      value={percent}
                      onChange={(e) => setPercent(e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    Return date (optional)
                    <input
                      className={field}
                      type="date"
                      min={pending?.date || completedDate || undefined}
                      disabled={Number(percent) >= remaining}
                      value={returnDate}
                      onChange={(e) => setReturnDate(e.target.value)}
                    />
                  </label>
                  <p className="text-xs text-gray-500 sm:col-span-2">
                    {Math.max(
                      0,
                      Math.round((remaining - Number(percent || 0)) * 100) /
                        100,
                    )}
                    % will remain. Leave the return date blank to put it in the
                    unscheduled queue.
                  </p>
                  <button
                    className={button}
                    disabled={
                      saving ||
                      (!pending?.date && !!split) ||
                      (!split && !source.installation?.installDate)
                    }
                  >
                    {saving ? "Saving…" : "Record completed work"}
                  </button>
                </form>
              )}
              {pending && (
                <form
                  className="space-y-3 border-t pt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save("reschedule");
                  }}
                >
                  <label className="block text-sm">
                    Remaining visit date
                    <input
                      className={field}
                      type="date"
                      value={moveDate}
                      onChange={(e) => setMoveDate(e.target.value)}
                    />
                  </label>
                  <button className={button} disabled={saving}>
                    Save remaining visit date
                  </button>
                  <p className="text-xs text-gray-500">
                    Blank keeps the remainder unscheduled. Completed visits do
                    not move.
                  </p>
                </form>
              )}
              {usage && usage.rows.length > 0 && (
                <div className="space-y-1 border-t pt-3 text-xs text-gray-600">
                  <p className="font-semibold">Usage reporting</p>
                  {usage.rows.map((r) => (
                    <p key={r.id}>
                      {r.date}:{" "}
                      {r.bags === null ? "Usage missing" : `${r.bags} bags`} ·{" "}
                      {r.basis === "budget-estimate"
                        ? "estimated from quoted budget"
                        : r.basis === "recorded"
                          ? "recorded visit usage"
                          : "revised allocation of final actual total"}
                    </p>
                  ))}
                  <p>
                    Final actual bags come from the existing completed
                    checksheet. Visit-level quantities remain estimates unless
                    recorded separately.
                  </p>
                </div>
              )}
              {split &&
                done > 0 &&
                !source.installerChecksheet?.complete &&
                !source.installation?.checkSheetSignedAsComplete && (
                  <details className="border-t pt-3">
                    <summary className="cursor-pointer text-xs font-semibold">
                      Correct the last progress entry
                    </summary>
                    <form
                      className="mt-3 space-y-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void save("undo");
                      }}
                    >
                      <p className="text-xs text-gray-600">
                        Reopens the most recently completed visit and merges its
                        remaining work. Earlier completed visits stay unchanged.
                        Reports will update.
                      </p>
                      <label className="block text-sm">
                        Correction reason
                        <input
                          className={field}
                          required
                          maxLength={500}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </label>
                      <button className={button} disabled={saving}>
                        Reopen last visit
                      </button>
                    </form>
                  </details>
                )}
              {split && (
                <details className="border-t pt-3 text-xs text-gray-500">
                  <summary className="cursor-pointer font-semibold">
                    Visit change history
                  </summary>
                  <ol className="mt-2 space-y-2">
                    {split.history.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ol>
                </details>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
