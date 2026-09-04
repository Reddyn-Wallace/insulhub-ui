import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export async function probePartnerCompanyAccess(pool){
 const client=await pool.connect(),company=randomUUID(),other=randomUUID(),admin=randomUUID(),sales=randomUUID(),foreign=randomUUID(),service='insulhub-settings-service';
 try{
  await client.query('BEGIN');
  const login=(await client.query('SELECT session_user role')).rows[0].role;
  await client.query(`GRANT partner_ops_runtime TO "${login.replaceAll('"','""')}" WITH INHERIT TRUE, SET TRUE`);
  await client.query("INSERT INTO partner_companies(id,slug,name,billing_model) VALUES($1::uuid,$1::text,'Lifecycle','INSULHUB_BILLED'),($2::uuid,$2::text,'Other','INSULHUB_BILLED')",[company,other]);
  await client.query("INSERT INTO partner_users(id,company_id,principal_type,name,email,partner_role)VALUES($1,$4,'PARTNER','Admin',$1||'@example.test','ADMIN'),($2,$4,'PARTNER','Sales',$2||'@example.test','SALES'),($3,$5,'PARTNER','Foreign',$3||'@example.test','ADMIN')",[admin,sales,foreign,company,other]);
  await client.query("INSERT INTO partner_sessions(id,user_id,token,expires_at)VALUES($1,$2,$1,now()+interval '1 hour')",[randomUUID(),sales]);
  const denied=async(sql,args,code)=>{await client.query('SAVEPOINT denied');try{await client.query(sql,args);assert.fail('Expected rejection '+code);}catch(error){assert.equal(error.message,code);}finally{await client.query('ROLLBACK TO SAVEPOINT denied');await client.query('RELEASE SAVEPOINT denied');}};
  const signatures=['partner_access_manage_users(text,uuid)','partner_access_manage_user(text,uuid,text,text,boolean)','partner_access_manage_create(text,uuid,text,text,text,text,text)','partner_access_manage_invite(text,uuid,text,text,text,text)','partner_ops_company_active(text,uuid,integer,boolean)'];
  for(const sig of signatures){const row=(await client.query("SELECT p.prosecdef,r.rolname,p.proconfig,has_function_privilege('partner_ops_runtime',p.oid,'EXECUTE') ops,has_function_privilege('partner_portal_runtime',p.oid,'EXECUTE') portal,has_function_privilege('partner_submission_worker',p.oid,'EXECUTE') worker FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=to_regprocedure($1)",[sig])).rows[0];assert.equal(row.rolname,'partner_ops_owner');assert.equal(row.prosecdef,true);assert.equal(row.ops,true);assert.equal(row.portal,false);assert.equal(row.worker,false);assert.ok(row.proconfig.includes('search_path=pg_catalog'));}
  await client.query('SET LOCAL ROLE partner_ops_runtime');
  assert.equal((await client.query('SELECT * FROM partner_access_manage_users($1,$2)',[admin,company])).rowCount,2);
  for(const actor of [sales,foreign]){
   await denied('SELECT * FROM partner_access_manage_users($1,$2)',[actor,company],'ACCESS_FORBIDDEN');
   await denied('SELECT partner_access_manage_user($1,$2,$3,\'ADMIN\',true)',[actor,company,sales],'ACCESS_FORBIDDEN');
   await denied('SELECT * FROM partner_access_manage_invite($1,$2,\'Bad\',\'bad@example.test\',$3,\'ADMIN\')',[actor,company,'a'.repeat(64)],'ACCESS_FORBIDDEN');
   await denied('SELECT partner_ops_access_password($1,$2,$3,$4)',[actor,company,sales,'a'.repeat(32)+':'+ 'b'.repeat(128)],'ACCESS_FORBIDDEN');
  }
  await denied('SELECT partner_access_manage_user($1,$2,$1,\'SALES\',null)',[admin,company],'ACCESS_LAST_ADMIN');
  assert.equal((await client.query('SELECT partner_access_manage_user($1,$2,$3,null,false) ok',[admin,company,foreign])).rows[0].ok,false);
  await client.query("SELECT * FROM partner_ops_access_issue($1,$2,$3,'RESET',$4)",[admin,company,sales,'c'.repeat(64)]);
  await client.query('SELECT partner_ops_company_active($1,$2,0,false)',[service,company]);
  await client.query('RESET ROLE');
  assert.equal((await client.query('SELECT count(*)::integer n FROM partner_users WHERE company_id=$1 AND disabled_at IS NULL',[company])).rows[0].n,0);
  assert.equal((await client.query('SELECT count(*)::integer n FROM partner_sessions WHERE user_id=$1',[sales])).rows[0].n,0);
  assert.equal((await client.query('SELECT count(*)::integer n FROM partner_account_links WHERE company_id=$1',[company])).rows[0].n,0);
  await client.query('SET LOCAL ROLE partner_ops_runtime');
  await denied('SELECT partner_access_manage_user($1,$2,$3,null,true)',[service,company,sales],'ACCESS_ARCHIVED');
  assert.equal((await client.query('SELECT partner_ops_company_active($1,$2,0,true) ok',[service,company])).rows[0].ok,false);
  await client.query('SELECT partner_ops_company_active($1,$2,1,true)',[service,company]);
  const users=(await client.query('SELECT * FROM partner_access_manage_users($1,$2)',[service,company])).rows;assert.ok(users.every(u=>u.disabled_at));
  await client.query('SELECT partner_access_manage_user($1,$2,$3,null,true)',[service,company,admin]);
  await client.query('SELECT partner_access_manage_user($1,$2,$3,\'ADMIN\',true)',[admin,company,sales]);
  await client.query('SELECT partner_access_manage_user($1,$2,$1,\'SALES\',null)',[admin,company]);
  await denied('SELECT * FROM partner_access_manage_users($1,$2)',[admin,company],'ACCESS_FORBIDDEN');
  await client.query('RESET ROLE');
  assert.equal((await client.query('SELECT password_version FROM partner_users WHERE id=$1',[admin])).rows[0].password_version,2);
  await client.query('SET LOCAL ROLE partner_ops_runtime');
  await client.query('SELECT partner_ops_partner_user_disable($1,$2,$3)',[service,company,sales]);
  await client.query('RESET ROLE');
  assert.equal((await client.query('SELECT password_version FROM partner_users WHERE id=$1',[sales])).rows[0].password_version,3);
 }finally{await client.query('ROLLBACK');client.release();}
 console.log('Company access PostgreSQL probes passed');
}

export async function probePartnerCompanyAccessLockOrder(pool){
 const first=await pool.connect(),second=await pool.connect();let pending,seeded;
 const login=(await first.query("SELECT session_user role,pg_has_role(session_user,'partner_ops_runtime','USAGE') member")).rows[0];
 if(!login.member)await first.query(`GRANT partner_ops_runtime TO "${login.role.replaceAll('"','""')}" WITH INHERIT TRUE, SET TRUE`);
 try{
  let company=(await first.query('SELECT id,revision FROM partner_companies ORDER BY id LIMIT 1')).rows[0];
  if(!company){seeded=randomUUID();company=(await first.query("INSERT INTO partner_companies(id,slug,name,billing_model)VALUES($1::uuid,$1::text,'Concurrency gate','INSULHUB_BILLED') RETURNING id,revision",[seeded])).rows[0];}
  await first.query('BEGIN');await first.query('SET LOCAL statement_timeout=\'3s\'');
  await first.query('SELECT id FROM partner_companies WHERE id=$1 FOR UPDATE',[company.id]);
  await second.query('BEGIN');await second.query('SET LOCAL statement_timeout=\'3s\'');
  await second.query('SET LOCAL ROLE partner_ops_runtime');
  const pid=(await second.query('SELECT pg_backend_pid() pid')).rows[0].pid;
  pending=second.query('SELECT partner_ops_company_active($1,$2,$3,false)',['insulhub-settings-service',company.id,company.revision]);
  pending.catch(()=>{});
  // Observe that archive is waiting on the company before it can lock its actor.
  let waiting=false;for(let i=0;i<100;i++){
   waiting=(await first.query("SELECT wait_event_type='Lock' waiting FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.waiting;
   if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(waiting,true);
  await first.query('SET LOCAL ROLE partner_ops_runtime');
  await first.query('SELECT * FROM partner_access_manage_users($1,$2)',['insulhub-settings-service',company.id]);
  await first.query('ROLLBACK');await pending;pending=undefined;
 }finally{await first.query('ROLLBACK');if(pending)await pending.catch(()=>{});await second.query('ROLLBACK');if(seeded)await first.query('DELETE FROM partner_companies WHERE id=$1',[seeded]);if(!login.member)await first.query(`REVOKE partner_ops_runtime FROM "${login.role.replaceAll('"','""')}"`);first.release();second.release();}
 console.log('Company access concurrent lock-order probe passed');
}
