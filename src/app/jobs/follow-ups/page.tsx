'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import FollowupSender from '@/components/FollowupSender';
import FollowupControls from '@/components/FollowupControls';
import type { QueueItem, QueueResponse, ControlRecord } from '@/lib/dead-followups/types';

const money = (value?: number | null) => value == null ? 'Amount not recorded' : new Intl.NumberFormat('en-NZ',{style:'currency',currency:'NZD',maximumFractionDigits:0}).format(value);
function date(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not recorded';
  return new Date(value).toLocaleDateString('en-NZ',{timeZone:'Pacific/Auckland',day:'numeric',month:'short',year:'numeric'});
}
function age(value: string | null | undefined, now: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Age unknown';
  const days = Math.floor((Date.parse(now)-Date.parse(value))/86400000);
  return days < 0 ? 'Check future date' : `${days} days`;
}
function Detail({item,checkedAt,onBack,onSkip,onSaved,onAccessLost,readOnly}:{item:QueueItem;checkedAt:string;onBack:()=>void;onSkip:()=>void;onSaved:(record:ControlRecord)=>void;onAccessLost:()=>void;readOnly:boolean}) {
  const {job,suggestion}=item;
  return <section aria-label="Selected quote" className="min-w-0 space-y-5">
    <button type="button" onClick={onBack} className="min-h-11 text-sm font-semibold text-[#1a3a4a] md:hidden">← Back to quotes</button>
    <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quote · #{job.jobNumber}</p><h2 className="mt-2 text-2xl font-bold text-[#1a3a4a]">{job.client?.contactDetails?.name || 'Unnamed customer'}</h2><p className="mt-1 text-sm text-slate-500">{[job.client?.contactDetails?.streetAddress,job.client?.contactDetails?.suburb,job.client?.contactDetails?.city].filter(Boolean).join(', ') || 'Address not recorded'}</p></div>
        <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">Dead quote</span>
      </div>
      <div className="my-5 grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
        <div><p className="text-xs text-slate-500">Current quote total · NZD</p><p className="mt-1 text-2xl font-bold text-[#1a3a4a]">{money(job.quote?.c_total)}</p></div>
        <div><p className="text-xs text-slate-500">Quote date and age</p><p className="mt-1 font-semibold text-slate-800">{date(job.quote?.date)}</p><p className="text-sm text-slate-500">{age(job.quote?.date,checkedAt)}</p></div>
      </div>
      <h3 className="text-sm font-semibold text-slate-800">Quoted scope</h3>
      <p className="mt-1 text-sm text-slate-600">Wall: {job.quote?.wall?.SQM == null ? 'not recorded' : `${job.quote.wall.SQM} m²`} · Ceiling: {job.quote?.ceiling?.SQM == null ? 'not recorded' : `${job.quote.ceiling.SQM} m²`}</p>
      {job.quote?.quoteNote && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-600">{job.quote.quoteNote}</p>}
      <p className="mt-4 text-sm text-amber-800">Review the quote’s age, scope and pricing before making an offer.</p>
      <Link className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-[#1a3a4a] underline underline-offset-4" href={`/jobs/${encodeURIComponent(job._id)}?returnTo=${encodeURIComponent('/jobs/follow-ups?stage=QUOTE')}`}>Open full quote and communications →</Link>
    </div>
    <button type="button" onClick={onSkip} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-[#1a3a4a]">Skip for now</button>
    {item.controls?.state.deadDate && <div className="rounded-xl bg-teal-50 p-4 text-sm text-teal-950"><strong>Staff-reviewed estimate: {date(item.controls.state.deadDate)}</strong><p className="mt-1">{item.controls.state.dateEvidence}</p><p className="mt-1">{item.eligibility.state==='review'?'Quote changed or history needs review.':item.eligibility.dueAt?`Next eligible date: ${date(item.eligibility.dueAt)}`:item.eligibility.reason}</p></div>}
    {!item.controls?.state.deadDate && <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
      <h3 className="font-semibold text-amber-950">{suggestion ? 'Estimated from a note — not confirmed' : 'Dead entry date unknown'}</h3>
      {suggestion ? <><p className="mt-2 text-sm text-amber-900">Possible Dead date: {date(suggestion.at)} · {age(suggestion.at,checkedAt)} ago</p><blockquote className="mt-3 whitespace-pre-wrap break-words border-l-2 border-amber-300 pl-3 text-sm text-amber-900">{suggestion.evidence}</blockquote><p className="mt-3 text-sm text-amber-900">Earliest first approach if this date is verified: {date(item.earliestFirstApproach)}. Previous offers must also be checked.</p></> : <p className="mt-2 text-sm text-amber-900">No reliable date could be suggested from the notes. The quote date and last edit date are not used as substitutes.</p>}
      <p className="mt-3 text-sm font-medium text-amber-950">{item.eligibility.reason}</p>
    </div>}
    {!item.controls && <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="font-semibold text-[#1a3a4a]">Previous offers not yet reviewed</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">Check the notes and existing communications before deciding whether this is a first or second approach. No recorded discount does not mean no discount was offered.</p>
    </div>}
    {item.controls && <FollowupControls key={`${item.job._id}:${item.controls.revision}:${item.job.updatedAt}`} item={item} readOnly={readOnly} onSaved={onSaved} onAccessLost={onAccessLost}/>}
    {item.sendAvailable && <FollowupSender item={item} onChanged={()=>onSaved(item.controls!)} onAccessLost={onAccessLost} readOnly={readOnly}/>}
    <div className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold text-[#1a3a4a]">Job notes</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600">{job.notes || 'No notes recorded.'}</p></div>
  </section>;
}
export default function DeadFollowupsPage() {
  const [data,setData]=useState<QueueResponse|null>(null);
  const [generation,setGeneration]=useState(0);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<string|null>(null);
  const [search,setSearch]=useState('');
  const [view,setView]=useState('all');
  const [skipped,setSkipped]=useState<string[]>([]);
  const [lastSkipped,setLastSkipped]=useState<string|null>(null);
  const [showSkipped,setShowSkipped]=useState(false);
  const skipKey=useRef<string|null>(null);
  const skipLoaded=useRef(false);
  const controller=useRef<AbortController|null>(null);
  const load=useCallback(async()=>{
    controller.current?.abort();const request=new AbortController();controller.current=request;
    setLoading(true);setError('');
    if(!skipLoaded.current){
      skipLoaded.current=true;
      try{const me=JSON.parse(localStorage.getItem('me') || '{}');if(me._id){skipKey.current=`dead-followups-skipped:${me._id}`;const saved=JSON.parse(sessionStorage.getItem(skipKey.current) || '[]');if(Array.isArray(saved))setSkipped(saved.filter(x=>typeof x==='string'));}}catch{/* Skip remains local to this page if storage is unavailable. */}
    }
    try {
      const response=await fetch('/api/dead-followups',{headers:{'x-access-token':localStorage.getItem('token') || ''},cache:'no-store',signal:request.signal});
      if(response.status===401 || response.status===403){
        if(!request.signal.aborted){setData(null);setSelected(null);}
      }
      if(!response.ok)throw Error(response.status===401?'Sign in again to view Dead quotes.':'The full quote list could not be verified. Please retry.');
      const payload=await response.json();
      if(!Array.isArray(payload.items) || typeof payload.readOnly!=='boolean')throw Error('The quote list could not be verified. Please retry.');
      if(!request.signal.aborted){setData(payload);setGeneration(value=>value+1);setSelected(current=>payload.items.some((item:QueueItem)=>item.job._id===current)?current:null);}
    }catch(cause){if(!request.signal.aborted)setError(cause instanceof Error?cause.message:'Could not load quotes.');}
    finally{if(!request.signal.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{void load();return()=>controller.current?.abort();},[load]);
  function updateSkipped(next:string[]){setSkipped(next);try{if(skipKey.current)sessionStorage.setItem(skipKey.current,JSON.stringify(next));}catch{/* Keep this session's in-memory list. */}}
  function skip(){if(!selected)return;updateSkipped([...new Set([...skipped,selected])]);setLastSkipped(selected);setSelected(null);}
  const inView=(row:QueueItem)=>{
    const snoozed=Boolean(row.controls?.state.snoozedUntil && Date.parse(row.controls.state.snoozedUntil)>Date.parse(data?.checkedAt || ''));
    if(view==='snoozed')return snoozed && row.eligibility.state!=='excluded';
    if(view==='all')return true;
    if(view==='review')return row.eligibility.state==='review'||row.eligibility.state==='attention'||Boolean(row.notePending);
    if(view==='due')return row.eligibility.state==='due' && !snoozed;
    return row.eligibility.state===view;
  };
  const items=(data?.items || []).filter(item=>(showSkipped || !skipped.includes(item.job._id)) && inView(item)).filter(item=>[item.job.client?.contactDetails?.name,item.job.client?.contactDetails?.streetAddress,item.job.jobNumber].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  const item=data?.items.find(item=>item.job._id===selected);
  return <main className="min-h-screen bg-[#f5f7f8] px-4 py-6 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-7xl">
      <Link href="/jobs?stage=QUOTE&subTab=DEAD" className="text-sm font-medium text-slate-500 hover:text-[#1a3a4a]">← Dead quotes</Link>
      <div className="mt-5 flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#e85d04]">Quotes</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-[#1a3a4a]">Follow-ups</h1><p className="mt-2 text-sm text-slate-600">Review the quote. Understand the history. Plan the next conversation.</p></div><button type="button" onClick={()=>void load()} disabled={loading} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-[#1a3a4a] disabled:opacity-50">{loading?'Loading…':'Refresh'}</button></div>
      <div className="my-6 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-600"><strong className="text-[#1a3a4a]">{data?.readOnly===false?'Follow-up preparation.':'Read-only review.'}</strong> Dead quotes only. Staff-reviewed dates remain estimates. {data?.items.some(row=>row.sendEnabled)?' Sending is manual; review each offer before sending.':' Sending is not enabled.'}</div>
      {error && <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error} {data && 'Showing the last loaded quotes; they may be out of date.'} <button onClick={()=>void load()} className="min-h-11 px-2 font-semibold underline">Retry</button></div>}
      {loading && !data && <p role="status" className="py-12 text-center text-slate-500">Loading Dead quotes…</p>}
      {data && <>
        <div className="mb-4 flex flex-wrap gap-2" aria-label="Queue views">{[['all','All Dead quotes'],['due','Due'],['review','Needs review'],['waiting','Waiting'],['snoozed','Snoozed'],['excluded','Excluded'],['complete','Completed']].map(([value,label])=><button type="button" key={value} aria-pressed={view===value} onClick={()=>{setView(value);setSelected(null);}} className={`min-h-11 rounded-full px-4 text-sm font-semibold ${view===value?'bg-[#1a3a4a] text-white':'bg-white text-slate-600'}`}>{label}</button>)}</div>
        {lastSkipped && <p className="mb-3 text-sm text-slate-600">Skipped for this session. <button type="button" onClick={()=>{updateSkipped(skipped.filter(id=>id!==lastSkipped));setLastSkipped(null);}} className="min-h-11 font-semibold underline">Undo skip</button></p>}
        {skipped.length>0 && <button type="button" onClick={()=>setShowSkipped(!showSkipped)} className="mb-3 min-h-11 text-sm font-semibold underline">{showSkipped?'Hide skipped':'Show skipped'} ({skipped.length})</button>}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-[#1a3a4a]">Quotes in this view <span className="ml-2 rounded-full bg-slate-200 px-2.5 py-1 text-xs">{items.length}</span></p><p className="text-xs text-slate-500">Last checked {date(data.checkedAt)} · NZ time</p></div>
        <div className="grid items-start gap-6 md:grid-cols-[minmax(260px,0.85fr)_minmax(0,1.65fr)]">
          <section aria-label="Dead quote queue" className={`${item?'hidden md:block':''} overflow-hidden rounded-2xl border border-slate-200 bg-white`}>
            <div className="border-b border-slate-100 p-3"><label htmlFor="followup-search" className="sr-only">Search Dead quotes</label><input id="followup-search" type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search customer, address or quote…" className="min-h-11 w-full rounded-xl bg-slate-50 px-3 text-sm outline-none focus:ring-2 focus:ring-orange-400"/></div>
            {!items.length?<p className="p-8 text-center text-sm text-slate-500">{data.items.length?'No quotes match this view.':'No Dead quotes found.'}</p>:<ul className="divide-y divide-slate-100">{items.map(row=><li key={row.job._id}><button type="button" aria-pressed={selected===row.job._id} onClick={()=>setSelected(row.job._id)} className={`w-full border-l-[3px] p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-orange-400 ${selected===row.job._id?'border-[#e85d04] bg-orange-50/50':'border-transparent hover:bg-slate-50'}`}><div className="flex items-start justify-between gap-3"><span className="font-semibold text-[#1a3a4a]">{row.job.client?.contactDetails?.name || 'Unnamed customer'}</span><span className="shrink-0 text-xs text-slate-400">#{row.job.jobNumber}</span></div><p className="mt-1 truncate text-xs text-slate-500">{row.job.client?.contactDetails?.streetAddress || 'Address not recorded'}</p><div className="mt-3 flex flex-wrap justify-between gap-2 text-xs"><span className="font-semibold text-slate-700">{money(row.job.quote?.c_total)}</span><span className="text-amber-800">{row.controls?.state.deadDate ? `${age(row.controls.state.deadDate,data.checkedAt)} · staff estimate` : row.suggestion?`${age(row.suggestion.at,data.checkedAt)} · estimated`:'Dead date unknown'}</span></div><p className="mt-2 text-xs text-slate-500">{row.eligibility.approach?`Approach ${row.eligibility.approach} · ${row.eligibility.state}`:row.eligibility.state==='excluded'?'Excluded':row.eligibility.state==='complete'?'Two approaches recorded':'Approach needs review'}</p></button></li>)}</ul>}
          </section>
          {item?<Detail key={`${item.job._id}:${generation}`} item={item} checkedAt={data.checkedAt} onBack={()=>setSelected(null)} onSkip={skip} onSaved={()=>void load()} onAccessLost={()=>{setData(null);setSelected(null);setError('Sign in again to view quotes.');}} readOnly={data.readOnly || loading || Boolean(error)}/>:<div className="hidden rounded-2xl border border-dashed border-slate-300 p-12 text-center md:block"><h2 className="font-semibold text-[#1a3a4a]">Select a quote to review</h2><p className="mt-2 text-sm leading-relaxed text-slate-500">View its scope, price, notes and possible Dead date here.</p></div>}
        </div></>}
    </div>
  </main>;
}
