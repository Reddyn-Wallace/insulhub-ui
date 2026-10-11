'use client';
import {useRef,useState} from 'react';
import {renderTemplate,type OfferTemplate} from '@/lib/dead-followups/templates';
import {followupTemplate,type SendAttempt} from '@/lib/dead-followups/sending';
import type {QueueItem} from '@/lib/dead-followups/types';
type Sender={id:string;label:string;senderValue?:string;signatureHtml?:string};
type Loaded={templates?:OfferTemplate[];templateRevision?:number;enabled:boolean;attempts:(SendAttempt&{canVerify?:boolean})[];contact:{name?:string;email?:string;phoneMobile?:string;phoneSecondary?:string};sms:{senders:Sender[]};email:{senders:Sender[]}};
const field='mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const button='min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50';
export default function FollowupSender({item,onChanged,onAccessLost,readOnly=false}:{item:QueueItem;onChanged:()=>void;onAccessLost?:()=>void;readOnly?:boolean}){
 const [data,setData]=useState<Loaded|null>(null);const [busy,setBusy]=useState(false);const active=useRef(false);const [locked,setLocked]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const [channel,setChannel]=useState<'sms'|'email'>('sms');const [sender,setSender]=useState('');const [confirmed,setConfirmed]=useState(false);
 const cents=item.controls?.state.draftDiscountCents;const template=followupTemplate(item.eligibility.approach||1,cents||0);
 const edited=useRef(false);
 const [body,setBody]=useState(template.body);const [subject,setSubject]=useState(template.subject);const requestId=useRef<string|null>(null);
 const endpoint=`/api/jobs/${item.job._id}/dead-followup/send`;
 const headers=()=>({'content-type':'application/json','x-access-token':localStorage.getItem('token')||''});
 async function load(){if(active.current)return;active.current=true;setBusy(true);setError('');try{const r=await fetch(endpoint,{headers:headers(),cache:'no-store'});if(r.status===401||r.status===403){setData(null);onAccessLost?.();}const json=await r.json();if(!r.ok)throw Error(json.error);setData(json);const next=edited.current?channel:(json.sms.senders.length?'sms':'email');setChannel(next);setSender(json[next].senders.some((s:Sender)=>s.id===sender)?sender:json[next].senders[0]?.id||'');if(!edited.current)applyTemplate(json,next);setLocked(false);setConfirmed(false);}catch{setError('Could not load saved sending status. Refresh before sending.');setLocked(true);}finally{active.current=false;setBusy(false);}}
 function applyTemplate(loaded:Loaded,kind:'sms'|'email'){
  const shared=loaded.templates?.find(t=>t.channel===kind&&t.approach===(item.eligibility.approach||1));
  const rendered=shared?renderTemplate(shared,{discountCents:cents||0,name:loaded.contact.name,quoteNumber:item.job.quote?.quoteNumber||item.job.jobNumber}):template;
  setBody(rendered.body);setSubject(rendered.subject);setConfirmed(false);
 }
 async function action(kind:'send'|'check'|'note'|'verify',attemptId?:string,proof?:{confirmed:boolean;evidence:string}){
  if(active.current||readOnly&&kind==='send')return;active.current=true;setBusy(true);setError('');setNotice('');
  try{
   requestId.current??=crypto.randomUUID();
   const payload=kind==='send'?{action:kind,requestId:requestId.current,revision:item.controls?.revision,jobVersion:item.job.updatedAt,channel,senderId:sender,destination:channel==='sms'?(data?.contact.phoneMobile||data?.contact.phoneSecondary):data?.contact.email,body,subject}:{action:kind,attemptId,...(kind==='verify'?proof:{})};
   const r=await fetch(endpoint,{method:'POST',headers:headers(),body:JSON.stringify(payload)});
   if(r.status===401||r.status===403){setData(null);onAccessLost?.();}
   const json=await r.json();if(!r.ok)throw Error(json.error||'Operation not confirmed.');
   if(!json.attempt)throw Error('Saved status was not returned.');
   setData(current=>current?{...current,attempts:[{...current.attempts.find(a=>a.id===json.attempt.id),...json.attempt},...current.attempts.filter(a=>a.id!==json.attempt.id)]}:current);
   setNotice(json.noteError||(kind==='verify'?'Sent evidence recorded. This action did not send a message.':json.attempt.status==='sent'?'Offer sent. Discount saved in history and job notes.':'Saved sending status updated.'));
   setConfirmed(false);
   if(json.attempt.status==='failed'){requestId.current=null;setLocked(true);}
  }catch(e){setLocked(true);setError(e instanceof Error?e.message:'Could not confirm the operation. Check saved status before sending again.');}
  finally{active.current=false;setBusy(false);}
 }
 const pending=data?.attempts.some(a=>['sending','accepted','unknown'].includes(a.status));
 const alreadySent=data?.attempts.some(a=>a.status==='sent'&&a.approach===(item.eligibility.approach||1));
 const canCompose=data?.enabled&&item.sendEnabled&&item.eligibility.state==='due'&&cents!=null&&!pending&&!alreadySent&&!locked;
 const destination=channel==='sms'?(data?.contact.phoneMobile||data?.contact.phoneSecondary):data?.contact.email;
 return <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5" aria-label="Send follow-up">
  <h3 className="font-semibold text-[#1a3a4a]">Send an individual offer</h3>
  <button type="button" disabled={busy} onClick={()=>void load()} className={button}>Compose or check follow-up</button>
  {item.notePending&&<p className="text-sm text-amber-900">A sent offer still needs its job note saved. Open the saved follow-up to retry the note.</p>}
  {error&&<p role="alert" className="text-sm text-amber-900">{error}</p>}{notice&&<p role="status" className="text-sm text-teal-900">{notice}</p>}
  {data&&<><p className="text-sm text-slate-600">Manual sends only. Unknown or pending sends must be checked before another attempt.</p>
   {data.attempts.map(a=><article key={a.id} className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
    <p className="font-semibold">Approach {a.approach} · NZD ${(a.discountCents/100).toFixed(2)} · {a.status}</p><p>{a.channel.toUpperCase()} to {a.destination}</p>{a.subject&&<p className="font-medium">{a.subject}</p>}{a.sentAt&&<p>Recorded sent: {new Date(a.sentAt).toLocaleString('en-NZ',{timeZone:'Pacific/Auckland'})} · NZ time</p>}{a.verification&&<p>Sent verified by {a.verification.actorName}: {a.verification.evidence}</p>}
    <p className="whitespace-pre-wrap break-words">{a.body}</p>
    {a.failureReason&&<p>{a.failureReason}</p>}
    {a.canVerify&&['sending','accepted','unknown'].includes(a.status)&&<details className="rounded-lg border border-amber-200 p-3">
     <summary className="cursor-pointer font-semibold">Verify from sent evidence</summary>
     <p className="mt-2">Check the original sending account or device. Match the recipient, message, date and discount. Do not use absence from Sent as proof of failure. This records the existing send; it never sends or permits a resend.</p>
     <form onSubmit={e=>{e.preventDefault();const fields=new FormData(e.currentTarget);void action('verify',a.id,{confirmed:fields.get('confirmed')==='on',evidence:String(fields.get('evidence')||'')});}} className="mt-3 space-y-3">
      <label className="block">Where you verified this send<textarea name="evidence" minLength={20} maxLength={2000} required className={field}/></label>
      <label className="flex gap-2"><input type="checkbox" name="confirmed" required/>I found this exact message in the sending account or device as sent.</label>
      <button type="submit" disabled={busy} className={button}>Record verified send</button>
     </form>
    </details>}

    {a.status==='sent'?<><p>Job note: {a.noteStatus==='saved'?'saved':'pending'}</p>{a.noteStatus!=='saved'&&<button type="button" disabled={busy} onClick={()=>void action('note',a.id)} className={button}>Retry job note only</button>}</>:a.status!=='failed'&&<button type="button" disabled={busy} onClick={()=>void action('check',a.id)} className={button}>Check saved send status</button>}
   </article>)}
   {data.attempts.length>0&&<button type="button" disabled={busy} onClick={onChanged} className={button}>Refresh quote and eligibility</button>}
   {canCompose?<form onSubmit={e=>{e.preventDefault();void action('send');}} className="space-y-3">
    <fieldset disabled={busy||readOnly} className="space-y-3">
     <p className="font-semibold text-sm">Approach {item.eligibility.approach} · Discount NZD ${(cents/100).toFixed(2)}</p>
     <label className="block text-sm">Send by<select value={channel} onChange={e=>{const next=e.target.value as 'sms'|'email';setChannel(next);setSender(data[next].senders[0]?.id||'');if(!edited.current)applyTemplate(data,next);setConfirmed(false);}} className={field}><option value="sms">SMS</option><option value="email">Email</option></select></label>
     <label className="block text-sm">Sending account<select value={sender} onChange={e=>{setSender(e.target.value);setConfirmed(false);}} className={field}><option value="">Choose a connected account</option>{data[channel].senders.map(s=><option key={s.id} value={s.id}>{s.label} {s.senderValue||''}</option>)}</select></label>
     <p className="text-sm">To: {destination||'Missing — update contact details on the quote'}</p>
     {channel==='email'&&<><label className="block text-sm">Subject<input value={subject} maxLength={200} onChange={e=>{edited.current=true;setSubject(e.target.value);setConfirmed(false);}} className={field}/></label><p className="text-xs text-slate-500">The selected account’s configured email signature is appended when sent.</p></>}
     <button type="button" onClick={()=>{applyTemplate(data,channel);edited.current=false;}} className={button}>Use saved template</button>
     <label className="block text-sm">Message<textarea rows={7} maxLength={channel==='sms'?1600:20000} value={body} onChange={e=>{edited.current=true;setBody(e.target.value);setConfirmed(false);}} className={field}/></label>
     <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I checked the recipient, quote scope, pricing and discount. Send this individual offer now.</label>
     <button type="submit" disabled={!confirmed||!sender||!destination} className={button+' bg-[#1a3a4a] text-white'}>Send offer</button>
    </fieldset>
   </form>:<p className="text-sm text-slate-600">{locked?'Check saved status or refresh the quote before composing another offer.':!data.enabled?'Sending is switched off. Saved attempts and note retries remain available.':'Review eligibility and save a discount before composing the next offer.'}</p>}
  </>}
 </section>;
}
