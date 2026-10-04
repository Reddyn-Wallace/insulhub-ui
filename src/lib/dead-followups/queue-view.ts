import {controlHistory,emptyControls} from './controls';
import {evaluateFollowup} from './rules';
import type {QueueItem} from './types';
export function matchesView(row:QueueItem,view:string,now:string){
 const snoozed=Boolean(row.controls?.state.snoozedUntil&&Date.parse(row.controls.state.snoozedUntil)>Date.parse(now));
 if(view==='all')return true;
 if(view==='review')return row.eligibility.state==='review'||row.eligibility.state==='attention'||Boolean(row.notePending);
 if(view==='snoozed')return snoozed&&row.eligibility.state!=='excluded';
 if(view==='due')return row.eligibility.state==='due'&&!snoozed;
 return row.eligibility.state===view;
}
export function sortQueueItems(items:QueueItem[]){
 const priority=(x:QueueItem)=>x.notePending?0:({attention:0,due:1,review:2,waiting:3,complete:4,excluded:5}[x.eligibility.state]);
 const due=(x:QueueItem)=>Number.isFinite(Date.parse(x.eligibility.dueAt||''))?Date.parse(x.eligibility.dueAt!):Number.MAX_SAFE_INTEGER;
 return [...items].sort((a,b)=>priority(a)-priority(b)||due(a)-due(b)||a.job._id.localeCompare(b.job._id));
}

/** Display due work only; the send endpoint still requires a real history review. */
export function needsFollowup(row:QueueItem,now:string){
 if(['attention','excluded','complete'].includes(row.eligibility.state))return false;
 const history=controlHistory(row.controls?.state||emptyControls(),row.job);
 return evaluateFollowup(row.job,{...history,historyReviewed:true},now).state==='due';
}
