import { afterEach, describe, expect, it } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { createPartnerTestDatabase } from "./test-db";
import { PartnerAccountAccessRepository } from "./account-access-repository";
import { accountToken } from "./account-access";
import { partnerUserManagementRoute } from "./user-management-routes";
const company="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222",origin="https://portal.example.test";
const pools:Array<{end():Promise<void>}>=[];
afterEach(async()=>{await Promise.all(pools.splice(0).map(p=>p.end()));});
async function fixture(){
 const {db,Pool}=createPartnerTestDatabase(),pool=new Pool();pools.push(pool);
 await pool.query("INSERT INTO partner_companies(id,slug,name,billing_model) VALUES($1,'one','One','INSULHUB_BILLED'),($2,'two','Two','INSULHUB_BILLED')",[company,other]);
 await pool.query("INSERT INTO partner_users(id,company_id,principal_type,name,email,partner_role) VALUES('admin',$1,'PARTNER','Admin','admin@example.test','ADMIN'),('sales',$1,'PARTNER','Sales','sales@example.test','SALES'),('other-admin',$2,'PARTNER','Other','other@example.test','ADMIN')",[company,other]);
 const forActor=(actor?:string)=>new PartnerAccountAccessRepository(pool,true,()=>db.backup(),actor);
 return {pool,staff:forActor(),admin:forActor('admin'),sales:forActor('sales'),forActor};
}
describe('company lifecycle and partner employee authorisation',()=>{
 it('archives every employee, revokes sessions and links, and restore leaves all disabled',async()=>{
  const f=await fixture();await f.staff.issue(company,'sales','RESET',accountToken().hash);
  await f.pool.query("INSERT INTO partner_sessions(id,user_id,token,expires_at)VALUES('session','sales','session-token',$1)",[new Date(Date.now()+3600000)]);
  expect(await f.staff.companyActive(company,0,false)).toBe(true);
  expect((await f.staff.managedUsers(company)).every(u=>u.disabledAt!==null)).toBe(true);
  expect((await f.pool.query('SELECT * FROM partner_sessions')).rows).toHaveLength(0);
  expect((await f.pool.query('SELECT * FROM partner_account_links')).rows).toHaveLength(0);
  expect(await f.staff.companyActive(company,0,true)).toBe(false);
  expect(await f.staff.companyActive(company,1,true)).toBe(true);
  expect((await f.staff.managedUsers(company)).every(u=>u.disabledAt!==null)).toBe(true);
  await f.staff.manageUser(company,'sales',{isActive:true});
  expect((await f.staff.managedUsers(company)).filter(u=>!u.disabledAt).map(u=>u.id)).toEqual(['sales']);
  expect((await f.staff.managedUsers(other))[0].disabledAt).toBeNull();
 });
 it('rejects Sales and cross-company management for list, change, invitations and password overrides',async()=>{
  const f=await fixture();const hash=await hashPassword('A-New-Password123!');
  for(const repo of [f.sales,f.forActor('other-admin')]){
   await expect(repo.managedUsers(company)).rejects.toThrow('ACCESS_FORBIDDEN');
   await expect(repo.manageUser(company,'sales',{role:'ADMIN'})).rejects.toThrow('ACCESS_FORBIDDEN');
   await expect(repo.invite(company,'New','new@example.test',accountToken().hash,'ADMIN')).rejects.toThrow('ACCESS_FORBIDDEN');
   await expect(repo.setPassword(company,'sales',hash)).rejects.toThrow('ACCESS_FORBIDDEN');
  }
  expect(await f.admin.manageUser(company,'other-admin',{isActive:false})).toBe(false);
 });
 it('permits own-company admins to create and invite either role without conferring internal privileges',async()=>{
  const f=await fixture(),hash=await hashPassword('A-New-Password123!');
  const created=await f.admin.createUser(company,{name:'New Admin',email:'new-admin@example.test',role:'ADMIN'},hash);
  const issue=await f.admin.invite(company,'Invite','invite@example.test',accountToken().hash,'SALES');
  expect(await f.admin.managedUsers(company)).toEqual(expect.arrayContaining([expect.objectContaining({id:created.id,role:'ADMIN'}),expect.objectContaining({id:issue?.user_id,role:'SALES',invitationPending:true})]));
  const row=(await f.pool.query('SELECT principal_type,ops_role FROM partner_users WHERE id=$1',[created.id])).rows[0];
  expect(row).toMatchObject({principal_type:'PARTNER',ops_role:null});
 });
 it('blocks archived company create/invite/reactivate, including existing invitation resends',async()=>{
  const f=await fixture();await f.staff.companyActive(company,0,false);
  await expect(f.staff.manageUser(company,'sales',{isActive:true})).rejects.toThrow('ACCESS_ARCHIVED');
  await expect(f.staff.createUser(company,{name:'New',email:'new@example.test'},await hashPassword('A-New-Password123!'))).rejects.toThrow('ACCESS_ARCHIVED');
  expect(await f.staff.invite(company,'New','new@example.test',accountToken().hash)).toBeNull();
  expect(await f.staff.issue(company,'sales','RESET',accountToken().hash)).toBeNull();
  await expect(f.admin.managedUsers(company)).rejects.toThrow('ACCESS_FORBIDDEN');
 });
 it('prevents the final active admin removing their own access; pending invites do not count',async()=>{
  const f=await fixture();await f.admin.invite(company,'Pending','pending@example.test',accountToken().hash,'ADMIN');
  await expect(f.admin.manageUser(company,'admin',{role:'SALES'})).rejects.toThrow('ACCESS_LAST_ADMIN');
  await expect(f.admin.manageUser(company,'admin',{isActive:false})).rejects.toThrow('ACCESS_LAST_ADMIN');
  await f.admin.manageUser(company,'sales',{role:'ADMIN'});
  expect(await f.admin.manageUser(company,'admin',{role:'SALES'})).toBe(true);
  await expect(f.admin.managedUsers(company)).rejects.toThrow('ACCESS_FORBIDDEN');
 });
 it('deactivation destroys links so they cannot become usable on individual reactivation',async()=>{
  const f=await fixture(),token=accountToken();await f.staff.issue(company,'sales','RESET',token.hash);
  await f.admin.manageUser(company,'sales',{isActive:false});await f.admin.manageUser(company,'sales',{isActive:true});
  expect(await f.staff.complete(token.hash,await hashPassword('A-New-Password123!'))).toBe(false);
 });
 it('partner HTTP boundary uses authenticated identity and rejects company injection and invalid origins',async()=>{
  const f=await fixture();let userId='sales';
  const deps={origins:new Set([origin]),getPrincipal:async()=>({principalType:'PARTNER' as const,userId,companyId:company}),repositoryFor:f.forActor,portalOrigin:origin};
  const req=(method:string,body?:unknown,requestOrigin=origin)=>new Request(origin+'/api/partner/users',{method,headers:{origin:requestOrigin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  expect((await partnerUserManagementRoute(req('GET'),undefined,undefined,deps)).status).toBe(403);
  userId='admin';expect((await partnerUserManagementRoute(req('GET'),undefined,undefined,deps)).status).toBe(200);
  expect((await partnerUserManagementRoute(req('PATCH',{role:'ADMIN',companyId:other}),'sales',undefined,deps)).status).toBe(400);
  expect((await partnerUserManagementRoute(req('PATCH',{role:'ADMIN'},'https://evil.test'),'sales',undefined,deps)).status).toBe(403);
 });
});
