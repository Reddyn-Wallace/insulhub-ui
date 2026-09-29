import 'server-only';
import {controlsRepository,emptyRecord} from './repository';
import {controlHistory} from './controls';
import {evaluateFollowup} from './rules';
import type {QueueResponse} from './types';
export async function decorateQueue(queue:QueueResponse):Promise<QueueResponse>{
  const repo=controlsRepository();
  if(!repo)return queue;
  try {
    const saved=await repo.list(queue.items.map(item=>item.job._id));
    return {...queue,readOnly:process.env.DEAD_QUOTE_FOLLOWUPS_ENABLED!=='true',historyAvailable:true,items:queue.items.map(item=>{
      const controls=saved[item.job._id] || emptyRecord();
      return {...item,controls,eligibility:evaluateFollowup(item.job,controlHistory(controls.state,item.job),queue.checkedAt)};
    })};
  }catch(error){
    // Only an explicitly missing migration permits read-only fallback. A failed
    // read must not silently discard exclusions or earlier offers.
    if((error as {code?:string}).code==='42P01')return queue;
    throw error;
  }
}
