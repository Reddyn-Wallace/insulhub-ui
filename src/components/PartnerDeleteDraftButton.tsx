"use client";

import { useRef, useState } from "react";
import { useAppDialog } from "./AppDialog";
import { clearDeletedDraftRecovery } from "@/lib/partner/deleted-draft-recovery";

export default function PartnerDeleteDraftButton({ jobId, revision, reference, recoveryScope, onDeleted }: {
  jobId: string; revision: number; reference: string; recoveryScope: string; onDeleted: () => void;
}) {
  const { confirm, dialog } = useAppDialog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);

  async function remove() {
    if (locked.current) return;
    locked.current = true;
    const approved = await confirm({
      title: "Delete draft?",
      description: `Remove ${reference} and its floor plans from your jobs? It will not be sent to InsulHub.`,
      confirmLabel: "Delete draft", tone: "danger",
    });
    if (!approved) { locked.current = false; return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/partner/jobs/${jobId}`, {
        method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision }),
      });
      const result = await response.json();
      if (!response.ok || result.deleted !== true) {
        setError(response.status === 409 ? "This draft has changed or submission has started. Reload jobs before continuing."
          : response.status === 401 ? "Your session has expired. Reload jobs to sign in."
          : "Deletion could not be confirmed. Reload jobs to check.");
        return;
      }
      try { clearDeletedDraftRecovery(window.sessionStorage, recoveryScope, jobId); } catch { /* Storage may be unavailable. Server deletion succeeded. */ }
      onDeleted();
    } catch {
      setError("Deletion could not be confirmed. Reload jobs to check.");
    } finally { setBusy(false); }
  }

  return <>
    <button type="button" onClick={remove} disabled={busy || Boolean(error)} aria-label={`Delete draft ${reference}`} className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:opacity-50">{busy ? "Deleting…" : "Delete"}</button>
    {error && <div role="alert" className="w-full text-sm text-red-700">{error} <button type="button" onClick={() => window.location.reload()} className="min-h-11 underline font-semibold">Reload jobs</button></div>}
    {dialog}
  </>;
}
