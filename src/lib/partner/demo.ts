import "server-only";
import type { Pool, PoolClient } from "pg";
import type { IMemoryDb } from "pg-mem";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { createPartnerTestDatabase } from "./test-db";
import { EMPTY_SITE_PLAN_DOCUMENT } from "../site-plan-drawings";
import { createQuoteDraft, PRODUCT_QUOTE_DEFAULTS } from "./quote";
import { normalizeSitePlanRenderInput, PARTNER_SITE_PLAN_RENDERER_VERSION, PARTNER_SITE_PLAN_TEMPLATE_SHA256, sitePlanRenderHash } from "./site-plan-hash";

export const PARTNER_DEMO_CONFIRMATION = "LOCAL_FICTIONAL_DATA_ONLY";
export const PARTNER_DEMO_AUTH_SECRET = "fictional-local-demo-auth-secret-not-for-production-2026";

export const PARTNER_DEMO_ACCOUNTS = [
  { company: "Northwind Insulation", email: "partner.demo@example.test", password: "PartnerDemo!2026" },
  { company: "Harbour Thermal", email: "second.demo@example.test", password: "SecondDemo!2026" },
] as const;

/** Internal-only local credentials. Never offer these in the partner portal. */
export const PARTNER_OPS_DEMO_ACCOUNTS = [
  { company: "InsulHub operations", email: "operator.demo@example.test", password: "OpsDemo!2026Secure" },
] as const;

export function partnerDemoModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.PARTNER_DEMO_MODE !== "true") return false;
  if (env.NODE_ENV === "production") throw new Error("Partner demo mode is forbidden in production");
  if (env.PARTNER_DEMO_CONFIRM !== PARTNER_DEMO_CONFIRMATION) {
    throw new Error(`PARTNER_DEMO_CONFIRM must equal ${PARTNER_DEMO_CONFIRMATION}`);
  }
  if (!env.PARTNER_APP_ORIGIN) throw new Error("PARTNER_APP_ORIGIN is required in partner demo mode");
  let origin: URL;
  try { origin = new URL(env.PARTNER_APP_ORIGIN); } catch { throw new Error("PARTNER_APP_ORIGIN must be a valid loopback origin in partner demo mode"); }
  const loopback = origin.hostname === "localhost" || origin.hostname === "127.0.0.1" || origin.hostname === "[::1]";
  if (!loopback || !["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("PARTNER_APP_ORIGIN must be an http(s) loopback origin in partner demo mode");
  }
  return true;
}

type PartnerDemoRuntime = NodeJS.Process & {
  __insulHubPartnerDemoPool?: Pool;
  __insulHubPartnerDemoDb?: IMemoryDb;
  __insulHubPartnerDemoPdfBytes?: Map<string, Buffer>;
  __insulHubPartnerDemoSubmissionPoison?: Set<string>;
  __insulHubPartnerDemoLocks?: Map<string,Promise<void>>;
  __insulHubPartnerDemoDatabaseContext?: AsyncLocalStorage<boolean>;
};

// Next.js evaluates route handlers and React Server Components in separate
// development module contexts. The Node process object is shared across those
// contexts, unlike each context's globalThis, so the explicitly enabled demo
// has one authoritative fictional database for pages and API mutations.
const demoRuntime = process as PartnerDemoRuntime;
const demoDatabaseContext = demoRuntime.__insulHubPartnerDemoDatabaseContext ??= new AsyncLocalStorage<boolean>();

export function storePartnerDemoPdfBytes(artifactId: string, bytes: Buffer): void {
  if (!partnerDemoModeEnabled()) throw new Error("Partner demo mode is not enabled");
  (demoRuntime.__insulHubPartnerDemoPdfBytes ??= new Map()).set(artifactId, Buffer.from(bytes));
}
export function readPartnerDemoPdfBytes(artifactId: string): Buffer | null { return demoRuntime.__insulHubPartnerDemoPdfBytes?.get(artifactId) ?? null; }
export function deletePartnerDemoPdfBytes(artifactIds: readonly string[]): void { for (const artifactId of artifactIds) demoRuntime.__insulHubPartnerDemoPdfBytes?.delete(artifactId); }
export function partnerDemoSubmissionPoisoned(companyId:string,jobId:string):boolean{return demoRuntime.__insulHubPartnerDemoSubmissionPoison?.has(`${companyId}:${jobId}`)??false;}
export function poisonPartnerDemoSubmission(companyId:string,jobId:string):void{(demoRuntime.__insulHubPartnerDemoSubmissionPoison??=new Set()).add(`${companyId}:${jobId}`);}

export async function withPartnerDemoLock<T>(key:string,work:()=>Promise<T>):Promise<T>{
  if(!partnerDemoModeEnabled())throw new Error("Partner demo mode is not enabled");
  const locks=demoRuntime.__insulHubPartnerDemoLocks??=new Map();const previous=locks.get(key)??Promise.resolve();let release!:()=>void;const current=new Promise<void>(resolve=>{release=resolve;});const tail=previous.then(()=>current);locks.set(key,tail);await previous;
  try{return await work();}finally{release();if(locks.get(key)===tail)locks.delete(key);}
}

/** A re-entrant process-wide lock: snapshots and ordinary pool statements cannot interleave. */
export async function withPartnerDemoDatabaseLock<T>(work:()=>Promise<T>):Promise<T>{
  if(demoDatabaseContext.getStore()) return work();
  return withPartnerDemoLock("database:atomic-transition",()=>demoDatabaseContext.run(true,work));
}

/**
 * pg-mem does not provide the PostgreSQL transaction semantics relied on by
 * the production worker. Its native backup is synchronous and exact, so the
 * fictional worker serializes each DB transition, restores the whole in-memory
 * world on a statement failure, and poisons the affected job until reset.
 */
export async function withPartnerDemoAtomicTransition<T>(companyId:string,jobId:string,work:()=>Promise<T>):Promise<T>{
  return withPartnerDemoDatabaseLock(async()=>{
    const db=demoRuntime.__insulHubPartnerDemoDb;if(!db)throw new Error("PARTNER_DEMO_DATABASE_UNAVAILABLE");const backup=db.backup();
    try{return await work();}catch(error){try{backup.restore();}finally{poisonPartnerDemoSubmission(companyId,jobId);}throw error;}
  });
}

/** Operational edits need rollback, but a rejected edit must not poison a submission. */
export async function withPartnerDemoAtomicOperation<T>(companyId:string,jobId:string,work:()=>Promise<T>):Promise<T>{
  return withPartnerDemoDatabaseLock(async()=>{
    const db=demoRuntime.__insulHubPartnerDemoDb;if(!db)throw new Error("PARTNER_DEMO_DATABASE_UNAVAILABLE");const backup=db.backup();
    try{return await work();}catch(error){backup.restore();throw error;}
  });
}

export async function resetPartnerDemoStorage():Promise<void>{
  const pool=demoRuntime.__insulHubPartnerDemoPool;demoRuntime.__insulHubPartnerDemoPool=undefined;demoRuntime.__insulHubPartnerDemoDb=undefined;demoRuntime.__insulHubPartnerDemoPdfBytes=undefined;demoRuntime.__insulHubPartnerDemoSubmissionPoison=undefined;demoRuntime.__insulHubPartnerDemoLocks=undefined;
  if(pool)await pool.end();
}

export function getPartnerDemoPool(): Pool {
  if (!partnerDemoModeEnabled()) throw new Error("Partner demo mode is not enabled");
  if (demoRuntime.__insulHubPartnerDemoPool) return demoRuntime.__insulHubPartnerDemoPool;

  const { db, Pool: MemoryPool } = createPartnerTestDatabase();
  db.public.none(`
    INSERT INTO partner_companies
      (id, slug, name, billing_model, quote_default_wall_rate_cents, quote_default_ceiling_rate_cents,
       quote_default_deposit_basis_points, quote_default_consent_fee_cents, quote_defaults_revision)
    VALUES
      ('11111111-1111-4111-8111-111111111111', 'northwind-insulation', 'Northwind Insulation', 'INSULHUB_BILLED', 15500, 13200, 2500, 0, 1),
      ('22222222-2222-4222-8222-222222222222', 'harbour-thermal', 'Harbour Thermal', 'PARTNER_BILLED', 16900, 14500, 3000, 2500, 1);

    UPDATE partner_companies SET submission_adapter_mode='FICTIONAL',submission_contract_version='fictional-v1',
      legacy_job_prefix=CASE id WHEN '11111111-1111-4111-8111-111111111111' THEN 'NW'::varchar ELSE 'HT'::varchar END;

    INSERT INTO partner_users (id, company_id, principal_type, name, email, ops_role) VALUES
      ('demo-partner-northwind', '11111111-1111-4111-8111-111111111111', 'PARTNER', 'Aroha Bennett', 'partner.demo@example.test', NULL),
      ('demo-teammate-northwind', '11111111-1111-4111-8111-111111111111', 'PARTNER', 'Samira Cole', 'teammate.demo@example.test', NULL),
      ('demo-partner-harbour', '22222222-2222-4222-8222-222222222222', 'PARTNER', 'Theo Morgan', 'second.demo@example.test', NULL),
      ('demo-internal-operator', NULL, 'INTERNAL', 'Morgan Taylor', 'operator.demo@example.test', 'ADMIN');

    INSERT INTO partner_accounts (id, account_id, provider_id, user_id, password) VALUES
      ('demo-account-northwind', 'demo-partner-northwind', 'credential', 'demo-partner-northwind', '32de88fe10c273111b59740dc8105b6c:b0e111d3cb0a29f56b4bcefb557c596c7a40cb66cb307ae26c4047a23c8a8923e5d72ef0a02b6ca59a27c11fa5e67c4a5ed6ca6d779261e06f320183eea38f20'),
      ('demo-account-teammate', 'demo-teammate-northwind', 'credential', 'demo-teammate-northwind', '32de88fe10c273111b59740dc8105b6c:b0e111d3cb0a29f56b4bcefb557c596c7a40cb66cb307ae26c4047a23c8a8923e5d72ef0a02b6ca59a27c11fa5e67c4a5ed6ca6d779261e06f320183eea38f20'),
      ('demo-account-harbour', 'demo-partner-harbour', 'credential', 'demo-partner-harbour', '26d2ab01ce5aa62601625ca63b4912c8:9d3b8bc0a920ae2a321d3a2b9fe907b3d3acb4dd6840e9812bcc11c8c2b5d50c7c830c0c1f2c1470d6d3d77e79b18bd5df86cde3849b1b74696c3aaf0b34a90b'),
      ('demo-account-operator', 'demo-internal-operator', 'credential', 'demo-internal-operator', '2d6820a65509c91546b51cd322830e5e:f7f1e256bf921ca6f986fb4f9fb6634482b5ef984f364edfe519cb2e7786868f8de5f418314b03a846fd8ff36238910adcc8e56d33cc41bf8ede176ba003afc8');

    INSERT INTO partner_jobs
      (id, company_id, created_by_user_id, client_reference, submission_state, billing_model_snapshot, customer_name, customer_mobile, customer_email, site_address, lead_sources, notes, submission_started_at, submitted_at, created_at, updated_at)
    VALUES
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'demo-partner-northwind', 'NW-2026-014', 'DRAFT', 'INSULHUB_BILLED', 'Mia Thompson', '021 555 0142', 'mia.thompson@example.test', '{"street":"18 Kauri Grove","suburb":"Brookfield","city":"Tauranga","postcode":"3110"}', '["REFERRAL","CONTACT_FORM"]', 'Customer is comparing ceiling and underfloor options.', NULL, NULL, '2026-08-25T09:00:00Z', '2026-08-28T23:30:00Z'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '11111111-1111-4111-8111-111111111111', 'demo-teammate-northwind', 'NW-2026-011', 'SUBMITTED', 'INSULHUB_BILLED', 'Wiremu Harris', '027 555 0101', 'wiremu.harris@example.test', '{"street":"42 Riverstone Road","suburb":"Pyes Pa","city":"Tauranga","postcode":"3112"}', '["PHONE_CALL"]', '', '2026-08-21T01:00:00Z', '2026-08-21T01:12:00Z', '2026-08-20T22:00:00Z', '2026-08-27T04:00:00Z'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', '11111111-1111-4111-8111-111111111111', 'demo-partner-northwind', 'NW-2026-009', 'FAILED_RETRYABLE', 'INSULHUB_BILLED', 'Sophie Clark', '022 555 0188', 'sophie.clark@example.test', '{"street":"7 Matipo Lane","suburb":"Papamoa Beach","city":"Papamoa","postcode":"3118"}', '["SOCIAL_MEDIA"]', '', '2026-08-19T02:00:00Z', NULL, '2026-08-18T22:00:00Z', '2026-08-26T02:00:00Z'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', '11111111-1111-4111-8111-111111111111', 'demo-partner-northwind', 'NW-2026-006', 'RECONCILIATION_REQUIRED', 'INSULHUB_BILLED', 'Noah Williams', '020 555 0120', 'noah.williams@example.test', '{"street":"101 Oceanview Drive","suburb":"Mount Maunganui","city":"Tauranga","postcode":"3116"}', '["HOMESHOW"]', '', '2026-08-14T03:00:00Z', NULL, '2026-08-13T22:00:00Z', '2026-08-24T03:00:00Z'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', '11111111-1111-4111-8111-111111111111', 'demo-partner-northwind', 'NW-2026-READY', 'DRAFT', 'INSULHUB_BILLED', 'Anika Rangi', '021 555 0199', 'anika.rangi@example.test', '{"street":"24 Pohutukawa Rise","suburb":"Welcome Bay","city":"Tauranga","postcode":"3112"}', '["REFERRAL","CONTACT_FORM"]', 'Ready fictional two-level home for the end-to-end submission demonstration.', NULL, NULL, '2026-08-29T01:00:00Z', '2026-08-29T01:15:00Z'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '22222222-2222-4222-8222-222222222222', 'demo-partner-harbour', 'HT-2026-031', 'DRAFT', 'PARTNER_BILLED', 'Olivia King', '021 555 0331', 'olivia.king@example.test', '{"street":"5 Harbour View","suburb":"Birkenhead","city":"Auckland","postcode":"0626"}', '["CONTACT_FORM"]', 'Partner-billed fictional example.', NULL, NULL, '2026-08-27T00:00:00Z', '2026-08-28T20:00:00Z'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222222', 'demo-partner-harbour', 'HT-2026-028', 'SUBMITTED', 'PARTNER_BILLED', 'Lucas Chen', '021 555 0328', 'lucas.chen@example.test', '{"street":"29 Fernbank Avenue","suburb":"Glenfield","city":"Auckland","postcode":"0629"}', '["REFERRAL"]', '', '2026-08-23T00:00:00Z', '2026-08-23T00:08:00Z', '2026-08-22T22:00:00Z', '2026-08-27T20:00:00Z');

    INSERT INTO partner_tracking_facts
      (id, company_id, job_id, fact_type, value_type, value, source, effective_at, recorded_by_user_id)
    VALUES
      ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'EBA_COMPLETED', 'BOOLEAN', 'true', 'LOCAL_INTERNAL', '2026-08-22T00:00:00Z', 'demo-internal-operator');
  `);
  const readyJob="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",company="11111111-1111-4111-8111-111111111111",user="demo-partner-northwind";
  const validDemoPdfs={
    ground:Buffer.from("JVBERi0xLjcKJYGBgYEKCjEgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFsgNCAwIFIgXQovQ291bnQgMQo+PgplbmRvYmoKCjIgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDEgMCBSCj4+CmVuZG9iagoKMyAwIG9iago8PAovVGl0bGUgPEZFRkYwMDQ3MDA3MjAwNkYwMDc1MDA2RTAwNjQwMDIwMDA2NjAwNkMwMDZGMDA2RjAwNzI+Ci9DcmVhdGlvbkRhdGUgKEQ6MjAyNjA4MjkwMDAwMDBaKQovTW9kRGF0ZSAoRDoyMDI2MDgyOTAwMDAwMFopCj4+CmVuZG9iagoKNCAwIG9iago8PAovVHlwZSAvUGFnZQovUGFyZW50IDEgMCBSCi9SZXNvdXJjZXMgPDwKL0ZvbnQgPDwKL0hlbHZldGljYS03MDk4NDgwNzg5IDUgMCBSCj4+Ci9YT2JqZWN0IDw8Cj4+Ci9FeHRHU3RhdGUgPDwKPj4KPj4KL01lZGlhQm94IFsgMCAwIDU5NSA4NDIgXQovQW5ub3RzIFsgXQovQ29udGVudHMgWyA2IDAgUiBdCj4+CmVuZG9iagoKNSAwIG9iago8PAovVHlwZSAvRm9udAovU3VidHlwZSAvVHlwZTEKL0Jhc2VGb250IC9IZWx2ZXRpY2EKL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcKPj4KZW5kb2JqCgo2IDAgb2JqCjw8Ci9GaWx0ZXIgL0ZsYXRlRGVjb2RlCi9MZW5ndGggMTcyCj4+CnN0cmVhbQp4nGVOPQvCUAzc8ysyC9Y0fU36QByUVgcX9W3iILV+0Q4V0b9v3lJECbkklwuXHuYBKEmREs4ieHxcYLJq2lfzvNXHsZIvXEFaeGTCcAZ2GNZgBxYpCqFahg6mrpRKWZ0UquKlFMckYl1mnJfKmFQWTE6VTZkPioXt7HKG4Q5hBGWADfQ/T22XwPiG/cFcT9/uORHW3cBE/B9jicgmbsHRdxfrFXbm+QFGXDcwCmVuZHN0cmVhbQplbmRvYmoKCnhyZWYKMCA3CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNiAwMDAwMCBuIAowMDAwMDAwMDc2IDAwMDAwIG4gCjAwMDAwMDAxMjYgMDAwMDAgbiAKMDAwMDAwMDI3MyAwMDAwMCBuIAowMDAwMDAwNDY4IDAwMDAwIG4gCjAwMDAwMDA1NjYgMDAwMDAgbiAKCnRyYWlsZXIKPDwKL1NpemUgNwovUm9vdCAyIDAgUgovSW5mbyAzIDAgUgo+PgoKc3RhcnR4cmVmCjgxMQolJUVPRg==","base64"),
    upper:Buffer.from("JVBERi0xLjcKJYGBgYEKCjEgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFsgNCAwIFIgXQovQ291bnQgMQo+PgplbmRvYmoKCjIgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDEgMCBSCj4+CmVuZG9iagoKMyAwIG9iago8PAovVGl0bGUgPEZFRkYwMDU1MDA3MDAwNzAwMDY1MDA3MjAwMjAwMDY2MDA2QzAwNkYwMDZGMDA3Mj4KL0NyZWF0aW9uRGF0ZSAoRDoyMDI2MDgyOTAwMDAwMFopCi9Nb2REYXRlIChEOjIwMjYwODI5MDAwMDAwWikKPj4KZW5kb2JqCgo0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9QYXJlbnQgMSAwIFIKL1Jlc291cmNlcyA8PAovRm9udCA8PAovSGVsdmV0aWNhLTcwOTg0ODA3ODkgNSAwIFIKPj4KL1hPYmplY3QgPDwKPj4KL0V4dEdTdGF0ZSA8PAo+Pgo+PgovTWVkaWFCb3ggWyAwIDAgNTk1IDg0MiBdCi9Bbm5vdHMgWyBdCi9Db250ZW50cyBbIDYgMCBSIF0KPj4KZW5kb2JqCgo1IDAgb2JqCjw8Ci9UeXBlIC9Gb250Ci9TdWJ0eXBlIC9UeXBlMQovQmFzZUZvbnQgL0hlbHZldGljYQovRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZwo+PgplbmRvYmoKCjYgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL0xlbmd0aCAxNzMKPj4Kc3RyZWFtCnicZU49C8JADN3zKzILahrvkh6Ig6XVwUW9TRyk1i90qIj+fXMOUpSQl+S9hJcWphFokCENeJQg4P0Iw3lzfTaPc73rK4Xc5aR5QCaMB2CHcQF2YJGhEKplvMHYlVIpq5NcVYKU4phErBsZF6QyJpOCyXslJfHKH70wxe4mGC8Qe1BGWEL789JqBowv2GzNc9/19kRY375Mwv8xlYRsy1dw1O1SPcHaPN+75TabCmVuZHN0cmVhbQplbmRvYmoKCnhyZWYKMCA3CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNiAwMDAwMCBuIAowMDAwMDAwMDc2IDAwMDAwIG4gCjAwMDAwMDAxMjYgMDAwMDAgbiAKMDAwMDAwMDI2OSAwMDAwMCBuIAowMDAwMDAwNDY0IDAwMDAwIG4gCjAwMDAwMDA1NjIgMDAwMDAgbiAKCnRyYWlsZXIKPDwKL1NpemUgNwovUm9vdCAyIDAgUgovSW5mbyAzIDAgUgo+PgoKc3RhcnR4cmVmCjgwOAolJUVPRg==","base64"),
  };
  const quote=createQuoteDraft({...PRODUCT_QUOTE_DEFAULTS,wallRateCents:15_500,ceilingRateCents:13_200,revision:1},"NW-READY-LOCAL","2026-08-29T00:00:00.000Z");quote.wall={enabled:true,areaSqm:146,rateCentsPerSqm:15_500,cavityDepthCm:10};quote.ceiling={enabled:true,areaSqm:118,rateCentsPerSqm:13_200,rValue:4.2,downlights:12};quote.comments="Fictional local demonstration only.";
  const escaped=(value:unknown)=>JSON.stringify(value).replaceAll("'","''");db.public.none(`UPDATE partner_jobs SET quote_data='${escaped(quote)}'::jsonb,quote_initialized_at='2026-08-29T01:10:00Z',quote_defaults_revision=1,quote_defaults_snapshot='${escaped(quote.defaultsSnapshot)}'::jsonb,floor_plan_revision=2 WHERE id='${readyJob}'`);
  const address={street:"24 Pohutukawa Rise",suburb:"Welcome Bay",city:"Tauranga",postcode:"3112"};
  const fixtures=[
    {drawingId:"dddddddd-dddd-4ddd-8ddd-ddddddddddd1",artifactId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",name:"Ground floor",document:{...EMPTY_SITE_PLAN_DOCUMENT,walls:[{id:"ground-north",start:{x:2,y:3},end:{x:15,y:3},style:"solid" as const},{id:"ground-east",start:{x:15,y:3},end:{x:15,y:13},style:"solid" as const}],textNotes:[{id:"ground-note",text:"Living and garage",x:5,y:7,fontSize:0.42}]},bytes:validDemoPdfs.ground},
    {drawingId:"dddddddd-dddd-4ddd-8ddd-ddddddddddd2",artifactId:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",name:"Upper floor",document:{...EMPTY_SITE_PLAN_DOCUMENT,walls:[{id:"upper-north",start:{x:3,y:4},end:{x:14,y:4},style:"solid" as const},{id:"upper-west",start:{x:3,y:4},end:{x:3,y:12},style:"dotted" as const}],textNotes:[{id:"upper-note",text:"Bedrooms",x:6,y:8,fontSize:0.42}]},bytes:validDemoPdfs.upper},
  ];
  const drawings=db.public.getTable("partner_site_plan_drawings"),artifacts=db.public.getTable("partner_site_plan_pdf_artifacts");
  fixtures.forEach((fixture,index)=>{const input=normalizeSitePlanRenderInput({drawingName:fixture.name,siteAddress:address,document:fixture.document});const renderHash=sitePlanRenderHash(input),contentSha256=createHash("sha256").update(fixture.bytes).digest("hex");drawings.insert({id:fixture.drawingId,company_id:company,job_id:readyJob,name:fixture.name,floor_index:index,sort_order:index,drawing_data:fixture.document,revision:1,created_by_user_id:user,created_at:new Date("2026-08-29T01:05:00Z"),updated_at:new Date("2026-08-29T01:12:00Z")});artifacts.insert({company_id:company,job_id:readyJob,drawing_id:fixture.drawingId,id:fixture.artifactId,render_hash:renderHash,pdf_bytes:fixture.bytes,byte_size:fixture.bytes.byteLength,drawing_revision:1,renderer_version:PARTNER_SITE_PLAN_RENDERER_VERSION,template_version:input.templateVersion,template_sha256:PARTNER_SITE_PLAN_TEMPLATE_SHA256,content_sha256:contentSha256,file_name:`${fixture.name}.pdf`,generated_by_user_id:user,generated_at:new Date("2026-08-29T01:12:00Z"),created_at:new Date("2026-08-29T01:12:00Z")});storePartnerDemoPdfBytes(fixture.artifactId,fixture.bytes);db.public.none(`UPDATE partner_site_plan_drawings SET current_pdf_artifact_id='${fixture.artifactId}' WHERE id='${fixture.drawingId}'`);});
  demoRuntime.__insulHubPartnerDemoDb=db;
  const rawPool=new MemoryPool() as unknown as Pool;
  // Every external statement takes the same lock as snapshot-based transitions.
  demoRuntime.__insulHubPartnerDemoPool = new Proxy(rawPool, {get(target,key,receiver){
    if(key==="query") return (...args: unknown[]) => withPartnerDemoDatabaseLock(async()=>((target.query as unknown as (...queryArgs:unknown[])=>Promise<unknown>)(...args)));
    if(key==="connect") return async () => {
      const client=await withPartnerDemoDatabaseLock(async()=>target.connect() as unknown as Promise<PoolClient>);
      return new Proxy(client,{get(clientTarget,clientKey,clientReceiver){
        if(clientKey==="query") return (...queryArgs: unknown[]) => withPartnerDemoDatabaseLock(async()=>((client.query as unknown as (...queryArgs:unknown[])=>Promise<unknown>)(...queryArgs)));
        const value=Reflect.get(clientTarget,clientKey,clientReceiver);return typeof value==="function" ? value.bind(clientTarget) : value;
      }});
    };
    const value=Reflect.get(target,key,receiver);return typeof value==="function" ? value.bind(target) : value;
  }});
  return demoRuntime.__insulHubPartnerDemoPool;
}
