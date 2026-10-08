'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import StageTabs from '@/components/StageTabs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {cachedQueue,fetchQueue,invalidateQueue} from '@/lib/dead-followups/queue-cache';
import {needsFollowup,sortQueueItems,waitingLabel} from '@/lib/dead-followups/queue-view';
import {quoteDiscounts} from '@/lib/dead-followups/discounts';
import {displayFollowupNotes} from '@/lib/dead-followups/note-display';
import FollowupActions from '@/components/FollowupActions';
import type { QueueItem, QueueResponse } from '@/lib/dead-followups/types';

const money = (value?: number | null) => value == null ? 'Amount not recorded' : new Intl.NumberFormat('en-NZ',{style:'currency',currency:'NZD',minimumFractionDigits:0,maximumFractionDigits:2}).format(value);
function date(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not recorded';
  return new Date(value).toLocaleDateString('en-NZ',{timeZone:'Pacific/Auckland',day:'numeric',month:'short',year:'numeric'});
}
function age(value: string | null | undefined, now: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Age unknown';
  const days = Math.floor((Date.parse(now)-Date.parse(value))/86400000);
  return days < 0 ? 'Check future date' : `${days} days`;
}
function Detail({item,checkedAt,onBack,onDone,onAccessLost,readOnly}:{item:QueueItem;checkedAt:string;onBack:()=>void;onDone:(notice:string)=>void;onAccessLost:()=>void;readOnly:boolean}) {
  const {job}=item;
  const existingDiscount=quoteDiscounts(job.quote);
  return <section aria-label="Selected quote" className="min-w-0 space-y-5">
    <button type="button" onClick={onBack} className="min-h-11 text-sm font-semibold text-[#1a3a4a] md:hidden">← Back to follow-ups</button>
    <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quote · #{job.jobNumber}</p><h2 className="mt-2 text-2xl font-bold text-[#1a3a4a]">{job.client?.contactDetails?.name || 'Unnamed customer'}</h2><p className="mt-1 text-sm text-slate-500">{[job.client?.contactDetails?.streetAddress,job.client?.contactDetails?.suburb,job.client?.contactDetails?.city].filter(Boolean).join(', ') || 'Address not recorded'}</p></div>
        <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">Dead quote</span>
      </div>
      <div className="my-5 grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
        <div><p className="text-xs text-slate-500">Current quote total · NZD</p><p className="mt-1 text-2xl font-bold text-[#1a3a4a]">{money(job.quote?.c_total)}</p></div>
        <div><p className="text-xs text-slate-500">Quote date and age</p><p className="mt-1 font-semibold text-slate-800">{date(job.quote?.date)}</p><p className="text-sm text-slate-500">{age(job.quote?.date,checkedAt)}</p></div>
      </div>
      {existingDiscount.items.length>0 && <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><strong>Existing discount: {money(existingDiscount.totalCents/100)} excl. GST</strong><ul className="mt-2 space-y-1">{existingDiscount.items.map((extra,i)=><li key={i}>{extra.name}: −{money(extra.cents/100)}</li>)}</ul><p className="mt-2 text-xs">Already included in the quote’s extras.</p></div>}
      <h3 className="text-sm font-semibold text-slate-800">Quoted scope</h3>
      <p className="mt-1 text-sm text-slate-600">{(job.quote?.wall?.SQM ?? 0) > 0 && <span>Wall: {job.quote?.wall?.SQM} m²</span>}{(job.quote?.wall?.SQM ?? 0) > 0 && (job.quote?.ceiling?.SQM ?? 0) > 0 && ' · '}{(job.quote?.ceiling?.SQM ?? 0) > 0 && <span>Ceiling: {job.quote?.ceiling?.SQM} m²</span>}</p>
      {job.quote?.quoteNote && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-600">{job.quote.quoteNote}</p>}
      <div className="mt-5 border-t border-slate-100 pt-4"><h3 className="font-semibold text-[#1a3a4a]">Job notes</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600">{displayFollowupNotes(job.notes) || 'No notes recorded.'}</p></div>
      <div className="mt-5 border-t border-slate-100 pt-4"><h3 className="font-semibold text-[#1a3a4a]">Follow-up history</h3>{item.controls?.state.offers.length?<ul className="mt-2 space-y-2">{item.controls.state.offers.map(offer=><li key={offer.number} className="text-sm text-slate-600">{offer.number===1?'First':'Second'} offer · {money(offer.discountCents/100)} discount · {offer.channel.toUpperCase()} · {date(offer.sentAt)}</li>)}</ul>:<p className="mt-2 text-sm text-slate-500">No follow-up offers recorded.</p>}</div>
      <Link className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-[#1a3a4a] underline underline-offset-4" href={`/jobs/${encodeURIComponent(job._id)}?returnTo=${encodeURIComponent('/jobs/follow-ups?stage=QUOTE')}`}>Open full quote and communications →</Link>
    </div>
    <FollowupActions item={item} readOnly={readOnly} onDone={onDone} onAccessLost={onAccessLost}/>

  </section>;
}
export default function DeadFollowupsPage() {
  const router=useRouter();
  const [data,setData]=useState<QueueResponse|null>(null);
  const [generation,setGeneration]=useState(0);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<string|null>(null);
  const [search,setSearch]=useState('');
  const [notice,setNotice]=useState('');
  const controller=useRef<AbortController|null>(null);
  const load=useCallback(async(force=false)=>{
    controller.current?.abort();const request=new AbortController();controller.current=request;
    setLoading(true);setError('');
    const token=localStorage.getItem('token')||'';
    if(force)invalidateQueue(token);
    const cached=cachedQueue(token);if(cached)setData(cached);
    try {
      const payload=await fetchQueue(token);
      if(!request.signal.aborted){setData(payload);setGeneration(value=>value+1);setSelected(current=>payload.items.some((item:QueueItem)=>item.job._id===current&&needsFollowup(item,payload.checkedAt))?current:null);}
    }catch(cause){if(!request.signal.aborted){if(cause&&typeof cause==='object'&&'status' in cause&&[401,403].includes(Number(cause.status))){setData(null);setSelected(null);}setError(cause instanceof Error?cause.message:'Could not load quotes.');}}
    finally{if(!request.signal.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{void load();return()=>controller.current?.abort();},[load]);
  const available=useMemo(()=>(data?.items||[]).filter(row=>needsFollowup(row,data!.checkedAt)),[data]);
  const sorted=useMemo(()=>sortQueueItems(available),[available]);
  const items=sorted.filter(item=>[item.job.client?.contactDetails?.name,item.job.client?.contactDetails?.streetAddress,item.job.jobNumber].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  const item=data?.items.find(item=>item.job._id===selected);
  return <><StageTabs activeStage="QUOTE" subTab="FOLLOW_UPS" counts={data?.quoteCounts} followupCount={data?available.length:null} onSubTabChange={tab=>router.push(`/jobs?stage=QUOTE&subTab=${tab}`)}/><main className="min-h-screen bg-[#f5f7f8] px-4 py-6 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-7xl">
      <div className="mt-5 flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#e85d04]">Quotes</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-[#1a3a4a]">Follow-ups</h1><p className="mt-2 text-sm text-slate-600">Review the quote. Understand the history. Plan the next conversation.</p></div></div>
      {data?.preview && <div className="my-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-950"><span>Interactive preview · Sample quotes · Sends are simulated</span><button type="button" className="min-h-11 font-semibold underline" onClick={async()=>{await fetch('/api/preview/reset',{method:'POST'});invalidateQueue(localStorage.getItem('token')||'');setNotice('');setSelected(null);void load();}}>Reset sample data</button></div>}
      {data?.readOnly && <p className="my-5 text-sm text-slate-500">Changes are disabled in this view.</p>}
      {notice && <p role="status" className="my-4 rounded-xl bg-teal-50 p-4 text-sm text-teal-900">{notice}</p>}
      {error && <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error} {data && 'Showing the last loaded quotes; they may be out of date.'} <button onClick={()=>void load(true)} className="min-h-11 px-2 font-semibold underline">Retry</button></div>}
      {loading && !data && <p role="status" className="py-12 text-center text-slate-500">Loading Dead quotes…</p>}
      {data && <>
        <div className="grid items-start gap-6 md:grid-cols-[minmax(260px,0.85fr)_minmax(0,1.65fr)]">
          <section aria-label="Dead quote queue" className={`${item?'hidden md:block':''} overflow-hidden rounded-2xl border border-slate-200 bg-white`}>
            <div className="border-b border-slate-100 p-3"><label htmlFor="followup-search" className="sr-only">Search Dead quotes</label><input id="followup-search" type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search customer, address or quote…" className="min-h-11 w-full rounded-xl bg-slate-50 px-3 text-sm outline-none focus:ring-2 focus:ring-orange-400"/></div>
            {!items.length?<p className="p-8 text-center text-sm text-slate-500">{search?'No quotes match your search.':'No quotes need following up right now.'}</p>:<ul className="divide-y divide-slate-100">{items.map(row=><li key={row.job._id}><button type="button" aria-pressed={selected===row.job._id} onClick={()=>setSelected(row.job._id)} className={`w-full border-l-[3px] p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-orange-400 ${selected===row.job._id?'border-[#e85d04] bg-orange-50/50':'border-transparent hover:bg-slate-50'}`}><div className="flex items-start justify-between gap-3"><span className="font-semibold text-[#1a3a4a]">{row.job.client?.contactDetails?.name || 'Unnamed customer'}</span><span className="shrink-0 text-xs text-slate-400">#{row.job.jobNumber}</span></div>{quoteDiscounts(row.job.quote).items.length>0&&<span className="mt-2 inline-block rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">Already discounted</span>}<p className="mt-1 truncate text-xs text-slate-500">{row.job.client?.contactDetails?.streetAddress || 'Address not recorded'}</p><div className="mt-3 flex flex-wrap justify-between gap-2 text-xs"><span className="font-semibold text-slate-700">{money(row.job.quote?.c_total)}</span></div><p className="mt-2 text-xs text-slate-500">{(row.controls?.state.offers.length||0)===0?'First follow-up':'Second follow-up'}</p>{waitingLabel(row,data.checkedAt)&&<p className="mt-1 text-xs font-semibold text-slate-600">{waitingLabel(row,data.checkedAt)}</p>}{row.notePending&&<p className="mt-1 text-xs font-medium text-amber-800">Job note pending</p>}</button></li>)}</ul>}
          </section>
          {item?<Detail key={`${item.job._id}:${generation}`} item={item} checkedAt={data.checkedAt} onBack={()=>setSelected(null)} onDone={message=>{setNotice(message);setSelected(null);invalidateQueue(localStorage.getItem('token')||'');window.scrollTo(0,0);void load();}} onAccessLost={()=>{invalidateQueue(localStorage.getItem('token')||'');setData(null);setSelected(null);setError('Sign in again to view quotes.');}} readOnly={data.readOnly || loading || Boolean(error)}/>:<div className="hidden rounded-2xl border border-dashed border-slate-300 p-12 text-center md:block"><h2 className="font-semibold text-[#1a3a4a]">Select a quote to review</h2><p className="mt-2 text-sm leading-relaxed text-slate-500">View its scope, price, notes and possible Dead date here.</p></div>}
        </div></>}
    </div>
  </main></>;
}
