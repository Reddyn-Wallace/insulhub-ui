import {attachDeadDate} from './date-repository';
import 'server-only';
import {ControlError} from './controls';
import {validQuote} from './server';
export async function readControlJob(token:string,id:string,withDate=true){
  if(!/^[a-f\d]{24}$/i.test(id))throw new ControlError('Quote not found.',404);
  const response=await fetch('https://api.insulhub.nz/graphql',{method:'POST',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'content-type':'application/json','x-access-token':token},body:JSON.stringify({query:`query FollowupAccess($_id:ObjectId!){me{_id firstname lastname role} job(_id:$_id){_id stage updatedAt archivedAt notes client{contactDetails{name email phoneMobile phoneSecondary}} lead{leadStatus callbackDate} quote{status date c_total}}}`,variables:{_id:id}})});
  if(!response.ok)throw new ControlError('Could not verify current quote access.',503);
  const json=await response.json();
  if(json.errors?.length)throw new ControlError('Could not verify current quote access.',503);
  if(!json.data?.me?._id)throw new ControlError('Sign in again.',401);
  const job=json.data.job;
  if(!job || job._id!==id)throw new ControlError('Quote not found.',404);
  if(!validQuote(job) || typeof job.updatedAt!=='string' || !Number.isFinite(Date.parse(job.updatedAt)))throw new ControlError('Could not verify the current quote version.',503);
  const me=json.data.me;
  return {job:withDate?await attachDeadDate(job):job,actor:{...(typeof me.role==='string'?{role:me.role}:{}),id:String(me._id),name:[me.firstname,me.lastname].filter(x=>typeof x==='string').join(' ') || String(me._id)}};
}
