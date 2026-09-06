"use client";
import { useEffect, useState } from "react";
type Settings = { enabled: boolean; testOnly: boolean; testerName: string; isTester: boolean; canManage: boolean };
export default function JobSmsSettings() {
  const [settings, setSettings] = useState<Settings>({ enabled: false, testOnly: false, testerName: "", isTester: false, canManage: false });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const headers = () => ({ "content-type": "application/json", "x-access-token": localStorage.getItem("token") || "" });
  useEffect(() => {
    let active = true;
    fetch("/api/job-sms-settings", { headers: headers() })
      .then(async response => { const data = await response.json(); if (!response.ok) throw Error(data.error); if (active) { setSettings(data); setReady(true); } })
      .catch(() => { if (active) setError("Could not load CRM messaging availability."); });
    return () => { active = false; };
  }, []);
  async function save(enabled: boolean, testOnly?: boolean) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/job-sms-settings", { method: "PATCH", headers: headers(), body: JSON.stringify({ enabled, ...(testOnly !== undefined ? { testOnly } : {}) }) });
      const data = await response.json(); if (!response.ok) throw Error(data.error); setSettings(current => ({ ...current, ...data }));
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save."); }
    finally { setBusy(false); }
  }
  const disabled = !ready || !settings.canManage || busy;
  return <div className="rounded-lg border border-gray-200 p-4">
    <h3 className="font-semibold text-gray-900">CRM messaging from jobs</h3>
    <p className="mt-1 text-sm text-gray-600">Control both Send SMS from CRM and Send email from CRM. Turning this off hides both options and blocks new CRM sends. Manual Text and Email, campaigns and saved communication history remain available.</p>
    <label className="mt-3 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={settings.enabled} disabled={disabled} onChange={() => void save(!settings.enabled)} />Enable CRM SMS and email</label>
    <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.testOnly} disabled={disabled} onChange={() => void save(settings.enabled, !settings.testOnly)} />{settings.testOnly && !settings.isTester ? `Test only with ${settings.testerName}’s account` : "Test only with my account"}</label>
    <p className="mt-2 text-xs text-gray-500">{!settings.enabled ? "Off for everyone. Set account-only testing before enabling to keep other staff on the current flow." : settings.testOnly ? `Available only to ${settings.testerName}. Other staff keep the manual options.` : "Available to everyone with job access."}</p>
    {settings.testOnly && !settings.isTester && <button type="button" className="mt-2 text-xs text-teal-700 underline" disabled={disabled} onClick={() => void save(settings.enabled, true)}>Use my account for testing instead</button>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </div>;
}
