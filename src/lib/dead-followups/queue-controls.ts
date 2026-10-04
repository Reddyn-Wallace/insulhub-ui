import {attachDeadDates} from './date-repository';
import 'server-only';
import {controlsRepository,emptyRecord} from './repository';
import {controlHistory} from './controls';
import {sendsRepository} from './send-repository';
import {evaluateFollowup} from './rules';
import type {QueueResponse} from './types';
export async function decorateQueue(queue:QueueResponse):Promise<QueueResponse>{
  const jobs=await attachDeadDates(queue.items.map(item=>item.job));
  queue={...queue,items:queue.items.map((item,i)=>({...item,job:jobs[i]}))};
  const repo=controlsRepository();
  if(!repo)return queue;
  try {
    const saved=await repo.list(queue.items.map(item=>item.job._id));
    const sends=sendsRepository();let summaries:Awaited<ReturnType<NonNullable<typeof sends>['summaries']>>=[];let sendAvailable=false;
    if(sends){try{summaries=await sends.summaries(queue.items.map(x=>x.job._id));sendAvailable=true;}catch(e){if((e as {code?:string}).code!=='42P01')throw e;}}
    return {...queue,readOnly:process.env.DEAD_QUOTE_FOLLOWUPS_ENABLED!=='true',historyAvailable:true,items:queue.items.map(item=>{
      const controls=saved[item.job._id] || emptyRecord();
      const pending=summaries.some(x=>x.insulhub_job_id===item.job._id&&['sending','accepted','unknown'].includes(x.status));
      return {...item,controls,notePending:summaries.some(x=>x.insulhub_job_id===item.job._id&&x.status==='sent'&&x.note_status!=='saved'),sendAvailable,sendEnabled:sendAvailable&&process.env.DEAD_QUOTE_FOLLOWUP_SEND_ENABLED==='true'&&process.env.DEAD_QUOTE_FOLLOWUPS_ENABLED==='true',eligibility:pending?{state:'attention' as const,reason:'A send is awaiting confirmation. Check its status before sending again.'}:evaluateFollowup(item.job,controlHistory(controls.state,item.job),queue.checkedAt)};
    })};
  }catch(error){
    // Only an explicitly missing migration permits read-only fallback. A failed
    // read must not silently discard exclusions or earlier offers.
    if((error as {code?:string}).code==='42P01')return queue;
    throw error;
  }
}
