import {ControlError} from './controls';
import {confirmedStatus,offerNote,type SendAttempt} from './sending';
export async function dispatchAttempt(claimed:boolean,deliver:()=>Promise<unknown>){if(!claimed)return;try{await deliver();}catch{/* Reconcile durable message status. Never replay an uncertain dispatch. */}}
export async function reconcileAttempt(a:SendAttempt,read:()=>Promise<{status:string;failure_reason:string}|undefined>):Promise<{status:SendAttempt['status'];failureReason:string}>{
 if(a.status==='sent'||a.status==='failed')return {status:a.status,failureReason:a.failureReason||''};
 const row=await read();
 return {status:row&&confirmedStatus(row.status)?'sent':row?.status==='failed'?'failed':row?.status==='accepted'?'accepted':'unknown',failureReason:row?.failure_reason||''};
}
export async function appendOfferNote(a:SendAttempt,deps:{read:()=>Promise<string>;write:(notes:string)=>Promise<unknown>}){
 if(a.status!=='sent'||!a.sentAt)throw new ControlError('Only confirmed sends can be added to job notes.',409);
 const marker=`[Dead quote follow-up ${a.id}]`;
 const before=await deps.read();if(before.includes(marker))return;
 const latest=await deps.read();if(latest.includes(marker))return;
 if(latest!==before)throw new ControlError('Job notes changed during this update. Retry the note only.',409);
 await deps.write([latest.trimEnd(),offerNote(a)].filter(Boolean).join('\n\n'));
 if(!(await deps.read()).includes(marker))throw new ControlError('Note update could not be confirmed. Retry the note only.',503);
}
