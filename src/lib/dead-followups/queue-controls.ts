import 'server-only';
import {attachDeadDates} from './date-repository';
import {controlsRepository,emptyRecord} from './repository';
import {controlHistory} from './controls';
import {sendsRepository} from './send-repository';
import {evaluateFollowup} from './rules';
import type {QueueResponse} from './types';
export async function decorateQueue(queue:QueueResponse):Promise<QueueResponse>{
  const ids=queue.items.map(item=>item.job._id);
  const repo=controlsRepository();const sends=repo?sendsRepository():null;
  // These independent reads used to run serially. All results are checked before publishing a queue.
  const [dates,saved,attempts]=await Promise.allSettled([
    attachDeadDates(queue.items.map(item=>item.job)),
    repo?repo.list(ids):Promise.resolve(null),
    sends?sends.summaries(ids):Promise.resolve(null),
  ]);
  if(dates.status==='rejected')throw dates.reason;
  queue={...queue,items:queue.items.map((item,i)=>({...item,job:dates.value[i]}))};
  if(saved.status==='rejected'){
    if((saved.reason as {code?:string}).code==='42P01')return queue;
    throw saved.reason;
  }
  if(!saved.value)return queue;
  if(attempts.status==='rejected'&&(attempts.reason as {code?:string}).code!=='42P01')throw attempts.reason;
  const summaries=attempts.status==='fulfilled'?attempts.value:null;
  const sendAvailable=summaries!==null;
  const pending=new Set<string>();const notes=new Set<string>();
  for(const row of summaries||[]){if(['sending','accepted','unknown'].includes(row.status))pending.add(row.insulhub_job_id);if(row.status==='sent'&&row.note_status!=='saved')notes.add(row.insulhub_job_id);}
  const records=saved.value;
  return {...queue,readOnly:process.env.DEAD_QUOTE_FOLLOWUPS_ENABLED!=='true',historyAvailable:true,items:queue.items.map(item=>{
    const controls=records[item.job._id]||emptyRecord();
    return {...item,controls,notePending:notes.has(item.job._id),sendAvailable,sendEnabled:sendAvailable&&process.env.DEAD_QUOTE_FOLLOWUP_SEND_ENABLED==='true'&&process.env.DEAD_QUOTE_FOLLOWUPS_ENABLED==='true',eligibility:pending.has(item.job._id)?{state:'attention' as const,reason:'A send is awaiting confirmation. Check its status before sending again.'}:evaluateFollowup(item.job,controlHistory(controls.state,item.job),queue.checkedAt)};
  })};
}
