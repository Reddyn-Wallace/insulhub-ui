import 'server-only';
import {Pool,type PoolClient} from 'pg';
import {assumedEntry,transitionKind,type DeadEntry} from './dates';
import {ControlError} from './controls';
import type {DeadQuote} from './types';
let pool:Pool|undefined;
export function dateRepository(){if(!process.env.DATABASE_URL)return null;pool??=new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000,statement_timeout:10000});return new DateRepository(pool);}
export function datesEnabled(){return process.env.DEAD_QUOTE_DATE_CAPTURE_ENABLED==='true'||process.env.DEAD_QUOTE_FOLLOWUPS_ENABLED==='true';}
export const BATCH_DEAD_DATE_BASELINE_SQL=`WITH source AS (
  SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id text,entry jsonb,version text)
), inserted AS (
  INSERT INTO dead_quote_dates(insulhub_job_id,entry)
  SELECT id,entry FROM source
  WHERE NOT EXISTS (SELECT 1 FROM dead_quote_dates WHERE insulhub_job_id=source.id)
  ORDER BY id
  ON CONFLICT DO NOTHING RETURNING insulhub_job_id,entry
)
INSERT INTO dead_quote_date_events(insulhub_job_id,kind,entry,actor_id,actor_name,after_version)
SELECT i.insulhub_job_id,'assumed',i.entry,'system','Agreed historical rule',s.version
FROM inserted i JOIN source s ON s.id=i.insulhub_job_id
WHERE i.entry IS NOT NULL AND i.entry<>'null'::jsonb`;
export const BATCH_DEAD_DATE_READ_SQL=`SELECT insulhub_job_id,entry,
  pending IS NOT NULL AND pending<>'null'::jsonb AS pending
  FROM dead_quote_dates WHERE insulhub_job_id=ANY($1::text[])`;
type DateRow={insulhub_job_id:string;entry:DeadEntry|null;pending:unknown};
export function queueDateAssumptions(jobs:DeadQuote[],now:string){
 return jobs.map(job=>({id:job._id,entry:assumedEntry(job,now),version:job.updatedAt||null}));
}
export function applyQueueDeadDates(jobs:DeadQuote[],rows:DateRow[],now:string){
 const records=new Map(rows.map(row=>[row.insulhub_job_id,row]));
 return jobs.map(job=>{
  const row=records.get(job._id);
  return {...job,deadEntry:row?row.entry:assumedEntry(job,now),deadDateUncertain:Boolean(row?.pending)};
 });
}
type Actor={id:string;name:string};
export class DateRepository{
 constructor(private readonly pool:Pool){}
 private async locked<T>(id:string,work:(c:PoolClient)=>Promise<T>){
  const c=await this.pool.connect();let locked=false;
  try{const r=await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',['dead-date:'+id]);locked=r.rows[0].locked;
   if(!locked)throw new ControlError('This quote is being saved. Refresh shortly.',409);return await work(c);
  }finally{if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',['dead-date:'+id]);c.release();}
 }
 async attachMany(jobs:DeadQuote[],persist:boolean):Promise<DeadQuote[]>{
  if(!jobs.length)return [];
  const now=new Date().toISOString();
  if(persist){
   await this.pool.query(BATCH_DEAD_DATE_BASELINE_SQL,[JSON.stringify(queueDateAssumptions(jobs,now))]);
  }
  const r=await this.pool.query<DateRow>(BATCH_DEAD_DATE_READ_SQL,[jobs.map(j=>j._id)]);
  return applyQueueDeadDates(jobs,r.rows,now);
 }
 async reconcile(id:string,read:()=>Promise<DeadQuote>){
  return this.locked(id,async c=>{
   const r=await c.query('SELECT pending,updated_at FROM dead_quote_dates WHERE insulhub_job_id=$1',[id]);
   if(!r.rows[0]?.pending)return;
   if(Date.now()-new Date(r.rows[0].updated_at).getTime()<60000)throw new ControlError('Wait a minute before checking the interrupted save.',409);
   const after=await read();const pending=r.rows[0].pending;
   await this.finish(c,pending.before,after,pending.actor,true);
  });
 }
 async attach(job:DeadQuote,persist:boolean):Promise<DeadQuote>{
  if(!persist||job.stage!=='QUOTE')return (await this.attachMany([job],false))[0];
  return this.locked(job._id,async c=>{
   const now=new Date().toISOString();
   const existing=await c.query<DateRow>(BATCH_DEAD_DATE_READ_SQL,[[job._id]]);
   if(existing.rows.length)return applyQueueDeadDates([job],existing.rows,now)[0];
   await this.baseline(c,job);
   const initialized=await c.query<DateRow>(BATCH_DEAD_DATE_READ_SQL,[[job._id]]);
   return applyQueueDeadDates([job],initialized.rows,now)[0];
  });
 }
 private async baseline(c:PoolClient,job:DeadQuote){
  const entry=assumedEntry(job,new Date().toISOString());
  await c.query('BEGIN');try{
   const r=await c.query('INSERT INTO dead_quote_dates(insulhub_job_id,entry) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING insulhub_job_id',[job._id,JSON.stringify(entry)]);
   if(r.rows.length&&entry)await c.query("INSERT INTO dead_quote_date_events(insulhub_job_id,kind,entry,actor_id,actor_name,after_version) VALUES($1,'assumed',$2,'system','Agreed historical rule',$3)",[job._id,JSON.stringify(entry),job.updatedAt]);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}
 }
 private async finish(c:PoolClient,before:DeadQuote,after:DeadQuote,actor:Actor,recovered=false){
  const kind=transitionKind(before,after);
  const entry:DeadEntry|null=kind==='entered'?{at:new Date().toISOString(),source:recovered?'ui_recovery':'ui_transition',evidence:recovered?'Current Dead state confirmed after an interrupted UI save.':'Dead entry confirmed after a save in this UI.'}:null;
  await c.query('BEGIN');try{
   if(kind){await c.query('UPDATE dead_quote_dates SET entry=$2,pending=NULL,updated_at=now() WHERE insulhub_job_id=$1',[before._id,JSON.stringify(entry)]);
    await c.query('INSERT INTO dead_quote_date_events(insulhub_job_id,kind,entry,actor_id,actor_name,before_version,after_version) VALUES($1,$2,$3,$4,$5,$6,$7)',[before._id,recovered?'recovered':kind,JSON.stringify(entry),actor.id,actor.name,before.updatedAt,after.updatedAt]);
   }else await c.query('UPDATE dead_quote_dates SET pending=NULL,updated_at=now() WHERE insulhub_job_id=$1',[before._id]);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}
 }
 async capture<T>(id:string,readBefore:()=>Promise<DeadQuote>,dispatch:()=>Promise<T>,readAfter:()=>Promise<DeadQuote>,actor:Actor):Promise<T>{
  return this.locked(id,async c=>{
   const before=await readBefore();await this.baseline(c,before);
   const r=await c.query('SELECT pending,updated_at FROM dead_quote_dates WHERE insulhub_job_id=$1',[id]);
   if(r.rows[0].pending){
    if(Date.now()-new Date(r.rows[0].updated_at).getTime()>60000){const pending=r.rows[0].pending;await this.finish(c,pending.before,before,pending.actor,true);}
    throw new ControlError('The previous save needs checking. Refresh this quote before making another change.',409);
   }
   // Commit intent before the external write. A crash leaves a visible blocker.
   await c.query('UPDATE dead_quote_dates SET pending=$2,updated_at=now() WHERE insulhub_job_id=$1',[id,JSON.stringify({before:{_id:before._id,stage:before.stage,updatedAt:before.updatedAt,archivedAt:before.archivedAt,quote:before.quote?{status:before.quote.status}:null,lead:before.lead},actor})]);
   const result=await dispatch();
   const after=await readAfter();await this.finish(c,before,after,actor);
   return result;
  });
 }
}
export async function attachDeadDate(job:DeadQuote):Promise<DeadQuote>{
 const repo=dateRepository();if(!repo){if(datesEnabled())throw new ControlError('Dead-date storage needs setup.',503);return {...job,deadEntry:assumedEntry(job,new Date().toISOString())};}
 try{return await repo.attach(job,datesEnabled());}catch(e){if(!datesEnabled()&&(e as {code?:string}).code==='42P01')return {...job,deadEntry:assumedEntry(job,new Date().toISOString())};throw e;}
}

export async function attachDeadDates(jobs:DeadQuote[],persist=datesEnabled()):Promise<DeadQuote[]>{
 const repo=dateRepository();if(!repo){if(datesEnabled())throw new ControlError('Dead-date storage needs setup.',503);return jobs.map(job=>({...job,deadEntry:assumedEntry(job,new Date().toISOString())}));}
 try{return await repo.attachMany(jobs,persist);}catch(e){if(!datesEnabled()&&(e as {code?:string}).code==='42P01')return jobs;throw e;}
}
