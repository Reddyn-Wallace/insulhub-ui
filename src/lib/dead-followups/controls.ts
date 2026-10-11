import {assumedEntry,entryLabel,quoteInCohort} from './dates';
import { classifyQuote, nzDateEnd } from './rules';
import type { ControlState, DeadQuote, FollowupHistory } from './types';
export class ControlError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function emptyControls(): ControlState {
  return {draftDiscountCents:null,snoozedUntil:null,exclusionReason:null,deadDate:null,dateEvidence:'',reviewedVersion:null,offers:[]};
}
export function parseDiscount(input: unknown): number {
  if (typeof input !== 'string' || !/^\d{1,8}(?:\.\d{1,2})?$/.test(input)) throw new ControlError('Enter a dollar amount with no more than two decimal places.');
  const [dollars,cents='']=input.split('.');
  return Number(dollars)*100+Number(cents.padEnd(2,'0'));
}
function text(value: unknown, label: string): string {
  if(typeof value!=='string' || !value.trim() || value.length>2000 || value.includes('\0'))throw new ControlError(`${label} is required (up to 2,000 characters).`);
  return value.trim();
}
function date(value: unknown, now: string, future: boolean): string {
  if(typeof value!=='string')throw new ControlError('Choose a valid date.');
  let at:string;
  try{at=nzDateEnd(value);}catch{throw new ControlError('Choose a valid date.');}
  if(future){if(Date.parse(at)<=Date.parse(now))throw new ControlError('Choose a future snooze date.');return at;}
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Pacific/Auckland',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  if(value>today)throw new ControlError('Historical dates cannot be in the future.');
  return new Date(Math.min(Date.parse(at),Date.parse(now))).toISOString();
}
export function applyControl(current: ControlState, input: unknown, job: DeadQuote, now: string): ControlState {
  if(!quoteInCohort(job) || job.deadDateUncertain || classifyQuote(job)!=='dead' || !job.updatedAt)throw new ControlError('This quote is no longer eligible or its current version could not be verified. Refresh it.',409);
  if(!input || typeof input!=='object' || Array.isArray(input))throw new ControlError('Invalid follow-up change.');
  const value=input as Record<string,unknown>;
  const next:ControlState={...current,offers:[...current.offers]};
  switch(value.action){
    case 'discount': {
      const amount=parseDiscount(value.amount);
      if(job.quote?.c_total==null || amount>Math.round(job.quote.c_total*100))throw new ControlError('The discount must not exceed the current quote total.');
      next.draftDiscountCents=amount;break;
    }
    case 'snooze': next.snoozedUntil=date(value.date,now,true);break;
    case 'unsnooze': next.snoozedUntil=null;break;
    case 'exclude': next.exclusionReason=text(value.reason,'An exclusion reason');break;
    case 'restore': next.exclusionReason=null;break;
    case 'review':
      if(value.historyConfirmed!==true)throw new ControlError('Review the notes and prior communications, then confirm all earlier offers are recorded.');
      {const entry=job.deadEntry===undefined?assumedEntry(job,now):job.deadEntry;
      next.deadDate=entry?.at || date(value.date,now,false);next.dateEvidence=entry?`${entryLabel(entry)}: ${entry.evidence}`:text(value.evidence,'Date evidence');next.reviewedVersion=job.updatedAt;break;}
    case 'record_offer': {
      if(current.offers.length>=2)throw new ControlError('Two individual approaches are already recorded.');
      if(value.channel!=='sms' && value.channel!=='email')throw new ControlError('Choose SMS or email.');
      const sentAt=date(value.date,now,false);
      if(current.offers.length && sentAt<current.offers[current.offers.length-1].sentAt)throw new ControlError('The second offer cannot precede the first.');
      next.offers.push({number:current.offers.length===0?1:2,sentAt,discountCents:parseDiscount(value.amount),channel:value.channel,evidence:text(value.evidence,'Send evidence'),source:'staff_recorded'});
      next.reviewedVersion=null;break;
    }
    case 'remove_latest_offer':
      text(value.reason,'A correction reason');
      if(!next.offers.length)throw new ControlError('No historical offer to correct.');
      if(next.offers.at(-1)?.source!=='staff_recorded')throw new ControlError('A confirmed CRM send cannot be removed.');
      next.offers.pop();next.reviewedVersion=null;break;
    default:throw new ControlError('Unknown follow-up action.');
  }
  return next;
}
export function controlHistory(state: ControlState, job: DeadQuote): FollowupHistory {
  const automatic=job.deadEntry===undefined?assumedEntry(job,new Date().toISOString()):job.deadEntry;
  return {entry:automatic?{at:automatic.at,provenance:automatic.source.startsWith('ui_')?'ui':'assumed',reviewed:true}:state.deadDate?{at:state.deadDate,provenance:'staff',reviewed:true}:null,
    historyReviewed:Boolean(state.reviewedVersion && state.reviewedVersion===job.updatedAt),
    approaches:state.offers.map(offer=>({...offer,status:'sent' as const})),
    snoozedUntil:state.snoozedUntil || undefined,excluded:Boolean(state.exclusionReason)};
}
