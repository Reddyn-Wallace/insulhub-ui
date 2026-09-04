"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { inspectPendingPartnerSubmissionForJob, type PartnerSubmissionKeyInput } from "@/lib/partner/submission-client";

function localStorageSafe(): Storage | null { try { return window.localStorage; } catch { return null; } }

/** Locks non-quote edit surfaces while a response-lost submission may be freezing the draft. */
export function usePartnerSubmissionEditGuard(input: PartnerSubmissionKeyInput | null, readOnly: boolean) {
  const [checked, setChecked] = useState(readOnly || !input);
  const [locked, setLocked] = useState(readOnly);
  const [message, setMessage] = useState(readOnly ? "This job is read-only." : "Checking whether submission is in progress…");
  const prefix = useMemo(() => input ? `partner-submission:v1:${input.scope}:${input.jobId}:` : "", [input]);
  const currentKey = useMemo(() => input ? `${prefix}${input.jobRevision}:${input.floorPlanRevision}` : "", [input, prefix]);
  const [settledKey, setSettledKey] = useState(currentKey);
  const generation = useRef(0);

  const reconcile = useCallback(async (epoch: number, signal?: AbortSignal) => {
    if (!input || readOnly) return;
    const storage = localStorageSafe();
    if (!storage) { setSettledKey(currentKey); setChecked(true); setLocked(true); setMessage("Editing is locked because submission recovery storage is unavailable. Return to the quote to check the job."); return; }
    const pending = inspectPendingPartnerSubmissionForJob(input, storage);
    if (pending.state === "UNAVAILABLE") { setSettledKey(currentKey); setChecked(true); setLocked(true); setMessage("Editing is locked because submission recovery storage could not be checked. Return to the quote to check the job."); return; }
    if (pending.state === "PENDING") {
      setSettledKey(currentKey); setChecked(true); setLocked(true); setMessage("A submission is being checked in another tab. Return to the quote to reconcile it before editing plans."); return;
    }
    try {
      const response = await fetch(`/api/partner/jobs/${input.jobId}/submission`, { cache: "no-store", signal });
      const payload = await response.json() as { status?: { state?: string } };
      if (signal?.aborted || generation.current !== epoch) return;
      const settled = inspectPendingPartnerSubmissionForJob(input, storage);
      if (settled.state !== "NONE") { setSettledKey(currentKey); setChecked(true); setLocked(true); setMessage(settled.state === "PENDING" ? "A submission is being checked in another tab. Return to the quote to reconcile it before editing plans." : "Editing is locked because submission recovery storage could not be checked. Return to the quote to check the job."); return; }
      if (response.ok && payload.status?.state === "DRAFT") { setSettledKey(currentKey); setChecked(true); setLocked(false); setMessage(""); return; }
      setSettledKey(currentKey); setChecked(true); setLocked(true); setMessage(response.ok ? "This job is no longer an editable draft. Return to the quote for its current status." : "Submission status could not be confirmed. Return to the quote before editing plans.");
    } catch {
      if (signal?.aborted || generation.current !== epoch) return;
      setSettledKey(currentKey); setChecked(true); setLocked(true); setMessage("Submission status could not be confirmed. Return to the quote before editing plans.");
    }
  }, [currentKey, input, readOnly]);

  useEffect(() => {
    if (!input || readOnly) return;
    let controller = new AbortController();
    const start = () => { controller.abort(); controller = new AbortController(); const epoch = ++generation.current; void reconcile(epoch, controller.signal); };
    let active=true;void Promise.resolve().then(()=>{if(active)start();});
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || !event.key?.startsWith(prefix)) return;
      setSettledKey(currentKey); setChecked(false); setLocked(true); setMessage("Checking the latest submission status…"); start();
    };
    window.addEventListener("storage", onStorage);
    return () => { active=false;controller.abort(); window.removeEventListener("storage", onStorage); };
  }, [currentKey, input, prefix, readOnly, reconcile]);

  if(readOnly)return{checked:true,locked:true,message:"This job is read-only."};
  if(!input)return{checked:true,locked:false,message:""};
  if(settledKey!==currentKey)return{checked:false,locked:true,message:"Checking whether submission is in progress…"};
  return { checked, locked, message };
}
