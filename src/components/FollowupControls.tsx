'use client';
import {useId,useRef,useState} from 'react';
import {addNzMonths} from '@/lib/dead-followups/rules';
import {emptyControls} from '@/lib/dead-followups/controls';
import type {ControlEvent,ControlRecord,QueueItem} from '@/lib/dead-followups/types';
const inputStyle='mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const buttonStyle='min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-[#1a3a4a] disabled:opacity-50';
const amount=(cents:number)=>new Intl.NumberFormat('en-NZ',{style:'currency',currency:'NZD'}).format(cents/100);
const nzDay=(at:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Pacific/Auckland',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
function quickDate(days:number){const stamp=new Date(`${nzDay(new Date())}T12:00:00Z`);stamp.setUTCDate(stamp.getUTCDate()+days);return stamp.toISOString().slice(0,10);}
const date=(at:string)=>new Date(at).toLocaleDateString('en-NZ',{timeZone:'Pacific/Auckland'});
export default function FollowupControls({item,onSaved,onAccessLost,readOnly=false}:{item:QueueItem;onSaved:(record:ControlRecord)=>void;onAccessLost?:()=>void;readOnly?:boolean}){
  const initial=item.controls || {revision:0,state:emptyControls(),actorName:'',updatedAt:null};
  const [record,setRecord]=useState(initial);
  const [discount,setDiscount]=useState(initial.state.draftDiscountCents===null?'':(initial.state.draftDiscountCents/100).toFixed(2));
  const [busy,setBusy]=useState(false);const [locked,setLocked]=useState(false);const busyRef=useRef(false);
  const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const [events,setEvents]=useState<ControlEvent[]|null>(null);const [auditError,setAuditError]=useState('');
  const prefix=useId();
  const endpoint=`/api/jobs/${item.job._id}/dead-followup`;
  const headers=()=>({'content-type':'application/json','x-access-token':localStorage.getItem('token') || ''});
  async function save(command:Record<string,unknown>){
    if(busyRef.current || locked || readOnly)return;
    busyRef.current=true;setBusy(true);setError('');setNotice('');
    let safeToRetry=false;
    try{
      const response=await fetch(endpoint,{method:'POST',headers:headers(),body:JSON.stringify({revision:record.revision,jobVersion:item.job.updatedAt,command})});
      const payload=await response.json();
      if(!response.ok){safeToRetry=response.status===400;if(response.status===401 || response.status===403)onAccessLost?.();if(response.status!==400)setLocked(true);throw Error(payload.error || 'Change could not be confirmed. Refresh before retrying.');}
      setRecord(payload.record);setNotice('Saved. No message has been sent.');setEvents(null);onSaved(payload.record);
    }catch(cause){if(!safeToRetry)setLocked(true);setError(cause instanceof Error?cause.message:'Change could not be confirmed. Refresh before retrying.');}
    finally{setBusy(false);busyRef.current=false;}
  }
  async function audit(){
    setAuditError('');
    try{const response=await fetch(endpoint,{headers:headers(),cache:'no-store'});if(response.status===401 || response.status===403)onAccessLost?.();if(!response.ok)throw Error();const payload=await response.json();setEvents(payload.events);}
    catch{setAuditError('Could not load the audit history. Try again.');}
  }
  function submit(event:React.FormEvent<HTMLFormElement>,action:string){
    event.preventDefault();const fields=Object.fromEntries(new FormData(event.currentTarget).entries());
    void save({...fields,action,...(action==='review'?{historyConfirmed:fields.historyConfirmed==='on'}:{})});
  }
  const state=record.state;
  return <section aria-label="Follow-up controls" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
    <h3 className="font-semibold text-[#1a3a4a]">Follow-up history and controls</h3>
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
    {notice && <p role="status" className="text-sm text-teal-800">{notice}</p>}
    {locked && <p className="text-sm text-amber-900">Use Refresh above before making another change. Your input is kept here until then.</p>}
    {state.offers.length>0?<ul className="space-y-3">{state.offers.map(offer=><li key={offer.number} className="rounded-xl bg-teal-50 p-4 text-sm text-teal-950"><p className="font-semibold">{offer.number===1?'First approach':'Second approach'} · {amount(offer.discountCents)} discount</p><p className="mt-1">{date(offer.sentAt)} · {offer.channel.toUpperCase()} · {offer.source==='provider_sent'?'Confirmed CRM send':'Staff-recorded history'}</p><p className="mt-2 whitespace-pre-wrap break-words">{offer.evidence}</p></li>)}</ul>:<p className="text-sm text-slate-600">No historical offers recorded here. Check existing communications before confirming the history.</p>}
    <fieldset disabled={busy || locked || readOnly} className="space-y-5 disabled:opacity-60">
      <form onSubmit={event=>{event.preventDefault();void save({action:'discount',amount:discount});}}>
        <label htmlFor={`${prefix}-discount`} className="text-sm font-semibold">Discount offered (NZD)</label>
        <input id={`${prefix}-discount`} inputMode="decimal" value={discount} onChange={event=>setDiscount(event.target.value)} placeholder="e.g. 500.00" className={inputStyle}/>
        <p className="my-2 text-xs text-slate-500">Saved as a draft. It will not count as an approach or create an “offer sent” note.</p>
        <button className={buttonStyle}>Save discount draft</button>
      </form>
      <details className="border-t border-slate-100 pt-4"><summary className="cursor-pointer text-sm font-semibold">Record an earlier offer</summary>
        <p className="my-3 text-sm text-slate-600">Only record an offer actually sent. This does not send a message. Date-only history uses the end of the NZ day for the next waiting period.</p>
        <form onSubmit={event=>submit(event,'record_offer')} className="space-y-3">
          <label className="block text-sm">Historical discount (NZD)<input name="amount" required inputMode="decimal" className={inputStyle}/></label>
          <label className="block text-sm">Date sent<input name="date" required type="date" className={inputStyle}/></label>
          <label className="block text-sm">Channel<select name="channel" className={inputStyle}><option value="sms">SMS</option><option value="email">Email</option></select></label>
          <label className="block text-sm">Evidence of sending<textarea name="evidence" required maxLength={2000} placeholder="Where the sent message or dated record can be checked" className={inputStyle}/></label>
          <button className={buttonStyle} disabled={state.offers.length>=2}>Record historical offer</button>
        </form>
      </details>
      {state.offers.at(-1)?.source==='staff_recorded' && <details className="border-t border-slate-100 pt-4"><summary className="cursor-pointer text-sm font-semibold">Correct the latest historical entry</summary><form onSubmit={event=>submit(event,'remove_latest_offer')} className="mt-3 space-y-3"><p className="text-sm text-slate-600">Removes the latest entry from the approach count. Its original evidence remains in the audit history.</p><label className="block text-sm">Correction reason<input name="reason" required maxLength={2000} className={inputStyle}/></label><button className={buttonStyle}>Remove latest entry from count</button></form></details>}
      <details className="border-t border-slate-100 pt-4"><summary className="cursor-pointer text-sm font-semibold">Review the Dead date and prior offers</summary>
        <p className="my-3 text-sm text-slate-600">This records a staff-reviewed estimate, not an exact backend transition time. A later change to the quote requires review again.</p>
        {state.deadDate && <p className="mb-3 text-sm">Recorded estimate: {date(state.deadDate)}. {state.dateEvidence}</p>}
        <form onSubmit={event=>submit(event,'review')} className="space-y-3"><label className="block text-sm">Estimated date this quote entered Dead<input name="date" required type="date" defaultValue={state.deadDate ? nzDay(new Date(state.deadDate)) : item.suggestion?.date || ''} className={inputStyle}/></label><label className="block text-sm">Date evidence<textarea name="evidence" required maxLength={2000} defaultValue={state.dateEvidence || item.suggestion?.evidence || ''} className={inputStyle}/></label><label className="flex items-start gap-2 text-sm"><input name="historyConfirmed" type="checkbox" required className="mt-1"/>I checked notes and communications. All previous individual offers are recorded above, or none were sent.</label><button className={buttonStyle}>Save reviewed history</button></form>
      </details>
      <div className="border-t border-slate-100 pt-4">
        {state.snoozedUntil && <p className="mb-3 text-sm text-slate-700">Snoozed through {date(state.snoozedUntil)} (NZ time). <button type="button" onClick={()=>void save({action:'unsnooze'})} className="font-semibold underline">Clear snooze</button></p>}
        <div className="mb-3 flex flex-wrap gap-2">{[7,14].map(days=><button type="button" key={days} onClick={()=>void save({action:'snooze',date:quickDate(days)})} className={buttonStyle}>{days===7?'1 week':'2 weeks'}</button>)}<button type="button" onClick={()=>void save({action:'snooze',date:nzDay(new Date(addNzMonths(new Date().toISOString(),1)))})} className={buttonStyle}>1 month</button></div>
        <form onSubmit={event=>submit(event,'snooze')} className="space-y-3"><label className="block text-sm font-semibold">Snooze until<input name="date" required type="date" className={inputStyle}/></label><p className="text-xs text-slate-500">Shared with the team. This never brings a follow-up forward.</p><button className={buttonStyle}>Snooze</button></form>
      </div>
      {state.exclusionReason?<div className="border-t border-slate-100 pt-4 text-sm"><p>Excluded from individual follow-ups: {state.exclusionReason}</p><button type="button" onClick={()=>void save({action:'restore'})} className={`${buttonStyle} mt-3`}>Restore follow-ups</button></div>:<details className="border-t border-slate-100 pt-4"><summary className="cursor-pointer text-sm font-semibold">Exclude from individual follow-ups</summary><form onSubmit={event=>submit(event,'exclude')} className="mt-3 space-y-3"><label className="block text-sm">Exclusion reason<input name="reason" required maxLength={2000} className={inputStyle}/></label><p className="text-xs text-slate-500">Reversible. This does not change the quote status or marketing preferences. Handle customer contact opt-outs through the existing team process.</p><button className={buttonStyle}>Exclude follow-ups</button></form></details>}
    </fieldset>
    {record.updatedAt && <p className="text-xs text-slate-500">Last changed by {record.actorName} · {date(record.updatedAt)}</p>}
    <button type="button" onClick={()=>void audit()} className="min-h-11 text-sm font-semibold text-[#1a3a4a] underline">View change history</button>
    {auditError && <p role="alert" className="text-sm text-amber-900">{auditError}</p>}
    {events && <ol className="space-y-3">{events.length===0 && <li className="text-sm text-slate-500">No changes recorded.</li>}{events.map(event=><li key={event.revision} className="rounded-lg bg-slate-50 p-3 text-sm"><p className="font-semibold">{event.action.replaceAll('_',' ')} · {event.actorName}</p><p>{date(event.createdAt)} · Revision {event.revision}</p>{event.reason && <p>{event.reason}</p>}{event.state.draftDiscountCents!==null && <p>Draft discount: {amount(event.state.draftDiscountCents)}</p>}{event.state.offers.map(offer=><p key={offer.number}>Approach {offer.number}: {amount(offer.discountCents)} · {date(offer.sentAt)} · {offer.evidence}</p>)}</li>)}</ol>}
  </section>;
}
