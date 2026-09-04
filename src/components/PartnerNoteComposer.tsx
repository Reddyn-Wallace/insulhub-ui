"use client";
import { useRef, useState } from "react";

export default function PartnerNoteComposer({ partnerName, onInternalSave, onPartnerSave, onDone }: {
  partnerName?: string; onInternalSave: (text: string) => Promise<boolean>;
  onPartnerSave: (text: string, requestKey: string) => Promise<void>; onDone: () => void;
}) {
  const [audience, setAudience] = useState<"internal" | "partner">("internal");
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const requestKey = useRef(crypto.randomUUID());
  const shared = audience === "partner" && Boolean(partnerName);
  async function submit() {
    if (busy || !text.trim()) return;
    setBusy(true); setError("");
    try {
      if (shared) await onPartnerSave(text.trim(), requestKey.current);
      else if (!await onInternalSave(text.trim())) throw Error("The note could not be saved. Your text is still here; try again.");
      onDone();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The note could not be saved."); }
    finally { setBusy(false); }
  }
  return <div>
    {partnerName ? <div className="mb-3 inline-flex rounded-lg bg-slate-100 p-1" role="group" aria-label="Note audience">
      {([['internal','Internal'],['partner','Share with partner']] as const).map(([value,label])=><button key={value} type="button" disabled={busy} aria-pressed={audience===value} onClick={()=>{setAudience(value);setError("");}} className={`min-h-10 rounded-md px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e85d04] ${audience===value?'bg-white text-[#1a3a4a] shadow-sm':'text-slate-500 hover:text-slate-800'}`}>{label}</button>)}
    </div> : null}
    <p id="note-audience-help" className="mb-3 text-xs text-slate-500">{shared ? `Visible to ${partnerName}` : "Only visible to your InsulHub team"}</p>
    <label htmlFor="job-note-text" className="sr-only">Note</label>
    <textarea id="job-note-text" aria-describedby="note-audience-help" value={text} disabled={busy} maxLength={shared?1000:10000} onChange={event=>{setText(event.target.value);requestKey.current=crypto.randomUUID();}} placeholder={shared?"Share a progress update…":"Type your note…"} rows={5} className="mb-2 w-full resize-y rounded-xl border border-gray-200 px-3 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04]" />
    {shared?<p className="mb-3 text-right text-xs text-slate-400">{text.length}/1,000</p>:null}
    {error?<p role="alert" className="mb-3 text-sm text-red-700">{error}</p>:null}
    <button type="button" onClick={()=>void submit()} disabled={busy||!text.trim()||(shared&&text.length>1000)} className="min-h-11 w-full rounded-xl bg-[#1a3a4a] px-4 py-3 font-semibold text-white disabled:opacity-50">{busy?"Saving…":shared?"Post update":"Add note"}</button>
  </div>;
}
