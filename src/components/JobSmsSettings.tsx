"use client";
import { useEffect, useState } from "react";
export default function JobSmsSettings() {
  const [enabled, setEnabled] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/job-sms-settings", { headers: { "x-access-token": localStorage.getItem("token") || "" } })
      .then(async response => { const data = await response.json(); if (!response.ok) throw Error(data.error); if (active) { setEnabled(data.enabled); setCanManage(data.canManage); setReady(true); } })
      .catch(() => { if (active) setError("Could not load CRM SMS availability."); });
    return () => { active = false; };
  }, []);
  async function toggle() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/job-sms-settings", { method: "PATCH", headers: { "content-type": "application/json", "x-access-token": localStorage.getItem("token") || "" }, body: JSON.stringify({ enabled: !enabled }) });
      const data = await response.json(); if (!response.ok) throw Error(data.error); setEnabled(data.enabled);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save."); }
    finally { setBusy(false); }
  }
  return <div className="rounded-lg border border-gray-200 p-4">
    <h3 className="font-semibold text-gray-900">SMS from jobs</h3>
    <p className="mt-1 text-sm text-gray-600">Allow staff to send SMS through a connected account from a job. Manual SMS and email remain available. Replies are not automatically captured.</p>
    <label className="mt-3 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={enabled} disabled={!ready || !canManage || busy} onChange={toggle} />Enable CRM SMS sending</label>
    {ready && !canManage && <p className="mt-2 text-xs text-gray-500">Your account cannot manage communication settings.</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </div>;
}
