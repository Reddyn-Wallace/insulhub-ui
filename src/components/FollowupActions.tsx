'use client';
import {useEffect,useRef,useState} from 'react';
import {loadComposerDetails} from '@/lib/dead-followups/composer-client';
import FollowupModal from './FollowupModal';
import FollowupComposer from './FollowupComposer';
import type {QueueItem} from '@/lib/dead-followups/types';
const button='min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50';
const field='mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2';
const nzDay=(at:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Pacific/Auckland',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
function daysFromNow(days:number){const at=new Date(nzDay(new Date())+'T12:00:00Z');at.setUTCDate(at.getUTCDate()+days);return at.toISOString().slice(0,10);}
export default function FollowupActions({item,readOnly,onDone,onAccessLost}:{item:QueueItem;readOnly:boolean;onDone:(notice:string)=>void;onAccessLost:()=>void}){
 const [mode,setMode]=useState<'send'|'skip'|'ignore'|null>(null);const [duration,setDuration]=useState('7');const [day,setDay]=useState('');const [reason,setReason]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [locked,setLocked]=useState(false);const active=useRef(false);
 useEffect(()=>{if(!readOnly&&item.sendAvailable)void loadComposerDetails(item).catch(()=>{});},[item,readOnly]);
 async function save(){if(active.current||readOnly||locked)return;active.current=true;setBusy(true);setError('');let correctable=false;try{
  if(mode==='ignore'&&!reason.trim()){correctable=true;throw Error('Enter a reason for ignoring this quote.');}
  const command=mode==='skip'?{action:'snooze',date:duration==='custom'?day:daysFromNow(Number(duration))}:{action:'exclude',reason};
  const r=await fetch(`/api/jobs/${item.job._id}/dead-followup`,{method:'POST',headers:{'content-type':'application/json','x-access-token':localStorage.getItem('token')||''},body:JSON.stringify({revision:item.controls?.revision,jobVersion:item.job.updatedAt,command})});
  const json=await r.json();if(r.status===401||r.status===403)onAccessLost();if(!r.ok){correctable=r.status===400;if(r.status!==400)setLocked(true);throw Error(json.error||'Change could not be confirmed. Refresh before retrying.');}if(!json.record){setLocked(true);throw Error('Change could not be confirmed. Refresh before retrying.');}
  onDone(mode==='skip'?'Quote skipped until after the selected date.':'Quote ignored and removed from further follow-ups.');
 }catch(e){setError(e instanceof Error?e.message:'Change could not be confirmed.');if(!correctable)setLocked(true);}finally{active.current=false;setBusy(false);}}
 return <>
  <div className="flex flex-wrap gap-3"><button type="button" disabled={readOnly||!item.controls||!item.sendAvailable} className={button+' bg-[#1a3a4a] text-white'} onMouseEnter={()=>{void loadComposerDetails(item).catch(()=>{});}} onFocus={()=>{void loadComposerDetails(item).catch(()=>{});}} onClick={()=>setMode('send')}>Send Offer</button><button type="button" disabled={readOnly||!item.controls} className={button+' bg-white'} onClick={()=>{setError('');setMode('skip');}}>Skip for now</button><button type="button" disabled={readOnly||!item.controls} className={button+' bg-white'} onClick={()=>{setError('');setMode('ignore');}}>Ignore</button></div>
  {mode==='send'&&<FollowupComposer item={item} readOnly={readOnly} onCancel={()=>setMode(null)} onDone={onDone} onAccessLost={onAccessLost}/>}
  {(mode==='skip'||mode==='ignore')&&<FollowupModal title={mode==='skip'?'How long do you want to skip for?':'Ignore this quote?'} busy={busy} onClose={()=>setMode(null)}><form onSubmit={e=>{e.preventDefault();void save();}} className="space-y-4"><fieldset disabled={busy||readOnly||locked} className="space-y-4">
   {mode==='skip'?<><label className="block text-sm">Skip for<select className={field} value={duration} onChange={e=>setDuration(e.target.value)}><option value="1">1 day</option><option value="7">1 week</option><option value="14">2 weeks</option><option value="30">30 days</option><option value="custom">Choose a date</option></select></label>{duration==='custom'&&<label className="block text-sm">Skip through<input type="date" required min={nzDay(new Date())} value={day} onChange={e=>setDay(e.target.value)} className={field}/></label>}<p className="text-sm text-slate-600">Returns to the queue after {duration==='custom'?(day||'the selected date'):daysFromNow(Number(duration))}, NZ time. Shared with the team.</p></>:<><label className="block text-sm">Reason for ignoring<textarea required maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} className={field}/></label><p className="text-sm text-slate-600">Removes this quote from further follow-ups.</p></>}
   <button type="submit" className={button+' bg-[#1a3a4a] text-white'}>{mode==='skip'?'Confirm skip':'Ignore quote'}</button>
  </fieldset>{error&&<p role="alert" className="text-sm text-amber-900">{error}{locked&&' Refresh the queue before retrying.'}</p>}<button type="button" disabled={busy} onClick={()=>setMode(null)} className={button}>Cancel</button></form></FollowupModal>}
 </>;
}
