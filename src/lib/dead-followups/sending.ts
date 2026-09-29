import type {Verification} from './verification';
import {defaultTemplates,renderTemplate} from './templates';
import {ControlError,controlHistory} from './controls';
import {evaluateFollowup} from './rules';
import {validateSmsInput} from '@/lib/job-sms';
import {validateJobEmail} from '@/lib/job-email';
import type {ControlState,DeadQuote} from './types';
export const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export type SendSnapshot={requestId:string;channel:'sms'|'email';senderId:string;destination:string;body:string;subject:string;discountCents:number;approach:1|2};
export type SendAttempt=SendSnapshot & {verification?:Verification;id:string;jobId:string;actorId:string;actorName:string;status:'sending'|'accepted'|'unknown'|'failed'|'sent';createdAt:string;sentAt:string|null;noteStatus:'pending'|'saved';failureReason:string};
export function confirmedStatus(status:string){return status==='sent'||status==='delivered';}
export function followupTemplate(approach:1|2,cents:number){
 return renderTemplate(defaultTemplates().find(t=>t.channel==='sms'&&t.approach===approach)!,{discountCents:cents});
}
export function prepareSend(input:unknown,state:ControlState,job:DeadQuote,now:string):SendSnapshot{
 if(!input || typeof input!=='object')throw new ControlError('Invalid send request.');
 const v=input as Record<string,unknown>;
 if(typeof v.requestId!=='string'||!uuid.test(v.requestId)||typeof v.senderId!=='string'||!uuid.test(v.senderId)||!Number.isInteger(v.revision)||v.jobVersion!==job.updatedAt)throw new ControlError('Refresh and review this quote before sending.',409);
 const eligibility=evaluateFollowup(job,controlHistory(state,job),now);
 if(eligibility.state!=='due'||!eligibility.approach)throw new ControlError(eligibility.reason,409);
 const cents=state.draftDiscountCents;
 if(cents===null||!Number.isSafeInteger(cents)||cents<0||job.quote?.c_total==null||cents>Math.round(job.quote.c_total*100))throw new ControlError('Save a valid discount amount before sending.');
 if(v.channel!=='sms'&&v.channel!=='email')throw new ControlError('Choose SMS or email.');
 let message:{destination:string;body:string;subject?:string};
 try{message=v.channel==='sms'?validateSmsInput({body:v.body,destination:v.destination}):validateJobEmail(v);}catch(e){throw new ControlError((e as Error).message);}
 // Use an explicit exact amount in the edited message so the stored offer is visible to the customer.
 const amount='$'+(cents/100).toFixed(2);
 if(!message.body.includes(amount)||new RegExp('\\'+amount.replace('.','\\.')+'[0-9]').test(message.body))throw new ControlError(`Include the saved discount ${amount} in the message.`);
 return {requestId:v.requestId,channel:v.channel,senderId:v.senderId,destination:message.destination,body:message.body,subject:message.subject||'',discountCents:cents,approach:eligibility.approach};
}
export function offerNote(attempt:Pick<SendAttempt,'id'|'approach'|'discountCents'|'channel'|'actorName'|'sentAt'|'verification'>){
 const day=new Date(attempt.sentAt!).toLocaleString('en-NZ',{timeZone:'Pacific/Auckland'});
 return `[Dead quote follow-up ${attempt.id}]\n${day} (NZ time) — Approach ${attempt.approach} sent by ${attempt.channel.toUpperCase()}. Discount offered: NZD $${(attempt.discountCents/100).toFixed(2)}. Staff: ${attempt.actorName}.${attempt.verification?`\nSent verified by ${attempt.verification.actorName}: ${attempt.verification.evidence}`:''}`;
}
