import 'server-only';
import {attachDeadDates} from './date-repository';
import {controlsRepository,emptyRecord} from './repository';
import {controlHistory} from './controls';
import {sendsRepository} from './send-repository';
import {evaluateFollowup} from './rules';
import {readBatchedQueueHistory} from './queue-history';
import type {DeadQuote,QueueResponse} from './types';

async function readHistory(jobs:DeadQuote[],persistDates?:boolean){
  const ids=jobs.map(job=>job._id);
  const repo=controlsRepository();const sends=repo?sendsRepository():null;
  const [dates,saved,attempts]=await Promise.allSettled([
    attachDeadDates(jobs,persistDates),
    repo?repo.list(ids):Promise.resolve(null),
    sends?sends.summaries(ids):Promise.resolve(null),
  ]);
  if(dates.status==='rejected')throw dates.reason;
  if(saved.status==='rejected'){
    if((saved.reason as {code?:string}).code==='42P01')return {jobs:dates.value,records:null,attempts:null};
    throw saved.reason;
  }
  if(!saved.value)return {jobs:dates.value,records:null,attempts:null};
  if(attempts.status==='rejected'&&(attempts.reason as {code?:string}).code!=='42P01')throw attempts.reason;
  return {jobs:dates.value,records:saved.value,attempts:attempts.status==='fulfilled'?attempts.value:null};
}

export async function decorateQueue(queue:QueueResponse,persistDates?:boolean):Promise<QueueResponse>{
  const jobs=queue.items.map(item=>item.job);
  const {jobs:dated,records,attempts:summaries}=await readBatchedQueueHistory(jobs,persistDates)??await readHistory(jobs,persistDates);
  queue={...queue,items:queue.items.map((item,i)=>({...item,job:dated[i]}))};
  if(!records)return queue;
  const sendAvailable=summaries!==null;
  const pending=new Set<string>();const notes=new Set<string>();
  for(const row of summaries||[]){if(['sending','accepted','unknown'].includes(row.status))pending.add(row.insulhub_job_id);if(row.status==='sent'&&row.note_status!=='saved')notes.add(row.insulhub_job_id);}
  return {...queue,readOnly:process.env.DEAD_QUOTE_FOLLOWUPS_ENABLED!=='true',historyAvailable:true,items:queue.items.map(item=>{
    const controls=records[item.job._id]||emptyRecord();
    return {...item,controls,notePending:notes.has(item.job._id),sendAvailable,sendEnabled:sendAvailable&&process.env.DEAD_QUOTE_FOLLOWUP_SEND_ENABLED==='true'&&process.env.DEAD_QUOTE_FOLLOWUPS_ENABLED==='true',eligibility:pending.has(item.job._id)?{state:'attention' as const,reason:'A send is awaiting confirmation. Check its status before sending again.'}:evaluateFollowup(item.job,controlHistory(controls.state,item.job),queue.checkedAt)};
  })};
}
