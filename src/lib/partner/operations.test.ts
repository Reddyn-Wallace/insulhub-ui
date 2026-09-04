import { describe, expect, it } from "vitest";
import { PartnerOperationsRepository } from "./operations-repository";
import { parseAmendment, parseInvoice, parseSettlement } from "./operations";
import { createPartnerTestDatabase } from "./test-db";
import { getPartnerDemoPool, resetPartnerDemoStorage, withPartnerDemoDatabaseLock } from "./demo";
import { PRODUCT_QUOTE_DEFAULTS } from "./quote";
import type { PartnerSql } from "./db";

const companyA = "11111111-1111-4111-8111-111111111111";
const jobA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

async function setup() {
  const { Pool } = createPartnerTestDatabase(); const pool = new Pool();
  await pool.query(`INSERT INTO partner_companies(id,slug,name,billing_model) VALUES($1,'one','One','INSULHUB_BILLED')`, [companyA]);
  await pool.query(`INSERT INTO partner_users(id,company_id,principal_type,name,email,ops_role) VALUES('admin',NULL,'INTERNAL','Admin','admin@test','ADMIN'),('ops',NULL,'INTERNAL','Ops','ops@test','OPERATIONS'),('finance',NULL,'INTERNAL','Finance','finance@test','FINANCE'),('viewer',NULL,'INTERNAL','Viewer','viewer@test','VIEWER'),('partner-a',$1,'PARTNER','Partner','partner-a@test',NULL)`,[companyA]);
  await pool.query(`INSERT INTO partner_jobs(id,company_id,created_by_user_id,client_reference,submission_state,billing_model_snapshot,submission_started_at,submitted_at) VALUES($1,$2,'partner-a','A-1','SUBMITTED','INSULHUB_BILLED',now(),now())`,[jobA,companyA]);
  return { pool, repo:new PartnerOperationsRepository(pool,true) };
}
const internal=(userId:string)=>({userId,principalType:"INTERNAL" as const,companyId:null});

describe("partner operations contract",()=>{
  it("parses only exact bounded financial and amendment shapes",()=>{
    expect(parseInvoice({revision:0,reference:" INV-1 ",amountCents:100,sentAt:"2026-01-01T00:00:00Z"})).toMatchObject({reference:"INV-1"});
    expect(parseInvoice({revision:0,reference:"x",amountCents:-1,sentAt:"2026-01-01T00:00:00Z"})).toBeNull();
    expect(parseAmendment({version:1,description:" scope ",contractDeltaCents:-30})).toEqual({description:"scope",contractDeltaCents:-30});
    expect(parseAmendment({version:2,description:"no"})).toBeNull();
    expect(parseSettlement({revision:0,grossCents:500,commissionCents:100,status:"PAID",settledAt:"2026-01-01T00:00:00Z"},"INSULHUB_BILLED")).not.toBeNull();
    expect(parseSettlement({revision:0,grossCents:500,commissionCents:100,status:"PAID",settledAt:"2026-01-01T00:00:00Z"},"PARTNER_BILLED")).toBeNull();
  });
  it("revalidates roles and projects both billing models without credentials",async()=>{
    const {pool,repo}=await setup();
    await expect(repo.appendFact(internal("viewer"),companyA,jobA,"EBA_COMPLETED","2026-01-01T00:00:00Z")).rejects.toMatchObject({code:"OPS_FORBIDDEN"});
    await repo.appendFact(internal("ops"),companyA,jobA,"EBA_COMPLETED","2026-01-01T00:00:00Z");
    await repo.upsertInvoice(internal("ops"),companyA,jobA,{revision:0,reference:"INV-1",amountCents:500,sentAt:"2026-01-02T00:00:00Z"});
    await repo.upsertInvoice(internal("ops"),companyA,jobA,{revision:0,reference:"INV-2",amountCents:600,sentAt:"2026-01-03T00:00:00Z"});
    await expect(repo.upsertInvoice(internal("ops"),companyA,jobA,{revision:0,reference:"INV-3",amountCents:700,sentAt:"2026-01-04T00:00:00Z"})).rejects.toMatchObject({code:"OPS_STALE_REVISION"});
    await repo.upsertSettlement(internal("finance"),companyA,jobA,"INSULHUB_BILLED",{revision:0,grossCents:600,commissionCents:100,status:"PAID",settledAt:"2026-01-04T00:00:00Z"});
    const view=await repo.partnerProjection(companyA,jobA); expect(view?.settlement).toMatchObject({netDueCents:100,status:"PAID"}); expect(JSON.stringify(view)).not.toMatch(/password|credential|cipher/i);
    await pool.end();
  });
  it("creates and disables partner users with a server-side password hash",async()=>{
    const {pool,repo}=await setup();
    const created=await repo.createPartnerUser(internal("admin"),companyA,{name:"New Partner",email:"new.partner@test",initialPassword:"ValidPassw0rd!"});
    const user=(await pool.query("SELECT id,company_id,principal_type,name,email,disabled_at FROM partner_users WHERE id=$1",[created.id])).rows[0];
    expect(user).toMatchObject({company_id:companyA,principal_type:"PARTNER",name:"New Partner",email:"new.partner@test",disabled_at:null});
    const account=(await pool.query("SELECT account_id,provider_id,user_id,password FROM partner_accounts WHERE account_id=$1",[created.id])).rows[0];
    expect(account).toMatchObject({account_id:created.id,provider_id:"credential",user_id:created.id});
    expect(String(account.password)).toMatch(/^[^:]+:[0-9a-f]+$/);
    await pool.query("INSERT INTO partner_sessions(id,expires_at,token,user_id) VALUES('sess-1',now()+interval '1 day','token-1',$1)",[created.id]);
    await repo.disablePartnerUser(internal("admin"),companyA,created.id);
    expect((await pool.query("SELECT 1 FROM partner_sessions WHERE user_id=$1",[created.id])).rowCount).toBe(0);
    expect((await pool.query("SELECT disabled_at FROM partner_users WHERE id=$1",[created.id])).rows[0].disabled_at).not.toBeNull();
    await pool.end();
  });

  it("serializes an outside demo write behind a failed compound operation rollback",async()=>{
    const saved={mode:process.env.PARTNER_DEMO_MODE,confirm:process.env.PARTNER_DEMO_CONFIRM,origin:process.env.PARTNER_APP_ORIGIN};
    process.env.PARTNER_DEMO_MODE="true"; process.env.PARTNER_DEMO_CONFIRM="LOCAL_FICTIONAL_DATA_ONLY"; process.env.PARTNER_APP_ORIGIN="http://localhost:3000";
    await resetPartnerDemoStorage();
    try {
      const alternatePath="./demo?shared-lock-regression", alternate=await import(alternatePath) as typeof import("./demo"); let reentered=false;
      await Promise.race([withPartnerDemoDatabaseLock(()=>alternate.withPartnerDemoDatabaseLock(async()=>{reentered=true;})),new Promise((_,reject)=>setTimeout(()=>reject(new Error("dual module lock deadlocked")),500))]);
      expect(reentered).toBe(true);
      const pool=getPartnerDemoPool(); const auditReached=Promise.withResolvers<void>(), release=Promise.withResolvers<void>();
      const sql={query:async (text:string,values?:unknown[])=>{ if(text.includes("partner_audit_events")){auditReached.resolve();await release.promise;throw new Error("forced audit failure");} return pool.query(text,values); }} as PartnerSql;
      const repository=new PartnerOperationsRepository(sql,true);
      const create=repository.createCompany({userId:"demo-internal-operator",principalType:"INTERNAL",companyId:null},{slug:"rollback-proof",name:"Rollback proof",billingModel:"INSULHUB_BILLED",quoteDefaults:{...PRODUCT_QUOTE_DEFAULTS,extras:PRODUCT_QUOTE_DEFAULTS.extras}});
      await auditReached.promise;
      let outsideDone=false; const outside=pool.query("UPDATE partner_companies SET name='Northwind locked write' WHERE slug='northwind-insulation'").then(()=>{outsideDone=true;});
      await Promise.resolve(); expect(outsideDone).toBe(false);
      release.resolve(); await expect(create).rejects.toThrow("forced audit failure"); await outside;
      expect((await pool.query("SELECT 1 FROM partner_companies WHERE slug='rollback-proof'")).rowCount).toBe(0);
      expect((await pool.query("SELECT name FROM partner_companies WHERE slug='northwind-insulation'")).rows[0].name).toBe("Northwind locked write");
      await pool.end();
    } finally { await resetPartnerDemoStorage(); process.env.PARTNER_DEMO_MODE=saved.mode; process.env.PARTNER_DEMO_CONFIRM=saved.confirm; process.env.PARTNER_APP_ORIGIN=saved.origin; }
  });
});
