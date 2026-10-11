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
export function waitingSince(row:QueueItem):string|null {
 const first=row.controls?.state.offers.find(offer=>offer.number===1);
 const at=first?.sentAt||controlHistory(row.controls?.state||emptyControls(),row.job).entry?.at;
 return at&&Number.isFinite(Date.parse(at))?at:null;
}
export function waitingLabel(row:QueueItem,now:string):string|null {
 const at=waitingSince(row);if(!at||!Number.isFinite(Date.parse(now)))return null;
 const nzDay=(value:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Pacific/Auckland',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
 const days=Math.max(0,Math.round((Date.parse(nzDay(now))-Date.parse(nzDay(at)))/86400000));
 const duration=`${days} ${days===1?'day':'days'}`;
 return row.controls?.state.offers.some(offer=>offer.number===1)?`${duration} since first follow-up`:`In Dead for ${duration}`;
}
export function sortQueueItems(items:QueueItem[]){
 const start=(row:QueueItem)=>{const at=waitingSince(row);return at?Date.parse(at):Number.MAX_SAFE_INTEGER;};
 return [...items].sort((a,b)=>start(a)-start(b)||a.job._id.localeCompare(b.job._id));
}

/** Display due work only; the send endpoint still requires a real history review. */
export function needsFollowup(row:QueueItem,now:string){
 if(['attention','excluded','complete'].includes(row.eligibility.state))return false;
 const history=controlHistory(row.controls?.state||emptyControls(),row.job);
 return evaluateFollowup(row.job,{...history,historyReviewed:true},now).state==='due';
}
