'use client';
import {useRef,useState} from 'react';
import type {ControlRecord,QueueItem} from '@/lib/dead-followups/types';
export default function FollowupControls({item,onSaved,onAccessLost,readOnly=false}:{item:QueueItem;onSaved:(record:ControlRecord)=>void;onAccessLost?:()=>void;readOnly?:boolean}){
 const [busy,setBusy]=useState(false);const [locked,setLocked]=useState(false);const active=useRef(false);const [error,setError]=useState('');
 async function restore(action:'restore'|'unsnooze'){if(active.current||readOnly||locked)return;active.current=true;setBusy(true);try{const r=await fetch(`/api/jobs/${item.job._id}/dead-followup`,{method:'POST',headers:{'content-type':'application/json','x-access-token':localStorage.getItem('token')||''},body:JSON.stringify({revision:item.controls?.revision,jobVersion:item.job.updatedAt,command:{action}})});if(r.status===401||r.status===403)onAccessLost?.();const json=await r.json();if(!r.ok||!json.record)throw Error(json.error||'Change could not be confirmed. Refresh before retrying.');onSaved(json.record);}catch(e){setLocked(true);setError(e instanceof Error?e.message:'Refresh before retrying.');}finally{active.current=false;setBusy(false);}}
 const state=item.controls?.state;
 return <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-label="Follow-up status">
  {state?.offers.map(offer=><p key={offer.number} className="text-sm">{offer.number===1?'First':'Second'} offer · ${(offer.discountCents/100).toFixed(2)} discount · {offer.channel.toUpperCase()} · {new Date(offer.sentAt).toLocaleDateString('en-NZ',{timeZone:'Pacific/Auckland'})}<span className="mt-1 block whitespace-pre-wrap break-words text-slate-600">{offer.evidence}</span></p>)}
  {state?.exclusionReason&&<div><p>Ignored: {state.exclusionReason}</p><button disabled={busy||readOnly||locked} onClick={()=>void restore('restore')} className="min-h-11 text-sm font-semibold underline disabled:opacity-50">Restore follow-ups</button></div>}
  {state?.snoozedUntil&&<div><p>Skipped through {new Date(state.snoozedUntil).toLocaleDateString('en-NZ',{timeZone:'Pacific/Auckland'})}</p><button disabled={busy||readOnly||locked} onClick={()=>void restore('unsnooze')} className="min-h-11 text-sm font-semibold underline disabled:opacity-50">Clear skip</button></div>}
  {!state?.offers.length&&!state?.exclusionReason&&!state?.snoozedUntil&&<p className="text-sm text-slate-500">No follow-up offers recorded.</p>}{error&&<p role="alert" className="text-sm text-amber-900">{error}</p>}
 </section>;
}
