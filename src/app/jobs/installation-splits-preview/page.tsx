"use client";

import { useEffect, useState } from 'react';
import { calendarRows, completeVisit, demoJobs, finaliseChecksheet, rescheduleVisit, usageRows, weekOf, type SplitJob } from '@/lib/installation-splits/model';

const KEY='insulhub-installation-splits-trial-v1';
const money=(n:number)=>new Intl.NumberFormat('en-NZ',{style:'currency',currency:'NZD',maximumFractionDigits:0}).format(n);
const num=(n:number|null)=>n===null?'Not recorded':new Intl.NumberFormat('en-NZ',{maximumFractionDigits:2}).format(n);
const dateLabel=(s:string|null)=>s?new Date(`${s}T12:00:00Z`).toLocaleDateString('en-NZ',{day:'numeric',month:'short',timeZone:'UTC'}):'Unscheduled';
const input='mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm';
const button='rounded-lg bg-[#e85d04] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40';
const secondary='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700';

export default function InstallationSplitsPreview() {
 const [jobs,setJobs]=useState<SplitJob[]>(demoJobs);
 const [selected,setSelected]=useState('demo-101');
 const [tab,setTab]=useState<'visits'|'calendar'|'usage'>('visits');
 const [percent,setPercent]=useState('60');
 const [returnDate,setReturnDate]=useState('2026-11-10');
 const [moveDate,setMoveDate]=useState('');
 const [bags,setBags]=useState('32');
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [ready,setReady]=useState(false);
 const [week,setWeek]=useState('all');
 const [resetting,setResetting]=useState(false);
 useEffect(()=>{
  try {const saved=localStorage.getItem(KEY);if(saved){const parsed=JSON.parse(saved);if(!Array.isArray(parsed)||parsed.length!==2||!parsed.every(j=>j && ['demo-101','demo-102'].includes(j.id)&&Array.isArray(j.visits)&&Array.isArray(j.history)&&j.checksheet))throw Error();setJobs(parsed);}}
  catch {setError('Saved trial data could not be loaded. Fresh examples are shown.');}
  setReady(true);
 },[]);
 const job=jobs.find(j=>j.id===selected)!;
 const pending=job.visits.find(v=>v.state==='planned');
 const completed=job.visits.filter(v=>v.state==='completed').reduce((n,v)=>n+v.percent,0);
 const allCalendar=jobs.flatMap(calendarRows);
 const allUsage=jobs.flatMap(usageRows);
 const weeks=Array.from(new Set(allCalendar.flatMap(v=>v.date?[weekOf(v.date)]:[]))).sort();
 const shownUsage=allUsage.filter(v=>week==='all'||(v.date&&weekOf(v.date)===week));
 function persist(next:SplitJob[]) {
  setJobs(next);
  try {localStorage.setItem(KEY,JSON.stringify(next));}catch{setError('Your changes work for this session, but this browser could not save them.');}
 }
 function change(fn:(j:SplitJob)=>SplitJob,message:string) {
  setError('');setNotice('');
  try {const next=fn(job);persist(jobs.map(j=>j.id===job.id?next:j));setNotice(message);setPercent(String(next.visits.find(v=>v.state==='planned')?.percent??''));setMoveDate('');}catch(e){setError(e instanceof Error?e.message:'Could not update the trial.');}
 }
 return <main className="mx-auto max-w-7xl px-4 py-6 text-slate-800 sm:px-6">
  <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
   <p><strong>Interactive trial · fictional jobs only.</strong> Changes stay in this browser. Neither live database is updated.</p>
   <button className={secondary} onClick={()=>setResetting(true)}>Reset examples</button>
  </div>
  {resetting&&<div role="alert" className="mb-4 rounded-xl border bg-white p-4"><p className="mb-3">Discard all trial changes and restore the two examples?</p><button className={button} onClick={()=>{persist(demoJobs());setSelected('demo-101');setPercent('60');setReturnDate('2026-11-10');setWeek('all');setNotice('Examples reset.');setError('');setResetting(false);}}>Confirm reset</button> <button className={secondary} onClick={()=>setResetting(false)}>Keep changes</button></div>}
  <div className="mb-6"><p className="text-xs font-bold uppercase tracking-widest text-[#e85d04]">Installation planning</p><h1 className="mt-1 text-2xl font-bold sm:text-3xl">One job. More than one visit.</h1><p className="mt-2 max-w-3xl text-sm text-slate-600">Record what was finished, schedule the remainder and see each week’s share. Start with DEMO-101: record 60%, then finish the remaining 40% and enter 32 bags on the final checksheet.</p></div>
  <div className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-slate-200/70 p-1" role="tablist" aria-label="Trial views">
   {(['visits','calendar','usage'] as const).map(t=><button key={t} role="tab" aria-selected={tab===t} className={`flex-1 whitespace-nowrap rounded-lg px-2 py-3 text-xs font-semibold sm:px-4 sm:text-sm ${tab===t?'bg-white text-[#1a3a4a] shadow-sm':'text-slate-600'}`} onClick={()=>setTab(t)}>{t==='visits'?'Job & visits':t==='calendar'?'Weekly calendar':'Usage report'}</button>)}
  </div>
  {error&&<p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  {notice&&<p role="status" className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
  {tab==='visits'&&<div className="grid gap-5 lg:grid-cols-[260px_1fr]">
   <aside className="space-y-3">{jobs.map(j=><button key={j.id} onClick={()=>{setSelected(j.id);setPercent(String(j.visits.find(v=>v.state==='planned')?.percent??''));setError('');setNotice('');}} className={`w-full rounded-xl border p-4 text-left ${selected===j.id?'border-[#e85d04] bg-orange-50':'border-slate-200 bg-white'}`}><span className="text-xs font-bold text-[#e85d04]">{j.number}</span><span className="mt-1 block text-sm font-semibold">{j.customer}</span><span className="mt-2 block text-xs text-slate-600">{j.checksheet.complete?'Installed · final checksheet':j.visits.some(v=>v.state==='completed')?'Partially complete · not installed':'Scheduled · not installed'}</span></button>)}</aside>
   <section className="space-y-5">
    <div className="rounded-xl border border-slate-200 bg-white p-5">
     <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">{job.number}</h2><p className="text-sm text-slate-500">{job.customer}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{job.checksheet.complete?'Installed':completed===100?'Work finished · checksheet pending':completed>0?'Partially complete · not installed':'Not installed'}</span></div>
     <div className="my-5 grid grid-cols-2 gap-4 sm:grid-cols-4">{[['Quoted area',`${num(job.area)} m²`],['Installation value',money(job.value)],['Quoted bags',num(job.budgetBags)],['Work completed',`${num(completed)}%`]].map(([label,value])=><div key={label}><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-xl font-bold">{value}</div></div>)}</div>
     <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-emerald-500" style={{width:`${completed}%`}}/></div>
     <p className="mt-2 text-xs text-slate-500">Example installation value excludes GST. Area and value are allocated by percentage.</p>
    </div>
    <div className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="mb-4 font-bold">Installation visits</h2><div className="space-y-3">{calendarRows(job).map((v,i)=><div key={v.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4"><div><p className="font-semibold">Visit {i+1} · {dateLabel(v.date)}</p><p className="mt-1 text-xs text-slate-500">{num(v.area)} m² · {money(v.value)} allocated</p></div><div className="text-right"><p className="text-lg font-bold">{v.percent}%</p><span className={`text-xs font-semibold ${v.state==='completed'?'text-emerald-700':'text-amber-700'}`}>{v.state==='completed'?'Completed work':v.date?'Planned return / visit':'Needs scheduling'}</span></div></div>)}</div></div>
    {pending&&<div className="rounded-xl border border-slate-200 bg-white p-5">
     <h2 className="font-bold">Record progress on {dateLabel(pending.date)}</h2><p className="mt-1 text-sm text-slate-600">{num(completed)}% already completed. This visit has {pending.percent}% remaining. Enter a percentage of the <strong>whole job</strong>.</p>
     <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();change(j=>completeVisit(j,pending.id,Number(percent),returnDate||null),'Progress recorded. Completed work is now included in the usage report.');}}>
      <label className="text-sm font-medium">Completed this visit (%)<input className={input} type="number" min="0.01" max={pending.percent} step="0.01" required value={percent} onChange={e=>setPercent(e.target.value)}/></label>
      <label className="text-sm font-medium">Return date (optional)<input className={input} type="date" min={pending.date||undefined} disabled={Number(percent)>=pending.percent} value={returnDate} onChange={e=>setReturnDate(e.target.value)}/></label>
      <p className="text-sm text-slate-600 sm:col-span-2">{num(Math.max(0,pending.percent-(Number(percent)||0)))}% will remain. Leave the return date blank to keep it in the unscheduled queue.</p>
      <button className={button} disabled={!ready||!pending.date}>Record completed work</button>
     </form>
     <form className="mt-5 border-t border-slate-100 pt-4" onSubmit={e=>{e.preventDefault();change(j=>rescheduleVisit(j,pending.id,moveDate||null),'Remaining work rescheduled. Completed visits have not moved.');}}><label className="text-sm font-medium">Move remaining visit / set its date<input className={input} type="date" value={moveDate} onChange={e=>setMoveDate(e.target.value)}/></label><div className="mt-3 flex flex-wrap items-center gap-3"><button className={secondary} disabled={!ready}>Save remaining visit date</button><p className="text-xs text-slate-500">Blank means unscheduled.</p></div></form>
    </div>}
    <div className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Final checksheet simulator</h2><p className="mt-1 text-sm text-slate-600">In the connected version, this comes from the existing checksheet. Here you can try the recalculation. Finish all visit work first.</p><form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();change(j=>finaliseChecksheet(j,Number(bags)),'Final actual total saved. Historical weekly estimates have been recalculated.');}}><label className="text-sm font-medium">Final actual bags<input className={input} type="number" min="0" step="0.01" required value={bags} onChange={e=>setBags(e.target.value)}/></label><button className={button} disabled={!ready||!!pending}>{job.checksheet.complete?'Revise final total':'Complete final checksheet'}</button></form>{job.checksheet.complete&&<p className="mt-3 text-sm font-semibold text-emerald-700">Final actual total: {num(job.checksheet.actualBags)} bags. Visit amounts remain allocated estimates.</p>}</div>
    {job.history.length>0&&<div className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="mb-3 font-bold">Change history</h2><ol className="space-y-2 text-sm text-slate-600">{job.history.map((line,i)=><li key={i}>{line}</li>)}</ol></div>}
   </section>
  </div>}
  {tab==='calendar'&&<section className="space-y-4"><div><h2 className="text-xl font-bold">Work by week</h2><p className="mt-1 text-sm text-slate-600">Completed work stays in its original week. Only the remaining planned allocation moves when you reschedule.</p></div>
   {allCalendar.some(v=>!v.date)&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-bold text-amber-900">Unscheduled remaining work</h3>{allCalendar.filter(v=>!v.date).map(v=><p key={v.id} className="mt-2 text-sm">{v.number} · {v.percent}% · {num(v.area)} m² · {money(v.value)}</p>)}</div>}
   <div className="grid gap-4 lg:grid-cols-2">{weeks.map(w=>{const visits=allCalendar.filter(v=>v.date&&weekOf(v.date)===w);const done=visits.filter(v=>v.state==='completed');const planned=visits.filter(v=>v.state==='planned');return <div key={w} className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="bg-[#1a3a4a] p-5 text-white"><h3 className="font-bold">Week of {dateLabel(w)}</h3><div className="mt-4 grid grid-cols-2 gap-4"><div><p className="text-xs text-white/70">Completed allocation</p><p className="mt-1 text-xl font-bold">{money(done.reduce((n,v)=>n+v.value,0))}</p><p className="text-sm">{num(done.reduce((n,v)=>n+v.area,0))} m²</p></div><div><p className="text-xs text-white/70">Planned allocation</p><p className="mt-1 text-xl font-bold">{money(planned.reduce((n,v)=>n+v.value,0))}</p><p className="text-sm">{num(planned.reduce((n,v)=>n+v.area,0))} m²</p></div></div></div><div className="divide-y divide-slate-100">{visits.sort((a,b)=>(a.date||'').localeCompare(b.date||'')).map(v=><div className="flex justify-between gap-3 p-4 text-sm" key={v.id}><div><p className="font-semibold">{dateLabel(v.date)} · {v.number}</p><p className="mt-1 text-slate-500">{num(v.area)} m² · {money(v.value)}</p></div><div className="text-right"><p className="font-bold">{v.percent}%</p><p className={v.state==='completed'?'text-emerald-700':'text-amber-700'}>{v.state==='completed'?'Completed':'Planned'}</p></div></div>)}</div></div>;})}</div>
  </section>}
  {tab==='usage'&&<section className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-bold">Usage report · visit allocation trial</h2><p className="mt-1 max-w-2xl text-sm text-slate-600">Includes completed visits even when the parent job is not installed. Planned returns are excluded. This is a trial of the proposed report behaviour.</p></div><label className="text-sm font-medium">Reporting week<select className={input} value={week} onChange={e=>setWeek(e.target.value)}><option value="all">All weeks</option>{weeks.map(w=><option key={w} value={w}>Week of {dateLabel(w)}</option>)}</select></label></div>
   <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"><strong>How to read these numbers:</strong> before the final checksheet, bags = quoted budget × completed percentage. Afterwards, the actual job total is allocated across visits, revising previous weeks. Neither is measured visit usage. Area is also estimated, so bags/m² is not presented as actual efficiency.</div>
   <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[['Completed visits',String(shownUsage.length)],['Allocated budget',num(shownUsage.reduce((n,r)=>n+(r.budget??0),0))],['Reported bags',num(shownUsage.reduce((n,r)=>n+(r.bags??0),0))],['Missing usage',String(shownUsage.filter(r=>r.bags===null).length)]].map(([label,value])=><div className="rounded-xl border border-slate-200 bg-white p-4" key={label}><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>)}</div>
   <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-100 text-xs text-slate-600"><tr>{['Job / visit date','Share','Estimated m²','Budget bags','Reported bags','Basis'].map(h=><th className="px-4 py-3" key={h}>{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{shownUsage.map(r=><tr key={r.id}><td className="px-4 py-4"><div className="font-semibold">{r.number}</div><div className="mt-1 text-xs text-slate-500">{dateLabel(r.date)}</div></td><td className="px-4 py-4">{r.percent}%</td><td className="px-4 py-4">{num(r.area)}</td><td className="px-4 py-4">{num(r.budget)}</td><td className="px-4 py-4 font-bold">{num(r.bags)}</td><td className="px-4 py-4"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${r.basis==='budget-estimate'?'bg-amber-100 text-amber-900':'bg-blue-100 text-blue-900'}`}>{r.basis==='budget-estimate'?'Estimated · quoted budget':r.basis==='recorded'?'Recorded visit usage':r.percent===100?'Final actual total':'Revised · allocated actual total'}</span></td></tr>)}{!shownUsage.length&&<tr><td colSpan={6} className="p-8 text-center text-slate-500">No completed visits in this week. Planned work appears in the calendar.</td></tr>}</tbody></table></div>
   <p className="text-xs text-slate-500">All values are fictional. No dollar material cost is shown: this trial has no bag unit-cost source. Sales won and invoicing remain separate from installation allocations.</p>
  </section>}
 </main>;
}
