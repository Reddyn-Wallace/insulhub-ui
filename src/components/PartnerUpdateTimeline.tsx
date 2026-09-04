"use client";
import { useEffect } from "react";
import { noteDate, type PartnerNoteFeed } from "@/lib/partner/note-updates";

export default function PartnerUpdateTimeline({ jobId, feed }: { jobId: string; feed: PartnerNoteFeed }) {
  useEffect(() => {
    if (!feed.latestSequence || feed.latestSequence <= feed.readSequence) return;
    // A client effect runs on opening the page, not during Next.js prefetch.
    // Acknowledge only the sequence actually rendered, never a newer arrival.
    const markRead=()=>{if(document.visibilityState!=="visible")return;void fetch(`/api/partner/jobs/${jobId}/updates`,{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({seenSequence:feed.latestSequence})}).catch(()=>{});};
    markRead();document.addEventListener("visibilitychange",markRead);return()=>document.removeEventListener("visibilitychange",markRead);
  }, [jobId, feed.latestSequence, feed.readSequence]);
  if (!feed.updates.length) return null;
  return <section aria-labelledby="partner-updates-heading" className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <h2 id="partner-updates-heading" className="text-base font-bold text-[#1a3a4a]">Updates</h2>
    <ol className="mt-4 space-y-5 border-l border-slate-200 pl-5">{[...feed.updates].sort((a,b)=>b.sequence-a.sequence).map(update=><li key={update.sequence} className="relative"><span aria-hidden="true" className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-[#e85d04] ring-4 ring-white"/><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">{update.description}</p><p className="mt-1.5 text-xs text-slate-500">{update.authorName} · <time dateTime={update.createdAt}>{noteDate(update.createdAt)}</time></p></li>)}</ol>
  </section>;
}
