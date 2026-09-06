"use client";
import { useEffect, useRef, useState } from "react";
import BottomSheet from "./BottomSheet";
import { smsStatusLabel } from "@/lib/job-sms";

type Sender = { id: string; label: string; senderValue: string };
export type JobSmsMessage = { id: string; body: string; destination: string; senderLabel: string; actorName: string; status: string; failureReason: string; createdAt?: string; templateTitle?: string };
type Attempt = { id: string; senderId: string; body: string; destination: string; templateTitle: string };
export default function JobSmsComposer({ jobId, phone, contactName, templates, onRecorded, statusUpdates = [] }: {
  jobId: string; phone: string; contactName: string; templates: { id: string; title: string; body: string }[]; onRecorded: (message?: JobSmsMessage) => void; statusUpdates?: { id: string; status: string; failureReason?: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [senderId, setSenderId] = useState("");
  const [body, setBody] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [message, setMessage] = useState<JobSmsMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const endpoint = `/api/jobs/${jobId}/sms`;
  const storageKey = `job-sms-attempt:${jobId}`;
  const headers = () => ({ "content-type": "application/json", "x-access-token": localStorage.getItem("token") || "" });
  useEffect(() => {
    let active = true;
    let saved: Attempt | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(storageKey) || "null"); } catch { /* no recoverable attempt */ }
    fetch(`${endpoint}${saved?.id ? `?attempt=${encodeURIComponent(saved.id)}` : ""}`, { headers: headers() })
      .then(async response => {
        const data = await response.json(); if (!response.ok) throw Error(data.error);
        if (!active) return;
        setEnabled(data.enabled); setSenders(data.senders); setSenderId(data.senders[0]?.id || "");
        if (saved) { setAttempt(saved); setBody(saved.body); setSenderId(saved.senderId); setMessage(data.message); }
      }).catch(() => { if (active && saved) { setAttempt(saved); setBody(saved.body); setError("Could not confirm the previous send. Check status before sending again."); } });
    return () => { active = false; };
  }, [endpoint, storageKey]);
  useEffect(() => {
    const update = statusUpdates.find(item => item.id === attempt?.id);
    if (update) setMessage(current => current ? { ...current, status: update.status, failureReason: update.failureReason || "" } : current);
  }, [statusUpdates, attempt?.id]);
  async function submit() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const current = attempt || { id: crypto.randomUUID(), senderId, body, destination: phone, templateTitle: templates.find(template => template.id === templateId)?.title || "" };
      // Persist before submitting so a reload cannot silently create another send.
      sessionStorage.setItem(storageKey, JSON.stringify(current)); setAttempt(current);
      setOpen(false);
      onRecorded({ ...current, senderLabel: senders.find(sender => sender.id === current.senderId)?.label || "", actorName: "", status: "sending", failureReason: "", createdAt: new Date().toISOString() });
      const response = await fetch(endpoint, { method: "POST", headers: headers(), body: JSON.stringify(current) });
      const data = await response.json();
      if (!response.ok) {
        if ((data.safeToEdit === true || [400, 403].includes(response.status))) { setAttempt(null); sessionStorage.removeItem(storageKey); }
        throw Error(data.error || "Could not confirm the send. Check status before sending again.");
      }
      setMessage(data.message); onRecorded({ ...data.message, templateTitle: current.templateTitle });
      if (["failed", "unknown"].includes(data.message.status)) setOpen(true);
    } catch (error) { setOpen(true); onRecorded(); setError(error instanceof Error ? error.message : "Could not confirm the send. Check status before sending again."); }
    finally { locked.current = false; setBusy(false); }
  }
  function newMessage() {
    sessionStorage.removeItem(storageKey); setAttempt(null); setMessage(null); if (message?.status !== "failed") { setBody(""); setTemplateId(""); } setError(""); onRecorded();
  }
  if (!enabled) return null;
  const settled = message && ["accepted", "sent", "delivered", "failed"].includes(message.status);
  return <>
    <button type="button" disabled={busy} onClick={() => { if (message && ["accepted", "sent", "delivered"].includes(message.status)) newMessage(); setOpen(true); }} className="rounded-xl border border-teal-700 px-3 py-3 text-sm font-semibold text-teal-800">Send SMS from CRM</button>
    <BottomSheet open={open} onClose={() => { if (!busy) setOpen(false); }} title="Send SMS from CRM">
      <div className="space-y-4 text-left">
        <div className="rounded-xl bg-gray-50 p-3"><p className="font-semibold">{contactName}</p><p className="text-sm">{attempt?.destination || phone || "No mobile number — update the job contact first."}</p></div>
        <p className="text-sm text-gray-600">Sends through your connected SMS account. Replies are not automatically captured yet. The job’s manual Text and Email buttons remain available.</p>
        {!enabled && <p className="text-sm text-amber-800">CRM SMS sending is currently disabled. Saved message status can still be checked.</p>}
        {!attempt ? <>
          <label className="block text-sm font-semibold">Sending account<select className="mt-1 w-full rounded-lg border p-3" value={senderId} onChange={event => setSenderId(event.target.value)} disabled={busy}><option value="">Choose a connected sender</option>{senders.map(sender => <option key={sender.id} value={sender.id}>{sender.label}</option>)}</select></label>
          {!senders.length && <p className="text-sm text-amber-800">No connected SMS sender is available. Check Senders in Settings or use manual Text.</p>}
          <label className="block text-sm font-semibold">Template<select className="mt-1 w-full rounded-lg border p-3" value={templateId} disabled={busy} onChange={event => { setTemplateId(event.target.value); setBody(templates.find(template => template.id === event.target.value)?.body || ""); }}><option value="">Blank message</option>{templates.map(template => <option key={template.id} value={template.id}>{template.title}</option>)}</select></label>
        </> : <p className="text-sm">Sender: {message?.senderLabel || senders.find(sender => sender.id === attempt.senderId)?.label || "Saved sending account"}{message?.actorName ? ` · ${message.actorName}` : ""}</p>}
        <label className="block text-sm font-semibold">Message<textarea rows={6} maxLength={1600} className="mt-1 w-full rounded-lg border p-3 font-normal" value={body} disabled={busy || !!attempt} onChange={event => setBody(event.target.value)} /></label>
        <p className="text-xs text-gray-500">{body.length}/1,600 characters. Long messages and some characters can use multiple SMS segments.</p>
        {message && <div role="status" className="rounded-lg bg-gray-50 p-3 text-sm"><strong>{smsStatusLabel(message.status)}</strong>{message.failureReason && <p className="mt-1">{message.failureReason}</p>}</div>}
        {attempt && !busy && (message?.status === "unknown" || !!error) && <p className="text-sm text-amber-800">This attempt is saved. Its status updates automatically while this job is open. Wait for confirmation before sending another text, including from your phone.</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {!attempt && <button type="button" disabled={busy || !enabled || !senderId || !phone || !body.trim()} onClick={() => void submit()} className="w-full rounded-xl bg-teal-700 p-3 font-semibold text-white disabled:opacity-40">{busy ? "Sending…" : "Send SMS"}</button>}
        {attempt && !message && <button type="button" disabled={busy || !enabled} onClick={() => void submit()} className="w-full rounded-xl border p-3 text-sm">Recover original send attempt</button>}
        {settled && <button type="button" disabled={busy || !enabled} onClick={newMessage} className="w-full rounded-xl border p-3 font-semibold">{message.status === "failed" ? "Compose a new attempt" : "Compose another message"}</button>}
      </div>
    </BottomSheet>
  </>;
}
