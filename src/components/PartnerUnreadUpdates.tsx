"use client";
import { useEffect, useState } from "react";
import type { PartnerNoteSummary } from "@/lib/partner/note-updates";
export function usePartnerUnreadUpdates() {
  const [unread,setUnread]=useState<Set<string>>(new Set());
  useEffect(()=>{
    let active=true;
    const refresh=()=>{if(document.visibilityState!=="visible")return;void fetch('/api/partner/updates',{cache:'no-store',credentials:'same-origin'}).then(async response=>{if(!response.ok)throw Error('Unavailable');return response.json();}).then((value:{jobs:PartnerNoteSummary[]})=>{if(active&&Array.isArray(value.jobs))setUnread(new Set(value.jobs.filter(job=>job.latestSequence>job.readSequence).map(job=>job.id)));}).catch(()=>{});};
    refresh();window.addEventListener('pageshow',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{active=false;window.removeEventListener('pageshow',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[]);
  return unread;
}
export default function PartnerUnreadUpdates() {
  return <span className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-[#a84202]"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#e85d04]"/>New update</span>;
}
