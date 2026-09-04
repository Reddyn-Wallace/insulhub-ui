import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
export async function probePartnerNoteUpdates(pool) {
 const c=await pool.connect();const company=randomUUID(),other=randomUUID(),job=randomUUID(),actor=randomUUID(),user=randomUUID(),second=randomUUID();
 const feed=async(id=user,scope=company,seen=null)=>(await c.query('SELECT public.partner_note_feed($1,$2,$3,$4) result',[id,scope,job,seen])).rows[0].result;
 try{
  await c.query('BEGIN');
  const login=(await c.query('SELECT session_user role')).rows[0].role;
  await c.query(`GRANT partner_ops_runtime,partner_portal_runtime TO "${login.replaceAll('"','""')}" WITH INHERIT TRUE, SET TRUE`);
  await c.query("INSERT INTO partner_companies(id,slug,name,billing_model) VALUES($1,$2,'Notes test','INSULHUB_BILLED'),($3,$4,'Other company','INSULHUB_BILLED')",[company,'note-'+company,other,'note-'+other]);
  await c.query("INSERT INTO partner_users(id,company_id,principal_type,name,email,ops_role) VALUES($1,NULL,'INTERNAL','Operator',$2,'ADMIN'),($3,$4,'PARTNER','Partner one',$5,NULL),($6,$4,'PARTNER','Partner two',$7,NULL)",[actor,actor+'@example.test',user,company,user+'@example.test',second,second+'@example.test']);
  await c.query("INSERT INTO partner_jobs(id,company_id,created_by_user_id,client_reference,submission_state,billing_model_snapshot,customer_name,submission_started_at,submitted_at) VALUES($1,$2,$3,'NOTE-TEST','SUBMITTED','INSULHUB_BILLED','Customer',now(),now())",[job,company,user]);
  const patch={version:1,description:'Shared update',requestKey:randomUUID(),authorName:'Verified Operator',legacyActorId:'a'.repeat(24)};
  await c.query('SET LOCAL ROLE partner_ops_runtime');
  for(let n=0;n<2;n++)await c.query('SELECT partner_ops_amendment_append($1,$2,$3,$4::jsonb)',[actor,company,job,JSON.stringify(patch)]);
  await c.query('RESET ROLE');await c.query('SET LOCAL ROLE partner_portal_runtime');
  const original=await feed();assert.equal(original.updates.length,1);assert.equal(original.updates[0].authorName,'Verified Operator');assert.equal(original.readSequence,0);assert.equal(original.latestSequence,1);
  assert.equal(await feed(user,other),null);assert.equal(await feed(actor),null);
  await c.query('SAVEPOINT denied');await assert.rejects(c.query('SELECT * FROM partner_note_reads'));await c.query('ROLLBACK TO SAVEPOINT denied');
  await c.query('SAVEPOINT future');await assert.rejects(feed(user,company,999));await c.query('ROLLBACK TO SAVEPOINT future');
  await c.query('RESET ROLE');await c.query('SET LOCAL ROLE partner_ops_runtime');
  await c.query('SELECT partner_ops_amendment_append($1,$2,$3,$4::jsonb)',[actor,company,job,JSON.stringify({...patch,description:'New arrival',requestKey:randomUUID()})]);
  await c.query('RESET ROLE');await c.query('SET LOCAL ROLE partner_portal_runtime');
  assert.equal((await feed(user,company,1)).readSequence,1);assert.equal((await feed()).latestSequence,2);assert.equal((await feed(second)).readSequence,0);
  assert.equal((await feed(user,company,0)).readSequence,1);assert.equal((await feed(user,company,2)).readSequence,2);
  const summaries=(await c.query('SELECT public.partner_note_feed($1,$2,NULL,NULL) result',[user,company])).rows[0].result;assert.equal(summaries.jobs.find(j=>j.id===job).readSequence,2);
  await c.query('RESET ROLE');await c.query('UPDATE partner_users SET disabled_at=now() WHERE id=$1',[user]);await c.query('SET LOCAL ROLE partner_portal_runtime');assert.equal(await feed(),null);
  console.log('Partner notes PostgreSQL checks passed: attribution, idempotency, tenant isolation, per-user unread, stale/future acknowledgements, disabled access, no direct table access.');
 }finally{await c.query('ROLLBACK');c.release();}
}
