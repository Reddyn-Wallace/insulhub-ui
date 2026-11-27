"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import BottomSheet from "@/components/BottomSheet";
import QuoteSheetFields from "@/components/QuoteSheetFields";
import { quoteHistoryDate, quoteMoney, type QuoteHistory as History } from "@/lib/quote-history/model";
import type { QuoteVersion, QuoteVersionValues } from "@/lib/quote-history/versions";

function versionValue(value: string | null | undefined) {
  if (value == null) return "Unavailable";
  return value === "—" ? "Not recorded" : value;
}

function scopeIncluded(area: string | null | undefined) {
  if (area == null) return null;
  return !["—", "0 m²"].includes(area);
}

function amount(value: string) {
  return value.replace(/[$,]/g, "");
}

function QuoteVersionFields({ values }: { values: QuoteVersionValues }) {
  const { fields, extras } = values;
  const value = (key: string) => versionValue(fields[key]);
  const [date, time] = value("date").split(", ", 2);

  return (
    <QuoteSheetFields
      quoteForm={{
        quoteNumber: value("quoteNumber"),
        date: "",
        hasWall: scopeIncluded(fields["wall.SQM"]),
        wallSQM: value("wall.SQM").replace(/ m²$/, ""),
        wallSQMPrice: amount(value("wall.SQMPrice")).replace(/\/m²$/, ""),
        wallCavityDepth: value("wall.cavityDepthMeters").replace(/^(100|150) mm$/, (_, mm) => `${Number(mm) / 10} cm`),
        hasCeiling: scopeIncluded(fields["ceiling.SQM"]),
        ceilingSQM: value("ceiling.SQM").replace(/ m²$/, ""),
        ceilingSQMPrice: amount(value("ceiling.SQMPrice")).replace(/\/m²$/, ""),
        ceilingRValue: value("ceiling.RValue").replace(/^R(?=\d)/, ""),
        ceilingDownlights: value("ceiling.downlights"),
        consentFee: amount(value("consentFee")),
        depositPercentage: value("depositPercentage").replace(/%$/, ""),
        extras: extras?.map(line => ({ name: line.label, price: amount(line.amount) })) ?? [],
        quoteNote: fields.quoteNote === "—" ? "" : value("quoteNote"),
      }}
      savedDate={{ date, time: time ?? (fields.date == null ? "Unavailable" : "Not recorded") }}
      extrasUnavailable={extras === null}
      totals={{
        wallR: value("wall.c_RValue"),
        wallBags: value("wall.c_bagCount"),
        ceilingThickness: value("ceiling.c_thickness"),
        ceilingBags: value("ceiling.c_bagCount"),
        contract: value("c_contractPrice"),
        gst: value("c_gst"),
        total: amount(value("c_total")),
        deposit: amount(value("c_deposit")),
      }}
    />
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
  const triggerRef = useRef<HTMLButtonElement>(null);
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
  function close() {
    setSelected(null);
    setVersion(null);
    triggerRef.current?.focus();
  }

  function retry() {
    setError("");
    setLoading(true);
    setRefresh(value => value + 1);
  }

  const open = selected !== null;
  const hasChanges = (history?.revision ?? 0) > 1;
  const trigger = hasChanges ? (
    <button type="button" ref={triggerRef} onClick={() => select("latest")}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}
      className="min-h-8 whitespace-nowrap text-xs font-medium text-gray-600 underline decoration-gray-300 underline-offset-4 hover:text-indigo-700 focus-visible:outline-indigo-700">
      Quote versions
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
      {open && createPortal(
        <BottomSheet open onClose={close} title="Quote versions" id={panelId}
          headerContent={
            <div className="border-b border-gray-100 px-4 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <button type="button" className={navigationStyle} disabled={loading || !version || version.revision <= 1}
                  onClick={() => version && select(version.revision - 1)}>Previous</button>
                <div className="text-center text-xs text-gray-600" aria-live="polite">
                  <p className="font-semibold text-gray-800">{version ? `Version ${version.revision} of ${latest}` : "Read-only"}</p>
                  {version && <p>{version.revision === latest ? "Current · Read-only" : "Read-only"}</p>}
                </div>
                <button type="button" className={navigationStyle} disabled={loading || !version || version.revision >= latest}
                  onClick={() => version && select(version.revision + 1 === latest ? "latest" : version.revision + 1)}>Next</button>
              </div>
              {version && (
                <p className="mt-1 text-center text-xs text-gray-500">
                  {version.at && <time dateTime={version.at}>
                    {version.observed ? "Recorded " : ""}{quoteHistoryDate(version.at)}
                  </time>}
                  {version.actor && ` · ${version.actor}`}
                  {version.reconstructed && <span className="block text-amber-800">Reconstructed from edit history</span>}
                </p>
              )}
            </div>
          }>
          {error && <p role="alert" className="text-sm text-red-700">{error}{" "}
            <button type="button" onClick={retry} className="font-semibold underline">Retry</button>
          </p>}
          {history?.pending && (
            <p role="status" className="mb-3 text-sm text-amber-800">
              An update is awaiting confirmation.{" "}
              <button type="button" onClick={retry} className="font-semibold underline">Refresh</button>
            </p>
          )}
          {loading && <p role="status" className="mb-3 text-sm text-gray-600">Loading quote version…</p>}
          {version && (version.values ? <QuoteVersionFields values={version.values} /> :
            <p className="text-sm text-gray-600">Quote details are unavailable for this version.</p>)}
        </BottomSheet>,
        document.body
      )}
    </>
  ));
}
