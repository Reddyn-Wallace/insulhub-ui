"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppDialog } from "./AppDialog";
import { EMPTY_SITE_PLAN_DOCUMENT } from "@/lib/site-plan-drawings";
import { nextDefaultFloorName, sitePlanRecoveryKey, type FloorPlanCollectionClient, type PartnerFloorPlanClient } from "@/lib/partner/site-plan-client";
import { usePartnerSubmissionEditGuard } from "./usePartnerSubmissionEditGuard";
import { flushPartnerEdits } from "@/lib/partner/navigation-save";

type Props = { jobId: string; recoveryScope: string; initialCollection?: FloorPlanCollectionClient; readOnly?: boolean; compact?: boolean; onCollectionChange?: (collection: FloorPlanCollectionClient) => void; onBusyChange?: (busy: boolean) => void; onOpeningChange?: (opening: boolean) => void; refreshOnMount?: boolean; submissionJobRevision?: number };
type ApiResult = { floorPlans?: FloorPlanCollectionClient; floorPlan?: PartnerFloorPlanClient; error?: string; code?: string; currentRevision?: number };
const control = "min-h-11 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-[#1a3a4a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e85d04] disabled:opacity-40";

function storage() { try { return window.sessionStorage; } catch { return null; } }

export default function PartnerFloorPlanList({ jobId, recoveryScope, initialCollection, readOnly = false, compact = false, onCollectionChange, onBusyChange, onOpeningChange, refreshOnMount = false, submissionJobRevision }: Props) {
  const router = useRouter();
  const [collection, setCollection] = useState<FloorPlanCollectionClient | null>(initialCollection ?? null);
  const [loading, setLoading] = useState(!initialCollection);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [locked, setLocked] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [draftLocked, setDraftLocked] = useState(readOnly);
  const submissionGuardInput = useMemo(() => submissionJobRevision === undefined || !collection ? null : ({ scope: recoveryScope, jobId, jobRevision: submissionJobRevision, floorPlanRevision: collection.revision }), [collection, jobId, recoveryScope, submissionJobRevision]);
  const submissionGuard = usePartnerSubmissionEditGuard(submissionGuardInput, readOnly);
  const editLocked = locked || submissionGuard.locked || !submissionGuard.checked;
  const focusAfterMutation = useRef<string | null>(null);
  const adding = useRef(false);
  const initialLoadStarted = useRef(false);
  const initialCollectionSignature = useRef(JSON.stringify(initialCollection ?? null));
  const { confirm, dialog } = useAppDialog();
  const adoptCollection = useCallback((next: FloorPlanCollectionClient) => { setCollection(next); onCollectionChange?.(next); }, [onCollectionChange]);

  const load = useCallback(async (announce = false) => {
    setLoading(true); setError(""); setSessionExpired(false);
    try {
      const response = await fetch(`/api/partner/jobs/${jobId}/floor-plans`, { cache: "no-store" });
      const result = await response.json() as ApiResult;
      if (response.status === 401) { setSessionExpired(true); setError("Your session expired while loading floor plans."); return; }
      if (!response.ok || !result.floorPlans) { setError(result.error ?? "Floor plans could not be loaded."); return; }
      adoptCollection(result.floorPlans); if (!draftLocked) setLocked(false);
      if (announce) setAnnouncement("Latest floor plans loaded.");
    } catch { setError("Floor plans could not be loaded. Check your connection and try again."); }
    finally { setLoading(false); }
  }, [adoptCollection, draftLocked, jobId]);

  useEffect(() => { if ((!initialCollection || refreshOnMount) && !initialLoadStarted.current) { initialLoadStarted.current = true; void load(false); } }, [initialCollection, load, refreshOnMount]);
  useEffect(() => { onBusyChange?.(Boolean(busy)); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(() => {
    const signature = JSON.stringify(initialCollection ?? null); if (signature === initialCollectionSignature.current || !initialCollection || busy || locked) return; initialCollectionSignature.current = signature;
    adoptCollection(initialCollection);
  }, [adoptCollection, busy, collection, initialCollection, locked]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible" && !busy && !editLocked) void load(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [busy, editLocked, load]);
  useEffect(() => { const id = focusAfterMutation.current; if (!id) return; focusAfterMutation.current = null; document.getElementById(id)?.focus(); }, [collection]);

  function quarantine(detail: string, permanent = false) {
    try { storage()?.removeItem(sitePlanRecoveryKey(recoveryScope, jobId, "collection-list")); } catch { /* best effort */ }
    setLocked(true); setError(detail); setAnnouncement("Floor plan changes are locked until the latest server version is loaded.");
    if (permanent) setDraftLocked(true);
  }
  function reloadJobDetails() { router.replace(`/partner/jobs/${jobId}`); router.refresh(); }
  async function result(response: Response): Promise<ApiResult | null> {
    const payload = await response.json() as ApiResult;
    if (response.status === 401) { setSessionExpired(true); setError("Your session expired before this change could be saved."); return null; }
    if (response.status === 409 && (payload.code === "STALE_REVISION" || payload.code === "DRAFT_LOCKED")) { quarantine(payload.code === "DRAFT_LOCKED" ? "This job is now read-only. Reload the latest job before continuing." : "Floor plans changed in another tab. Reload the latest version before continuing.", payload.code === "DRAFT_LOCKED"); return null; }
    if (!response.ok) { setError(payload.error ?? "The floor plan change could not be saved."); return null; }
    return payload;
  }
  async function addFloor() {
    if (!collection || loading || busy || editLocked || readOnly || adding.current) return;
    adding.current = true; onOpeningChange?.(true); setError("");
    let opening = false;
    try {
      // Drain the quote before marking plans busy, otherwise its save guard
      // would correctly refuse to save during a floor-plan mutation.
      if (!await flushPartnerEdits()) { setError("Save the highlighted quote changes before adding a floorplan."); return; }
      setBusy("add");
      const attempted = { revision: collection.revision, name: nextDefaultFloorName(collection.floors), document: EMPTY_SITE_PLAN_DOCUMENT };
      const response = await fetch(`/api/partner/jobs/${jobId}/floor-plans`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(attempted) });
      const payload = await result(response); if (!payload?.floorPlans) return;
      adoptCollection(payload.floorPlans);
      const added = payload.floorPlans.floors.filter((floor) => !collection.floors.some((existing) => existing.id === floor.id));
      if (added.length !== 1) { quarantine("Reload floor plans to check which drawing was added before continuing."); return; }
      opening = true; router.push(`/partner/jobs/${jobId}/floor-plans/${added[0].id}`);
    } catch { quarantine("The new floorplan could not be confirmed. Reload floor plans before trying again."); }
    finally { if (!opening) { adding.current = false; setBusy(""); onOpeningChange?.(false); } }
  }
  async function remove(floor: PartnerFloorPlanClient) {
    if (!collection || editLocked || readOnly || !await confirm({ title: `Delete ${floor.name}?`, description: "This removes the floor drawing. This cannot be undone.", confirmLabel: "Delete floor", tone: "danger" })) return;
    setBusy(floor.id); setError(""); const index = collection.floors.findIndex((item) => item.id === floor.id); const attempted = { revision: collection.revision };
    try {
      const response = await fetch(`/api/partner/jobs/${jobId}/floor-plans/${floor.id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(attempted) });
      const payload = await result(response); if (!payload?.floorPlans) return;
      adoptCollection(payload.floorPlans); focusAfterMutation.current = payload.floorPlans.floors[index]?.id ? `floor-card-${payload.floorPlans.floors[index].id}` : payload.floorPlans.floors[index - 1]?.id ? `floor-card-${payload.floorPlans.floors[index - 1].id}` : "add-floor-plan"; setAnnouncement(`${floor.name} deleted.`);
    } catch { setError(`${floor.name} was not deleted. Reload to check the latest floor plans.`); }
    finally { setBusy(""); }
  }

  if (loading && !collection) return <div className="rounded-2xl border border-gray-200 bg-white p-6" role="status">Loading floor plans…</div>;
  return <section id={compact ? undefined : "floor-plans-list"} className={compact ? "scroll-mt-24" : "mx-auto max-w-5xl"} aria-labelledby="floor-plans-heading">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 id="floor-plans-heading" className="text-xl font-bold text-[#1a3a4a]">Floor plans</h2><p className="mt-1 text-sm text-gray-600">{readOnly ? "Review the floor plans recorded with this job." : "Mark each floor complete before submitting."}</p></div><div className="flex flex-wrap gap-2">{!readOnly ? <button id="add-floor-plan" type="button" onClick={() => void addFloor()} disabled={!collection || loading || editLocked || Boolean(busy) || (collection?.floors.length ?? 0) >= 20} className="min-h-11 rounded-xl bg-[#c04e03] px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a3a4a] disabled:bg-gray-300">{busy === "add" ? "Adding…" : loading ? "Loading floors…" : "Add floorplan"}</button> : null}</div></div>
    {readOnly ? <p role="status" className="mt-4 rounded-xl border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700"><strong>Read-only plans.</strong> This job is no longer a draft, so floor plans cannot be changed.</p> : null}
    {!readOnly && editLocked ? <div role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">Plan editing is locked.</p><p className="mt-1">{submissionGuard.message}</p><Link href={`/partner/jobs/${jobId}#submission-readiness`} className="mt-2 inline-flex min-h-11 items-center rounded-lg bg-[#1a3a4a] px-3 py-2 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e85d04]">Return to submission status</Link></div> : null}
      {error ? <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p className="font-semibold">{error}</p>{sessionExpired ? <Link href="/partner/login?reason=session-expired" className="mt-2 inline-flex min-h-11 items-center font-semibold underline">Sign in again</Link> : null}{!sessionExpired && !draftLocked ? <button type="button" onClick={() => void load(true)} disabled={loading || Boolean(busy)} className="mt-2 block min-h-11 rounded-lg bg-[#1a3a4a] px-3 py-2 font-semibold text-white">{locked ? "Reload latest floor plans" : "Retry floor plans"}</button> : null}{draftLocked ? <button type="button" onClick={reloadJobDetails} className="mt-2 inline-flex min-h-11 items-center rounded-lg bg-[#1a3a4a] px-3 py-2 font-semibold text-white">Reload job details</button> : null}</div> : null}

    {!collection?.floors.length ? <div className="mt-4 rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center"><h3 className="font-bold text-[#1a3a4a]">{readOnly ? "No floor plans recorded" : "No floor plans yet"}</h3><p className="mt-2 text-sm text-gray-600">{readOnly ? "This submitted job has no saved floor plans." : "Add a floorplan to start drawing."}</p>{!readOnly ? <button type="button" onClick={() => void addFloor()} disabled={loading || editLocked || Boolean(busy)} className="mt-4 min-h-11 rounded-xl bg-[#c04e03] px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-300">{loading ? "Loading floors…" : "Add floorplan"}</button> : null}</div> : <ol className="mt-4 space-y-2" aria-label="Floor plans">{collection.floors.map((floor) => {  return <li key={floor.id} className="rounded-2xl border border-gray-200 bg-white p-3"><article id={`floor-card-${floor.id}`} tabIndex={-1} className="outline-none focus-visible:ring-2 focus-visible:ring-[#e85d04]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0 flex-1"><h3 className="font-semibold text-[#1a3a4a]">{floor.name}</h3><span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${floor.pdfReady ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{floor.pdfReady ? "Complete" : "Draft"}</span></div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:max-w-md lg:justify-end">{busy || (!readOnly && editLocked) ? <span aria-disabled="true" className={`${control} inline-flex items-center justify-center opacity-40`}>{readOnly ? "View" : "Open"}</span> : <Link id={`floor-open-${floor.id}`} href={`/partner/jobs/${jobId}/floor-plans/${floor.id}`} className={`${control} inline-flex items-center justify-center`}>{readOnly ? "View" : "Open"}</Link>}{!readOnly ? <><button type="button" className={`${control} border-red-200 text-red-700`} disabled={editLocked || Boolean(busy)} onClick={() => void remove(floor)}>Delete</button></> : null}</div></div>
    </article></li>; })}</ol>}
    <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>{dialog}
  </section>;
}
