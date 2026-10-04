import {classifyQuote,nzDateEnd} from './rules';
import type {DeadQuote} from './types';
export type DeadEntry={at:string;source:'last_note'|'quote_plus_30'|'ui_transition'|'ui_recovery';evidence:string};
const nzDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Pacific/Auckland',year:'numeric',month:'2-digit',day:'2-digit'});
export function quoteDay(job:DeadQuote):string|null{
 const raw=job.quote?.date;if(!raw)return null;
 try{if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){nzDateEnd(raw);return raw;}
 if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw)||!Number.isFinite(Date.parse(raw)))return null;
 nzDateEnd(raw.slice(0,10));
 return nzDay.format(new Date(raw));}catch{return null;}
}
export function quoteInCohort(job:DeadQuote){const day=quoteDay(job);return day!==null&&day>='2026-01-01';}
export function assumedEntry(job:DeadQuote,now:string):DeadEntry|null{
 if(!quoteInCohort(job)||classifyQuote(job)!=='dead')return null;
 let latest:DeadEntry|null=null;let generated=false;
 for(const line of (job.notes||'').split(/\r?\n/)){
  if(line.startsWith('[Dead quote follow-up ')){generated=true;continue;}
  const match=line.match(/^\s*(?:(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})|(\d{4}-\d{2}-\d{2}))\s+-\s+/);
  if(!match){if(generated)continue;continue;}generated=false;
  const day=match[4]||`${match[3].length===2?'20'+match[3]:match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
  try{const at=nzDateEnd(day);if(day>nzDay.format(new Date(now)))continue;
   if(!latest||at>latest.at)latest={at,source:'last_note',evidence:line.trim()};
  }catch{/* An invalid stamp is not dated evidence. */}
 }
 if(latest)return latest;
 const day=new Date(`${quoteDay(job)}T12:00:00Z`);day.setUTCDate(day.getUTCDate()+30);
 return {at:nzDateEnd(day.toISOString().slice(0,10)),source:'quote_plus_30',evidence:'No dated CRM note: quote date plus 30 days.'};
}
export function transitionKind(before:DeadQuote,after:DeadQuote):'entered'|'left'|null{
 const was=classifyQuote(before)==='dead',is=classifyQuote(after)==='dead';return was===is?null:is?'entered':'left';
}
export function isTrackedMutation(query:string,variables?:Record<string,unknown>):string|null{
 if(!/^\s*mutation\b/.test(query))return null;
 const input=variables?.input as {_id?:unknown}|undefined;
 const id=/\bupdateJob\s*\(/.test(query)?input?._id:/\barchiveJob\s*\(/.test(query)?variables?._id:null;
 return typeof id==='string'?id:null;
}
export function entryLabel(entry:DeadEntry){return entry.source==='ui_transition'?'Recorded in this UI':entry.source==='ui_recovery'?'Confirmed after an interrupted save':entry.source==='last_note'?'Assumed from last dated note':'Assumed from quote date + 30 days';}
