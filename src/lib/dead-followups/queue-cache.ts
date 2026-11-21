import { calendarDataRevision, calendarLastWrite } from '@/lib/calendar/cache';
import { clearBrowserCachePrefixes } from '@/lib/client-cache';
import { persistSharedBrowser, readSharedBrowser } from '@/lib/crm-read/shared-browser';
import type {QueueResponse} from './types';
const TTL=30_000;
// Display-only fallback while a fresh request runs. Never used by fetchQueue.
const STALE_TTL=10*60_000;
const snapshotKey='follow-up-queue';
export const followupSnapshotPrefix=`jobs-cache:shared-v1:${snapshotKey}:`;
type Entry={token:string;data:QueueResponse|null;at:number;writeAt:number;revision:number;pending:Promise<QueueResponse>|null};
let entry:Entry|null=null;
function isCurrent(current:Entry|null,token:string):current is Entry{
 return current?.token===token&&current.writeAt===calendarLastWrite()&&current.revision===calendarDataRevision();
}
export function cachedQueue(token:string,allowStale=false):QueueResponse|null {
 return isCurrent(entry,token)&&Date.now()-entry.at<(allowStale?STALE_TTL:TTL)?entry.data:null;
}
export function invalidateQueue(token:string,forgetSaved=false){
 if(entry?.token===token)entry=null;
 if(forgetSaved)clearBrowserCachePrefixes([followupSnapshotPrefix],['local']);
}
export async function restoreQueue(token:string){
 if(!token||typeof crypto==='undefined')return null;
 const saved=await readSharedBrowser<QueueResponse>(snapshotKey,snapshotKey,token,STALE_TTL);
 return saved?.data.detailsDeferred===true && Array.isArray(saved.data.items)
  ? {...saved.data,readOnly:true} : null;
}
export async function fetchQueue(token:string):Promise<QueueResponse>{
 const cached=cachedQueue(token);if(cached)return cached;
 if(!isCurrent(entry,token))entry={token,data:null,at:0,writeAt:calendarLastWrite(),revision:calendarDataRevision(),pending:null};
 const current=entry!;
 if(current.pending)return current.pending;
 current.pending=(async()=>{
  const startedAt=Date.now();
  const response=await fetch('/api/dead-followups?view=queue',{headers:{'x-access-token':token},cache:'no-store'});
  if(!response.ok){if(response.status===401||response.status===403){if(entry===current)invalidateQueue(token,true);}throw Object.assign(Error(response.status===401?'Sign in again to view Dead quotes.':'The full quote list could not be verified. Please retry.'),{status:response.status});}
  const data:QueueResponse=await response.json();
  if(!Array.isArray(data.items)||typeof data.readOnly!=='boolean'||typeof data.checkedAt!=='string')throw Error('The quote list could not be verified. Please retry.');
  if(entry!==current||!isCurrent(current,token))throw Error('Quotes changed while loading. Please retry.');
  current.data=data;current.at=Date.now();
  if(data.detailsDeferred===true&&token&&typeof crypto!=='undefined'){
   void persistSharedBrowser(snapshotKey,snapshotKey,token,{data:{...data,readOnly:true},checkedAt:startedAt,writeAt:current.writeAt},current.writeAt,current.revision,()=>entry===current);
  }
  return data;
 })();
 try{return await current.pending;}finally{current.pending=null;}
}
