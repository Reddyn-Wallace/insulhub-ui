import 'server-only';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {validateVerification,type Verifier,type Verification} from './verification';
import {ControlError} from './controls';
import {prepareSend,type SendAttempt,type SendSnapshot} from './sending';
import type {ControlState,DeadQuote} from './types';
let pool:Pool|undefined;
export function sendsRepository(){if(!process.env.DATABASE_URL)return null;pool??=new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000,statement_timeout:10000});return new SendRepository(pool);}
function attempt(row:Record<string,unknown>):SendAttempt{return {...row.snapshot as SendSnapshot,...(row.verification?{verification:row.verification as Verification}:{}),id:String(row.id),jobId:String(row.insulhub_job_id),actorId:String(row.actor_id),actorName:String(row.actor_name),status:row.status as SendAttempt['status'],sentAt:row.sent_at?new Date(String(row.sent_at)).toISOString():null,createdAt:new Date(String(row.created_at)).toISOString(),noteStatus:row.note_status as SendAttempt['noteStatus'],failureReason:String(row.failure_reason)};}
export class SendRepository{
 constructor(private readonly pool:Pool){}
 async summaries(ids:string[]){if(!ids.length)return [];const r=await this.pool.query('SELECT insulhub_job_id,status,note_status FROM dead_quote_followup_attempts WHERE insulhub_job_id=ANY($1::text[])',[ids]);return r.rows as {insulhub_job_id:string;status:string;note_status:string}[];}
 async list(jobId:string){const r=await this.pool.query(`SELECT a.*, CASE WHEN v.attempt_id IS NULL THEN NULL ELSE jsonb_build_object('actorId',v.actor_id,'actorName',v.actor_name,'evidence',v.evidence,'verifiedAt',v.verified_at) END AS verification FROM dead_quote_followup_attempts a LEFT JOIN dead_quote_followup_verifications v ON v.attempt_id=a.id WHERE a.insulhub_job_id=$1 ORDER BY a.created_at DESC`,[jobId]);return r.rows.map(attempt);}
 async claim(job:DeadQuote,input:unknown,actor:{id:string;name:string}){
  const v=input as {requestId?:string;revision?:number};const c=await this.pool.connect();
  try{await c.query('BEGIN');
   const control=await c.query('SELECT * FROM dead_quote_followup_controls WHERE insulhub_job_id=$1 FOR UPDATE',[job._id]);
   if(!control.rows[0])throw new ControlError('Review and save a discount first.',409);
   const existing=await c.query('SELECT * FROM dead_quote_followup_attempts WHERE request_id=$1',[v.requestId]);
   if(existing.rows[0]){const a=attempt(existing.rows[0]);if(a.jobId!==job._id||a.actorId!==actor.id)throw new ControlError('Send reference already used.',409);await c.query('COMMIT');return {claimed:false,attempt:a};}
   if(control.rows[0].revision!==v.revision)throw new ControlError('Follow-up changed. Refresh before sending.',409);
   const active=await c.query("SELECT id FROM dead_quote_followup_attempts WHERE insulhub_job_id=$1 AND status IN ('sending','accepted','unknown')",[job._id]);
   if(active.rows.length)throw new ControlError('An earlier send needs its status checked. Do not send again.',409);
   const snapshot=prepareSend(input,control.rows[0].state,job,new Date().toISOString());
   const row=await c.query('INSERT INTO dead_quote_followup_attempts(id,request_id,insulhub_job_id,approach,snapshot,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[randomUUID(),snapshot.requestId,job._id,snapshot.approach,JSON.stringify(snapshot),actor.id,actor.name]);
   await c.query('COMMIT');return {claimed:true,attempt:attempt(row.rows[0])};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async verifySent(id:string,input:unknown,actor:Verifier){return this.setOutcome(id,'sent','',{input,actor});}
 async setOutcome(id:string,status:SendAttempt['status'],failureReason='',verification?:{input:unknown;actor:Verifier}){
  const c=await this.pool.connect();
  try{await c.query('BEGIN');
   const ref=await c.query('SELECT insulhub_job_id FROM dead_quote_followup_attempts WHERE id=$1',[id]);if(!ref.rows[0])throw new ControlError('Send not found.',404);
   const controls=await c.query('SELECT * FROM dead_quote_followup_controls WHERE insulhub_job_id=$1 FOR UPDATE',[ref.rows[0].insulhub_job_id]);
   const rows=await c.query(`SELECT a.*, CASE WHEN v.attempt_id IS NULL THEN NULL ELSE jsonb_build_object('actorId',v.actor_id,'actorName',v.actor_name,'evidence',v.evidence,'verifiedAt',v.verified_at) END AS verification FROM dead_quote_followup_attempts a LEFT JOIN dead_quote_followup_verifications v ON v.attempt_id=a.id WHERE a.id=$1 FOR UPDATE OF a`,[id]);const a=attempt(rows.rows[0]);
   const proof=verification?validateVerification(a,verification.input,verification.actor,new Date().toISOString()):undefined;
   // Successful sends remain counted even if a later delivery report fails.
   if(a.status==='sent'||a.status==='failed'){await c.query('COMMIT');return a;}
   const saved=await c.query("UPDATE dead_quote_followup_attempts SET status=$2,failure_reason=$3,sent_at=CASE WHEN $2='sent' THEN now() ELSE sent_at END WHERE id=$1 RETURNING *",[id,status,failureReason]);
   const result=attempt(saved.rows[0]);
   if(proof){await c.query('INSERT INTO dead_quote_followup_verifications(attempt_id,actor_id,actor_name,evidence,verified_at) VALUES($1,$2,$3,$4,$5)',[id,proof.actorId,proof.actorName,proof.evidence,proof.verifiedAt]);result.verification=proof;}
   if(status==='sent'){
    const state=controls.rows[0].state as ControlState;
    if(state.offers.length!==a.approach-1)throw new ControlError('Offer history conflicts with this send. Review required.',409);
    state.offers.push({number:a.approach,sentAt:result.sentAt!,discountCents:a.discountCents,channel:a.channel,evidence:proof?`Sent verified by ${proof.actorName}: ${proof.evidence}`:`CRM message ${a.id}`,source:proof?'staff_verified':'provider_sent',attemptId:a.id});
    const updated=await c.query('UPDATE dead_quote_followup_controls SET state=$2,revision=revision+1,actor_name=$3,updated_at=now() WHERE insulhub_job_id=$1 RETURNING revision',[a.jobId,JSON.stringify(state),a.actorName]);
    await c.query("INSERT INTO dead_quote_followup_events(insulhub_job_id,revision,action,state,actor_id,actor_name,quote_version) VALUES($1,$2,'send_confirm',$3,$4,$5,$6)",[a.jobId,updated.rows[0].revision,JSON.stringify(state),a.actorId,a.actorName,state.reviewedVersion||'']);
   }
   await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async messageOutcome(a:SendAttempt){
  const table=a.channel==='sms'?'job_sms_messages':'job_email_messages';
  const r=await this.pool.query(`SELECT status,failure_reason FROM ${table} WHERE id=$1 AND insulhub_job_id=$2`,[a.id,a.jobId]);
  return r.rows[0] as {status:string;failure_reason:string}|undefined;
 }
 async withNoteLock<T>(id:string,work:()=>Promise<T>):Promise<T>{
  const c=await this.pool.connect();
  try{const r=await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',['dead-followup-note:'+id]);if(!r.rows[0].locked)throw new ControlError('Note update already in progress. Refresh shortly.',409);try{return await work();}finally{await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',['dead-followup-note:'+id]);}}finally{c.release();}
 }
 async noteSaved(id:string){await this.pool.query("UPDATE dead_quote_followup_attempts SET note_status='saved' WHERE id=$1 AND status='sent'",[id]);}
}
