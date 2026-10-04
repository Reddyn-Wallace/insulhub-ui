'use client';
import {use,useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import FollowupSender from '@/components/FollowupSender';
import FollowupControls from '@/components/FollowupControls';
import {classifyQuote,evaluateFollowup} from '@/lib/dead-followups/rules';
import {controlHistory} from '@/lib/dead-followups/controls';
import type {ControlRecord,DeadQuote,QueueItem} from '@/lib/dead-followups/types';
type Saved={job:DeadQuote;record:ControlRecord;readOnly:boolean;preview?:boolean};
export default function FollowupHistory({params}:{params:Promise<{id:string}>}){
 const {id}=use(params);return <History key={id} id={id}/>;
}
function History({id}:{id:string}){
 const [saved,setSaved]=useState<Saved|null>(null);const [error,setError]=useState('');const [checking,setChecking]=useState(false);
 const load=useCallback(async()=>{try{const r=await fetch(`/api/jobs/${id}/dead-followup`,{headers:{'x-access-token':localStorage.getItem('token')||''},cache:'no-store'});if(r.status===401||r.status===403){setSaved(null);throw Error('Sign in again to view this history.');}if(!r.ok)throw Error('Follow-up controls could not be loaded.');const value=await r.json();if(value.job&&value.record)setSaved(value);setError('');}catch(e){setError(e instanceof Error?e.message:'Could not load follow-up controls.');}},[id]);
 useEffect(()=>{void load();},[load]);
 async function checkDate(){setChecking(true);try{const r=await fetch(`/api/jobs/${id}/dead-date/check`,{method:'POST',headers:{'x-access-token':localStorage.getItem('token')||''}});const value=await r.json();if(!r.ok)throw Error(value.error);await load();}catch(e){setError(e instanceof Error?e.message:'Date check failed.');}finally{setChecking(false);}}
 const item:QueueItem=saved?{job:saved.job,controls:saved.record,eligibility:evaluateFollowup(saved.job,controlHistory(saved.record.state,saved.job),new Date().toISOString()),suggestion:null,earliestFirstApproach:null,sendEnabled:false}:{job:{_id:id,stage:'UNKNOWN'},eligibility:{state:'review',reason:'History view only'},suggestion:null,earliestFirstApproach:null,sendEnabled:false};
 return <main className="mx-auto max-w-3xl space-y-5 p-5"><Link href={`/jobs/${encodeURIComponent(id)}`} className="text-sm underline">← Back to job</Link><h1 className="text-2xl font-semibold">Follow-up history</h1>
  {saved?.preview&&<p className="rounded-xl bg-orange-50 p-3 text-sm">Interactive preview · Sample quotes · Sends are simulated</p>}
  {error&&<p role="alert">{error}</p>}
  {saved?.job.deadDateUncertain&&<div className="rounded-xl bg-amber-50 p-4 text-sm"><p>The last job save was interrupted.</p><button type="button" disabled={checking} className="min-h-11 font-semibold underline" onClick={()=>void checkDate()}>Check saved Dead date</button></div>}
  {saved&&classifyQuote(saved.job)==='dead'&&<FollowupControls key={`${saved.record.revision}:${saved.job.updatedAt}:${saved.job.deadDateUncertain}`} item={item} readOnly={saved.readOnly||Boolean(error)||checking} onSaved={()=>void load()} onAccessLost={()=>{setSaved(null);window.location.assign('/login');}}/>}
  <FollowupSender item={item} readOnly onChanged={()=>void load()} onAccessLost={()=>window.location.assign('/login')}/>
 </main>;
}
