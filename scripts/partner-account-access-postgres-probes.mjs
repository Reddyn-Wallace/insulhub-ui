import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const assert=(value,message)=>{if(!value)throw Error("Account access PostgreSQL gate: "+message);};
const identifier=value=>'"'+String(value).replaceAll('"','""')+'"';
const hash=value=>createHash("sha256").update(value).digest("hex");
const passwordHash="a".repeat(32)+":"+"b".repeat(128);
async function denied(client,sql,values=[]){
  await client.query("SAVEPOINT access_denied");let failed=false;
  try{await client.query(sql,values);}catch{failed=true;}
  await client.query("ROLLBACK TO SAVEPOINT access_denied");await client.query("RELEASE SAVEPOINT access_denied");
  assert(failed,"unsafe operation unexpectedly succeeded");
}

/** Disposable gate only. Every fixture and role grant is rolled back, with no emails/jobs. */
export async function probePartnerAccountAccess(pool){
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const migrator=(await client.query("SELECT current_user name")).rows[0].name;
    await client.query(`GRANT partner_ops_runtime,partner_portal_runtime TO ${identifier(migrator)}`);
    assert(!(await client.query("SELECT has_schema_privilege('partner_ops_owner','public','CREATE') allowed")).rows[0].allowed,"owner CREATE grant must be removed");
    const expected=[
      ["partner_ops_access_invite(text,uuid,text,text,text)",true,false],["partner_ops_access_issue(text,uuid,text,text,text)",true,false],
      ["partner_ops_access_password(text,uuid,text,text)",true,false],["partner_ops_access_users(text,uuid)",true,false],
      ["partner_access_rate_limit(text,integer)",true,true],["partner_access_email_result(text,boolean)",true,true],
      ["partner_access_request_reset(text,text)",false,true],["partner_access_complete(text,text)",false,true],
      ["partner_access_apply_password(text,uuid,text,text,boolean)",false,false],["partner_access_store_link(text,uuid,text,text,text)",false,false],
      ["partner_access_session_guard()",false,false],["partner_access_disable_guard()",false,false],
    ];
    for(const [signature,ops,portal] of expected){
      const row=(await client.query(`SELECT p.prosecdef,p.proconfig,r.rolname,
        has_function_privilege('partner_ops_runtime',p.oid,'EXECUTE') ops,
        has_function_privilege('partner_portal_runtime',p.oid,'EXECUTE') portal,
        NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public_denied
        FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=to_regprocedure($1)`,["public."+signature])).rows[0];
      assert(row?.prosecdef&&row.proconfig?.join(",")==="search_path=pg_catalog"&&row.rolname==="partner_ops_owner"&&row.ops===ops&&row.portal===portal&&row.public_denied,"exact function grants/owner/search path");
    }
    for(const role of ["partner_ops_runtime","partner_portal_runtime"]){
      for(const table of ["partner_account_links","partner_access_rate_limits"]){
        for(const privilege of ["SELECT","INSERT","UPDATE","DELETE","TRUNCATE"]){
          assert(!(await client.query("SELECT has_table_privilege($1,$2,$3) allowed",[role,"public."+table,privilege])).rows[0].allowed,"no direct link/rate table grants");
        }
      }
    }
    const company=randomUUID(),otherCompany=randomUUID(),email=randomUUID()+"@example.test",actor="insulhub-settings-service";
    await client.query("INSERT INTO partner_companies(id,slug,name,billing_model)VALUES($1,$3,'Access gate','INSULHUB_BILLED'),($2,$4,'Other gate','PARTNER_BILLED')",[company,otherCompany,randomUUID(),randomUUID()]);
    await client.query("SET ROLE partner_ops_runtime");
    const invite=(await client.query("SELECT * FROM partner_ops_access_invite($1,$2,'Gate Person',$3,$4)",[actor,company,email,hash("first")])).rows[0];
    assert(invite?.issued,"staff invitation");
    await client.query("RESET ROLE");
    const user=invite.user_id;
    assert((await client.query("SELECT invitation_pending FROM partner_users WHERE id=$1",[user])).rows[0].invitation_pending,"pending user");
    assert((await client.query("SELECT id FROM partner_accounts WHERE user_id=$1",[user])).rowCount===0,"no temporary password");
    await denied(client,"INSERT INTO partner_sessions(id,token,user_id,expires_at) VALUES($1,$1,$2,now()+interval '1 hour')",[randomUUID(),user]);
    await client.query("SET ROLE partner_portal_runtime");
    await denied(client,"SELECT * FROM partner_ops_access_users($1,$2)",[actor,company]);
    assert((await client.query("SELECT partner_access_complete($1,$2) done",[hash("first"),passwordHash])).rows[0].done,"token redemption");
    assert(!(await client.query("SELECT partner_access_complete($1,$2) done",[hash("first"),passwordHash])).rows[0].done,"single-use token");
    await denied(client,"UPDATE partner_users SET invitation_pending=false WHERE id=$1",[user]);
    await client.query("RESET ROLE");
    assert(!(await client.query("SELECT invitation_pending FROM partner_users WHERE id=$1",[user])).rows[0].invitation_pending,"accepted user");
    await denied(client,"INSERT INTO partner_sessions(id,token,user_id,expires_at,password_version) VALUES($1,$1,$2,now()+interval '1 hour',0)",[randomUUID(),user]);
    const session=randomUUID();
    await client.query("INSERT INTO partner_sessions(id,token,user_id,expires_at,password_version) VALUES($1,$1,$2,now()+interval '1 hour',1)",[session,user]);
    await client.query("SET ROLE partner_ops_runtime");
    assert((await client.query("SELECT * FROM partner_ops_access_issue($1,$2,$3,'RESET',$4)",[actor,otherCompany,user,hash("cross")])).rowCount===0,"cross company denied");
    assert((await client.query("SELECT * FROM partner_ops_access_issue($1,$2,$3,'RESET',$4)",[actor,company,user,hash("second")])).rows[0]?.issued,"staff reset");
    assert((await client.query("SELECT partner_ops_access_password($1,$2,$3,$4) done",[actor,company,user,passwordHash])).rows[0].done,"manual override");
    await client.query("RESET ROLE");
    assert((await client.query("SELECT id FROM partner_sessions WHERE user_id=$1",[user])).rowCount===0,"all sessions revoked");
    await client.query("SET ROLE partner_portal_runtime");
    assert(!(await client.query("SELECT partner_access_complete($1,$2) done",[hash("second"),passwordHash])).rows[0].done,"override invalidates link");
    await client.query("SELECT * FROM partner_access_request_reset($1,$2)",[email,hash("third")]);
    await client.query("RESET ROLE");
    await client.query("UPDATE partner_users SET disabled_at=now() WHERE id=$1",[user]);
    assert((await client.query("SELECT user_id FROM partner_account_links WHERE user_id=$1",[user])).rowCount===0,"disable trigger invalidates links");
    const rollback=readFileSync(new URL("../migrations/partner/012_partner_account_access.down.sql",import.meta.url),"utf8");
    const guard=/^BEGIN;\s*(DO \$\$[\s\S]*?END \$\$;)/.exec(rollback)?.[1];
    assert(guard,"rollback preservation guard");await denied(client,guard);
  }finally{await client.query("RESET ROLE").catch(()=>{});await client.query("ROLLBACK");client.release();}
}
