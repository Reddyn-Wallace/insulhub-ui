"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { settingsRequest } from "@/lib/partner/settings-client";
import { formatPartnerDate } from "@/lib/partner/date";
import type { NeutralPartnerTracking } from "@/lib/partner/neutral-tracking";

type Context = { linked: false } | { linked: true; companyName: string; tracking: NeutralPartnerTracking };

export default function PartnerLinkedJobPanel({ jobId, version }: { jobId: string; version: string }) {
  const [context, setContext] = useState<Context | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState(false);
  const requestKey = useRef(crypto.randomUUID());
  const load = useCallback(async () => {
    setLoadError(false);
    try { setContext(await settingsRequest<Context>(`/api/settings/partners/job-context?legacyId=${encodeURIComponent(jobId)}`)); }
    catch { setContext(null); setLoadError(true); }
  }, [jobId]);
  useEffect(() => { void load(); }, [load, version]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!description.trim() || busy) return;
    setBusy(true); setError("");
    const submittedDescription = description.trim();
    try {
      setContext(await settingsRequest<Context>("/api/settings/partners/job-context", "POST", { legacyId: jobId, description: submittedDescription, requestKey: requestKey.current }));
      setDescription((current) => current.trim() === submittedDescription ? "" : current);
      requestKey.current = crypto.randomUUID();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The update could not be saved."); }
    finally { setBusy(false); }
  }

  if (loadError) return <div role="alert" className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><span>Partner details couldn’t be checked.</span><button type="button" onClick={() => void load()} className="min-h-11 rounded-lg border border-amber-300 bg-white px-3 font-semibold">Try again</button></div>;
  if (!context?.linked) return null;
  return <section className="mb-3 rounded-xl border border-orange-200 bg-orange-50/60 p-4" aria-labelledby="partner-job-heading">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><p className="text-[11px] font-bold uppercase tracking-wide text-[#e85d04]">Partner job</p><h2 id="partner-job-heading" className="font-bold text-[#1a3a4a]">{context.companyName}</h2></div>
      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">{context.tracking.clientReference}</span>
    </div>
    {context.tracking.amendments.length ? <div className="mt-3 space-y-2" aria-label="Partner-visible updates">{context.tracking.amendments.map((item) => <div key={item.sequence} className="rounded-lg border border-orange-100 bg-white px-3 py-2"><p className="text-sm text-slate-800">{item.description}</p><p className="mt-1 text-xs text-slate-500">{formatPartnerDate(item.createdAt)}</p></div>)}</div> : null}
    <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
      <label className="sr-only" htmlFor="partner-job-update">Update visible to partner</label>
      <textarea id="partner-job-update" value={description} onChange={(event) => { setDescription(event.target.value); requestKey.current = crypto.randomUUID(); }} disabled={busy} maxLength={1000} rows={2} placeholder="Add an update the partner can see" className="min-h-11 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100" />
      <button type="submit" disabled={busy || !description.trim()} className="min-h-11 self-end rounded-lg bg-[#1a3a4a] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? "Adding…" : "Add update"}</button>
    </form>
    {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
  </section>;
}
