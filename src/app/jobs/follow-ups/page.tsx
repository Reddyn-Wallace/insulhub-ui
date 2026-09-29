'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueueItem, QueueResponse } from '@/lib/dead-followups/types';

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
function Detail({item,checkedAt,onBack}:{item:QueueItem;checkedAt:string;onBack:()=>void}) {
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
    <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
      <h3 className="font-semibold text-amber-950">{suggestion ? 'Estimated from a note — not confirmed' : 'Dead entry date unknown'}</h3>
      {suggestion ? <><p className="mt-2 text-sm text-amber-900">Possible Dead date: {date(suggestion.at)} · {age(suggestion.at,checkedAt)} ago</p><blockquote className="mt-3 whitespace-pre-wrap break-words border-l-2 border-amber-300 pl-3 text-sm text-amber-900">{suggestion.evidence}</blockquote><p className="mt-3 text-sm text-amber-900">Earliest first approach if this date is verified: {date(item.earliestFirstApproach)}. Previous offers must also be checked.</p></> : <p className="mt-2 text-sm text-amber-900">No reliable date could be suggested from the notes. The quote date and last edit date are not used as substitutes.</p>}
      <p className="mt-3 text-sm font-medium text-amber-950">{item.eligibility.reason}</p>
    </div>
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="font-semibold text-[#1a3a4a]">Previous offers not yet reviewed</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">Check the notes and existing communications before deciding whether this is a first or second approach. No recorded discount does not mean no discount was offered.</p>
    </div>
    <div className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold text-[#1a3a4a]">Job notes</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600">{job.notes || 'No notes recorded.'}</p></div>
  </section>;
}
export default function DeadFollowupsPage() {
  const [data,setData]=useState<QueueResponse|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<string|null>(null);
  const [search,setSearch]=useState('');
  const controller=useRef<AbortController|null>(null);
  const load=useCallback(async()=>{
    controller.current?.abort();const request=new AbortController();controller.current=request;
    setLoading(true);setError('');
    try {
      const response=await fetch('/api/dead-followups',{headers:{'x-access-token':localStorage.getItem('token') || ''},cache:'no-store',signal:request.signal});
      if(response.status===401 || response.status===403){
        if(!request.signal.aborted){setData(null);setSelected(null);}
      }
      if(!response.ok)throw Error(response.status===401?'Sign in again to view Dead quotes.':'The full quote list could not be verified. Please retry.');
      const payload=await response.json();
      if(!Array.isArray(payload.items) || payload.readOnly!==true)throw Error('The quote list could not be verified. Please retry.');
      if(!request.signal.aborted){setData(payload);setSelected(current=>payload.items.some((item:QueueItem)=>item.job._id===current)?current:null);}
    }catch(cause){if(!request.signal.aborted)setError(cause instanceof Error?cause.message:'Could not load quotes.');}
    finally{if(!request.signal.aborted)setLoading(false);}
  },[]);
  useEffect(()=>{void load();return()=>controller.current?.abort();},[load]);
  const items=(data?.items || []).filter(item=>[item.job.client?.contactDetails?.name,item.job.client?.contactDetails?.streetAddress,item.job.jobNumber].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  const item=data?.items.find(item=>item.job._id===selected);
  return <main className="min-h-screen bg-[#f5f7f8] px-4 py-6 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-7xl">
      <Link href="/jobs?stage=QUOTE&subTab=DEAD" className="text-sm font-medium text-slate-500 hover:text-[#1a3a4a]">← Dead quotes</Link>
      <div className="mt-5 flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#e85d04]">Quotes</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-[#1a3a4a]">Follow-ups</h1><p className="mt-2 text-sm text-slate-600">Review the quote. Understand the history. Plan the next conversation.</p></div><button type="button" onClick={()=>void load()} disabled={loading} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-[#1a3a4a] disabled:opacity-50">{loading?'Loading…':'Refresh'}</button></div>
      <div className="my-6 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-relaxed text-slate-600"><strong className="text-[#1a3a4a]">Read-only review.</strong> Dead quotes only. Dates and previous offers need verification before a due queue can be confirmed. Sending is not enabled.</div>
      {error && <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error} {data && 'Showing the last loaded quotes; they may be out of date.'} <button onClick={()=>void load()} className="min-h-11 px-2 font-semibold underline">Retry</button></div>}
      {loading && !data && <p role="status" className="py-12 text-center text-slate-500">Loading Dead quotes…</p>}
      {data && <><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-[#1a3a4a]">Needs review <span className="ml-2 rounded-full bg-slate-200 px-2.5 py-1 text-xs">{data.items.length}</span></p><p className="text-xs text-slate-500">Last checked {date(data.checkedAt)} · NZ time</p></div>
        <div className="grid items-start gap-6 md:grid-cols-[minmax(260px,0.85fr)_minmax(0,1.65fr)]">
          <section aria-label="Dead quote queue" className={`${item?'hidden md:block':''} overflow-hidden rounded-2xl border border-slate-200 bg-white`}>
            <div className="border-b border-slate-100 p-3"><label htmlFor="followup-search" className="sr-only">Search Dead quotes</label><input id="followup-search" type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search customer, address or quote…" className="min-h-11 w-full rounded-xl bg-slate-50 px-3 text-sm outline-none focus:ring-2 focus:ring-orange-400"/></div>
            {!items.length?<p className="p-8 text-center text-sm text-slate-500">{data.items.length?'No quotes match your search.':'No Dead quotes found.'}</p>:<ul className="divide-y divide-slate-100">{items.map(row=><li key={row.job._id}><button type="button" aria-pressed={selected===row.job._id} onClick={()=>setSelected(row.job._id)} className={`w-full border-l-[3px] p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-orange-400 ${selected===row.job._id?'border-[#e85d04] bg-orange-50/50':'border-transparent hover:bg-slate-50'}`}><div className="flex items-start justify-between gap-3"><span className="font-semibold text-[#1a3a4a]">{row.job.client?.contactDetails?.name || 'Unnamed customer'}</span><span className="shrink-0 text-xs text-slate-400">#{row.job.jobNumber}</span></div><p className="mt-1 truncate text-xs text-slate-500">{row.job.client?.contactDetails?.streetAddress || 'Address not recorded'}</p><div className="mt-3 flex flex-wrap justify-between gap-2 text-xs"><span className="font-semibold text-slate-700">{money(row.job.quote?.c_total)}</span><span className="text-amber-800">{row.suggestion?`${age(row.suggestion.at,data.checkedAt)} · estimated`:'Dead date unknown'}</span></div><p className="mt-2 text-xs text-slate-500">Approach needs review</p></button></li>)}</ul>}
          </section>
          {item?<Detail key={item.job._id} item={item} checkedAt={data.checkedAt} onBack={()=>setSelected(null)}/>:<div className="hidden rounded-2xl border border-dashed border-slate-300 p-12 text-center md:block"><h2 className="font-semibold text-[#1a3a4a]">Select a quote to review</h2><p className="mt-2 text-sm leading-relaxed text-slate-500">View its scope, price, notes and possible Dead date here.</p></div>}
        </div></>}
    </div>
  </main>;
}
