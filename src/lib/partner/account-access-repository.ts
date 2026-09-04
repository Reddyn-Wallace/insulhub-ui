import "server-only";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { partnerDemoModeEnabled, withPartnerDemoAtomicOperation } from "./demo";
import { writePartnerAuditEvent } from "./audit";
import { PARTNER_SETTINGS_SERVICE_ID } from "./settings-service";
import type { AccountLinkIssue, AccountLinkPurpose } from "./account-access";

type User = { id:string;company_id:string;name:string;email:string;invitation_pending:boolean;disabled_at:Date|null;principal_type:string;partner_role:"ADMIN"|"SALES" };
const queues=new WeakMap<Pool,Promise<void>>();
export class PartnerAccountAccessRepository {
  constructor(private readonly pool:Pool, private readonly emulate=process.env.NODE_ENV==="test"||partnerDemoModeEnabled(), private readonly backup?:()=>{restore():void}, private readonly actorId=PARTNER_SETTINGS_SERVICE_ID) {}
  private async atomic<T>(work:(sql:PoolClient)=>Promise<T>):Promise<T>{
    const execute=async()=>{
      const snapshot=this.backup?.(),sql=await this.pool.connect();
      try{await sql.query("BEGIN");const value=await work(sql);await sql.query("COMMIT");return value;}
      catch(error){await sql.query("ROLLBACK");snapshot?.restore();throw error;}
      finally{sql.release();}
    };
    if(partnerDemoModeEnabled())return withPartnerDemoAtomicOperation("account-access","",execute);
    const previous=queues.get(this.pool)??Promise.resolve();let release!:()=>void;
    const next=new Promise<void>(resolve=>{release=resolve;});queues.set(this.pool,previous.then(()=>next));
    await previous;try{return await execute();}finally{release();}
  }
  private async actor(sql:PoolClient,companyId?:string){
    // Company lock precedes actor/target locks in every management transaction.
    const company=companyId?(await sql.query("SELECT is_active FROM partner_companies WHERE id=$1 FOR UPDATE",[companyId])).rows[0]:null;
    const user=(await sql.query("SELECT * FROM partner_users WHERE id=$1 FOR UPDATE",[this.actorId])).rows[0];
    if(user&&!user.disabled_at&&((user.principal_type==='INTERNAL'&&user.company_id===null&&user.ops_role==='ADMIN')||(company?.is_active&&user.principal_type==='PARTNER'&&user.company_id===companyId&&user.partner_role==='ADMIN'&&!user.invitation_pending)))return;
    throw Error("ACCESS_FORBIDDEN");
  }
  private async active(sql:PoolClient,companyId:string,userId?:string){
    const company=(await sql.query<{name:string}>("SELECT name FROM partner_companies WHERE id=$1 AND is_active=true FOR UPDATE",[companyId])).rows[0];if(!company)return null;
    if(!userId)return {company,user:null};
    const user=(await sql.query<User>("SELECT * FROM partner_users WHERE id=$1 AND company_id=$2 AND principal_type='PARTNER' AND disabled_at IS NULL FOR UPDATE",[userId,companyId])).rows[0];
    return user?{company,user}:null;
  }
  private async store(sql:PoolClient,user:User,companyName:string,hash:string,purpose:AccountLinkPurpose,actor:string|null):Promise<AccountLinkIssue>{
    const existing=(await sql.query<{issued_at:Date}>("SELECT issued_at FROM partner_account_links WHERE user_id=$1",[user.id])).rows[0];
    const issued=!existing||new Date(existing.issued_at).getTime()<=Date.now()-60_000;
    if(issued){
      await sql.query("DELETE FROM partner_account_links WHERE user_id=$1",[user.id]);
      await sql.query("INSERT INTO partner_account_links(user_id,company_id,token_hash,purpose,expires_at)VALUES($1,$2,$3,$4,$5)",[user.id,user.company_id,hash,purpose,new Date(Date.now()+(purpose==="INVITE"?48:1)*3_600_000)]);
      await writePartnerAuditEvent(sql,{type:"ACCOUNT_LINK_ISSUED",actorUserId:actor,subjectUserId:user.id,companyId:user.company_id,metadata:{reason:purpose}});
    }
    return {user_id:user.id,email:user.email,name:user.name,company_name:companyName,purpose,issued};
  }
  async invite(companyId:string,name:string,email:string,hash:string,role:"ADMIN"|"SALES"="SALES"):Promise<AccountLinkIssue|null>{
    if(!this.emulate)return (await this.pool.query<AccountLinkIssue>("SELECT * FROM public.partner_access_manage_invite($1,$2,$3,$4,$5,$6)",[this.actorId,companyId,name,email,hash,role])).rows[0]??null;
    return this.atomic(async sql=>{
      await this.actor(sql,companyId);const active=await this.active(sql,companyId);if(!active)return null;
      let user=(await sql.query<User>("SELECT * FROM partner_users WHERE email=$1 FOR UPDATE",[email])).rows[0];
      if(user){if(user.company_id!==companyId||user.principal_type!=="PARTNER"||user.disabled_at||!user.invitation_pending||user.name!==name||user.partner_role!==role)throw Error("ACCESS_EXISTS");}
      else{
        user=(await sql.query<User>("INSERT INTO partner_users(id,company_id,principal_type,name,email,email_verified,invitation_pending,partner_role)VALUES($1,$2,'PARTNER',$3,$4,false,true,$5) RETURNING *",[randomUUID(),companyId,name,email,role])).rows[0];
        await writePartnerAuditEvent(sql,{type:"OPS_PARTNER_USER_PROVISIONED",actorUserId:this.actorId,subjectUserId:user.id,companyId});
      }
      return this.store(sql,user,active.company.name,hash,"INVITE",this.actorId);
    });
  }
  async issue(companyId:string,userId:string,purpose:AccountLinkPurpose,hash:string):Promise<AccountLinkIssue|null>{
    if(!this.emulate)return (await this.pool.query<AccountLinkIssue>("SELECT * FROM public.partner_ops_access_issue($1,$2,$3,$4,$5)",[this.actorId,companyId,userId,purpose,hash])).rows[0]??null;
    return this.atomic(async sql=>{
      await this.actor(sql,companyId);const active=await this.active(sql,companyId,userId);if(!active?.user)return null;
      if(purpose==="INVITE"&&!active.user.invitation_pending)throw Error("ACCESS_INVALID");
      return this.store(sql,active.user,active.company.name,hash,purpose,this.actorId);
    });
  }
  async requestReset(email:string,hash:string):Promise<AccountLinkIssue|null>{
    if(!this.emulate)return (await this.pool.query<AccountLinkIssue>("SELECT * FROM public.partner_access_request_reset($1,$2)",[email,hash])).rows[0]??null;
    return this.atomic(async sql=>{
      const user=(await sql.query<User>("SELECT * FROM partner_users WHERE email=$1 AND principal_type='PARTNER'",[email])).rows[0];if(!user)return null;
      const active=await this.active(sql,user.company_id,user.id);if(!active?.user)return null;
      return this.store(sql,active.user,active.company.name,hash,active.user.invitation_pending?"INVITE":"RESET",null);
    });
  }
  private async applyPassword(sql:PoolClient,user:User,hash:string,actor:string|null,verified:boolean){
    if(!/^[0-9a-f]{32}:[0-9a-f]{128}$/.test(hash))throw Error("ACCESS_INVALID");
    const account=(await sql.query("SELECT id FROM partner_accounts WHERE provider_id='credential' AND account_id=$1",[user.id])).rows[0];
    if(account)await sql.query("UPDATE partner_accounts SET password=$2,updated_at=now() WHERE id=$1",[account.id,hash]);
    else await sql.query("INSERT INTO partner_accounts(id,account_id,provider_id,user_id,password)VALUES($1,$2,'credential',$2,$3)",[randomUUID(),user.id,hash]);
    await sql.query("UPDATE partner_users SET invitation_pending=false,password_version=password_version+1,email_verified=CASE WHEN $2 THEN true ELSE email_verified END,updated_at=now() WHERE id=$1",[user.id,verified]);
    await sql.query("DELETE FROM partner_account_links WHERE user_id=$1",[user.id]);
    await sql.query("DELETE FROM partner_sessions WHERE user_id=$1",[user.id]);
    await writePartnerAuditEvent(sql,{type:"ACCOUNT_PASSWORD_CHANGED",actorUserId:actor,subjectUserId:user.id,companyId:user.company_id,metadata:{reason:verified?"LINK":"STAFF_OVERRIDE"}});
    await writePartnerAuditEvent(sql,{type:"SESSIONS_REVOKED",actorUserId:actor,subjectUserId:user.id,companyId:user.company_id,metadata:{reason:"password_changed"}});
  }
  async setPassword(companyId:string,userId:string,hash:string):Promise<boolean>{
    if(!this.emulate)return (await this.pool.query<{changed:boolean}>("SELECT public.partner_ops_access_password($1,$2,$3,$4) changed",[this.actorId,companyId,userId,hash])).rows[0]?.changed===true;
    return this.atomic(async sql=>{await this.actor(sql,companyId);const active=await this.active(sql,companyId,userId);if(!active?.user)return false;await this.applyPassword(sql,active.user,hash,this.actorId,false);return true;});
  }
  async complete(hash:string,passwordHash:string):Promise<boolean>{
    if(!this.emulate)return (await this.pool.query<{changed:boolean}>("SELECT public.partner_access_complete($1,$2) changed",[hash,passwordHash])).rows[0]?.changed===true;
    return this.atomic(async sql=>{
      const link=(await sql.query<{user_id:string;company_id:string;expires_at:Date}>("SELECT * FROM partner_account_links WHERE token_hash=$1 FOR UPDATE",[hash])).rows[0];
      if(!link||new Date(link.expires_at).getTime()<=Date.now())return false;
      const active=await this.active(sql,link.company_id,link.user_id);if(!active?.user)return false;
      await this.applyPassword(sql,active.user,passwordHash,null,true);return true;
    });
  }
  async managedUsers(companyId:string){
    const rows=this.emulate?await this.atomic(async sql=>{await this.actor(sql,companyId);return (await sql.query("SELECT id,name,email,disabled_at,partner_role,invitation_pending FROM partner_users WHERE company_id=$1 AND principal_type='PARTNER' ORDER BY email",[companyId])).rows;}):(await this.pool.query("SELECT * FROM public.partner_access_manage_users($1,$2)",[this.actorId,companyId])).rows;
    return rows.map(u=>({id:u.id,name:u.name,email:u.email,disabledAt:u.disabled_at?new Date(u.disabled_at).toISOString():null,role:u.partner_role,invitationPending:u.invitation_pending}));
  }
  async manageUser(companyId:string,userId:string,patch:{role?:"ADMIN"|"SALES";isActive?:boolean}):Promise<boolean>{
    if(!this.emulate)return (await this.pool.query("SELECT public.partner_access_manage_user($1,$2,$3,$4,$5) changed",[this.actorId,companyId,userId,patch.role??null,patch.isActive??null])).rows[0]?.changed===true;
    return this.atomic(async sql=>{
      await this.actor(sql,companyId);
      const u=(await sql.query("SELECT * FROM partner_users WHERE id=$1 AND company_id=$2 AND principal_type='PARTNER' FOR UPDATE",[userId,companyId])).rows[0];if(!u)return false;
      if(patch.isActive&&!await this.active(sql,companyId))throw Error("ACCESS_ARCHIVED");
      if(userId===this.actorId&&(patch.isActive===false||patch.role==='SALES')){
        const others=await sql.query("SELECT id FROM partner_users WHERE company_id=$1 AND principal_type='PARTNER' AND partner_role='ADMIN' AND disabled_at IS NULL AND invitation_pending=false AND id<>$2",[companyId,userId]);
        if(!others.rows.length)throw Error("ACCESS_LAST_ADMIN");
      }
      await sql.query("UPDATE partner_users SET partner_role=$2,disabled_at=$3,password_version=password_version+$4,updated_at=now() WHERE id=$1",[userId,patch.role??u.partner_role,patch.isActive===true?null:patch.isActive===false?(u.disabled_at??new Date()):u.disabled_at,patch.isActive===false||(patch.role&&patch.role!==u.partner_role)?1:0]);
      if(patch.isActive===false||patch.role&&patch.role!==u.partner_role)await sql.query("DELETE FROM partner_sessions WHERE user_id=$1",[userId]);
      if(patch.isActive===false)await sql.query("DELETE FROM partner_account_links WHERE user_id=$1",[userId]);
      await writePartnerAuditEvent(sql,{type:"OPS_PARTNER_USER_PROVISIONED",actorUserId:this.actorId,subjectUserId:userId,companyId,metadata:{reason:patch.isActive===false?"user_disabled":patch.isActive?"user_reactivated":"role_changed_"+patch.role}});
      return true;
    });
  }
  async createUser(companyId:string,input:{name:string;email:string;role?:"ADMIN"|"SALES"},passwordHash:string):Promise<{id:string}>{
    const id=randomUUID(),role=input.role??"SALES";
    if(!this.emulate){await this.pool.query("SELECT public.partner_access_manage_create($1,$2,$3,$4,$5,$6,$7)",[this.actorId,companyId,id,input.name,input.email,passwordHash,role]);return{id};}
    return this.atomic(async sql=>{
      await this.actor(sql,companyId);if(!await this.active(sql,companyId))throw Error("ACCESS_ARCHIVED");
      const user=(await sql.query<User>("INSERT INTO partner_users(id,company_id,principal_type,name,email,partner_role) VALUES($1,$2,'PARTNER',$3,$4,$5) RETURNING *",[id,companyId,input.name,input.email,role])).rows[0];
      await this.applyPassword(sql,user,passwordHash,this.actorId,false);
      await writePartnerAuditEvent(sql,{type:"OPS_PARTNER_USER_PROVISIONED",actorUserId:this.actorId,subjectUserId:id,companyId});return{id};
    });
  }
  async companyActive(companyId:string,revision:number,isActive:boolean):Promise<boolean>{
    if(!this.emulate)return (await this.pool.query("SELECT public.partner_ops_company_active($1,$2,$3,$4) changed",[this.actorId,companyId,revision,isActive])).rows[0]?.changed===true;
    return this.atomic(async sql=>{
      await this.actor(sql);const changed=await sql.query("UPDATE partner_companies SET is_active=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING id",[companyId,revision,isActive]);if(!changed.rows.length)return false;
      if(!isActive){
        const users=(await sql.query("SELECT id FROM partner_users WHERE company_id=$1 AND principal_type='PARTNER'",[companyId])).rows;
        await sql.query("UPDATE partner_users SET disabled_at=COALESCE(disabled_at,now()),password_version=password_version+1,updated_at=now() WHERE company_id=$1 AND principal_type='PARTNER'",[companyId]);
        for(const user of users)await sql.query("DELETE FROM partner_sessions WHERE user_id=$1",[user.id]);
        await sql.query("DELETE FROM partner_account_links WHERE company_id=$1",[companyId]);
      }
      await writePartnerAuditEvent(sql,{type:"OPS_COMPANY_UPDATED",actorUserId:this.actorId,companyId,metadata:{reason:isActive?"company_unarchived":"company_archived"}});return true;
    });
  }
  async userStates(companyId:string):Promise<Array<{id:string;invitation_pending:boolean}>>{
    if(!this.emulate)return (await this.pool.query<{id:string;invitation_pending:boolean}>("SELECT * FROM public.partner_ops_access_users($1,$2)",[this.actorId,companyId])).rows;
    return this.atomic(async sql=>{await this.actor(sql,companyId);return (await sql.query<{id:string;invitation_pending:boolean}>("SELECT id,invitation_pending FROM partner_users WHERE company_id=$1 AND principal_type='PARTNER'",[companyId])).rows;});
  }
  async emailResult(hash:string,accepted:boolean):Promise<boolean>{
    if(!this.emulate)return (await this.pool.query<{recorded:boolean}>("SELECT public.partner_access_email_result($1,$2) recorded",[hash,accepted])).rows[0]?.recorded===true;
    return this.atomic(async sql=>{
      const updated=await sql.query<{user_id:string;company_id:string}>("UPDATE partner_account_links SET delivery_state=$2 WHERE token_hash=$1 RETURNING user_id,company_id",[hash,accepted?"ACCEPTED":"UNCONFIRMED"]);
      const link=updated.rows[0];if(!link)return false;
      await writePartnerAuditEvent(sql,{type:accepted?"ACCOUNT_EMAIL_ACCEPTED":"ACCOUNT_EMAIL_UNCONFIRMED",subjectUserId:link.user_id,companyId:link.company_id});return true;
    });
  }
  async rateLimit(key:string,limit:number):Promise<boolean>{
    if(!this.emulate)return (await this.pool.query<{allowed:boolean}>("SELECT public.partner_access_rate_limit($1,$2) allowed",[key,limit])).rows[0]?.allowed===true;
    return this.atomic(async sql=>{
      const old=(await sql.query<{attempts:number;window_start:Date}>("SELECT * FROM partner_access_rate_limits WHERE key_hash=$1",[key])).rows[0];
      if(!old||new Date(old.window_start).getTime()<=Date.now()-900_000){await sql.query("DELETE FROM partner_access_rate_limits WHERE key_hash=$1",[key]);await sql.query("INSERT INTO partner_access_rate_limits(key_hash)VALUES($1)",[key]);return true;}
      await sql.query("UPDATE partner_access_rate_limits SET attempts=attempts+1 WHERE key_hash=$1",[key]);return old.attempts+1<=limit;
    });
  }
}
