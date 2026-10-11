// Local sample state only. No database, provider or network dependencies.
import {randomUUID} from 'node:crypto';
import {emptyControls,applyControl,controlHistory,ControlError} from '../../src/lib/dead-followups/controls';
import {evaluateFollowup} from '../../src/lib/dead-followups/rules';
import {prepareSend,offerNote,type SendAttempt} from '../../src/lib/dead-followups/sending';
import {defaultTemplates,ordinaryTemplate} from '../../src/lib/dead-followups/templates';
import {buildContactTemplateFields,type ContactTemplate} from '../../src/lib/contact-template-fields';
import type {ControlRecord,ControlEvent,DeadQuote,QueueResponse} from '../../src/lib/dead-followups/types';
const senderId='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
type Sample={job:DeadQuote;record:ControlRecord;events:ControlEvent[];attempts:SendAttempt[]};
export type PreviewState={version:2;samples:Sample[];templates:ContactTemplate[]};
function seed(now:string):PreviewState{
 const ago=(days:number)=>new Date(Date.parse(now)-days*86400000).toISOString();
 const samples=['Alex Example','Morgan Sample','Taylor Demo'].map((name,index):Sample=>{
  const id=String(index+1).repeat(24);const entered=ago(index===2?15:200);const quoteDate='2026-01-10';
  const job:DeadQuote={_id:id,jobNumber:1201+index,stage:'QUOTE',updatedAt:ago(1),notes:'Sample quote — use this to try the follow-up workflow.',quote:{status:'DECLINED',date:quoteDate,quoteNumber:1201+index,c_total:12500+index*2000,wall:{SQM:90},ceiling:index===0?null:{SQM:50},extras:index===0?[{name:'Existing promotional discount',price:-750}]:[]},lead:{leadStatus:'DEAD'},client:{contactDetails:{name,email:`sample${index+1}@example.test`,phoneMobile:'0210000000',streetAddress:`${index+1} Example Street`,city:'Wellington'}},deadEntry:{at:entered,source:'last_note',evidence:'Sample historical date'}};
  const state={...emptyControls(),draftDiscountCents:50000,reviewedVersion:job.updatedAt!,deadDate:entered};
  if(index===1)state.offers.push({number:1,sentAt:ago(150),discountCents:40000,channel:'email',source:'staff_recorded',evidence:'Sample first offer, already sent.'});
  return {job,record:{revision:1,state,actorName:'Preview Staff',updatedAt:ago(1)},events:[],attempts:[]};
 });
 return {version:2,samples,templates:defaultTemplates().map(t=>({...ordinaryTemplate(t),id:randomUUID()}))};
}
export class FollowupPreview{
 readonly state:PreviewState;
 constructor(saved?:PreviewState,private readonly now=()=>new Date().toISOString()) {this.state=saved?.version===2?saved:seed(now());}
 private sample(id:string){const s=this.state.samples.find(s=>s.job._id===id);if(!s)throw new ControlError('Sample quote not found.',404);return s;}
 queue():QueueResponse{return {quoteCounts:{OPEN:0,CALLBACK:0,DEAD:this.state.samples.length,ALL:this.state.samples.length},preview:true,readOnly:false,historyAvailable:true,checkedAt:this.now(),items:this.state.samples.map(s=>({job:s.job,controls:s.record,eligibility:evaluateFollowup(s.job,controlHistory(s.record.state,s.job),this.now()),suggestion:null,earliestFirstApproach:null,sendAvailable:true,sendEnabled:true}))};}
 history(id:string){const s=this.sample(id);return {job:s.job,record:s.record,events:s.events,readOnly:false,preview:true};}
 change(id:string,input:{revision:number;jobVersion:string;command:unknown}){
  const s=this.sample(id);if(input.revision!==s.record.revision||input.jobVersion!==s.job.updatedAt)throw new ControlError('Refresh this sample quote before saving.',409);
  const next=applyControl(s.record.state,input.command,s.job,this.now());
  s.record={revision:s.record.revision+1,state:next,actorName:'Preview Staff',updatedAt:this.now()};
  s.events.unshift(structuredClone({...s.record,createdAt:this.now(),action:String((input.command as {action:string}).action),reason:''}));return {record:s.record};
 }
 sender(id:string){const s=this.sample(id);return {enabled:true,attempts:s.attempts,contact:s.job.client?.contactDetails,templates:this.state.templates,templateFields:buildContactTemplateFields(s.job,'Preview Staff'),sms:{senders:[{id:senderId,label:'Preview SMS — simulated'}]},email:{senders:[{id:senderId,label:'Preview email — simulated',senderValue:'preview@example.test'}]}};}
 send(id:string,input:Record<string,unknown>){
  const s=this.sample(id);
  if(input.action!=='send'){
   if(!['check','note'].includes(String(input.action)))throw new ControlError('Unsupported preview action.');
   const attempt=s.attempts.find(a=>a.id===input.attemptId);if(!attempt)throw new ControlError('Sample send not found.',404);return {attempt,noteError:''};
  }
  const previous=s.attempts.find(a=>a.requestId===input.requestId);if(previous)return {attempt:previous,noteError:''};
  if(input.revision!==s.record.revision||input.senderId!==senderId)throw new ControlError('Refresh before sending the sample offer.',409);
  const snapshot=prepareSend(input,s.record.state,s.job,this.now());
  const expected=snapshot.channel==='email'?s.job.client?.contactDetails?.email:s.job.client?.contactDetails?.phoneMobile;
  if(input.destination!==expected)throw new ControlError('Use the sample contact.');
  const attempt:SendAttempt={...snapshot,id:randomUUID(),jobId:id,actorId:'preview',actorName:'Preview Staff',status:'sent',createdAt:this.now(),sentAt:this.now(),noteStatus:'saved',failureReason:''};
  s.attempts.unshift(attempt);s.record.state.offers.push({number:attempt.approach,sentAt:attempt.sentAt!,discountCents:attempt.discountCents,channel:attempt.channel,evidence:'Simulated preview send',source:'provider_sent',attemptId:attempt.id});s.record.revision++;s.record.updatedAt=this.now();
  s.job.notes=(s.job.notes||'')+'\n\n'+offerNote(attempt);s.job.updatedAt=this.now();
  return {attempt,noteError:''};
 }
 templateRead(){return {preview:true,templates:this.state.templates};}
 templateWrite(id:string,input:Partial<ContactTemplate>){
  const existing=this.state.templates.find(t=>t.id===id);if(!existing)throw new ControlError('Template not found.',404);
  const next={...existing,...input,id};
  if(!next.title?.trim()||!next.body?.trim()||!['sms','email','calendar'].includes(next.channel))throw new ControlError('Template name, channel and message are required.');
  Object.assign(existing,next);return {template:existing};
 }
 templateCreate(input:Partial<ContactTemplate>){
  if(!input.title?.trim()||!input.body?.trim()||!input.channel||!['sms','email','calendar'].includes(input.channel))throw new ControlError('Template name, channel and message are required.');
  const template:ContactTemplate={id:randomUUID(),title:input.title,channel:input.channel,body:input.body,subject:input.subject||'',description:input.description||'',sortOrder:Number(input.sortOrder)||0};
  this.state.templates.push(template);return {template};
 }
 templateDelete(id:string){const index=this.state.templates.findIndex(t=>t.id===id);if(index<0)throw new ControlError('Template not found.',404);this.state.templates.splice(index,1);return {ok:true};}
}
