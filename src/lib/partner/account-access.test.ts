import { afterEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { createPartnerTestDatabase } from "./test-db";
import { PartnerAccountAccessRepository } from "./account-access-repository";
import { accountToken, accountHash, accountLinkUrl, RESET_REQUEST_MESSAGE } from "./account-access";
import { createPartnerAuth, getAuthenticatedPrincipalWith } from "./auth";
import { partnerLogin } from "./auth-route";
import { publicAccountPassword, type AccountAccessDependencies } from "./account-access-routes";
import { partnerSettingsRoute } from "./settings-routes";
import { PartnerOperationsRepository } from "./operations-repository";
import { requireInsulhubAuth } from "../insulhub-auth";

const origin="https://portal.example.test", password="Fictional-New-Password1!", otherPassword="Fictional-Other-Password2!";
const company="11111111-1111-4111-8111-111111111111", otherCompany="22222222-2222-4222-8222-222222222222";
const pools:Array<{end():Promise<void>}>=[];
afterEach(async()=>{await Promise.all(pools.splice(0).map(p=>p.end()));vi.restoreAllMocks();vi.unstubAllGlobals();});
async function fixture(){
  const {db,Pool}=createPartnerTestDatabase(),pool=new Pool();pools.push(pool);
  await pool.query("INSERT INTO partner_companies(id,slug,name,billing_model)VALUES($1,'access','Access','INSULHUB_BILLED'),($2,'other','Other','PARTNER_BILLED')",[company,otherCompany]);
  const repository=new PartnerAccountAccessRepository(pool,true,()=>db.backup());
  const mail=vi.fn(async()=>({delivery:"SENT" as const,message:"Invitation email sent."}));
  const deferred:Array<()=>Promise<void>>=[];
  const deps:AccountAccessDependencies={repository,origins:new Set([origin]),portalOrigin:origin,sendMail:mail,deferMail:work=>{deferred.push(work);}};
  const auth=createPartnerAuth({database:pool,baseURL:origin,secret:"fictional-account-access-auth-secret-at-least-32"});
  const authDeps={auth,sql:pool,origins:deps.origins,getPrincipal:(headers:Headers)=>getAuthenticatedPrincipalWith(auth,pool,headers)};
  const login=async(email:string,pw=password)=>partnerLogin(new Request(origin+"/api/partner/auth/login",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({email,password:pw})}),"partner",authDeps);
  return {db,pool,repository,deps,mail,deferred,auth,authDeps,login};
}
function request(body:unknown,headers:Record<string,string>={}){
  return new Request(origin+"/api/partner/auth/password/request",{method:"POST",headers:{origin,"content-type":"application/json",...headers},body:JSON.stringify(body)});
}
async function invite(f:Awaited<ReturnType<typeof fixture>>,email="person@example.test"){
  const token=accountToken(),issue=(await f.repository.invite(company,"Person",email,token.hash))!;return{token,issue};
}
async function ageLink(f:Awaited<ReturnType<typeof fixture>>,userId:string){
  await f.pool.query("UPDATE partner_account_links SET issued_at=now()-interval '2 minutes' WHERE user_id=$1",[userId]);
}
describe("partner account access lifecycle",()=>{
  it("creates a pending invite with no password, stores only a hash, and accepts once into the existing sign-in flow",async()=>{
    const f=await fixture(),{token,issue}=await invite(f);
    expect(issue.issued).toBe(true);
    expect((await f.repository.userStates(company))[0]).toMatchObject({id:issue.user_id,invitation_pending:true});
    expect((await f.pool.query("SELECT id FROM partner_accounts WHERE user_id=$1",[issue.user_id])).rows).toHaveLength(0);
    const link=(await f.pool.query("SELECT * FROM partner_account_links WHERE user_id=$1",[issue.user_id])).rows[0];
    expect(link.token_hash).toBe(accountHash(token.token));expect(JSON.stringify(link)).not.toContain(token.token);
    expect(new Date(link.expires_at).getTime()-new Date(link.issued_at).getTime()).toBeGreaterThan(47*3_600_000);
    expect((await f.login(issue.email)).status).toBe(401);
    expect(await f.repository.complete(token.hash,await hashPassword(password))).toBe(true);
    expect(await f.repository.complete(token.hash,await hashPassword(otherPassword))).toBe(false);
    const signedIn=await f.login(issue.email);expect(signedIn.status).toBe(200);
    const cookie=signedIn.headers.get("set-cookie")!.split(";")[0];
    expect(await getAuthenticatedPrincipalWith(f.auth,f.pool,new Headers({cookie}))).toMatchObject({userId:issue.user_id,companyId:company,principalType:"PARTNER"});
  });
  it("blocks pending sign-in even if an old credential/session is present, and fences stale credential versions",async()=>{
    const f=await fixture(),{issue}=await invite(f);
    await f.pool.query("INSERT INTO partner_accounts(id,provider_id,account_id,user_id,password)VALUES('old','credential',$1,$1,$2)",[issue.user_id,await hashPassword(password)]);
    expect((await f.login(issue.email)).status).toBe(401);
    await f.repository.setPassword(company,issue.user_id,await hashPassword(password));
    const login=await f.login(issue.email),cookie=login.headers.get("set-cookie")!.split(";")[0];
    await f.pool.query("UPDATE partner_users SET password_version=password_version+1 WHERE id=$1",[issue.user_id]);
    expect(await getAuthenticatedPrincipalWith(f.auth,f.pool,new Headers({cookie}))).toBeNull();
  });
  it("serializes concurrent redemption and invalidates established sessions",async()=>{
    const f=await fixture(),{issue}=await invite(f);
    await f.repository.setPassword(company,issue.user_id,await hashPassword(password));
    const oldLogin=await f.login(issue.email),cookie=oldLogin.headers.get("set-cookie")!.split(";")[0];
    const token=accountToken();await f.repository.requestReset(issue.email,token.hash);
    const hash=await hashPassword(otherPassword);
    expect((await Promise.all([f.repository.complete(token.hash,hash),f.repository.complete(token.hash,hash)])).sort()).toEqual([false,true]);
    expect(await getAuthenticatedPrincipalWith(f.auth,f.pool,new Headers({cookie}))).toBeNull();
    expect((await f.login(issue.email,password)).status).toBe(401);
    expect((await f.login(issue.email,otherPassword)).status).toBe(200);
  });
  it("resend replaces old links, delayed acknowledgement cannot mark newer links, and override invalidates every link",async()=>{
    const f=await fixture(),{token:first,issue}=await invite(f);
    expect((await f.repository.issue(company,issue.user_id,"INVITE",accountToken().hash))?.issued).toBe(false);
    await ageLink(f,issue.user_id);
    const second=accountToken();expect((await f.repository.issue(company,issue.user_id,"INVITE",second.hash))?.issued).toBe(true);
    expect(await f.repository.emailResult(first.hash,true)).toBe(false);
    expect((await f.pool.query("SELECT delivery_state FROM partner_account_links WHERE user_id=$1",[issue.user_id])).rows[0].delivery_state).toBe("CREATED");
    expect(await f.repository.complete(first.hash,await hashPassword(password))).toBe(false);
    await f.repository.setPassword(company,issue.user_id,await hashPassword(password));
    expect(await f.repository.complete(second.hash,await hashPassword(otherPassword))).toBe(false);
    expect((await f.repository.userStates(company))[0].invitation_pending).toBe(false);
  });
  it("denies cross-company operations, internal users, disabled users and inactive companies",async()=>{
    const f=await fixture(),{token,issue}=await invite(f);
    const hash=await hashPassword(password);
    expect(await f.repository.issue(otherCompany,issue.user_id,"RESET",accountToken().hash)).toBeNull();
    expect(await f.repository.setPassword(otherCompany,issue.user_id,hash)).toBe(false);
    await expect(f.repository.invite(otherCompany,"Person",issue.email,accountToken().hash)).rejects.toThrow("ACCESS_EXISTS");
    expect(await f.repository.requestReset("insulhub-settings-service@internal.invalid",accountToken().hash)).toBeNull();
    await f.pool.query("UPDATE partner_users SET disabled_at=now() WHERE id=$1",[issue.user_id]);
    expect(await f.repository.requestReset(issue.email,accountToken().hash)).toBeNull();
    expect(await f.repository.complete(token.hash,hash)).toBe(false);expect(await f.repository.setPassword(company,issue.user_id,hash)).toBe(false);
    const second=await invite(f,"second@example.test");await f.pool.query("UPDATE partner_companies SET is_active=false WHERE id=$1",[company]);
    expect(await f.repository.complete(second.token.hash,hash)).toBe(false);
    expect(await f.repository.setPassword(company,second.issue.user_id,hash)).toBe(false);
  });
  it("rejects expired links and rolls back credentials, link consumption and session deletion together on failure",async()=>{
    const f=await fixture(),{token,issue}=await invite(f);
    await f.pool.query("UPDATE partner_account_links SET issued_at=now()-interval '4 hours',expires_at=now()-interval '1 hour' WHERE user_id=$1",[issue.user_id]);
    expect(await f.repository.complete(token.hash,await hashPassword(password))).toBe(false);
    await f.repository.setPassword(company,issue.user_id,await hashPassword(password));
    const next=accountToken();await f.repository.requestReset(issue.email,next.hash);
    const native=f.pool.connect.bind(f.pool);
    vi.spyOn(f.pool,"connect").mockImplementation(async()=>{
      const client=await native(),query=client.query.bind(client);
      client.query=(async(text:string,values?:unknown[])=>{if(text.startsWith("INSERT INTO partner_audit_events"))throw Error("Audit unavailable");return query(text,values);}) as typeof client.query;
      return client;
    });
    await expect(f.repository.complete(next.hash,await hashPassword(otherPassword))).rejects.toThrow("Audit unavailable");
    const account=(await f.pool.query("SELECT password FROM partner_accounts WHERE user_id=$1",[issue.user_id])).rows[0];
    expect(await verifyPassword({hash:account.password,password})).toBe(true);
    expect((await f.pool.query("SELECT token_hash FROM partner_account_links WHERE user_id=$1",[issue.user_id])).rows[0].token_hash).toBe(next.hash);
  });
});
describe("account access route boundaries",()=>{
  it("returns generic reset responses before email processing and does not reveal account/provider state",async()=>{
    const f=await fixture(),{issue}=await invite(f);await ageLink(f,issue.user_id);
    f.mail.mockRejectedValue(Error("private provider details"));
    const unknown=await publicAccountPassword(request({email:"unknown@example.test"}),"request",f.deps);
    const known=await publicAccountPassword(request({email:issue.email}),"request",f.deps);
    expect(await unknown.json()).toEqual({message:RESET_REQUEST_MESSAGE});expect(await known.json()).toEqual({message:RESET_REQUEST_MESSAGE});
    expect(known.headers.get("cache-control")).toBe("private, no-store");expect(f.mail).not.toHaveBeenCalled();
    expect(f.deferred).toHaveLength(1);await f.deferred[0]();expect(f.mail).toHaveBeenCalledOnce();
  });
  it("enforces exact Origin, canonical host, bounded input and durable public throttling",async()=>{
    const f=await fixture();
    for(const headers of [{origin:"https://evil.test"},{origin:origin+"/path"},{host:"evil.test"},{"x-forwarded-host":"evil.test"}] as Array<Record<string,string>>){
      expect((await publicAccountPassword(request({email:"unknown@example.test"},headers),"request",f.deps)).status).toBe(403);
    }
    expect((await publicAccountPassword(request({email:"unknown@example.test",companyId:company}),"request",f.deps)).status).toBe(400);
    for(let i=0;i<9;i++)expect((await publicAccountPassword(request({email:"unknown@example.test"}),"request",f.deps)).status).toBe(200);
    expect((await publicAccountPassword(request({email:"unknown@example.test"}),"request",f.deps)).status).toBe(429);
  });
  it("completes only a valid token/password body, without setting cookies or accepting callback URLs",async()=>{
    const f=await fixture(),{token}=await invite(f);
    expect((await publicAccountPassword(request({token:token.token,password,callbackURL:"https://evil.test"}),"complete",f.deps)).status).toBe(400);
    const complete=await publicAccountPassword(request({token:token.token,password}),"complete",f.deps);
    expect(complete.status).toBe(200);expect(complete.headers.get("set-cookie")).toBeNull();
    expect((await publicAccountPassword(request({token:token.token,password}),"complete",f.deps)).status).toBe(400);
    const url=new URL(accountLinkUrl(origin,token.token));expect(url.pathname).toBe("/partner/set-password");expect(url.search).toBe("");expect(url.hash).toContain(token.token);
  });
  it("normal InsulHub verification is required for invitations/reset/override; failed delivery is not reported as sent",async()=>{
    const f=await fixture();vi.stubGlobal("fetch",vi.fn(async()=>Response.json({data:{users:{results:[{_id:"normal-user"}]}}})));
    const deps={repository:new PartnerOperationsRepository(f.pool,true),accessRepository:f.repository,origins:f.deps.origins,portalOrigin:origin,verify:requireInsulhubAuth,sendAccountMail:async()=>({delivery:"FAILED" as const,message:"Email could not be confirmed."})};
    const call=(r:Request,userId?:string,action:"invite"|"access"="invite")=>partnerSettingsRoute(r,company,userId,true,deps,action);
    expect((await call(request({name:"Person",email:"invite@example.test"},{cookie:"insulhub_partner.session_token=partner"}))).status).toBe(401);
    const normal={"x-access-token":"account-access-normal-user"};
    const created=await call(request({name:"Person",email:"invite@example.test"},normal));
    expect(created.status).toBe(200);expect(await created.json()).toMatchObject({ok:true,delivery:"FAILED"});
    const repeated=await call(request({name:"Person",email:"invite@example.test"},normal));
    expect(repeated.status).toBe(429);expect(repeated.headers.get("retry-after")).toBe("60");
    const pending=(await f.repository.userStates(company))[0];
    const override=await call(request({action:"PASSWORD",password},normal),pending.id,"access");expect(override.status).toBe(200);
    expect((await f.login("invite@example.test")).status).toBe(200);
  });
});
