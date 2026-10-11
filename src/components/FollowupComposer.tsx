'use client';
import {useEffect,useRef,useState} from 'react';
import {applyTemplateFields,buildContactTemplateFields} from '@/lib/contact-template-fields';
import {parseDiscount} from '@/lib/dead-followups/controls';
import type {ControlRecord,QueueItem} from '@/lib/dead-followups/types';
import FollowupModal from './FollowupModal';
import {cachedComposerDetails,loadComposerDetails,clearComposerDetails,type ComposerDetails as Loaded} from '@/lib/dead-followups/composer-client';
const field='mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const button='min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50';
export default function FollowupComposer({item,readOnly,onCancel,onDone,onAccessLost}:{item:QueueItem;readOnly:boolean;onCancel:()=>void;onDone:(notice:string)=>void;onAccessLost:()=>void}){
 const [data,setData]=useState<Loaded|null>(()=>cachedComposerDetails(item)||null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const active=useRef(false);const [locked,setLocked]=useState(false);
 const amountInput=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(data)amountInput.current?.focus();},[data]);
 const [amount,setAmount]=useState(item.controls?.state.draftDiscountCents==null?'':(item.controls.state.draftDiscountCents/100).toFixed(2));
 const [channel,setChannel]=useState<'sms'|'email'>('sms');const [sender,setSender]=useState('');const [templateId,setTemplateId]=useState('');
 const [body,setBody]=useState('');const [subject,setSubject]=useState('');const [confirm,setConfirm]=useState(false);
 const endpoint=`/api/jobs/${item.job._id}/dead-followup`;const requestId=useRef<string|null>(null);
 const headers=()=>({'content-type':'application/json','x-access-token':localStorage.getItem('token')||''});
 function template(loaded:Loaded,kind:'sms'|'email',id:string,value:string){
  const selected=loaded.templates?.find(t=>t.channel===kind&&t.id===id);
  if(!selected){setBody('');setSubject('');return;}
  let cents=0;try{cents=parseDiscount(value||'0');}catch{}
  const fields={...(loaded.templateFields||buildContactTemplateFields({...item.job,client:{contactDetails:loaded.contact}})),discount:cents>0?'$'+(cents/100).toFixed(2):''};
  setBody(applyTemplateFields(selected.body,fields));setSubject(applyTemplateFields(selected.subject||'',fields));
 }
 useEffect(()=>{let cancelled=false;void(async()=>{try{const json=await loadComposerDetails(item);if(cancelled)return;setData(json);const kind=json.sms.senders.length?'sms':'email';setChannel(kind);setSender(json[kind].senders[0]?.id||'');setTemplateId('');}catch(e){if(!cancelled&&[401,403].includes((e as {status?:number}).status||0))onAccessLost();if(!cancelled)setError(e instanceof Error?e.message:'Could not load sending details.');}})();return()=>{cancelled=true;};
 // Load once for this quote; inputs below explicitly update the selected template.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[endpoint]);
 const destination=channel==='sms'?(data?.contact.phoneMobile||data?.contact.phoneSecondary):data?.contact.email;
 const blocked=data?.attempts.some(a=>['sending','accepted','unknown'].includes(a.status)||(a.status==='sent'&&a.approach===(item.eligibility.approach||((item.controls?.state.offers.length||0)>0?2:1))));
 async function post(path:string,value:unknown){const r=await fetch(path,{method:'POST',headers:headers(),body:JSON.stringify(value)});if(r.status===401||r.status===403)onAccessLost();const json=await r.json();if(!r.ok)throw Error(json.error||'The operation could not be confirmed.');return json;}
 async function send(){if(active.current||readOnly||locked||!confirm)return;active.current=true;clearComposerDetails();setBusy(true);setError('');try{
  let record=item.controls!;
  for(const command of [{action:'discount',amount:amount.trim()||'0'},{action:'review',historyConfirmed:true,date:item.suggestion?.date,evidence:item.suggestion?.evidence}]){
   const result=await post(endpoint,{revision:record.revision,jobVersion:item.job.updatedAt,command});if(!result.record)throw Error('Saved offer details could not be confirmed.');record=result.record as ControlRecord;
  }
  requestId.current??=crypto.randomUUID();
  const result=await post(endpoint+'/send',{action:'send',requestId:requestId.current,revision:record.revision,jobVersion:item.job.updatedAt,channel,senderId:sender,destination,body,subject});
  if(result.attempt?.status==='sent'){onDone(result.noteError?'Offer sent. Its job note still needs saving—open follow-up history to retry the note.':'Follow-up sent. Saved in history and job notes.');}
  else throw Error('Sending is not yet confirmed. Open follow-up history to check saved status before trying again.');
 }catch(e){setLocked(true);setConfirm(false);setError(e instanceof Error?e.message:'Sending could not be confirmed. Check follow-up history before retrying.');}finally{active.current=false;setBusy(false);}}
 function review(){try{const cents=parseDiscount(amount.trim()||'0');if(cents>0&&(item.job.quote?.c_total==null||cents>Math.round(item.job.quote.c_total*100)))throw Error('The discount must not exceed the quote total.');if(!body.trim())throw Error('Choose a template or write a message.');if(channel==='email'&&!subject.trim())throw Error('Enter an email subject.');setError('');setConfirm(true);}catch(e){setError(e instanceof Error?e.message:'Enter a valid discount.');}}
 const disabled=readOnly||busy||locked||!data?.enabled||!item.sendEnabled||blocked;
 return <FollowupModal composer title={`Send offer to ${item.job.client?.contactDetails?.name||data?.contact.name||"customer"}`} busy={busy} onClose={onCancel}>
  {error&&<p role="alert" className="text-sm text-amber-900">{error}</p>}
  {!data&&<p role="status" className="text-sm text-slate-500">{error?'Sending details unavailable.':'Connecting sending accounts…'}</p>}<form onSubmit={e=>{e.preventDefault();review();}}><fieldset disabled={disabled} className="space-y-4">
   <label className="block text-sm font-semibold">Discount (NZD, optional)<input ref={amountInput} inputMode="decimal" value={amount} onChange={e=>{setAmount(e.target.value);if(templateId)template(data!,channel,templateId,e.target.value);}} className={field}/></label>
   <label className="block text-sm">Send by<select value={channel} onChange={e=>{const kind=e.target.value as 'sms'|'email';setChannel(kind);setSender(data![kind].senders[0]?.id||'');setTemplateId('');setBody('');setSubject('');}} className={field}><option value="sms">SMS</option><option value="email">Email</option></select></label>
   <label className="block text-sm">Template<select className={field} value={templateId} onChange={e=>{setTemplateId(e.target.value);template(data!,channel,e.target.value,amount);}}><option value="">Blank message</option>{(data?.templates||[]).filter(t=>t.channel===channel).map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
   {data?.templateError&&<p role="alert" className="text-sm text-amber-900">{data.templateError}</p>}
   <label className="block text-sm">Sending account<select required className={field} value={sender} onChange={e=>setSender(e.target.value)}><option value="">Choose an account</option>{(data?.[channel].senders||[]).map(s=><option key={s.id} value={s.id}>{s.label} {s.senderValue||''}</option>)}</select></label>
   <p className="text-sm">To: {destination||'Missing—update the contact details on the quote.'}</p>
   {channel==='email'&&<label className="block text-sm">Subject<input required maxLength={200} value={subject} onChange={e=>setSubject(e.target.value)} className={field}/></label>}
   <label className="block text-sm">Message<textarea required rows={6} maxLength={channel==='sms'?1600:20000} className={field} value={body} onChange={e=>setBody(e.target.value)}/></label>
   <p className="text-xs text-slate-500">Changing the amount, channel or template resets the message to the selected template.{channel==='email'?' Your sending account’s signature will be appended.':''}</p>
   <button type="submit" disabled={!sender||!destination} className={button+' bg-[#1a3a4a] text-white'}>Review offer</button>
  </fieldset></form>
  {data&&!data.enabled&&<p className="text-sm">Sending is switched off.</p>}{blocked&&<p className="text-sm">Check the saved send in follow-up history before sending another offer.</p>}
  <button type="button" disabled={busy} onClick={onCancel} className={button}>Cancel</button>
  {confirm&&<FollowupModal title="Confirm offer" busy={busy} onClose={()=>setConfirm(false)}><div className="space-y-4"><p className="font-semibold">{item.job.client?.contactDetails?.name}{Number(amount)>0?` · $${Number(amount).toFixed(2)} discount`:''}</p><p className="text-sm">{channel.toUpperCase()} to {destination}</p>{channel==='email'&&<p className="font-semibold">{subject}</p>}<p className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm">{body}</p><div className="flex gap-3"><button type="button" disabled={disabled} onClick={()=>void send()} className={button+' bg-[#1a3a4a] text-white'}>{busy?'Sending…':'Confirm and send'}</button><button type="button" disabled={busy} onClick={()=>setConfirm(false)} className={button}>Back</button></div></div></FollowupModal>}
 </FollowupModal>;
}
