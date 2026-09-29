import {NextRequest,NextResponse} from 'next/server';
import {requireInsulhubAuth,tokenFromRequest} from '@/lib/insulhub-auth';
import {readControlJob} from '@/lib/dead-followups/access';
import {ControlError} from '@/lib/dead-followups/controls';
import {sendsRepository} from '@/lib/dead-followups/send-repository';
import {dispatchAttempt,reconcileAttempt,appendOfferNote} from '@/lib/dead-followups/send-service';
import {uuid,type SendAttempt} from '@/lib/dead-followups/sending';
import {classifyQuote} from '@/lib/dead-followups/rules';
import {POST as smsPost,GET as smsGet} from '@/app/api/jobs/[id]/sms/route';
import {POST as emailPost,GET as emailGet} from '@/app/api/jobs/[id]/email/route';
export const maxDuration=60;
type Context={params:Promise<{id:string}>};
const headers={'cache-control':'private, no-store'};
function failure(e:unknown){return NextResponse.json({error:e instanceof ControlError?e.message:'Could not confirm this operation. Refresh the saved attempt before sending again.'},{status:e instanceof ControlError?e.status:503,headers});}
function enabled(){return process.env.DEAD_QUOTE_FOLLOWUPS_ENABLED==='true'&&process.env.DEAD_QUOTE_FOLLOWUP_SEND_ENABLED==='true';}
async function saveNote(token:string,a:SendAttempt,repo:NonNullable<ReturnType<typeof sendsRepository>>){
 await repo.withNoteLock(a.jobId,async()=>{
  await appendOfferNote(a,{read:async()=>{const {job}=await readControlJob(token,a.jobId);return job.notes||'';},write:async notes=>{
   const response=await fetch('https://api.insulhub.nz/graphql',{method:'POST',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'content-type':'application/json','x-access-token':token},body:JSON.stringify({query:'mutation FollowupNote($input:UpdateJobInput!){updateJob(input:$input){_id notes}}',variables:{input:{_id:a.jobId,notes}}})});
   const json=await response.json();if(!response.ok||json.errors?.length||json.data?.updateJob?._id!==a.jobId)throw new ControlError('The offer was sent, but the job note could not be confirmed. Retry the note only.',503);
  }});
 });
 // Release the advisory-lock connection before requesting another pooled connection.
 await repo.noteSaved(a.id);
}
export async function GET(request:NextRequest,context:Context){
 try{
  const denied=await requireInsulhubAuth(request);if(denied)return denied;
  const {id}=await context.params;const {job}=await readControlJob(tokenFromRequest(request),id);
  const repo=sendsRepository();if(!repo)throw new ControlError('Sending storage needs setup.',503);
  const [attempts,sms,email]=await Promise.all([repo.list(id),smsGet(request,context),emailGet(request,context)]);
  return NextResponse.json({attempts,enabled:enabled(),contact:job.client?.contactDetails||{},sms:sms.ok?await sms.json():{senders:[]},email:email.ok?await email.json():{senders:[]}},{headers});
 }catch(e){return failure(e);}
}
export async function POST(request:NextRequest,context:Context){
 try{
  const denied=await requireInsulhubAuth(request);if(denied)return denied;
  const raw=await request.text();if(raw.length>30000)throw new ControlError('Message is too large.');
  let input;try{input=JSON.parse(raw);}catch{throw new ControlError('Invalid send request.');}
  if(!input||!['send','check','note'].includes(input.action))throw new ControlError('Choose a valid action.');
  const {id}=await context.params;const token=tokenFromRequest(request);const {job,actor}=await readControlJob(token,id);
  const repo=sendsRepository();if(!repo)throw new ControlError('Sending storage needs setup.',503);
  let a:SendAttempt;
  let rejection='';
  if(input.action==='send'){
   if(!enabled())throw new ControlError('Follow-up sending is not enabled.',503);
   if(typeof input.requestId!=='string'||!uuid.test(input.requestId))throw new ControlError('Invalid send reference.');
   const claim=await repo.claim(job,input,actor);a=claim.attempt;
   if(claim.claimed){
    const fresh=await readControlJob(token,id);
    if(fresh.job.updatedAt!==input.jobVersion||classifyQuote(fresh.job)!=='dead'){
     a=await repo.setOutcome(a.id,'failed','Quote changed before dispatch. Refresh and review again.');
    }else{
     await dispatchAttempt(true,async()=>{
      const messageRequest=new NextRequest(request.url,{method:'POST',headers:{'content-type':'application/json','x-access-token':token},body:JSON.stringify({id:a.id,senderId:a.senderId,destination:a.destination,subject:a.subject,body:a.body,templateTitle:`Dead quote approach ${a.approach}`})});
      const response=await (a.channel==='sms'?smsPost:emailPost)(messageRequest,context);
      const result=await response.json();
      if(response.status===400||(response.status===409&&result.safeToEdit===true))rejection='Message was not sent. Check the contact details and connected sender.';
     });
    }
   }
  }else{
   if(typeof input.attemptId!=='string'||!uuid.test(input.attemptId))throw new ControlError('Invalid send reference.');
   const found=(await repo.list(id)).find(x=>x.id===input.attemptId);if(!found)throw new ControlError('Send not found.',404);a=found;
   if(input.action==='check'&&a.channel==='sms'&&['sending','accepted','unknown'].includes(a.status)){
    await smsPost(new NextRequest(request.url,{method:'POST',headers:{'content-type':'application/json','x-access-token':token},body:JSON.stringify({id:a.id,action:'check'})}),context);
   }
  }
  if(input.action!=='note'){
   const message=await repo.messageOutcome(a);
   const outcome=await reconcileAttempt(a,async()=>message);
   const safeFailure=Boolean(rejection&&!message&&outcome.status==='unknown');
   a=await repo.setOutcome(a.id,safeFailure?'failed':outcome.status,safeFailure?rejection:outcome.failureReason);
  }
  let noteError='';
  if(a.status==='sent'&&a.noteStatus!=='saved'){
   try{await saveNote(token,a,repo);a={...a,noteStatus:'saved'};}
   catch{noteError='Offer sent. The job note is still pending. Retry the note only; this will not resend the offer.';}
  }else if(input.action==='note'&&a.status!=='sent')throw new ControlError('This send is not confirmed.',409);
  return NextResponse.json({attempt:a,noteError},{headers});
 }catch(e){return failure(e);}
}
