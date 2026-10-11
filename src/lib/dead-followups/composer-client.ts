import type {OfferTemplate} from './templates';
import type {QueueItem} from './types';
type Sender={id:string;label:string;senderValue?:string};
export type ComposerDetails={templates?:OfferTemplate[];enabled:boolean;attempts:{status:string;approach:number}[];contact:{name?:string;email?:string;phoneMobile?:string;phoneSecondary?:string};sms:{senders:Sender[]};email:{senders:Sender[]}};
let session='';
const cache=new Map<string,{expires:number;data?:ComposerDetails;promise:Promise<ComposerDetails>}>();
function key(item:QueueItem){const token=localStorage.getItem('token')||'';if(token!==session){cache.clear();session=token;}return `${item.job._id}:${item.job.updatedAt}:${item.controls?.revision}`;}
export function cachedComposerDetails(item:QueueItem){const entry=cache.get(key(item));return entry&&entry.expires>Date.now()?entry.data:undefined;}
export function clearComposerDetails(){cache.clear();}
export function loadComposerDetails(item:QueueItem):Promise<ComposerDetails>{
 const id=key(item);const existing=cache.get(id);if(existing&&existing.expires>Date.now())return existing.promise;
 const token=session;
 const entry={expires:Infinity,data:undefined as ComposerDetails|undefined,promise:Promise.resolve(null as unknown as ComposerDetails)};
 entry.promise=fetch(`/api/jobs/${item.job._id}/dead-followup/send`,{headers:{'x-access-token':token},cache:'no-store'}).then(async response=>{
  if(!response.ok)throw Object.assign(new Error('Could not load sending details. Close and reopen the offer to retry.'),{status:response.status});
  const data=await response.json() as ComposerDetails;
  if(!data.sms||!data.email||!Array.isArray(data.attempts))throw Error('Sending details could not be verified.');
  if(localStorage.getItem('token')!==token)throw Error('Your session changed. Reopen the quote.');
  entry.data=data;entry.expires=Date.now()+300000;return data;
 }).catch(error=>{if(cache.get(id)===entry)cache.delete(id);throw error;});
 if(cache.size>=20)cache.delete(cache.keys().next().value!);cache.set(id,entry);return entry.promise;
}
