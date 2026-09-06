"use client";
import { useEffect, useRef, useState } from "react";
import BottomSheet from "./BottomSheet";
import { emailStatusLabel, type JobEmailMessage } from "@/lib/job-email";

type Sender = { id: string; label: string; senderValue: string; signatureHtml: string };
type Attempt = { id: string; senderId: string; destination: string; subject: string; body: string; templateTitle: string };
const headers = () => ({ "content-type": "application/json", "x-access-token": localStorage.getItem("token") || "" });
export default function JobEmailComposer({ jobId, email, contactName, templates, onRecorded }: {
  jobId: string; email: string; contactName: string; templates: { id: string; title: string; subject: string; body: string }[]; onRecorded: (message?: JobEmailMessage) => void;
}) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [senderId, setSenderId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [message, setMessage] = useState<JobEmailMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkedGmail, setCheckedGmail] = useState(false);
  const locked = useRef(false);
  const recorded = useRef(onRecorded); recorded.current = onRecorded;
  const endpoint = `/api/jobs/${jobId}/email`;
  const storageKey = `job-email-attempt:${jobId}`;
  useEffect(() => {
    let active = true;
    let saved: Attempt | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(storageKey) || "null"); } catch { /* No saved attempt. */ }
    if (saved) { setAttempt(saved); setSubject(saved.subject); setBody(saved.body); setSenderId(saved.senderId); }
    fetch(`${endpoint}${saved?.id ? `?attempt=${encodeURIComponent(saved.id)}` : ""}`, { headers: headers() })
      .then(async response => {
        const data = await response.json(); if (!response.ok) throw Error(data.error);
        if (!active) return;
        setEnabled(data.enabled === true); setSenders(data.senders); if (!saved) setSenderId(data.senders[0]?.id || "");
        if (saved && data.message) { setMessage(data.message); recorded.current(data.message); }
      }).catch(() => { if (active) setError("Could not load email accounts or confirm the previous send. Refresh the page to try again."); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [endpoint, storageKey]);
  useEffect(() => {
    if (!attempt || (message && message.status !== "sending")) return;
    let stopped = false; let running = false;
    const controller = new AbortController();
    const started = Date.now();
    // Reconcile a delayed CRM response only. This does not send, or query Gmail.
    const timer = setInterval(async () => {
      if (running || document.hidden || navigator.onLine === false) return;
      if (Date.now() - started > 70000) { clearInterval(timer); return; }
      running = true;
      try {
        const response = await fetch(`${endpoint}?attempt=${encodeURIComponent(attempt.id)}`, { headers: headers(), signal: controller.signal });
        const data = await response.json();
        if (!stopped && response.ok && data.message) {
          setMessage(data.message); recorded.current(data.message);
          if (data.message.status === "sent") { setOpen(false); setError(""); }
        }
      } catch { /* Preserve the saved attempt on a connection failure. */ }
      finally { running = false; }
    }, 3000);
    return () => { stopped = true; controller.abort(); clearInterval(timer); };
  }, [attempt, message?.status, endpoint]);
  async function submit() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const current = attempt || { id: crypto.randomUUID(), senderId, destination: email, subject, body, templateTitle: templates.find(item => item.id === templateId)?.title || "" };
      sessionStorage.setItem(storageKey, JSON.stringify(current)); setAttempt(current);
      setOpen(false);
      recorded.current({ ...current, renderedBody: current.body, renderedHtml: "", senderLabel: sender?.label || "", senderValue: sender?.senderValue || "", actorName: "", status: "sending", failureReason: "", createdAt: new Date().toISOString() });
      const response = await fetch(endpoint, { method: "POST", headers: headers(), body: JSON.stringify(current) });
      const data = await response.json();
      if (!response.ok) {
        if (data.safeToEdit === true) { sessionStorage.removeItem(storageKey); setAttempt(null); }
        throw Error(data.error || "Sending could not be confirmed. Check Gmail’s Sent folder before sending again.");
      }
      setMessage(data.message); recorded.current({ ...data.message, templateTitle: current.templateTitle });
      if (["failed", "unknown"].includes(data.message.status)) setOpen(true);
    } catch (error) { setOpen(true); setError(error instanceof Error ? error.message : "Sending could not be confirmed."); recorded.current(); }
    finally { locked.current = false; setBusy(false); }
  }
  function newMessage() {
    sessionStorage.removeItem(storageKey); setAttempt(null); setMessage(null); setError(""); setCheckedGmail(false);
    if (message?.status !== "failed") { setSubject(""); setBody(""); setTemplateId(""); }
    if (!senders.some(item => item.id === senderId)) setSenderId(senders[0]?.id || "");
  }
  const sender = senders.find(item => item.id === senderId);
  if (!enabled) return null;
  return <>
    <button type="button" disabled={!ready || busy} onClick={() => { if (message?.status === "sent") newMessage(); setOpen(true); }} className="rounded-xl border border-[#1a3a4a] px-3 py-3 text-sm font-semibold text-[#1a3a4a] disabled:opacity-40">Send email from CRM</button>
    <BottomSheet open={open} onClose={() => { if (!busy) setOpen(false); }} title="Send email from CRM">
      <div className="space-y-4 text-left">
        <div className="rounded-xl bg-gray-50 p-3"><p className="font-semibold">{contactName}</p><p className="break-all text-sm">{attempt?.destination || email || "No email address — update the job contact first."}</p></div>
        <p className="text-sm text-gray-600">Uses your connected Gmail account and saved signature. Replies are not captured in the CRM yet.</p>
        {!attempt ? <>
          <label className="block text-sm font-semibold">Sending account<select className="mt-1 w-full rounded-lg border p-3" value={senderId} onChange={event => setSenderId(event.target.value)} disabled={busy}><option value="">Choose a connected account</option>{senders.map(item => <option key={item.id} value={item.id}>{item.label} — {item.senderValue}</option>)}</select></label>
          {!senders.length && <p className="text-sm text-amber-800">No connected email account is available. Connect Gmail under Senders in Settings, or use the manual Email option.</p>}
          <label className="block text-sm font-semibold">Template<select className="mt-1 w-full rounded-lg border p-3" value={templateId} disabled={busy} onChange={event => { const template = templates.find(item => item.id === event.target.value); setTemplateId(event.target.value); setSubject(template?.subject || ""); setBody(template?.body || ""); }}><option value="">Blank email</option>{templates.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        </> : <p className="break-words text-sm">Sender: {message?.senderValue || sender?.senderValue || "Saved sending account"}</p>}
        <label className="block text-sm font-semibold">Subject<input className="mt-1 w-full rounded-lg border p-3 font-normal" value={subject} maxLength={200} disabled={busy || !!attempt} onChange={event => setSubject(event.target.value)} /></label>
        <label className="block text-sm font-semibold">Message<textarea rows={8} maxLength={20000} className="mt-1 w-full rounded-lg border p-3 font-normal" value={body} disabled={busy || !!attempt} onChange={event => setBody(event.target.value)} /></label>
        {message && <div role="status" className="rounded-lg bg-gray-50 p-3 text-sm"><strong>{emailStatusLabel(message.status)}</strong>{message.failureReason && <p>{message.failureReason}</p>}</div>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {attempt && !busy && (message?.status === "unknown" || !!error) && <p className="text-sm text-amber-800">This attempt is saved. Check the sending account’s Sent folder before composing another email. Refreshing this page will not resend it.</p>}
        {!attempt && <button type="button" disabled={busy || !senderId || !email || !subject.trim() || !body.trim()} onClick={() => void submit()} className="w-full rounded-xl bg-[#1a3a4a] p-3 font-semibold text-white disabled:opacity-40">{busy ? "Sending…" : "Send email"}</button>}
        {attempt && !message && <button type="button" disabled={busy} onClick={() => void submit()} className="w-full rounded-xl border p-3 text-sm">Recover original send attempt</button>}
        {message?.status === "unknown" && <label className="flex gap-2 text-sm"><input type="checkbox" checked={checkedGmail} onChange={event => setCheckedGmail(event.target.checked)} />I checked Gmail’s Sent folder and know whether this email was sent.</label>}
        {(message?.status === "failed" || message?.status === "sent" || (message?.status === "unknown" && checkedGmail)) && <button type="button" disabled={busy} onClick={newMessage} className="w-full rounded-xl border p-3 font-semibold">Compose a new email</button>}
      </div>
    </BottomSheet>
  </>;
}
