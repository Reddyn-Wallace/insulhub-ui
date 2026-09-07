"use client";
import { useId, useState } from "react";
import EmailPreview from "./EmailPreview";

export type JobCommunicationRecord = {
  id: string; source: string; channel: string; status: string;
  renderedSubject?: string; renderedBody?: string; renderedHtml?: string;
  senderLabel?: string; senderName?: string; senderValue?: string; actorName?: string;
  destination: string; templateTitle?: string; campaignName?: string;
  sentAt?: string | null; failureReason?: string;
};
function timestamp(value?: string | null) {
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}
function dateLabel(value?: string | null) {
  return timestamp(value) ? new Date(value!).toLocaleString("en-NZ", {
    timeZone: "Pacific/Auckland", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  }) : "Time not recorded";
}
function statusLabel(message: JobCommunicationRecord) {
  if (message.source === "job") return "Opened in app";
  if (message.source === "crm_email" && message.status === "sent") return "Accepted by Gmail";
  return ({ sending: "Sending", accepted: "Pending", sent: "Sent", delivered: "Delivered", failed: "Failed", unknown: "Send not confirmed", skipped: "Not sent" } as Record<string, string>)[message.status] || message.status;
}
function ChannelIcon({ channel }: { channel: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5" aria-hidden="true">
    {channel === "email" ? <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></> : <><path d="M21 11a8 8 0 0 1-8 8H6l-3 3V11a9 9 0 0 1 18 0Z"/><path d="M7 9h10M7 13h6"/></>}
  </svg>;
}
function MessageCard({ message }: { message: JobCommunicationRecord }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const title = message.channel === "email" ? message.renderedSubject || message.templateTitle || "Email" : message.renderedBody || "SMS";
  const manual = message.source === "job";
  const status = statusLabel(message);
  const colour = message.status === "failed" ? "bg-rose-50 text-rose-700" : ["sent", "delivered"].includes(message.status) ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600";
  return <li className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 p-3 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-orange-500 sm:p-4">
      <span className={`mt-0.5 shrink-0 rounded-xl p-2 ${message.channel === "email" ? "bg-orange-50 text-orange-700" : "bg-teal-50 text-teal-700"}`}><ChannelIcon channel={message.channel}/></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-1 block truncate text-xs text-slate-500">{message.channel === "email" ? "Email" : "SMS"} to {message.destination}</span>
        <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
          <span>{dateLabel(message.sentAt)}</span>
          {message.actorName && <span>· {message.actorName}</span>}
          {message.source === "campaign" && <span>· {message.campaignName || "Campaign"}</span>}
          <span role="status" className={`rounded-full px-2 py-0.5 font-semibold ${colour}`}>{status}</span>
        </span>
      </span>
      <span className={`mt-1 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true">⌄</span>
    </button>
    {open && <div id={panelId} className="border-t border-slate-100 px-3 pb-4 pt-3 sm:px-4">
      <dl className="mb-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <dt className="text-slate-500">To</dt><dd className="break-words text-slate-800">{message.destination}</dd>
        {!manual && <><dt className="text-slate-500">From</dt><dd className="break-words text-slate-800">{message.senderName || message.senderLabel || "Not recorded"}{message.senderValue && <span className="block text-slate-500">{message.senderValue}</span>}</dd>
          <dt className="text-slate-500">Staff member</dt><dd className="text-slate-800">{message.actorName || "Not recorded"}</dd></>}
        <dt className="text-slate-500">Recorded</dt><dd className="text-slate-800">{dateLabel(message.sentAt)} NZ time</dd>
      </dl>
      {message.channel === "email" && message.renderedHtml
        ? <EmailPreview html={message.renderedHtml}/>
        : <div className={`whitespace-pre-wrap break-words rounded-xl p-4 text-sm leading-relaxed text-slate-800 ${message.channel === "sms" ? "bg-[#edf5f5]" : "bg-slate-50"}`}>{message.renderedBody || "No message body was saved."}</div>}
      {message.source === "campaign" && !message.senderValue && <p className="mt-3 text-xs text-slate-500">Sending {message.channel === "email" ? "address" : "number"} wasn’t saved for this campaign.</p>}
      {message.failureReason && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{message.failureReason}</p>}
      {message.channel === "email" && !manual && <p className="mt-3 text-xs text-slate-500">Delivery and read receipts are not tracked.</p>}
      {message.source === "crm_sms" && message.status === "accepted" && <p className="mt-3 text-xs text-slate-500">Waiting for the phone to send. Status updates automatically while this job is open.</p>}
      {message.status === "unknown" && <p className="mt-3 text-xs text-slate-500">The send could not be confirmed. Check the sending account before sending another message.</p>}
    </div>}
  </li>;
}
export default function JobCommunications({ messages, loading = false, error = "", onRetry }: {
  messages: JobCommunicationRecord[]; loading?: boolean; error?: string; onRetry?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const searchId = useId();
  const listId = useId();
  const sent = messages.filter(message => ["crm_sms", "crm_email", "campaign"].includes(message.source))
    .sort((a, b) => timestamp(b.sentAt) - timestamp(a.sentAt));
  const matches = (message: JobCommunicationRecord) => [message.renderedSubject, message.renderedBody, message.destination, message.senderName, message.senderValue, message.actorName, message.templateTitle, message.campaignName]
    .filter(Boolean).join(" ").toLowerCase().includes(search.trim().toLowerCase());
  const visible = expanded ? sent.filter(matches) : sent.slice(0, 1);
  const manual = messages.filter(message => message.source === "job" && matches(message)).sort((a, b) => timestamp(b.sentAt) - timestamp(a.sentAt));
  return <section aria-label="Job communications" aria-busy={loading} className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <header className="px-4 py-3 sm:px-5">
      <div className="flex items-center gap-2"><h2 className="text-base font-bold text-[#1a3a4a]">Communications</h2>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{loading && !messages.length ? "Loading…" : sent.length}</span>
      </div>
    </header>
    {error && <div role="alert" className="mx-3 mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error} {onRetry && <button type="button" onClick={onRetry} className="font-semibold underline">Try again</button>}</div>}
    <div id={listId} className="space-y-3 border-t border-slate-100 bg-slate-50/60 p-3 sm:p-4">
      {expanded && <><label htmlFor={searchId} className="sr-only">Search communications</label>
      <input id={searchId} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search messages…" className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-400"/></>}
      {loading && !messages.length ? <p className="py-8 text-center text-sm text-slate-500">Loading communications…</p>
        : visible.length ? <ul aria-label="CRM-sent messages" className="space-y-3">{visible.map(message => <MessageCard key={message.id} message={message}/>)}</ul>
        : !error && <p className="py-8 text-center text-sm text-slate-500">{sent.length ? "No messages match your search." : "No CRM messages recorded yet."}</p>}
      {expanded && manual.length > 0 && <details className="rounded-xl border border-slate-200 bg-white p-3 text-sm"><summary className="cursor-pointer font-medium text-slate-600">Opened in another app · {manual.length}</summary><p className="my-3 text-xs text-slate-500">These records show a draft was opened in your email or SMS app. They do not confirm it was sent.</p><ul aria-label="Manual app history" className="space-y-2">{manual.map(message => <MessageCard key={message.id} message={message}/>)}</ul></details>}
      {(sent.length > 1 || messages.some(message => message.source === "job")) && <button type="button" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)} className="w-full rounded-lg py-2 text-sm font-semibold text-[#1a3a4a]">{expanded ? "Show latest only" : "Show all communications"}</button>}
    </div>
  </section>;
}
