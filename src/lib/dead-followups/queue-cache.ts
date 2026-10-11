import type {QueueResponse} from './types';
const TTL=30_000;
type Entry={token:string;data:QueueResponse|null;at:number;pending:Promise<QueueResponse>|null};
let entry:Entry|null=null;
export function cachedQueue(token:string):QueueResponse|null {
 return entry?.token===token&&Date.now()-entry.at<TTL?entry.data:null;
}
export function invalidateQueue(token:string){if(entry?.token===token)entry=null;}
export async function fetchQueue(token:string):Promise<QueueResponse>{
 const cached=cachedQueue(token);if(cached)return cached;
 if(entry?.token!==token)entry={token,data:null,at:0,pending:null};
 const current=entry!;
 if(current.pending)return current.pending;
 current.pending=(async()=>{
  const response=await fetch('/api/dead-followups',{headers:{'x-access-token':token},cache:'no-store'});
  if(!response.ok){if(response.status===401||response.status===403){if(entry===current)entry=null;}throw Object.assign(Error(response.status===401?'Sign in again to view Dead quotes.':'The full quote list could not be verified. Please retry.'),{status:response.status});}
  const data:QueueResponse=await response.json();
  if(!Array.isArray(data.items)||typeof data.readOnly!=='boolean'||typeof data.checkedAt!=='string')throw Error('The quote list could not be verified. Please retry.');
  if(entry===current){current.data=data;current.at=Date.now();}
  return data;
 })();
 try{return await current.pending;}finally{current.pending=null;}
}
