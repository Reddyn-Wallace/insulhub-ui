"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import InsulHubDrawingCanvas from "./InsulHubDrawingCanvas";
import { decodeSitePlanRecovery, encodeSitePlanRecovery, sitePlanRecoveryKey, type PartnerFloorPlanClient } from "@/lib/partner/site-plan-client";
import type { SitePlanDrawingDocument } from "@/lib/site-plan-drawings";
import { parseSitePlanDocument } from "@/lib/site-plan-drawings";
import { sitePlanNoteLayoutFits } from "@/lib/site-plan-note-layout";
import { usePartnerSubmissionEditGuard } from "./usePartnerSubmissionEditGuard";

type Props = { jobId: string; initialFloor: PartnerFloorPlanClient; recoveryScope: string; readOnly?: boolean; submissionJobRevision?: number; submissionFloorPlanRevision?: number };
type RecoveryValue = { name: string; document: SitePlanDrawingDocument; edited?: boolean };
type ApiResult = { floorPlan?: PartnerFloorPlanClient; error?: string; code?: string; currentRevision?: number };
function storage() { try { return window.sessionStorage; } catch { return null; } }
function validRecoveryValue(value: unknown): value is RecoveryValue { if (!value || typeof value !== "object" || Array.isArray(value)) return false; const record = value as Record<string, unknown>; return Object.keys(record).every((key) => ["name","document","edited"].includes(key)) && (record.edited === undefined || typeof record.edited === "boolean") && typeof record.name === "string" && record.name.trim().length > 0 && [...record.name].length <= 120 && Boolean(parseSitePlanDocument(record.document)); }

export default function PartnerFloorPlanEditor({ jobId, initialFloor, recoveryScope, readOnly = false, submissionJobRevision, submissionFloorPlanRevision }: Props) {
  const router = useRouter();
  const recoveryKey = sitePlanRecoveryKey(recoveryScope, jobId, initialFloor.id);
  const [name, setName] = useState(initialFloor.name);
  const [document, setDocument] = useState(initialFloor.document);
  const [revision, setRevision] = useState(initialFloor.revision);
  const [edited, setEdited] = useState(false);
  const mutationInFlight = useRef(false);
  const [savedPdfReady, setSavedPdfReady] = useState(initialFloor.pdfReady);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify({ name: initialFloor.name, document: initialFloor.document }));
  const [saving, setSaving] = useState(false); const [generating, setGenerating] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [status, setStatus] = useState(""); const [error, setError] = useState("");
  const [locked, setLocked] = useState(false); const [sessionExpired, setSessionExpired] = useState(false);
  const submissionGuardInput = useMemo(() => submissionJobRevision === undefined || submissionFloorPlanRevision === undefined ? null : ({ scope: recoveryScope, jobId, jobRevision: submissionJobRevision, floorPlanRevision: submissionFloorPlanRevision }), [jobId, recoveryScope, submissionFloorPlanRevision, submissionJobRevision]);
  const submissionGuard = usePartnerSubmissionEditGuard(submissionGuardInput, readOnly);
  const editLocked = locked || submissionGuard.locked || !submissionGuard.checked;
  const [recovered, setRecovered] = useState(false);
  const recoveryLoaded = useRef(false);
  const recoveryAdoptedOnMount = useRef(false);
  const snapshot = useMemo(() => JSON.stringify({ name: name.trim(), document }), [document, name]);
  const dirty = edited || snapshot !== savedSnapshot;
  const pdfReady = !dirty && savedPdfReady;
  const invalidNotes = document.textNotes.filter((note) => !sitePlanNoteLayoutFits(note));
  const busy = saving || generating || leaving;

  useEffect(() => {
    if (recoveryLoaded.current || readOnly) return; recoveryLoaded.current = true;
    const recoveredValue = decodeSitePlanRecovery<RecoveryValue>(storage()?.getItem(recoveryKey) ?? null, recoveryScope, jobId, initialFloor.id, validRecoveryValue);
    if (recoveredValue?.revision === revision) {
      const recoveredSnapshot = JSON.stringify({ name: recoveredValue.value.name.trim(), document: recoveredValue.value.document });
      if (recoveredSnapshot === savedSnapshot && !recoveredValue.value.edited) { try { storage()?.removeItem(recoveryKey); } catch { /* best effort */ } return; }
      recoveryAdoptedOnMount.current = true; setName(recoveredValue.value.name); setDocument(recoveredValue.value.document); setRecovered(true); setEdited(true); setStatus("Unsaved drawing changes recovered.");
    } else { try { storage()?.removeItem(recoveryKey); } catch { /* best effort */ } }
  }, [initialFloor.id, jobId, readOnly, recoveryKey, recoveryScope, revision, savedSnapshot]);
  useEffect(() => {
    if (readOnly || !recoveryLoaded.current) return;
    if (!dirty) {
      if (recoveryAdoptedOnMount.current) { recoveryAdoptedOnMount.current = false; return; }
      try { storage()?.removeItem(recoveryKey); } catch { /* best effort */ }
      return;
    }
    recoveryAdoptedOnMount.current = false;
    try { storage()?.setItem(recoveryKey, encodeSitePlanRecovery({ scope: recoveryScope, jobId, drawingId: initialFloor.id, revision, savedAt: new Date().toISOString(), value: { name, document, edited } })); } catch { /* best effort */ }
  }, [dirty, document, edited, initialFloor.id, jobId, name, readOnly, recoveryKey, recoveryScope, revision]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);

  function quarantine(detail: string) {
    try { storage()?.setItem(recoveryKey, encodeSitePlanRecovery({ scope: recoveryScope, jobId, drawingId: initialFloor.id, revision, savedAt: new Date().toISOString(), value: { name, document } })); } catch { /* best effort */ }
    setLocked(true); setError(detail); setStatus("Editing is locked until the latest saved floor is loaded.");
  }
  async function parse(response: Response): Promise<ApiResult | null> {
    const result = await response.json() as ApiResult;
    if (response.status === 401) { setSessionExpired(true); setError("Your session expired before this floor plan could be saved."); return null; }
    if (response.status === 409 && (result.code === "STALE_REVISION" || result.code === "DRAFT_LOCKED")) { quarantine(result.code === "DRAFT_LOCKED" ? "This job is now read-only. Reload before continuing." : "This floor plan changed in another tab. Reload the latest version before continuing."); return null; }
    if (!response.ok || !result.floorPlan) { setError(result.error ?? "The floor plan request could not be completed."); return null; }
    return result;
  }
  function adopt(floor: PartnerFloorPlanClient) {
    setName(floor.name); setDocument(floor.document); setRevision(floor.revision); setEdited(false); setSavedPdfReady(floor.pdfReady);
    setSavedSnapshot(JSON.stringify({ name: floor.name, document: floor.document })); setRecovered(false);
    try { storage()?.removeItem(recoveryKey); } catch { /* best effort */ }
  }
  async function save(complete = false): Promise<boolean> {
    if (readOnly || editLocked || mutationInFlight.current || !name.trim() || invalidNotes.length || (complete && !document.walls.length)) return false;
    mutationInFlight.current = true; setSaving(true); setEdited(true); setSavedPdfReady(false); setError(""); setStatus("Saving…"); setSessionExpired(false);
    let returningToQuote = false;
    const finish = () => { returningToQuote = true; setLeaving(true); router.push(`/partner/jobs/${jobId}#floor-plans`); router.refresh(); return true; };
    try {
      // Persist edits before completion so the PDF always uses this revision.
      const response = await fetch(`/api/partner/jobs/${jobId}/floor-plans/${initialFloor.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision, name: name.trim(), document }) });
      const result = await parse(response); if (!result?.floorPlan) return false;
      adopt(result.floorPlan); setSavedPdfReady(false); setStatus("Draft saved.");
      if (!complete) return finish();
      setGenerating(true); setStatus("Completing floor plan…");
      const completed = await parse(await fetch(`/api/partner/jobs/${jobId}/floor-plans/${initialFloor.id}/pdf`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: result.floorPlan.revision }) }));
      if (!completed?.floorPlan) { setStatus("Draft saved. Completion needs to be retried."); return false; }
      if (!completed.floorPlan.pdfReady) { setError("The floor plan is still a draft. Try marking it complete again."); return false; }
      adopt(completed.floorPlan); setStatus("Floor plan complete."); return finish();
    } catch { setError(complete ? "The floor plan could not be completed. Your drawing is kept; try again." : "The floor plan could not be saved. Your edits are still available in this tab."); return false; }
    finally { if (!returningToQuote) mutationInFlight.current = false; setSaving(false); setGenerating(false); }
  }
  function reload() { router.refresh(); }
  function requestBack() {
    if (mutationInFlight.current || busy) return;
    if (!readOnly && dirty) {
      if (!name.trim()) { setError("Enter a floor name before returning to the quote."); return; }
      if (invalidNotes.length) { setError("Shorten the highlighted note or widen its text box before returning to the quote."); return; }
      void save(false); return;
    }
    mutationInFlight.current = true; setLeaving(true);
    router.push(`/partner/jobs/${jobId}#floor-plans`); router.refresh();
  }
  function discardRecovery() { try { storage()?.removeItem(recoveryKey); } catch { /* best effort */ } setName(initialFloor.name); setDocument(initialFloor.document); setEdited(false); setRecovered(false); setStatus("Recovered changes discarded."); }

  return <div className="partner-floor-editor flex h-full min-h-0 flex-col bg-[#eef0f3]">
    <header className="shrink-0 border-b border-gray-200 bg-white px-3 py-2 shadow-sm sm:px-5">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-2 lg:flex-row lg:items-center lg:justify-between"><div className="flex min-w-0 items-center gap-3"><button type="button" onClick={requestBack} disabled={busy} className="min-h-11 shrink-0 rounded-xl border border-gray-300 bg-white px-3 text-sm font-semibold text-[#1a3a4a] focus-visible:ring-2 focus-visible:ring-[#e85d04]">Back to quote</button><label className="min-w-0 flex-1 text-xs font-semibold text-gray-600">Floor name<input value={name} maxLength={120} disabled={readOnly || editLocked || busy} onChange={(event) => { setName(event.target.value); setEdited(true); setError(""); setStatus("Unsaved"); }} className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-base font-semibold text-[#1a3a4a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e85d04]" /></label></div>
        <div className="flex flex-wrap items-center gap-2"><span role="status" aria-live="polite" className={`content-center rounded-full px-3 py-1 text-sm font-semibold ${pdfReady ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{generating ? "Completing…" : saving ? "Saving…" : pdfReady ? "Complete" : "Draft"}</span>{!readOnly ? <><button type="button" disabled={editLocked || busy || !name.trim() || document.walls.length === 0 || invalidNotes.length > 0} onClick={() => void save(true)} className="min-h-11 rounded-xl bg-[#c04e03] px-3 text-sm font-semibold text-white disabled:bg-gray-300">Save as complete</button></> : null}</div></div>
    </header>
    <section className="mx-auto flex min-h-0 w-full max-w-[1500px] flex-1 flex-col p-2" aria-label="Floor plan editor">
      {readOnly ? <div role="status" className="mb-3 rounded-xl border border-slate-300 bg-white p-4 text-sm text-slate-700"><strong>This submitted job is read-only.</strong> You can review the completed drawing.</div> : null}
      {!readOnly && editLocked ? <div role="status" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">Plan editing is locked.</p><p className="mt-1">{submissionGuard.message}</p><Link href={`/partner/jobs/${jobId}#submission-readiness`} className="mt-2 inline-flex min-h-11 items-center rounded-xl bg-[#1a3a4a] px-4 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e85d04]">Return to submission status</Link></div> : null}
      {recovered ? <div role="status" className="mb-3 flex flex-col gap-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between"><p><strong>Unsaved changes recovered.</strong> Review and save them when ready.</p><button type="button" onClick={discardRecovery} disabled={busy} className="min-h-11 rounded-xl border border-blue-300 bg-white px-3 font-semibold">Discard recovered changes</button></div> : null}
      {invalidNotes.length ? <p role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">Shorten the highlighted text note or increase its text-box width before saving.</p> : null}
      <p className="mb-3 shrink-0 rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-700">Draw walls, add notes, then save as complete. Blank floor plans can be saved as drafts.</p>
      {error ? <div role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p className="font-semibold">{error}</p>{sessionExpired ? <Link href="/partner/login?reason=session-expired" className="mt-2 inline-flex min-h-11 items-center font-semibold underline">Sign in again</Link> : null}{locked ? <button type="button" onClick={reload} className="mt-2 block min-h-11 rounded-xl bg-[#1a3a4a] px-4 font-semibold text-white">Reload latest floor plan</button> : null}</div> : null}
      <p className="sr-only" aria-live="polite">{status}</p>
      <InsulHubDrawingCanvas value={document} onChange={(next) => { if (editLocked || readOnly) return; if (JSON.stringify(next) !== JSON.stringify(document)) setEdited(true); setDocument(next); setStatus("Unsaved"); setError(""); }} disabled={editLocked || readOnly || busy} label={`${name || "Floor plan"} drawing grid`} />
    </section>
  </div>;
}
