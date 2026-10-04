'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {renderTemplate,type TemplateRecord,type OfferTemplate} from '@/lib/dead-followups/templates';
const field='mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
type Audit={revision:number;actorName:string;createdAt:string;templates:OfferTemplate[]};
export default function FollowupTemplates(){
 const [isPreview,setIsPreview]=useState(false);
 const [record,setRecord]=useState<TemplateRecord|null>(null);const [events,setEvents]=useState<Audit[]>([]);const [canManage,setCanManage]=useState(false);const [busy,setBusy]=useState(false);const [locked,setLocked]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');const active=useRef(false);
 const headers=()=>({'content-type':'application/json','x-access-token':localStorage.getItem('token')||''});
 const load=useCallback(async()=>{
  if(active.current)return;active.current=true;setBusy(true);setError('');
  try{const r=await fetch('/api/dead-followups/templates',{headers:headers(),cache:'no-store'});const json=await r.json();if(!r.ok)throw Error(json.error);setIsPreview(json.preview===true);setRecord(json.record);setEvents(json.events);setCanManage(json.canManage);setLocked(false);setNotice('');}catch(e){setLocked(true);setError(e instanceof Error?e.message:'Templates could not be loaded.');}finally{active.current=false;setBusy(false);}
 },[]);
 useEffect(()=>{void load();},[load]);
 async function save(){if(active.current||locked||!canManage||!record)return;active.current=true;setBusy(true);setError('');setNotice('');let correctable=false;try{const r=await fetch('/api/dead-followups/templates',{method:'PATCH',headers:headers(),body:JSON.stringify({revision:record.revision,templates:record.templates})});const json=await r.json();if(!r.ok){correctable=r.status===400;if(r.status!==400)setLocked(true);throw Error(json.error);}setRecord(json.record);setNotice('Shared templates saved. Existing messages and open drafts are unchanged.');}catch(e){setError(e instanceof Error?e.message:'Save could not be confirmed. Reload before saving again.');if(!correctable)setLocked(true);}finally{active.current=false;setBusy(false);}}
 function change(index:number,key:'body'|'subject',value:string){setRecord(r=>r?{...r,templates:r.templates.map((t,i)=>i===index?{...t,[key]:value}:t)}:r);}
 return <main className="mx-auto max-w-4xl space-y-5 px-4 py-6">
  <Link href="/jobs/settings?section=templates" className="text-sm underline">← Settings templates</Link>
  {isPreview&&<p className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-950">Interactive preview · Sample templates · Changes stay local</p>}
  <h1 className="text-2xl font-semibold text-[#1a3a4a]">Dead quote offer templates</h1>
  <p className="text-sm text-slate-600">Shared starting messages for first and second offers. Administrators can change these defaults; staff can still edit each individual message before sending.</p>
  <p className="text-sm text-slate-600">Use {'{{discount}}'} for the saved NZD dollar amount. Optional fields: {'{{name}}'} and {'{{quoteNumber}}'}. The preview uses Alex, quote 123 and $500.00.</p>
  <button type="button" disabled={busy} onClick={()=>void load()} className="min-h-11 rounded-lg border px-4">Reload saved templates</button>
  {error&&<p role="alert" className="text-sm text-amber-900">{error}</p>}{notice&&<p role="status" className="text-sm text-teal-900">{notice}</p>}
  {record?<form onSubmit={e=>{e.preventDefault();void save();}}>
   <fieldset disabled={busy||locked||!canManage} className="space-y-5">
    {record.templates.map((template,i)=>{const title=(template.approach===1?'First':'Second')+' '+template.channel.toUpperCase();const preview=renderTemplate(template,{discountCents:50000,name:'Alex',quoteNumber:123});return <section key={template.channel+template.approach} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
     <h2 className="font-semibold">{title} offer</h2>
     {template.channel==='email'&&<label className="block text-sm">{title} subject<input maxLength={180} className={field} value={template.subject} onChange={e=>change(i,'subject',e.target.value)}/></label>}
     <label className="block text-sm">{title} message<textarea rows={5} maxLength={template.channel==='sms'?1400:18000} className={field} value={template.body} onChange={e=>change(i,'body',e.target.value)}/></label>
     <div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="font-semibold">Example preview</p>{preview.subject&&<p>{preview.subject}</p>}<p className="whitespace-pre-wrap break-words">{preview.body}</p></div>
    </section>;})}
    <button className="min-h-11 rounded-lg bg-[#1a3a4a] px-4 text-white disabled:opacity-50">Save shared templates</button>
   </fieldset>
   {!canManage&&<p className="mt-3 text-sm text-slate-500">Read-only. Shared defaults require an administrator and enabled follow-up controls.</p>}
   <p className="mt-3 text-xs text-slate-500">Revision {record.revision}{record.actorName?' · '+record.actorName:''}</p>
  </form>:<p role="status">{busy?'Loading templates…':'Templates are unavailable.'}</p>}
  {events.length>0&&<details className="rounded-lg border p-4"><summary>Shared template change history</summary>{events.map(event=><details key={event.revision} className="mt-3 text-sm"><summary>Revision {event.revision} · {event.actorName} · {new Date(event.createdAt).toLocaleString('en-NZ',{timeZone:'Pacific/Auckland'})}</summary>{event.templates.map(t=><div key={t.channel+t.approach} className="my-3 whitespace-pre-wrap break-words"><strong>Approach {t.approach} · {t.channel.toUpperCase()}</strong><p>{t.subject}</p><p>{t.body}</p></div>)}</details>)}</details>}
 </main>;
}
