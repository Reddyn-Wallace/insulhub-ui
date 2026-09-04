"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { settingsRequest } from "@/lib/partner/settings-client";
import { opsButtonClass, opsInputClass } from "@/lib/partner/operations-client";
import { formatPartnerDate } from "@/lib/partner/date";
import type { JobLinkTarget, LinkablePartnerJob } from "@/lib/partner/job-link";

export default function PartnerJobLinks({ companyId, onLock }: { companyId: string; onLock: (locked: boolean) => void }) {
  const [jobs, setJobs] = useState<LinkablePartnerJob[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [preview, setPreview] = useState<{ target: JobLinkTarget; preview: string; resolutionRequired:"NO_EFFECT_CONFIRMED"|"RETURNED_IDENTITY"|null } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [investigationConfirmed,setInvestigationConfirmed]=useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const base = `/api/settings/partners/${companyId}/jobs`;
  const load = useCallback(async () => {
    setLoading(true);
    try { setJobs((await settingsRequest<{ jobs: LinkablePartnerJob[] }>(base)).jobs); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Jobs could not be loaded."); }
    finally { setLoading(false); }
  }, [base]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { onLock(busy); }, [busy, onLock]);
  async function act(job: LinkablePartnerJob, action: "preview" | "confirm" | "refresh") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      if (action === "preview") {
        setPreview(null); setConfirmed(false);setInvestigationConfirmed(false);
        setPreview(await settingsRequest(`${base}/${job.id}`, "POST", { action, identifier }));
      } else {
        await settingsRequest(`${base}/${job.id}`, "POST", action === "refresh" ? { action } : { action, identifier: preview?.target.id, preview: preview?.preview, confirmed,investigationConfirmed });
        setPreview(null); setSelected(null); setIdentifier(""); setConfirmed(false);setInvestigationConfirmed(false);
        setNotice(action === "confirm" ? "Job linked. Its latest status is now available to the partner." : "Status updated from InsulHub.");
        await load();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The job could not be checked.");
      // A lost confirmation response may already have saved the link. Always
      // reload mapping before allowing another confirmation; no blind retry.
      if (action === "confirm") { setPreview(null); setConfirmed(false);setInvestigationConfirmed(false); await load(); }
    } finally { inFlight.current = false; setBusy(false); }
  }
  const address = (value: JobLinkTarget["address"]) => Object.values(value).filter(Boolean).join(", ");
  return <section aria-label="Partner job links" className="mt-4 border-t border-slate-200 pt-4">
    <h3 className="font-bold text-[#1a3a4a]">Submitted jobs</h3>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-emerald-800">{notice}</p>}
    {loading ? <p role="status" className="mt-3 text-sm">Loading jobs…</p> : !jobs.length ? <p className="mt-3 text-sm text-slate-600">No submitted partner jobs yet.</p> : null}
    <ul className="mt-3 space-y-3">{jobs.map(job => <li key={job.id} className="rounded-xl bg-slate-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><p className="font-semibold">{job.customerName} <span className="text-xs font-normal text-slate-500">{job.clientReference}</span></p><p className="text-sm text-slate-600">{address(job.siteAddress)}</p>
          {job.linkedStatus && <p className="mt-1 text-xs text-slate-600">Status checked {formatPartnerDate(job.linkedStatus.checkedAt)}</p>}</div>
        {job.linkedStatus ? <div className="flex flex-wrap items-center gap-2"><a href={`/jobs/${job.legacyId}`} className="text-sm font-semibold text-[#a84202] underline">InsulHub #{job.linkedJobNumber}</a><button type="button" disabled={busy} onClick={() => void act(job, "refresh")} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold">Check status</button></div>
          : <button type="button" disabled={busy || !["FAILED_RETRYABLE","RECONCILIATION_REQUIRED","SUBMITTED"].includes(job.submissionState)} onClick={() => { setSelected(job.id); setIdentifier(job.legacyId ?? ""); setPreview(null); setConfirmed(false);setInvestigationConfirmed(false); setError(""); setNotice(""); }} className={opsButtonClass}>Link InsulHub job</button>}
      </div>
      {selected === job.id && !job.linkedStatus && <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); void act(job, preview ? "confirm" : "preview"); }}>
        <label className="grid gap-1 text-sm font-semibold">InsulHub job number or link<input autoComplete="off" maxLength={500} disabled={busy} value={identifier} onChange={event => { setIdentifier(event.target.value); setPreview(null); setConfirmed(false); }} className={opsInputClass} /></label>
        {preview && <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold text-slate-500">Existing InsulHub job #{preview.target.jobNumber}</p><p className="font-semibold">{preview.target.customerName}</p><p className="text-sm">{address(preview.target.address)}</p>
          <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4" />I checked that this is the same customer and property.</label>
          {preview.resolutionRequired&&<label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={investigationConfirmed} disabled={busy} onChange={event=>setInvestigationConfirmed(event.target.checked)} className="mt-1 h-4 w-4" />{preview.resolutionRequired==="RETURNED_IDENTITY"?"I checked this is the exact job returned by the automatic transfer and completed any remaining quote or floor-plan work in InsulHub.":"I checked InsulHub and confirmed the automatic transfer did not create another job."}</label>}
        </div>}
        <div className="flex flex-wrap gap-2"><button disabled={busy || !identifier.trim() || Boolean(preview && (!confirmed||(preview.resolutionRequired&&!investigationConfirmed)))} className={opsButtonClass}>{busy ? "Checking…" : preview ? "Confirm link" : "Check job"}</button><button type="button" disabled={busy} onClick={() => { setSelected(null); setPreview(null); setConfirmed(false);setInvestigationConfirmed(false); }} className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-semibold">Cancel</button></div>
      </form>}
    </li>)}</ul>
  </section>;
}
