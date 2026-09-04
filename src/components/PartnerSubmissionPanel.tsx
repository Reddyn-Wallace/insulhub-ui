"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAppDialog } from "./AppDialog";
import { allocatePendingPartnerSubmissionKey, clearPartnerSubmissionKey, inspectPendingPartnerSubmissionForJob, readPendingPartnerSubmissionKey, type SubmissionLockManager } from "@/lib/partner/submission-client";

interface Props {
  jobId: string; recoveryScope: string; jobRevision: number; floorPlanRevision: number;
  ready: boolean; dirty: boolean; saving: boolean; plansBusy: boolean; stale: boolean; frozen: boolean; recoveryChecked?: boolean;
  onNotReady?: () => void;
  verifiedSave?: boolean;
  onSuccess?: () => void;
  onLockChange: (locked: boolean) => void; onRecoveryChecked: () => void; onFrozen: () => void;
}

function browserStorage(): Storage | null { try { return window.localStorage; } catch { return null; } }
function browserLocks(): SubmissionLockManager | null { try { return navigator.locks ?? null; } catch { return null; } }

export default function PartnerSubmissionPanel({ jobId, recoveryScope, jobRevision, floorPlanRevision, ready, dirty, saving, plansBusy, stale, frozen, recoveryChecked = false, verifiedSave = false, onSuccess, onLockChange, onRecoveryChecked, onFrozen, onNotReady }: Props) {
  const router = useRouter();
  const { confirm, dialog } = useAppDialog(); const lock = useRef(false);
  const gateOpen=useRef(false);
  const mounted=useRef(true);
  const recoveryEpoch=useRef(0);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const [action, setAction] = useState<"signin" | "reload" | "plans" | null>(null); const [retrySeconds, setRetrySeconds] = useState(0);
  const disabledReason = !recoveryChecked ? "Checking the latest submission status before editing or submitting." : frozen ? "Submission status is being confirmed. This draft is temporarily locked." : stale ? "Reload the latest saved draft before submitting." : dirty ? "Changes are saving automatically." : saving ? "Wait for the draft to finish saving." : plansBusy ? "Wait for the floor plan change to finish." : "";
  gateOpen.current=!disabledReason;
  const keyInput = { scope: recoveryScope, jobId, jobRevision, floorPlanRevision };
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(() => { if (!retrySeconds) return; const timer=window.setInterval(()=>setRetrySeconds((value)=>Math.max(0,value-1)),1000); return()=>window.clearInterval(timer); },[retrySeconds]);
  useEffect(()=>{
    const epoch=++recoveryEpoch.current;const active=()=>mounted.current&&recoveryEpoch.current===epoch;
    let controller:AbortController|undefined;let statusObsolete=false;const pending=inspectPendingPartnerSubmissionForJob(keyInput,browserStorage());
    if(pending.state==="PENDING"&&pending.jobRevision===jobRevision&&pending.floorPlanRevision===floorPlanRevision){onLockChange(true);onRecoveryChecked();setBusy(true);void verifyAfterAmbiguous(pending.key,active).finally(()=>{if(active())setBusy(false);});}
    else if(pending.state!=="NONE"){onLockChange(true);onRecoveryChecked();setAction("reload");setError(pending.state==="PENDING"?"A newer saved revision is already being submitted in another tab. Editing remains locked until you reload this job.":"Submission recovery storage could not be checked. Editing remains locked until you reload this job.");}
    else if (verifiedSave) {
      // The just-completed save already confirmed DRAFT for this revision.
      // Still inspect pending keys above and keep the storage listener below.
      onRecoveryChecked();
    }
    else {
      // A tab may have rendered DRAFT before another tab committed and cleared
      // its key. Confirm the server state once before exposing edit controls.
      onLockChange(true);setBusy(true);
      controller=new AbortController();
      void fetch(`/api/partner/jobs/${jobId}/submission`,{cache:"no-store",signal:controller.signal}).then(async(response)=>{
        if(!active()||statusObsolete)return;
        if(response.ok){const data=await response.json() as {status?:{state?:string}};if(!active()||statusObsolete)return;if(data.status?.state==="DRAFT"){const settled=inspectPendingPartnerSubmissionForJob(keyInput,browserStorage());if(settled.state==="NONE"){onLockChange(false);onRecoveryChecked();return;}onLockChange(true);onRecoveryChecked();setAction("reload");setError(settled.state==="PENDING"?"A newer saved revision is already being submitted in another tab. Editing remains locked until you reload this job.":"Submission recovery storage could not be checked. Editing remains locked until you reload this job.");return;}if(data.status?.state){onRecoveryChecked();onFrozen();return;}}
        onRecoveryChecked();setAction(response.status===401?"signin":"reload");setError(response.status===401?"Your session expired before this draft could be checked.":"This draft's submission status could not be confirmed. Editing remains locked until you reload.");
      }).catch(()=>{if(active()&&!statusObsolete){onRecoveryChecked();setAction("reload");setError("This draft's submission status could not be confirmed. Editing remains locked until you reload.");}}).finally(()=>{if(active()&&!statusObsolete)setBusy(false);});
    }
    const expectedPrefix=`partner-submission:v1:${recoveryScope}:${jobId}:`;
    const observe=(event:StorageEvent)=>{
      if(event.storageArea!==browserStorage()||!event.key?.startsWith(expectedPrefix))return;
      statusObsolete=true;controller?.abort();
      if(event.newValue===null){onLockChange(true);router.refresh();window.location.reload();return;}
      const current=inspectPendingPartnerSubmissionForJob(keyInput,browserStorage());
      if(current.state==="PENDING"&&current.jobRevision===jobRevision&&current.floorPlanRevision===floorPlanRevision){onLockChange(true);setBusy(true);void verifyAfterAmbiguous(current.key,active).finally(()=>{if(active())setBusy(false);});}
      else if(current.state!=="NONE"){onLockChange(true);setBusy(false);setAction("reload");setError(current.state==="PENDING"?"A newer saved revision is already being submitted in another tab. Editing remains locked until you reload this job.":"Submission recovery storage could not be checked. Editing remains locked until you reload this job.");}
    };
    window.addEventListener("storage",observe);return()=>{controller?.abort();window.removeEventListener("storage",observe);};
  // Recovery intentionally binds to the immutable saved revision represented by this mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  async function verifyAfterAmbiguous(idempotencyKey:string,isCurrent:()=>boolean=()=>mounted.current) {
    for(let attempt=0;attempt<3;attempt++){
      if(!isCurrent())return;if(attempt)await new Promise((resolve)=>window.setTimeout(resolve,500*2**attempt));if(!isCurrent())return;
      try{
        const response=await fetch(`/api/partner/jobs/${jobId}/submission`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jobRevision,floorPlanRevision,idempotencyKey})});
        if(!isCurrent())return;
        const data=await response.json().catch(()=>({})) as {code?:string;error?:string};
        if(response.status===200){clearPartnerSubmissionKey(keyInput,browserStorage());setMessage("Quote submitted successfully.");(onSuccess ?? onFrozen)();return;}
        if(response.status===502&&data.code==="SUBMISSION_FAILED"){clearPartnerSubmissionKey(keyInput,browserStorage());setError(data.error??"Submission unsuccessful. Contact the Insulmax team directly.");onFrozen();return;}
        if(response.status===202){clearPartnerSubmissionKey(keyInput,browserStorage());setMessage("Submission was received. Reload this job to check its status.");onFrozen();return;}
        // Once an earlier response was lost, a no-effect response to this retry
        // does not prove the original request stopped. Preserve the same key and
        // lock until acceptance/non-DRAFT is authoritative.
        if(response.status===401){setAction("signin");setError("Your session expired while submission status remained uncertain. The recovery key is preserved and editing remains locked.");return;}
        if(response.status===429){setAction("reload");setError(data.error??"Submission status is still uncertain. Editing remains locked while the same request is recovered.");return;}
        if(response.status===422||(response.status===409&&data.code==="STALE_REVISION")||(response.status===503&&data.code==="SUBMISSION_UNAVAILABLE")){setAction("reload");setError("An earlier submission attempt may still be completing. Editing remains locked until the job status is reloaded.");return;}
      }catch{if(!isCurrent())return;/* retry the same idempotent request */}
    }
    onLockChange(true); setError("Submission may have been received, but its status could not be confirmed. Editing remains locked until you reload this job."); setAction("reload");
  }

  async function submit() {
    if (lock.current || disabledReason) return;
    if (!ready) { onNotReady?.(); return; }
    lock.current = true; setError(""); setMessage("");
    try {
      const accepted = await confirm({ title: "Submit this quote?", description: "This permanently freezes the saved lead, quote and completed floor plans. You will not be able to edit or replace them after submission.", confirmLabel: "Submit and make read-only", cancelLabel: "Keep editing", tone: "warning" });
      if (!accepted||!mounted.current) return;
      if(!gateOpen.current){setError("The saved draft or submission status changed while confirmation was open. No submission was started. Review the latest status before trying again.");return;}
      setBusy(true);
      onLockChange(true);
      const idempotencyKey = await allocatePendingPartnerSubmissionKey(keyInput,browserStorage(),browserLocks());
      if(!idempotencyKey){onLockChange(false);setError("This browser could not coordinate a safe submission recovery key. No submission was started. Use a supported browser with storage enabled and try again.");return;}
      const response = await fetch(`/api/partner/jobs/${jobId}/submission`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobRevision, floorPlanRevision, idempotencyKey }) });
      if(!mounted.current)return;
      const data = await response.json().catch(() => ({})) as { error?: string; code?: string };
      if (response.status === 200) { clearPartnerSubmissionKey(keyInput,browserStorage()); setMessage("Quote submitted successfully."); (onSuccess ?? onFrozen)(); return; }
      if (response.status === 502 && data.code === "SUBMISSION_FAILED") { clearPartnerSubmissionKey(keyInput,browserStorage());setError(data.error ?? "Submission unsuccessful. Contact the Insulmax team directly.");onFrozen();return; }
      if (response.status === 202) { clearPartnerSubmissionKey(keyInput,browserStorage()); setMessage("Submission was received. Reload this job to check its status."); onFrozen(); return; }
      if (response.status === 401) { clearPartnerSubmissionKey(keyInput,browserStorage());onLockChange(false); setAction("signin"); setError("Your session has expired. Sign in again to view this job."); return; }
      if (response.status === 422) { const pdfIssue=["SUBMISSION_PDF_MISSING","SUBMISSION_PDF_STALE","SUBMISSION_PDF_INTEGRITY_FAILED"].includes(data.code??"");clearPartnerSubmissionKey(keyInput,browserStorage());onLockChange(true);setAction(pdfIssue?"plans":"reload");setError(pdfIssue?"A floor plan changed and must be marked complete again before submission. Reload this job or open Floor plans.":"The saved readiness information changed. Reload this job before submitting again.");(document.getElementById(pdfIssue?"floor-plans":"submission-readiness"))?.focus();return; }
      if (response.status === 429) { clearPartnerSubmissionKey(keyInput,browserStorage());onLockChange(false); setRetrySeconds(Math.min(300,Number(response.headers.get("retry-after")??300)||300)); setError(data.error ?? "Too many attempts. Wait before trying again."); return; }
      if (response.status === 409 && data.code === "STALE_REVISION") { clearPartnerSubmissionKey(keyInput,browserStorage());onLockChange(false);setAction("reload");setError("This saved draft changed. Reload the latest version before submitting.");return; }
      if (response.status === 409) { await verifyAfterAmbiguous(idempotencyKey); return; }
      if (response.status === 503 && data.code === "SUBMISSION_UNAVAILABLE") { clearPartnerSubmissionKey(keyInput,browserStorage());onLockChange(false); setError(data.error ?? "Submission is not available yet. The saved draft remains editable."); return; }
      await verifyAfterAmbiguous(idempotencyKey);
    } catch { if(!mounted.current)return;const idempotencyKey=readPendingPartnerSubmissionKey(keyInput,browserStorage());if(idempotencyKey)await verifyAfterAmbiguous(idempotencyKey);else{onLockChange(true);setAction("reload");setError("Submission status could not be confirmed. Editing remains locked until you reload this job.");} }
    finally { lock.current = false; if(mounted.current)setBusy(false); }
  }

  return <section id="submission-readiness" tabIndex={-1} className="min-w-0 focus:outline-none" aria-label="Submit quote">
    <div className="flex items-center justify-end">
      <button type="button" onClick={submit} disabled={busy || retrySeconds>0 || Boolean(disabledReason)} aria-describedby="submission-disabled-reason" className="min-h-14 w-full shrink-0 rounded-xl bg-[#c04e03] px-8 py-4 text-base font-bold text-white shadow-sm hover:bg-[#a84202] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#e85d04]/40 disabled:bg-gray-300 sm:w-auto sm:min-w-64">{busy ? "Submitting…" : retrySeconds ? `Try again in ${retrySeconds}s` : "Submit quote"}</button></div>
    <p id="submission-disabled-reason" className="sr-only">{disabledReason || (ready ? "Ready to submit. You will confirm before anything is frozen." : "Complete the quote and floor plans, then submit. Any missing details will be highlighted.")}</p>

    <div aria-live="assertive" aria-atomic="true">{error ? <div role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800"><p>{error}</p>{action==="signin"?<Link href="/partner/login?reason=session-expired" className="mt-2 inline-flex min-h-11 items-center underline">Sign in again</Link>:null}{action==="reload"||action==="plans"?<button type="button" onClick={()=>{router.refresh();window.location.reload();}} className="mt-2 min-h-11 rounded-lg bg-[#1a3a4a] px-3 text-white">Reload job status</button>:null}{action==="plans"?<Link href={`/partner/jobs/${jobId}#floor-plans`} className="ml-2 mt-2 inline-flex min-h-11 items-center rounded-lg border border-[#1a3a4a] px-3 text-[#1a3a4a]">Open floor plans</Link>:null}</div> : null}{message ? <p className="mt-3 rounded-xl bg-blue-50 p-3 text-sm font-semibold text-blue-900">{message}</p> : null}</div>{dialog}
  </section>;
}
