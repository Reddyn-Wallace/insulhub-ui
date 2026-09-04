import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SITE_PLAN_DOCUMENT } from "../site-plan-drawings";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { PARTNER_DEMO_CONFIRMATION } from "./demo";
import { calculateQuote, createQuoteDraft, PRODUCT_QUOTE_DEFAULTS } from "./quote";
import type { PartnerPrincipal } from "./repository";
import { PartnerSitePlanRepository } from "./site-plan-repository";
import { buildAuthoritativePartnerSubmission, PartnerSubmissionRepository } from "./submission-repository";
import { partnerSubmissionIdempotencyHash } from "./submission";
import { createPartnerTestDatabase } from "./test-db";

const pools:Array<{end():Promise<void>}>=[];
const env={NODE_ENV:"test",PARTNER_DEMO_MODE:"true",PARTNER_DEMO_CONFIRM:PARTNER_DEMO_CONFIRMATION,PARTNER_APP_ORIGIN:"http://127.0.0.1:3000"} as NodeJS.ProcessEnv;
afterEach(async()=>{vi.unstubAllEnvs();await Promise.all(pools.splice(0).map((pool)=>pool.end()));});

async function fixture(){
  vi.stubEnv("NODE_ENV","test");vi.stubEnv("PARTNER_DEMO_MODE","true");vi.stubEnv("PARTNER_DEMO_CONFIRM",PARTNER_DEMO_CONFIRMATION);vi.stubEnv("PARTNER_APP_ORIGIN","http://127.0.0.1:3000");
  const {Pool}=createPartnerTestDatabase();const pool=new Pool();pools.push(pool);
  const companyId=(await pool.query(`INSERT INTO partner_companies(slug,name,billing_model,submission_adapter_mode,submission_contract_version,legacy_job_prefix) VALUES('submit-company','Submit Company','INSULHUB_BILLED','FICTIONAL','fictional-v1','NW') RETURNING id`)).rows[0].id;
  await pool.query("INSERT INTO partner_users(id,company_id,principal_type,name,email) VALUES('submit-user',$1,'PARTNER','Submit User','submit@example.test')",[companyId]);
  const quote=createQuoteDraft(PRODUCT_QUOTE_DEFAULTS,"LOCAL-READY","2026-08-30T00:00:00.000Z");quote.wall={enabled:true,areaSqm:100,rateCentsPerSqm:1000,cavityDepthCm:10};
  const jobId=(await pool.query(`INSERT INTO partner_jobs(company_id,created_by_user_id,client_reference,billing_model_snapshot,customer_name,customer_mobile,customer_email,site_address,lead_sources,notes,quote_data,quote_initialized_at,quote_defaults_revision,quote_defaults_snapshot,quote_total_cents)
    VALUES($1,'submit-user','SUBMIT-1','INSULHUB_BILLED','Fictional Ready','0215550123','',$2::jsonb,'[]'::jsonb,'Ready',$3::jsonb,now(),$4,$5::jsonb,$6) RETURNING id`,[companyId,JSON.stringify({street:"1 Demo Street",suburb:"Demo",city:"Auckland",postcode:"1010"}),JSON.stringify(quote),quote.defaultsSnapshot.revision,JSON.stringify(quote.defaultsSnapshot),calculateQuote(quote).totalCents])).rows[0].id;
  const principal:PartnerPrincipal={userId:"submit-user",companyId,principalType:"PARTNER"};const plans=new PartnerSitePlanRepository(pool);
  const document={...EMPTY_SITE_PLAN_DOCUMENT,walls:[{id:"wall-1",start:{x:1,y:1},end:{x:5,y:1},style:"solid" as const}]};
  const created=await plans.create(principal,jobId,0,"Ground floor",document);if(created.outcome!=="updated")throw new Error("drawing create failed");const drawingId=created.collection.floors[0].id;
  const snapshot=await plans.renderSnapshot(principal,jobId,drawingId);if(!snapshot)throw new Error("render snapshot missing");const bytes=Buffer.from("%PDF-1.7\nfictional submission repository fixture");
  const published=await plans.publish(principal,jobId,drawingId,snapshot,{bytes,contentSha256:createHash("sha256").update(bytes).digest("hex")},"Ground floor.pdf");if(!published?.pdfReady)throw new Error("publish failed");
  return{pool,principal,jobId,repository:new PartnerSubmissionRepository(pool,env)};
}

async function secondReadyJob(pool:Pool,principal:PartnerPrincipal,sourceJobId:string){
  const jobId=(await pool.query(`INSERT INTO partner_jobs(company_id,created_by_user_id,client_reference,billing_model_snapshot,customer_name,customer_mobile,customer_email,site_address,lead_sources,notes,quote_data,quote_initialized_at,quote_defaults_revision,quote_defaults_snapshot,quote_total_cents)
    SELECT company_id,created_by_user_id,'SUBMIT-2',billing_model_snapshot,customer_name,customer_mobile,customer_email,site_address,lead_sources,notes,quote_data,quote_initialized_at,quote_defaults_revision,quote_defaults_snapshot,quote_total_cents FROM partner_jobs WHERE company_id=$1 AND id=$2 RETURNING id`,[principal.companyId,sourceJobId])).rows[0].id;
  const plans=new PartnerSitePlanRepository(pool as never);const document={...EMPTY_SITE_PLAN_DOCUMENT,walls:[{id:"wall-2",start:{x:1,y:1},end:{x:4,y:1},style:"solid" as const}]};const created=await plans.create(principal,jobId,0,"Ground floor",document);if(created.outcome!=="updated")throw new Error("second drawing create failed");const drawingId=created.collection.floors[0].id;const snapshot=await plans.renderSnapshot(principal,jobId,drawingId);if(!snapshot)throw new Error("second render snapshot missing");const bytes=Buffer.from("%PDF-1.7\nsecond fictional submission fixture");const published=await plans.publish(principal,jobId,drawingId,snapshot,{bytes,contentSha256:createHash("sha256").update(bytes).digest("hex")},"Ground floor.pdf");if(!published?.pdfReady)throw new Error("second publish failed");return jobId;
}

describe("fictional submission repository atomic freeze",()=>{
  it("freezes the server-owned company source and zero terms, including unsent old quotes",async()=>{
    const {pool,principal,jobId,repository}=await fixture();
    const old=(await pool.query("SELECT quote_data FROM partner_jobs WHERE id=$1",[jobId])).rows[0].quote_data;
    old.consentFeeCents=12300;old.depositBasisPoints=3500;
    await pool.query("UPDATE partner_jobs SET quote_data=$2::jsonb,lead_sources=$3::jsonb WHERE id=$1",[jobId,JSON.stringify(old),JSON.stringify(["REFERRAL"])]);
    const candidate=await repository.loadCandidate(principal,jobId,partnerSubmissionIdempotencyHash("company-attribution-fixture-001"));
    if(!candidate)throw new Error("missing candidate");
    const built=buildAuthoritativePartnerSubmission(candidate);
    expect(built.snapshot.job.leadSources).toEqual(["Submit Company"]);
    expect(built.snapshot.job.quote).toMatchObject({consentFeeCents:0,depositBasisPoints:0});
    const spoofed={...candidate,companyName:"Spoofed company"};
    await expect(repository.freeze(principal,spoofed,buildAuthoritativePartnerSubmission(spoofed))).rejects.toThrow("SUBMISSION_STALE");
    await repository.freeze(principal,candidate,built);
    const frozen=(await pool.query("SELECT quote_data FROM partner_jobs WHERE id=$1",[jobId])).rows[0].quote_data;
    expect(frozen).toMatchObject({consentFeeCents:0,depositBasisPoints:0});
    expect(frozen.wall).toEqual(old.wall);
  });

  it("serializes ten concurrent submits into one complete saga with no orphan rows",async()=>{
    const{pool,principal,jobId,repository}=await fixture();const candidate=await repository.loadCandidate(principal,jobId,partnerSubmissionIdempotencyHash("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));if(!candidate)throw new Error("candidate missing");const built=buildAuthoritativePartnerSubmission(candidate);
    const results=await Promise.all(Array.from({length:10},()=>repository.freeze(principal,candidate,built)));
    expect(results.filter((result)=>!result.replayed)).toHaveLength(1);expect(new Set(results.map((result)=>result.status.state))).toEqual(new Set(["QUEUED"]));
    for(const table of ["partner_submission_snapshots","partner_submission_requests","partner_submission_plan_manifest","partner_submission_plan_deliveries","partner_outbox_events"]){expect((await pool.query(`SELECT 1 FROM ${table} WHERE company_id=$1 AND job_id=$2`,[principal.companyId,jobId])).rowCount).toBe(1);}
    expect((await pool.query("SELECT submission_state FROM partner_jobs WHERE company_id=$1 AND id=$2",[principal.companyId,jobId])).rows[0].submission_state).toBe("QUEUED");
    const snapshot=(await pool.query("SELECT canonical_document,snapshot_sha256,byte_size FROM partner_submission_snapshots WHERE company_id=$1 AND job_id=$2",[principal.companyId,jobId])).rows[0];
    expect(snapshot.canonical_document).toBe(built.canonicalDocument);expect(snapshot.snapshot_sha256).toHaveLength(64);expect(Number(snapshot.byte_size)).toBe(Buffer.byteLength(built.canonicalDocument));expect(built.manifest).toHaveLength(1);
  });

  it("fails closed without transaction-capable SQL before writing anything",async()=>{
    const{pool,principal,jobId,repository}=await fixture();const candidate=await repository.loadCandidate(principal,jobId,partnerSubmissionIdempotencyHash("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));if(!candidate)throw new Error("candidate missing");const built=buildAuthoritativePartnerSubmission(candidate);
    const queryOnly=new PartnerSubmissionRepository({query:pool.query.bind(pool)} as never,env);
    await expect(queryOnly.freeze(principal,candidate,built)).rejects.toThrow("SUBMISSION_TRANSACTION_UNAVAILABLE");expect((await pool.query("SELECT 1 FROM partner_submission_requests WHERE company_id=$1 AND job_id=$2",[principal.companyId,jobId])).rowCount).toBe(0);
  });

  it("rejects a drawing race after candidate load and rolls back every saga row",async()=>{
    const{pool,principal,jobId,repository}=await fixture();const candidate=await repository.loadCandidate(principal,jobId,partnerSubmissionIdempotencyHash("cccccccc-cccc-4ccc-8ccc-cccccccccccc"));if(!candidate)throw new Error("candidate missing");const built=buildAuthoritativePartnerSubmission(candidate);
    await pool.query("UPDATE partner_site_plan_drawings SET name='Changed after preflight' WHERE company_id=$1 AND job_id=$2",[principal.companyId,jobId]);
    await expect(repository.freeze(principal,candidate,built)).rejects.toThrow("SUBMISSION_STALE");
    for(const table of ["partner_submission_snapshots","partner_submission_requests","partner_submission_plan_manifest","partner_submission_plan_deliveries"]){expect((await pool.query(`SELECT 1 FROM ${table} WHERE company_id=$1 AND job_id=$2`,[principal.companyId,jobId])).rowCount).toBe(0);}
    expect((await pool.query("SELECT submission_state FROM partner_jobs WHERE company_id=$1 AND id=$2",[principal.companyId,jobId])).rows[0].submission_state).toBe("DRAFT");
  });

  it("rolls back snapshot and manifest writes when a later transaction step fails",async()=>{
    const{pool,principal,jobId,repository}=await fixture();const candidate=await repository.loadCandidate(principal,jobId,partnerSubmissionIdempotencyHash("dddddddd-dddd-4ddd-8ddd-dddddddddddd"));if(!candidate)throw new Error("candidate missing");const built=buildAuthoritativePartnerSubmission(candidate);
    const faultySql={query:pool.query.bind(pool),connect:async()=>{const client=await pool.connect();return{query:async(text:string,values?:unknown[])=>{if(text.includes("INSERT INTO partner_submission_requests"))throw new Error("injected transaction fault");return client.query(text,values);},release:()=>client.release()};}};
    await expect(new PartnerSubmissionRepository(faultySql as never,env).freeze(principal,candidate,built)).rejects.toThrow("injected transaction fault");
    for(const table of ["partner_submission_snapshots","partner_submission_requests","partner_submission_plan_manifest","partner_submission_plan_deliveries"]){expect((await pool.query(`SELECT 1 FROM ${table} WHERE company_id=$1 AND job_id=$2`,[principal.companyId,jobId])).rowCount).toBe(0);}expect((await pool.query("SELECT 1 FROM partner_outbox_events WHERE company_id=$1 AND job_id=$2 AND topic='PARTNER_SUBMISSION_EXECUTE'",[principal.companyId,jobId])).rowCount).toBe(0);
    expect((await pool.query("SELECT submitted_snapshot_at FROM partner_site_plan_drawings WHERE company_id=$1 AND job_id=$2",[principal.companyId,jobId])).rows[0].submitted_snapshot_at).toBeNull();expect((await pool.query("SELECT submission_state FROM partner_jobs WHERE company_id=$1 AND id=$2",[principal.companyId,jobId])).rows[0].submission_state).toBe("DRAFT");
  });

  it("returns no preflight or status for a different tenant",async()=>{
    const{principal,jobId,repository}=await fixture();const other={...principal,companyId:"99999999-9999-4999-8999-999999999999"};expect(await repository.preflight(other,jobId)).toBeNull();expect(await repository.status(other,jobId)).toBeNull();
  });

  it("rejects same-company key reuse on another job as a bounded no-effect conflict",async()=>{
    const{pool,principal,jobId,repository}=await fixture();const secondJobId=await secondReadyJob(pool as never,principal,jobId);const hash=partnerSubmissionIdempotencyHash("abababab-abab-4bab-8bab-abababababab");const first=await repository.loadCandidate(principal,jobId,hash);const second=await repository.loadCandidate(principal,secondJobId,hash);if(!first||!second)throw new Error("candidate missing");await repository.freeze(principal,first,buildAuthoritativePartnerSubmission(first));await expect(repository.freeze(principal,second,buildAuthoritativePartnerSubmission(second))).rejects.toThrow("SUBMISSION_IDEMPOTENCY_CONFLICT");expect((await pool.query("SELECT 1 FROM partner_submission_requests WHERE company_id=$1 AND job_id=$2",[principal.companyId,secondJobId])).rowCount).toBe(0);expect((await pool.query("SELECT submission_state FROM partner_jobs WHERE company_id=$1 AND id=$2",[principal.companyId,secondJobId])).rows[0].submission_state).toBe("DRAFT");
  });

  it("compensates a late post-job-update fault even when ROLLBACK itself rejects",async()=>{
    const{pool,principal,jobId,repository}=await fixture();const candidate=await repository.loadCandidate(principal,jobId,partnerSubmissionIdempotencyHash("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"));if(!candidate)throw new Error("candidate missing");const built=buildAuthoritativePartnerSubmission(candidate);const originalUpdated=(await pool.query("SELECT updated_at FROM partner_jobs WHERE id=$1",[jobId])).rows[0].updated_at;let statusReads=0;
    const sql={query:pool.query.bind(pool),connect:async()=>{const client=await pool.connect();return{query:async(text:string,values?:unknown[])=>{if(text==="ROLLBACK")throw new Error("rollback connection lost");if(text.includes("SELECT r.state")&&++statusReads===2)throw new Error("late status fault");return client.query(text,values);},release:()=>client.release()};}};
    await expect(new PartnerSubmissionRepository(sql as never,env).freeze(principal,candidate,built)).rejects.toThrow("late status fault");for(const table of ["partner_submission_snapshots","partner_submission_requests","partner_submission_plan_manifest","partner_submission_plan_deliveries"]){expect((await pool.query(`SELECT 1 FROM ${table} WHERE company_id=$1 AND job_id=$2`,[principal.companyId,jobId])).rowCount).toBe(0);}expect((await pool.query("SELECT 1 FROM partner_outbox_events WHERE company_id=$1 AND job_id=$2 AND topic='PARTNER_SUBMISSION_EXECUTE'",[principal.companyId,jobId])).rowCount).toBe(0);const drawing=(await pool.query("SELECT submitted_snapshot_data,submitted_snapshot_at,submitted_pdf_storage_key,submitted_pdf_outbox_event_id FROM partner_site_plan_drawings WHERE company_id=$1 AND job_id=$2",[principal.companyId,jobId])).rows[0];expect(drawing).toEqual({submitted_snapshot_data:null,submitted_snapshot_at:null,submitted_pdf_storage_key:null,submitted_pdf_outbox_event_id:null});const job=(await pool.query("SELECT submission_state,updated_at FROM partner_jobs WHERE id=$1",[jobId])).rows[0];expect(job.submission_state).toBe("DRAFT");expect(new Date(job.updated_at).toISOString()).toBe(new Date(originalUpdated).toISOString());
  });

  it("poisons a demo job when compensation cannot be verified",async()=>{
    const{pool,principal,jobId,repository}=await fixture();const candidate=await repository.loadCandidate(principal,jobId,partnerSubmissionIdempotencyHash("ffffffff-ffff-4fff-8fff-ffffffffffff"));if(!candidate)throw new Error("candidate missing");const built=buildAuthoritativePartnerSubmission(candidate);let compensate=false;
    const sql={query:async(text:string,values?:unknown[])=>{if(compensate&&text.includes("DELETE FROM partner_submission_requests"))throw new Error("cleanup unavailable");return pool.query(text,values);},connect:async()=>{const client=await pool.connect();return{query:async(text:string,values?:unknown[])=>{if(text.includes("INSERT INTO partner_submission_requests")){compensate=true;throw new Error("injected write fault");}return client.query(text,values);},release:()=>client.release()};}};
    const poisoned=new PartnerSubmissionRepository(sql as never,env);await expect(poisoned.freeze(principal,candidate,built)).rejects.toThrow("SUBMISSION_DEMO_RESET_REQUIRED");await expect(poisoned.preflight(principal,jobId)).rejects.toThrow("SUBMISSION_DEMO_RESET_REQUIRED");await expect(poisoned.status(principal,jobId)).rejects.toThrow("SUBMISSION_DEMO_RESET_REQUIRED");await expect(poisoned.loadCandidate(principal,jobId,candidate.idempotencyKeyHash)).rejects.toThrow("SUBMISSION_DEMO_RESET_REQUIRED");await expect(poisoned.freeze(principal,candidate,built)).rejects.toThrow("SUBMISSION_DEMO_RESET_REQUIRED");
  });

  it("poisons on a silent job-restore no-op after a late committed-looking fault",async()=>{
    const{pool,principal,jobId,repository}=await fixture();const candidate=await repository.loadCandidate(principal,jobId,partnerSubmissionIdempotencyHash("12121212-1212-4212-8212-121212121212"));if(!candidate)throw new Error("candidate missing");const built=buildAuthoritativePartnerSubmission(candidate);let compensating=false;let statusReads=0;
    const sql={query:async(text:string,values?:unknown[])=>{if(compensating&&text.includes("UPDATE partner_jobs"))return{rows:[],rowCount:0};return pool.query(text,values);},connect:async()=>{const client=await pool.connect();return{query:async(text:string,values?:unknown[])=>{if(text==="ROLLBACK")throw new Error("rollback unavailable");if(text.includes("SELECT r.state")&&++statusReads===2){compensating=true;throw new Error("late fault");}return client.query(text,values);},release:()=>client.release()};}};
    const poisoned=new PartnerSubmissionRepository(sql as never,env);await expect(poisoned.freeze(principal,candidate,built)).rejects.toThrow("SUBMISSION_DEMO_RESET_REQUIRED");await expect(poisoned.preflight(principal,jobId)).rejects.toThrow("SUBMISSION_DEMO_RESET_REQUIRED");
  });

  it("poisons when a silent delete leaves a partial manifest residue",async()=>{
    const{pool,principal,jobId,repository}=await fixture();const candidate=await repository.loadCandidate(principal,jobId,partnerSubmissionIdempotencyHash("13131313-1313-4313-8313-131313131313"));if(!candidate)throw new Error("candidate missing");const built=buildAuthoritativePartnerSubmission(candidate);let compensating=false;
    const sql={query:async(text:string,values?:unknown[])=>{if(compensating&&text.includes("DELETE FROM partner_submission_plan_manifest"))return{rows:[],rowCount:0};return pool.query(text,values);},connect:async()=>{const client=await pool.connect();return{query:async(text:string,values?:unknown[])=>{if(text==="ROLLBACK")throw new Error("rollback unavailable");if(text.includes("INSERT INTO partner_submission_requests")){compensating=true;throw new Error("write fault");}return client.query(text,values);},release:()=>client.release()};}};
    const poisoned=new PartnerSubmissionRepository(sql as never,env);await expect(poisoned.freeze(principal,candidate,built)).rejects.toThrow("SUBMISSION_DEMO_RESET_REQUIRED");await expect(poisoned.status(principal,jobId)).rejects.toThrow("SUBMISSION_DEMO_RESET_REQUIRED");
  });
});
