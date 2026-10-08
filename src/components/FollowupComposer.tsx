'use client';
import {useEffect,useRef,useState} from 'react';
import {defaultTemplates,renderTemplate,type OfferTemplate} from '@/lib/dead-followups/templates';
import {parseDiscount} from '@/lib/dead-followups/controls';
import type {ControlRecord,QueueItem} from '@/lib/dead-followups/types';
import FollowupModal from './FollowupModal';
type Sender={id:string;label:string;senderValue?:string};
type Loaded={templates?:OfferTemplate[];enabled:boolean;attempts:{status:string;approach:number}[];contact:{name?:string;email?:string;phoneMobile?:string;phoneSecondary?:string};sms:{senders:Sender[]};email:{senders:Sender[]}};
const field='mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const button='min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50';
export default function FollowupComposer({item,readOnly,onCancel,onDone,onAccessLost}:{item:QueueItem;readOnly:boolean;onCancel:()=>void;onDone:(notice:string)=>void;onAccessLost:()=>void}){
 const [data,setData]=useState<Loaded|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const active=useRef(false);const [locked,setLocked]=useState(false);
 const [amount,setAmount]=useState(item.controls?.state.draftDiscountCents==null?'':(item.controls.state.draftDiscountCents/100).toFixed(2));
 const [channel,setChannel]=useState<'sms'|'email'>('sms');const [sender,setSender]=useState('');const [approach,setApproach]=useState<1|2>(item.eligibility.approach||((item.controls?.state.offers.length||0)>0?2:1));
 const [body,setBody]=useState('');const [subject,setSubject]=useState('');const [confirm,setConfirm]=useState(false);
 const endpoint=`/api/jobs/${item.job._id}/dead-followup`;const requestId=useRef<string|null>(null);
 const headers=()=>({'content-type':'application/json','x-access-token':localStorage.getItem('token')||''});
 function template(loaded:Loaded,kind:'sms'|'email',number:1|2,value:string){let cents=0;try{cents=parseDiscount(value);}catch{}const selected=(loaded.templates||defaultTemplates()).find(t=>t.channel===kind&&t.approach===number);if(!selected)return;const text=renderTemplate(selected,{discountCents:cents,name:loaded.contact.name,quoteNumber:item.job.quote?.quoteNumber||item.job.jobNumber});setBody(text.body);setSubject(text.subject);}
 useEffect(()=>{let cancelled=false;void(async()=>{try{const r=await fetch(endpoint+'/send',{headers:headers(),cache:'no-store'});if(cancelled)return;if(r.status===401||r.status===403)onAccessLost();const json=await r.json();if(!r.ok)throw Error(json.error||'Could not load sending details.');if(cancelled)return;setData(json);const kind=json.sms.senders.length?'sms':'email';setChannel(kind);setSender(json[kind].senders[0]?.id||'');template(json,kind,approach,amount);}catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Could not load sending details.');}})();return()=>{cancelled=true;};
 // Load once for this quote; inputs below explicitly update the selected template.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[endpoint]);
 const destination=channel==='sms'?(data?.contact.phoneMobile||data?.contact.phoneSecondary):data?.contact.email;
 const blocked=data?.attempts.some(a=>['sending','accepted','unknown'].includes(a.status)||(a.status==='sent'&&a.approach===(item.eligibility.approach||((item.controls?.state.offers.length||0)>0?2:1))));
 async function post(path:string,value:unknown){const r=await fetch(path,{method:'POST',headers:headers(),body:JSON.stringify(value)});if(r.status===401||r.status===403)onAccessLost();const json=await r.json();if(!r.ok)throw Error(json.error||'The operation could not be confirmed.');return json;}
 async function send(){if(active.current||readOnly||locked||!confirm)return;active.current=true;setBusy(true);setError('');try{
  let record=item.controls!;
  for(const command of [{action:'discount',amount},{action:'review',historyConfirmed:true,date:item.suggestion?.date,evidence:item.suggestion?.evidence}]){
   const result=await post(endpoint,{revision:record.revision,jobVersion:item.job.updatedAt,command});if(!result.record)throw Error('Saved offer details could not be confirmed.');record=result.record as ControlRecord;
  }
  requestId.current??=crypto.randomUUID();
  const result=await post(endpoint+'/send',{action:'send',requestId:requestId.current,revision:record.revision,jobVersion:item.job.updatedAt,channel,senderId:sender,destination,body,subject});
  if(result.attempt?.status==='sent'){onDone(result.noteError?'Offer sent. Its job note still needs saving—open follow-up history to retry the note.':'Offer sent. Discount saved in history and job notes.');}
  else throw Error('Sending is not yet confirmed. Open follow-up history to check saved status before trying again.');
 }catch(e){setLocked(true);setConfirm(false);setError(e instanceof Error?e.message:'Sending could not be confirmed. Check follow-up history before retrying.');}finally{active.current=false;setBusy(false);}}
 function review(){try{const cents=parseDiscount(amount);if(item.job.quote?.c_total==null||cents>Math.round(item.job.quote.c_total*100))throw Error('The discount must not exceed the quote total.');setError('');setConfirm(true);}catch(e){setError(e instanceof Error?e.message:'Enter a valid discount.');}}
 const disabled=readOnly||busy||locked||!data?.enabled||!item.sendEnabled||blocked;
 return <FollowupModal composer title={`Send offer to ${item.job.client?.contactDetails?.name||data?.contact.name||"customer"}`} busy={busy} onClose={onCancel}>
  {error&&<p role="alert" className="text-sm text-amber-900">{error}</p>}
  {!data?<p role="status">{error?'Sending details unavailable.':'Loading sending details…'}</p>:<form onSubmit={e=>{e.preventDefault();review();}}><fieldset disabled={disabled} className="space-y-4">
   <label className="block text-sm font-semibold">Offer amount (NZD discount)<input autoFocus required inputMode="decimal" value={amount} onChange={e=>{setAmount(e.target.value);template(data,channel,approach,e.target.value);}} className={field}/></label>
   <label className="block text-sm">Send by<select value={channel} onChange={e=>{const kind=e.target.value as 'sms'|'email';setChannel(kind);setSender(data[kind].senders[0]?.id||'');template(data,kind,approach,amount);}} className={field}><option value="sms">SMS</option><option value="email">Email</option></select></label>
   <label className="block text-sm">Template<select className={field} value={approach} onChange={e=>{const number=Number(e.target.value) as 1|2;setApproach(number);template(data,channel,number,amount);}}><option value="1">First follow-up</option><option value="2">Second follow-up</option></select></label>
   <label className="block text-sm">Sending account<select required className={field} value={sender} onChange={e=>setSender(e.target.value)}><option value="">Choose an account</option>{data[channel].senders.map(s=><option key={s.id} value={s.id}>{s.label} {s.senderValue||''}</option>)}</select></label>
   <p className="text-sm">To: {destination||'Missing—update the contact details on the quote.'}</p>
   {channel==='email'&&<label className="block text-sm">Subject<input required maxLength={200} value={subject} onChange={e=>setSubject(e.target.value)} className={field}/></label>}
   <label className="block text-sm">Message<textarea required rows={6} maxLength={channel==='sms'?1600:20000} className={field} value={body} onChange={e=>setBody(e.target.value)}/></label>
   <p className="text-xs text-slate-500">Changing the amount, channel or template resets the message to the selected template.{channel==='email'?' Your sending account’s signature will be appended.':''}</p>
   <button type="submit" disabled={!sender||!destination} className={button+' bg-[#1a3a4a] text-white'}>Review offer</button>
  </fieldset></form>}
  {data&&!data.enabled&&<p className="text-sm">Sending is switched off.</p>}{blocked&&<p className="text-sm">Check the saved send in follow-up history before sending another offer.</p>}
  <button type="button" disabled={busy} onClick={onCancel} className={button}>Cancel</button>
  {confirm&&<FollowupModal title="Confirm offer" busy={busy} onClose={()=>setConfirm(false)}><div className="space-y-4"><p className="font-semibold">{item.job.client?.contactDetails?.name} · ${Number(amount).toFixed(2)} discount</p><p className="text-sm">{channel.toUpperCase()} to {destination}</p>{channel==='email'&&<p className="font-semibold">{subject}</p>}<p className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm">{body}</p><div className="flex gap-3"><button type="button" disabled={disabled} onClick={()=>void send()} className={button+' bg-[#1a3a4a] text-white'}>{busy?'Sending…':'Confirm and send'}</button><button type="button" disabled={busy} onClick={()=>setConfirm(false)} className={button}>Back</button></div></div></FollowupModal>}
 </FollowupModal>;
}
