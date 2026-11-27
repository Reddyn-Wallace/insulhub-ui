"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { fields, quoteHistoryDate, quoteMoney, type QuoteHistory as History } from "@/lib/quote-history/model";
import type { QuoteVersion, QuoteVersionValues } from "@/lib/quote-history/versions";

const labels = new Map(fields.map(([key, label]) => [key, label]));
const sections = [
  { name: "Quote details", keys: ["quoteNumber", "date", "status"] },
  { name: "Wall insulation", keys: ["wall.SQM", "wall.SQMPrice", "wall.cavityDepthMeters", "wall.c_RValue", "wall.c_bagCount", "wall.internal"], area: "wall.SQM" },
  { name: "Ceiling insulation", keys: ["ceiling.SQM", "ceiling.SQMPrice", "ceiling.RValue", "ceiling.c_thickness", "ceiling.c_bagCount", "ceiling.downlights"], area: "ceiling.SQM" },
  { name: "Pricing", keys: ["c_contractPrice", "c_gst", "consentFee", "totalOverridden", "c_deposit", "depositPercentage", "depositOverridden"] },
  { name: "Notes and site plan", keys: ["quoteNote", "quoteResultNote", "sitePlanNotes", "files_QuoteSitePlan"] },
  { name: "Follow-up", keys: ["deferralDate", "sendFollowupEmail", "sendFollowupText"] },
];

function versionValue(value: string | null | undefined) {
  if (value == null) return "Unavailable";
  return value === "—" ? "Not recorded" : value;
}

function QuoteVersionDetails({ values }: { values: QuoteVersionValues }) {
  return (
    <div className="space-y-4">
      <dl className="rounded-lg bg-gray-50 px-3 py-2.5">
        <dt className="text-xs font-medium text-gray-600">Total incl. GST</dt>
        <dd className="text-xl font-bold text-green-700">{versionValue(values.fields.c_total)}</dd>
      </dl>
      {sections.map(({ name, keys, area }) => (
        area && ["—", "0 m²"].includes(values.fields[area] ?? "") ? null : (
          <section key={name} className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{name}</h3>
            <dl className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              {keys.map(key => (
                <div key={key} className="flex justify-between gap-3 border-b border-gray-100 py-1.5 text-sm">
                  <dt className="text-gray-600">{labels.get(key)}</dt>
                  <dd className="min-w-0 break-words whitespace-pre-wrap text-right font-medium text-gray-900">{versionValue(values.fields[key])}</dd>
                </div>
              ))}
            </dl>
          </section>
        )
      ))}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Charges and discounts</h3>
        {values.extras?.length ? (
          <dl>
            {values.extras.map((line, index) => (
              <div key={index} className="flex justify-between gap-3 border-b border-gray-100 py-1.5 text-sm">
                <dt className="min-w-0 break-words text-gray-600">{line.label}</dt>
                <dd className="shrink-0 font-medium text-gray-900">{line.amount}</dd>
              </div>
            ))}
          </dl>
        ) : <p className="py-1 text-sm text-gray-600">{values.extras ? "None" : "Unavailable"}</p>}
      </section>
    </div>
  );
}

async function loadHistory<T>(jobId: string, query: string, signal: AbortSignal): Promise<T | null> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/quote-history${query}`, {
    headers: { "x-access-token": localStorage.getItem("token") || "" },
    cache: "no-store", signal,
  });
  if (response.status === 204) return null;
  if (response.status === 409) throw new Error("Quote history is being updated. Try again shortly.");
  if (!response.ok) throw new Error("Could not load quote history.");
  return response.json();
}

export default function QuoteHistory({ jobId, refreshKey, legacySentAt, children }: {
  jobId: string; refreshKey: string; legacySentAt: string | null;
  children: (trigger: ReactNode, content: ReactNode) => ReactNode;
}) {
  const panelId = useId();
  const [history, setHistory] = useState<History | null>(null);
  const [selected, setSelected] = useState<number | "latest" | null>(null);
  const [version, setVersion] = useState<QuoteVersion | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void loadHistory<History>(jobId, "", controller.signal)
      .then(result => { if (!controller.signal.aborted) setHistory(result); })
      .catch(() => {});
    return () => controller.abort();
  }, [jobId, refreshKey, refresh]);

  useEffect(() => {
    if (selected === null) return;
    const controller = new AbortController();
    void loadHistory<QuoteVersion>(jobId, `?version=${selected}`, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) {
          if (!result || !Number.isInteger(result.revision)) throw new Error("Could not load this quote version.");
          setVersion(result);
          setError("");
        }
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load this quote version.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [jobId, refreshKey, selected, refresh]);

  function select(next: number | "latest") {
    setLoading(true);
    setError("");
    setSelected(next);
  }
  const open = selected !== null;
  const hasChanges = (history?.revision ?? 0) > 1;
  const trigger = hasChanges ? (
    <button type="button" onClick={() => {
      if (open) {
        setSelected(null);
        setVersion(null);
      } else select("latest");
    }} aria-expanded={open} aria-controls={open ? panelId : undefined}
      className="min-h-8 whitespace-nowrap text-xs font-medium text-gray-600 underline decoration-gray-300 underline-offset-4 hover:text-indigo-700 focus-visible:outline-indigo-700">
      {open ? "Hide versions" : "Quote versions"}
    </button>
  ) : null;
  const latest = Math.max(history?.revision ?? 0, version?.latest ?? 0);
  const navigationStyle = "min-h-10 rounded-md border border-gray-200 px-3 text-sm font-medium text-gray-800 disabled:text-gray-400";

  return children(trigger, (
    <>
      {history?.lastSend ? (
        <div className="mb-3 text-xs text-gray-600">
          <p>Last send acknowledged {quoteHistoryDate(history.lastSend.at)}
            {history.lastSend.total !== null && ` · ${quoteMoney(history.lastSend.total)} incl. GST`}</p>
          {history.changedSinceSend && !history.pending && (
            <p className="mt-1 font-semibold text-amber-800">The saved quote changed since that send.</p>
          )}
        </div>
      ) : legacySentAt && (
        <span className="mb-3 inline-block rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
          Email log match {quoteHistoryDate(legacySentAt)}
        </span>
      )}
      {hasChanges && open && (
        <section id={panelId} aria-label="Quote versions" aria-busy={loading}
          className="mb-3 space-y-3 rounded-lg border border-gray-200 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <button type="button" className={navigationStyle} disabled={loading || !version || version.revision <= 1}
              onClick={() => version && select(version.revision - 1)}>Previous</button>
            <span className="text-center text-xs font-semibold text-gray-700" aria-live="polite">
              {version ? `Version ${version.revision} of ${latest}` : "Quote versions"}
            </span>
            <button type="button" className={navigationStyle} disabled={loading || !version || version.revision >= latest}
              onClick={() => version && select(version.revision + 1 === latest ? "latest" : version.revision + 1)}>Next</button>
          </div>
          {error && <p role="alert" className="text-sm text-red-700">{error}{" "}
            <button type="button" onClick={() => setRefresh(value => value + 1)} className="font-semibold underline">Retry</button>
          </p>}
          {history?.pending && (
            <p role="status" className="text-sm text-amber-800">
              An update is awaiting confirmation.{" "}
              <button type="button" onClick={() => setRefresh(value => value + 1)} className="font-semibold underline">Refresh</button>
            </p>
          )}
          {loading && <p role="status" className="text-sm text-gray-600">Loading quote version…</p>}
          {version && (
            <>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600">
                {version.revision === latest && <span className="rounded bg-green-50 px-2 py-1 font-medium text-green-800">Current</span>}
                {version.reconstructed && <span className="rounded bg-amber-50 px-2 py-1 font-medium text-amber-800">Reconstructed from edit history</span>}
                {version.at && <time dateTime={version.at}>
                  {version.observed ? "Recorded " : ""}{quoteHistoryDate(version.at)}
                </time>}
                {version.actor && <span>· {version.actor}</span>}
              </div>
              {version.values ? <QuoteVersionDetails values={version.values} /> :
                <p className="text-sm text-gray-600">Quote details are unavailable for this version.</p>}
            </>
          )}
        </section>
      )}
    </>
  ));
}
