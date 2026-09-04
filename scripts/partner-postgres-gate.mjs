#!/usr/bin/env node
import { probePartnerNoteUpdates } from "./partner-note-updates-postgres-probes.mjs";
import { probePartnerCompanyAccess, probePartnerCompanyAccessLockOrder } from "./partner-company-access-postgres-probes.mjs";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { probePartnerAccountAccess } from "./partner-account-access-postgres-probes.mjs";
import { probePartnerJobLinks } from "./partner-job-links-postgres-probes.mjs";
import { probePartnerDraftDeletion } from "./partner-draft-deletion-postgres-probes.mjs";
import { probePartnerSettingsService } from "./partner-settings-postgres-probes.mjs";
import { probePartnerLiveTransfer } from "./partner-live-transfer-postgres-probes.mjs";
import { capturePartnerOwnerGrants, restorePartnerOwnerGrants, migratePartnerAll, migratePartnerOne } from "./partner-migrations.mjs";
import { assertPartnerOperationsRemoved, probePartnerOperations } from "./partner-ops-postgres-probes.mjs";

const connectionString = process.env.PARTNER_MIGRATION_TEST_DATABASE_URL;
if (!connectionString) throw new Error("PARTNER_MIGRATION_TEST_DATABASE_URL is required");
if ([process.env.DATABASE_URL, process.env.PARTNER_DATABASE_URL, process.env.PARTNER_MIGRATION_DATABASE_URL, process.env.PARTNER_SUBMISSION_DATABASE_URL, process.env.PARTNER_OPS_DATABASE_URL].includes(connectionString)) throw new Error("Migration gate database must be disposable and separate from runtime/migration URLs");
if (process.env.PARTNER_MIGRATION_GATE_CONFIRM !== "RESET_DEDICATED_PARTNER_TEST_DATABASE") {
  throw new Error("Set PARTNER_MIGRATION_GATE_CONFIRM=RESET_DEDICATED_PARTNER_TEST_DATABASE");
}

async function expectRejectedInSavepoint(client, name, text, values = []) {
  let ownsTransaction=false;
  try { await client.query(`SAVEPOINT ${name}`); }
  catch(error) {
    if(error.code!=="25P01")throw error;
    await client.query("BEGIN");ownsTransaction=true;
    await client.query(`SAVEPOINT ${name}`);
  }
  let rejected = false;
  try {
    await client.query(text, values);
  } catch {
    rejected = true;
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await client.query(`RELEASE SAVEPOINT ${name}`);
    if(ownsTransaction)await client.query("ROLLBACK");
  }
  if (!rejected) throw new Error(`Expected PostgreSQL constraint probe ${name} to fail`);
}

function assertGate(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertImmediateSubmissionRoleCatalog(pool){
  const signatures=["public.partner_submission_request_id(uuid,uuid)","public.partner_claim_submission_exact(uuid,uuid,uuid,text,integer)","public.partner_claim_submission_notification_exact(uuid,uuid,uuid,text,integer)"];
  const rows=(await pool.query(`SELECT signature,p.prosecdef,owner.rolname,p.proconfig,
      has_function_privilege('partner_portal_runtime',p.oid,'EXECUTE') runtime_execute,
      has_function_privilege('partner_submission_worker',p.oid,'EXECUTE') worker_execute
    FROM unnest($1::text[]) signature JOIN pg_proc p ON p.oid=to_regprocedure(signature)
    JOIN pg_roles owner ON owner.oid=p.proowner ORDER BY signature`,[signatures])).rows;
  assertGate(rows.length===3&&rows.every(row=>row.prosecdef===true&&row.rolname==="partner_submission_owner"&&row.proconfig?.some(setting=>setting.replaceAll(" ","")==="search_path=pg_catalog")),"Immediate submission functions must be owner-scoped SECURITY DEFINER boundaries");
  const request=rows.find(row=>row.signature.includes("request_id"));
  assertGate(request?.runtime_execute===true&&request.worker_execute===false&&rows.filter(row=>!row.signature.includes("request_id")).every(row=>row.runtime_execute===false&&row.worker_execute===true),"Immediate submission functions must have purpose-separated runtime and worker grants");
}

async function assertSitePlanCompanyLock(pool,present){
  const signature="public.partner_lock_site_plan_company(uuid)";
  const found=(await pool.query("SELECT to_regprocedure($1) AS oid",[signature])).rows[0]?.oid;
  if(!present){assertGate(found===null,"Floor-plan company lock must be absent after 015 rollback");return;}
  assertGate(found!==null,"Floor-plan company lock must exist after 015 apply");
  const row=(await pool.query(`SELECT p.prosecdef,owner.rolname AS owner,p.proconfig,
      has_function_privilege('partner_portal_runtime',p.oid,'EXECUTE') AS runtime_execute,
      has_table_privilege('partner_portal_runtime','public.partner_companies','UPDATE') AS runtime_company_update
    FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner WHERE p.oid=to_regprocedure($1)`,[signature])).rows[0];
  assertGate(row?.prosecdef===true&&row.owner==="partner_artifact_owner"&&row.runtime_execute===true&&row.runtime_company_update===false&&row.proconfig?.some(setting=>setting.replaceAll(" ","")==="search_path=pg_catalog"),"Floor-plan company lock must remain a narrow owner-scoped runtime capability");
  const client=await pool.connect();let granted=false,seededCompany=false,company;
  try{
    const actor=(await client.query("SELECT session_user AS role")).rows[0].role;
    company=(await client.query("SELECT id FROM public.partner_companies WHERE is_active=true ORDER BY id LIMIT 1")).rows[0];
    if(!company){company=(await client.query("INSERT INTO public.partner_companies(slug,name,billing_model) VALUES($1,'Floor-plan gate company','INSULHUB_BILLED') RETURNING id",[`floor-plan-gate-${randomUUID().slice(0,8)}`])).rows[0];seededCompany=true;}
    const canSet=(await client.query("SELECT pg_has_role(session_user,'partner_portal_runtime','SET') AS allowed")).rows[0].allowed===true;
    if(!canSet){await client.query(`GRANT partner_portal_runtime TO ${quoteIdentifier(actor)} WITH INHERIT TRUE, SET TRUE`);granted=true;}
    await client.query("BEGIN");await client.query("SET LOCAL ROLE partner_portal_runtime");
    const runtime=(await client.query("SELECT public.partner_lock_site_plan_company($1) AS locked,has_table_privilege(current_user,'public.partner_companies','UPDATE') AS company_update",[company.id])).rows[0];
    assertGate(runtime.locked===true&&runtime.company_update===false,"Restricted portal role must lock an active company without company UPDATE authority");
    await client.query("ROLLBACK");
  }finally{await client.query("ROLLBACK").catch(()=>{});if(seededCompany&&company)await client.query("DELETE FROM public.partner_companies WHERE id=$1",[company.id]).catch(()=>{});if(granted){const actor=(await client.query("SELECT session_user AS role")).rows[0].role;await client.query(`REVOKE partner_portal_runtime FROM ${quoteIdentifier(actor)}`);}client.release();}
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite gate fixture");
    if (Object.is(value, -0) || value === 0) return "0";
    return value.toString().replace(/e\+/, "e");
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key.normalize("NFC"))}:${canonicalJson(value[key] === undefined ? null : value[key])}`).join(",")}}`;
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function submissionRequestId(companyId, jobId, idempotencyHash) {
  const value=sha256(`partner-submission-request-v1|${companyId.toLowerCase()}|${jobId.toLowerCase()}|${idempotencyHash}`);
  return `${value.slice(0,8)}-${value.slice(8,12)}-5${value.slice(13,16)}-8${value.slice(17,20)}-${value.slice(20,32)}`;
}

async function seedReadySubmission(pool, slug, adapterMode="FICTIONAL", pdfMode="VALID", idempotencyHash=sha256("same-tenant-idempotency-key-0001")) {
  slug=slug.replaceAll("_","-");
  const snapshotId=randomUUID();
  const live=adapterMode==="LIVE"; const credential=Buffer.from("encrypted-gate-credential"); const nonce=Buffer.from("gate-nonce");
  const companyId = (await pool.query("INSERT INTO partner_companies(slug,name,billing_model,submission_adapter_mode,submission_contract_version,legacy_job_prefix,legacy_base_url,legacy_credential_ciphertext,legacy_credential_nonce,legacy_credential_key_version,legacy_credential_updated_at) VALUES($1,'E1 Gate','INSULHUB_BILLED',$2,'fictional-v1','GT',$3,$4,$5,$6,$7) RETURNING id",[slug,adapterMode,live?"https://legacy.example.test":null,live?credential:null,live?nonce:null,live?1:null,live?new Date("2026-08-30T00:00:00.000Z"):null])).rows[0].id;
  const userId=randomUUID(); await pool.query("INSERT INTO partner_users(id,company_id,principal_type,name,email) VALUES($1,$2,'PARTNER','E1 User',$3)",[userId,companyId,`${slug}@example.test`]);
  const address={street:"12 Māhoe Road",suburb:"Ōtāhuhu",city:"Auckland",postcode:"1062"};
  const defaults={wallRateCents:1000,ceilingRateCents:1000,depositBasisPoints:2500,consentFeeCents:0,extras:[],revision:1,source:"COMPANY_DEFAULTS"};
  const quote={schema:1,quoteNumber:"LOCAL-E1",quoteDate:"2026-08-30T00:00:00.000Z",numberSource:"LOCAL_DRAFT",wall:{enabled:true,areaSqm:100,rateCentsPerSqm:1000,cavityDepthCm:10},ceiling:{enabled:false,areaSqm:null,rateCentsPerSqm:null,rValue:null,downlights:null},consentFeeCents:0,depositBasisPoints:2500,extras:[],comments:"",defaultsSnapshot:defaults};
  const jobId=(await pool.query(`INSERT INTO partner_jobs(company_id,created_by_user_id,client_reference,billing_model_snapshot,customer_name,customer_mobile,customer_email,site_address,lead_sources,notes,quote_data,quote_initialized_at,quote_defaults_revision,quote_defaults_snapshot,quote_total_cents)
    VALUES($1,$2,'E1-GATE','INSULHUB_BILLED','Hine Te Rangi','021 555 0123','',$3::jsonb,'[]'::jsonb,'Kia ora',$4::jsonb,now(),1,$5::jsonb,115000) RETURNING id`,[companyId,userId,JSON.stringify(address),JSON.stringify(quote),JSON.stringify(defaults)])).rows[0].id;
  const requestId=submissionRequestId(companyId,jobId,idempotencyHash);
  const document={schemaVersion:1,templateVersion:"site-plan-template-v2",walls:[{id:"wall-1",start:{x:1,y:1},end:{x:5,y:1},style:"solid"}],textNotes:[],showDimensions:true};
  const drawingId=(await pool.query("INSERT INTO partner_site_plan_drawings(company_id,job_id,name,sort_order,drawing_data,created_by_user_id) VALUES($1,$2,'Ground floor',0,$3::jsonb,$4) RETURNING id",[companyId,jobId,JSON.stringify(document),userId])).rows[0].id;
  const renderInput={drawingName:"Ground floor",siteAddress:address,document,templateVersion:"site-plan-template-v2",templateSha256:"b82dc68276806628e2574a6a51a6299d1a23df56f4ba8a5a4a06226d3ebd904b",fontSha256:"478c558ea716033cd60c03438f628dfa75694dcf6b5f6d505a2f05fd2b4f3823",rendererVersion:"partner-site-plan-renderer-v1"};
  const renderInputCanonical=canonicalJson(renderInput); const renderHash=sha256(renderInputCanonical); const bytes=pdfMode==="NON_PDF"?Buffer.from("not a PDF gate payload"):Buffer.from("%PDF-1.7\nE1 gate\n%%EOF\n"); const actualContentSha=sha256(bytes); const contentSha=pdfMode==="BAD_SHA"?"0".repeat(64):actualContentSha; const artifactId=randomUUID();
  await pool.query(`INSERT INTO partner_site_plan_pdf_artifacts(company_id,job_id,drawing_id,id,render_hash,pdf_bytes,byte_size,drawing_revision,renderer_version,template_version,template_sha256,content_sha256,file_name,generated_by_user_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,0,'partner-site-plan-renderer-v1','site-plan-template-v2','b82dc68276806628e2574a6a51a6299d1a23df56f4ba8a5a4a06226d3ebd904b',$8,'Ground floor.pdf',$9)`,[companyId,jobId,drawingId,artifactId,renderHash,bytes,bytes.length,contentSha,userId]);
  await pool.query("UPDATE partner_site_plan_drawings SET current_pdf_artifact_id=$4 WHERE company_id=$1 AND job_id=$2 AND id=$3",[companyId,jobId,drawingId,artifactId]);
  const documentCanonical=canonicalJson(document); const documentSha=sha256(documentCanonical); const remote=`GT-${requestId.replaceAll("-","")}-01-${artifactId.replaceAll("-","")}-${contentSha}.pdf`;
  const snapshot={schemaVersion:1,contract:{adapterMode,version:"fictional-v1",legacyJobPrefix:"GT"},job:{id:jobId,companyId,revision:0,floorPlanRevision:0,clientReference:"E1-GATE",billingModel:"INSULHUB_BILLED",customer:{name:"Hine Te Rangi",mobile:"021 555 0123",email:""},siteAddress:address,leadSources:[],notes:"Kia ora",quote},plans:[{ordinal:0,drawingId,name:"Ground floor",drawingRevision:0,document,documentSha256:documentSha,artifact:{id:artifactId,renderHash,contentSha256:contentSha,byteSize:bytes.length,rendererVersion:"partner-site-plan-renderer-v1",templateVersion:"site-plan-template-v2",templateSha256:"b82dc68276806628e2574a6a51a6299d1a23df56f4ba8a5a4a06226d3ebd904b",localFileName:"Ground floor.pdf"},remoteFileName:remote}]};
  const canonicalDocument=canonicalJson(snapshot); const snapshotSha=sha256(canonicalDocument); const requestHash=sha256(canonicalJson({schemaVersion:1,snapshotSha256:snapshotSha}));
  const manifest=[{ordinal:0,drawingId,artifactId,drawingRevision:0,documentCanonical,documentSha256:documentSha,renderInputCanonical,renderHash,contentSha256:contentSha,byteSize:bytes.length,remoteFileName:remote}];
  return {companyId,userId,jobId,drawingId,artifactId,requestId,snapshotId,idempotencyHash,canonicalDocument,snapshotSha,requestHash,manifest};
}

const pool = new Pool({ connectionString, max: 2 });
try {
  const migrationRolePreflight = await pool.query("SELECT rolsuper FROM pg_roles WHERE rolname=current_user");
  if (migrationRolePreflight.rows[0]?.rolsuper !== false) throw new Error("Use a non-superuser migration login for realistic ownership/grant checks");
  const preflight = await pool.query("SELECT to_regclass('public.partner_companies') AS portal, to_regclass('public.partner_schema_migrations') AS ledger");
  if (preflight.rows[0].portal) throw new Error("Migration gate requires a clean dedicated database without partner tables");
  if (preflight.rows[0].ledger) {
    const applied = await pool.query("SELECT count(*)::integer AS count FROM partner_schema_migrations");
    if (applied.rows[0].count !== 0) throw new Error("Migration gate requires an empty migration ledger");
  }

  const stagedVersions = [];
  for (let index = 0; index < 3; index += 1) {
    const result = await migratePartnerOne(pool, "up");
    if (!result.changed) throw new Error("Migration gate expected foundation migrations");
    stagedVersions.push(result.version);
  }
  let legacyCompanyId;
  let legacyJobId;
  let legacyDrawingId;
  const preflightClient = await pool.connect();
  try {
    await preflightClient.query("BEGIN");
    const companyId = (await preflightClient.query("INSERT INTO partner_companies(slug,name,billing_model)VALUES($1,'Preflight','INSULHUB_BILLED') RETURNING id", [`preflight-${randomUUID().slice(0, 8)}`])).rows[0].id;
    const userId = randomUUID();
    await preflightClient.query("INSERT INTO partner_users(id,company_id,principal_type,name,email)VALUES($1,$2,'PARTNER','Preflight',$3)",[userId,companyId,`preflight-${randomUUID()}@example.test`]);
    const jobId = (await preflightClient.query("INSERT INTO partner_jobs(company_id,created_by_user_id,client_reference,billing_model_snapshot)VALUES($1,$2,'preflight','INSULHUB_BILLED') RETURNING id", [companyId,userId])).rows[0].id;
    await preflightClient.query("INSERT INTO partner_site_plan_drawings(company_id,job_id,name,sort_order,created_by_user_id)VALUES($1,$2,'Duplicate',0,$3),($1,$2,'duplicate',0,$3)",[companyId,jobId,userId]);
    await preflightClient.query("COMMIT");
    let preflightRejected = false;
    try {
      await migratePartnerOne(pool, "up");
    } catch (error) {
      preflightRejected = error instanceof Error
        && error.message.includes("duplicate_name_groups=1")
        && error.message.includes("invalid_order_jobs=1");
    }
    if (!preflightRejected) throw new Error("Migration gate expected non-PII site-plan preflight counts to reject duplicate legacy rows");
    await preflightClient.query("BEGIN");
    await preflightClient.query("DELETE FROM partner_site_plan_drawings WHERE company_id=$1", [companyId]);
    legacyDrawingId = (await preflightClient.query(
      "INSERT INTO partner_site_plan_drawings(company_id,job_id,name,floor_index,sort_order,drawing_data,created_by_user_id) VALUES($1,$2,'Legacy Ground',7,0,'{}'::jsonb,$3) RETURNING id",
      [companyId, jobId, userId],
    )).rows[0].id;
    await preflightClient.query("COMMIT");
    legacyCompanyId = companyId;
    legacyJobId = jobId;
  } finally {
    preflightClient.release();
  }
  const remainingUp = await migratePartnerAll(pool, "up");
  const firstUp = { changed: true, versions: [...stagedVersions, ...remainingUp.versions] };
  await assertImmediateSubmissionRoleCatalog(pool);
  // No temporary usable owner memberships may escape a successful migration.
  const grantProbe=await pool.connect();
  try {
    await grantProbe.query("BEGIN");
    assertGate((await capturePartnerOwnerGrants(grantProbe)).length===0,"Migrations must remove temporary owner self-grants");
    const actor=(await grantProbe.query("SELECT session_user AS role")).rows[0].role;
    const allGrants=()=>grantProbe.query(`SELECT r.rolname,m.grantor,m.member,m.admin_option,m.inherit_option,m.set_option
      FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
      WHERE r.rolname IN('partner_artifact_owner','partner_submission_owner','partner_ops_owner')
      ORDER BY r.rolname,m.grantor,m.member`);
    await grantProbe.query(`GRANT partner_submission_owner TO ${quoteIdentifier(actor)} WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY ${quoteIdentifier(actor)}`);
    const before=(await allGrants()).rows;
    const saved=await capturePartnerOwnerGrants(grantProbe);
    await grantProbe.query(`GRANT partner_submission_owner,partner_ops_owner TO ${quoteIdentifier(actor)} WITH INHERIT TRUE, SET TRUE GRANTED BY ${quoteIdentifier(actor)}`);
    await restorePartnerOwnerGrants(grantProbe,saved);
    assertGate(JSON.stringify((await allGrants()).rows)===JSON.stringify(before),"Restore must preserve SET-only options and other-grantor ADMIN memberships exactly");
    await grantProbe.query("ROLLBACK");
    assertGate((await capturePartnerOwnerGrants(grantProbe)).length===0,"Grant probe rollback must restore the original baseline");
  } finally { await grantProbe.query("ROLLBACK").catch(()=>{});grantProbe.release(); }
  const neutralV2=await seedReadySubmission(pool,`neutral-v2-${randomUUID().slice(0,8)}`);
  const neutralSnapshot=JSON.parse(neutralV2.canonicalDocument);
  neutralSnapshot.schemaVersion=2;delete neutralSnapshot.job.billingModel;
  neutralSnapshot.job.leadSources=["E1 Gate"];
  neutralSnapshot.job.quote={...neutralSnapshot.job.quote,consentFeeCents:0,depositBasisPoints:0};
  const neutralClient=await pool.connect();
  try{
    await neutralClient.query("BEGIN");
    const neutralActor=(await neutralClient.query("SELECT session_user role")).rows[0].role;
    await neutralClient.query(`GRANT partner_portal_runtime TO ${quoteIdentifier(neutralActor)} WITH INHERIT TRUE, SET TRUE`);
    await neutralClient.query("SET LOCAL ROLE partner_portal_runtime");
    const frozen=await neutralClient.query("SELECT * FROM partner_freeze_submission($1,$2,$3,0,0,$4,$5,$6,$7,$8::jsonb)",[neutralV2.companyId,neutralV2.jobId,neutralV2.userId,neutralV2.requestId,neutralV2.snapshotId,neutralV2.idempotencyHash,canonicalJson(neutralSnapshot),JSON.stringify(neutralV2.manifest)]);
    assertGate(frozen.rowCount===1&&frozen.rows[0].replayed===false,"Fresh schema-v2 submission must freeze exactly once");
    await neutralClient.query("RESET ROLE");
    const stored=(await neutralClient.query("SELECT schema_version,snapshot_data FROM partner_submission_snapshots WHERE id=$1",[neutralV2.snapshotId])).rows[0];
    assertGate(stored.schema_version===2&&!Object.hasOwn(stored.snapshot_data.job,"billingModel"),"Schema-v2 snapshot must be neutral and omit billing");
    await neutralClient.query("ROLLBACK");
  }finally{await neutralClient.query("ROLLBACK").catch(()=>{});neutralClient.release();}
  const neutralCleanup=await pool.connect();
  try{await neutralCleanup.query("BEGIN");const cleanupActor=(await neutralCleanup.query("SELECT session_user role")).rows[0].role;await neutralCleanup.query(`GRANT partner_portal_runtime TO ${quoteIdentifier(cleanupActor)} WITH INHERIT TRUE, SET TRUE`);await neutralCleanup.query("SET LOCAL ROLE partner_portal_runtime");await neutralCleanup.query("SELECT partner_purge_draft_site_plan_drawing($1,$2,$3,0)",[neutralV2.companyId,neutralV2.jobId,neutralV2.drawingId]);await neutralCleanup.query("RESET ROLE");await neutralCleanup.query(`REVOKE partner_portal_runtime FROM ${quoteIdentifier(cleanupActor)}`);await neutralCleanup.query("COMMIT");}finally{await neutralCleanup.query("ROLLBACK").catch(()=>{});neutralCleanup.release();}
  await pool.query("DELETE FROM partner_jobs WHERE company_id=$1",[neutralV2.companyId]);
  await pool.query("DELETE FROM partner_users WHERE company_id=$1",[neutralV2.companyId]);
  await pool.query("DELETE FROM partner_companies WHERE id=$1",[neutralV2.companyId]);
  await probePartnerOperations(pool);
  await probePartnerSettingsService(pool);
  await probePartnerCompanyAccess(pool);
  await probePartnerCompanyAccessLockOrder(pool);
  await probePartnerDraftDeletion(pool, seedReadySubmission);
  await probePartnerAccountAccess(pool);
  await probePartnerJobLinks(pool, seedReadySubmission);
  await probePartnerLiveTransfer(pool,seedReadySubmission);
  await assertSitePlanCompanyLock(pool,true);
  // Prove an immutable v1 submission created before migration 020 remains
  // claimable and byte-for-byte identical after the neutral v2 cutover.
  assertGate((await migratePartnerOne(pool, "down")).version === "023_partner_note_updates", "Expected partner notes rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "022_partner_company_access", "Expected company access rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "021_partner_immediate_submission", "Expected immediate submission rollback before v1 compatibility probe");
  assertGate((await migratePartnerOne(pool, "down")).version === "020_partner_neutral_submission_v2", "Expected temporary neutral rollback for v1 compatibility probe");
  const historicalV1=await seedReadySubmission(pool,`historical-v1-${randomUUID().slice(0,8)}`);
  const historicalSnapshot=JSON.parse(historicalV1.canonicalDocument);
  historicalSnapshot.job.leadSources=["E1 Gate"];
  historicalSnapshot.job.quote={...historicalSnapshot.job.quote,depositBasisPoints:0,consentFeeCents:0};
  const historicalCanonical=canonicalJson(historicalSnapshot);
  await pool.query("UPDATE partner_jobs SET quote_data=$2::jsonb WHERE id=$1",[historicalV1.jobId,JSON.stringify(historicalSnapshot.job.quote)]);
  const historicalClient=await pool.connect();
  try{
    const historicalActor=(await historicalClient.query("SELECT session_user role")).rows[0].role;
    await historicalClient.query(`GRANT partner_portal_runtime,partner_submission_worker TO ${quoteIdentifier(historicalActor)} WITH INHERIT TRUE, SET TRUE`);
    await historicalClient.query("BEGIN");await historicalClient.query("SET LOCAL ROLE partner_portal_runtime");
    const frozen=await historicalClient.query("SELECT * FROM partner_freeze_submission($1,$2,$3,0,0,$4,$5,$6,$7,$8::jsonb)",[historicalV1.companyId,historicalV1.jobId,historicalV1.userId,historicalV1.requestId,historicalV1.snapshotId,historicalV1.idempotencyHash,historicalCanonical,JSON.stringify(historicalV1.manifest)]);
    assertGate(frozen.rowCount===1&&frozen.rows[0].replayed===false,"Historical schema-v1 fixture must freeze before migration 020");
    await historicalClient.query("COMMIT");
    const before=(await historicalClient.query("SELECT schema_version,canonical_document,snapshot_sha256 FROM partner_submission_snapshots WHERE id=$1",[historicalV1.snapshotId])).rows[0];
    const beforeTerms=JSON.parse(before.canonical_document);
    assertGate(before.schema_version===1&&before.snapshot_sha256===frozen.rows[0].authoritative_snapshot_sha256&&beforeTerms.job.billingModel==="INSULHUB_BILLED","Historical schema-v1 snapshot must preserve its approved terms before cutover");
    assertGate((await migratePartnerOne(pool,"up")).version==="020_partner_neutral_submission_v2","Expected neutral migration to reapply for v1 compatibility probe");
    assertGate((await migratePartnerOne(pool,"up")).version==="021_partner_immediate_submission","Expected immediate submission migration to reapply for v1 compatibility probe");
  assertGate((await migratePartnerOne(pool, "up")).version === "022_partner_company_access", "Expected company access reapply");
  assertGate((await migratePartnerOne(pool, "up")).version === "023_partner_note_updates", "Expected partner notes reapply");
  await probePartnerNoteUpdates(pool);
    const after=(await historicalClient.query("SELECT schema_version,canonical_document,snapshot_sha256 FROM partner_submission_snapshots WHERE id=$1",[historicalV1.snapshotId])).rows[0];
    assertGate(JSON.stringify(after)===JSON.stringify(before),"Migration 020 must not rewrite historical schema-v1 terms or hashes");
    await historicalClient.query("BEGIN");await historicalClient.query("SET LOCAL ROLE partner_submission_worker");
    const claim=(await historicalClient.query("SELECT * FROM partner_claim_submission_bounded('historical-v1-gate',120)")).rows[0];
    assertGate(claim?.request_id===historicalV1.requestId&&claim.claim_status==="CLAIMED","Restricted worker must claim the pre-020 schema-v1 request after cutover");
    const claimed=(await historicalClient.query("SELECT canonical_document,snapshot_sha256 FROM partner_submission_claimed_snapshot($1,$2,$3,$4,$5)",[claim.company_id,claim.job_id,claim.request_id,claim.lease_token,claim.fence_token])).rows[0];
    assertGate(claimed?.canonical_document===before.canonical_document&&claimed.snapshot_sha256===before.snapshot_sha256,"Restricted worker must read unchanged historical schema-v1 terms after cutover");
    const released=(await historicalClient.query("SELECT partner_release_submission_bounded($1,$2,$3,$4,$5,'PROVIDER_UNAVAILABLE',604800) AS outcome",[claim.company_id,claim.job_id,claim.request_id,claim.lease_token,claim.fence_token])).rows[0]?.outcome;
    assertGate(released==="RELEASED","Compatibility probe must release its worker lease");
    await historicalClient.query("COMMIT");
    await historicalClient.query(`REVOKE partner_portal_runtime,partner_submission_worker FROM ${quoteIdentifier(historicalActor)}`);
  }finally{await historicalClient.query("ROLLBACK").catch(()=>{});historicalClient.release();}
  // The gate has recorded the compatibility proof. Reset its synthetic worker
  // marker so the later all-down rehearsal is not intentionally blocked.
  const resetClient=await pool.connect();
  try{
    await resetClient.query("BEGIN");
    for(const table of ["partner_submission_snapshots","partner_submission_plan_manifest","partner_audit_events","partner_jobs","partner_site_plan_drawings","partner_site_plan_pdf_artifacts"])await resetClient.query(`ALTER TABLE public.${table} DISABLE TRIGGER USER`);
    await resetClient.query("DELETE FROM public.partner_submission_plan_deliveries WHERE company_id=$1",[historicalV1.companyId]);
    await resetClient.query("DELETE FROM public.partner_submission_attempts WHERE company_id=$1",[historicalV1.companyId]);
    await resetClient.query("UPDATE public.partner_site_plan_drawings SET current_pdf_artifact_id=NULL,submitted_pdf_outbox_event_id=NULL WHERE company_id=$1",[historicalV1.companyId]);
    await resetClient.query("DELETE FROM public.partner_outbox_events WHERE company_id=$1",[historicalV1.companyId]);
    await resetClient.query("DELETE FROM public.partner_audit_events WHERE company_id=$1",[historicalV1.companyId]);
    await resetClient.query("DELETE FROM public.partner_submission_requests WHERE company_id=$1",[historicalV1.companyId]);
    await resetClient.query("DELETE FROM public.partner_submission_plan_manifest WHERE company_id=$1",[historicalV1.companyId]);
    await resetClient.query("DELETE FROM public.partner_submission_snapshots WHERE company_id=$1",[historicalV1.companyId]);
    await resetClient.query("DELETE FROM public.partner_site_plan_pdf_artifacts WHERE company_id=$1",[historicalV1.companyId]);
    await resetClient.query("DELETE FROM public.partner_site_plan_drawings WHERE company_id=$1",[historicalV1.companyId]);
    await resetClient.query("DELETE FROM public.partner_jobs WHERE company_id=$1",[historicalV1.companyId]);
    await resetClient.query("DELETE FROM public.partner_users WHERE company_id=$1",[historicalV1.companyId]);
    await resetClient.query("DELETE FROM public.partner_companies WHERE id=$1",[historicalV1.companyId]);
    for(const table of ["partner_submission_snapshots","partner_submission_plan_manifest","partner_audit_events","partner_jobs","partner_site_plan_drawings","partner_site_plan_pdf_artifacts"])await resetClient.query(`ALTER TABLE public.${table} ENABLE TRIGGER USER`);
    await resetClient.query("COMMIT");
  }finally{await resetClient.query("ROLLBACK").catch(()=>{});resetClient.release();}
  assertGate((await migratePartnerOne(pool, "down")).version === "023_partner_note_updates", "Expected partner notes rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "022_partner_company_access", "Expected company access rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "021_partner_immediate_submission", "Expected immediate submission rollback before legacy probes");
  assertGate((await migratePartnerOne(pool, "down")).version === "020_partner_neutral_submission_v2", "Expected neutral submission rollback before legacy probes");
  assertGate((await migratePartnerOne(pool, "down")).version === "019_partner_branded_notification_details", "Expected branded notification rollback before legacy probes");
  assertGate((await migratePartnerOne(pool, "down")).version === "018_partner_notification_dead_audit", "Expected notification dead-audit rollback before legacy probes");
  assertGate((await migratePartnerOne(pool, "down")).version === "017_partner_notification_owner_access", "Expected notification owner access rollback before legacy probes");
  assertGate((await migratePartnerOne(pool, "down")).version === "016_partner_submission_notifications", "Expected notification delivery rollback before legacy probes");
  assertGate((await migratePartnerOne(pool, "down")).version === "015_partner_site_plan_company_lock", "Expected floor-plan company lock rollback");
  await assertSitePlanCompanyLock(pool,false);
  assertGate((await migratePartnerOne(pool, "down")).version === "014_partner_live_transfer", "Expected live transfer rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "013_partner_manual_links", "Expected manual links rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "012_partner_account_access", "Expected account access rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "011_partner_draft_deletion", "Expected draft deletion rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "010_partner_settings_service", "Expected settings service rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "009_partner_draft_creation", "Expected creation binding rollback");
  const initialPolicyDown = await migratePartnerOne(pool, "down");
  assertGate(initialPolicyDown.version === "008_partner_quote_policy", "Expected policy rollback before legacy probes");
  const opsInitialDown = await migratePartnerOne(pool, "down");
  assertGate(opsInitialDown.version === "007_partner_operations", "Expected 007 to roll down before legacy worker probes");
  await assertPartnerOperationsRemoved(pool);
  const e4InitialDown = await migratePartnerOne(pool, "down");
  assertGate(e4InitialDown.version === "006_partner_submission_worker", "Expected to roll E4 down before legacy E1 runtime probes");
  const e1InitialDown = await migratePartnerOne(pool, "down");
  assertGate(e1InitialDown.version === "005_partner_submission_saga", "Expected to roll E1 down before legacy D1 runtime probes");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const companyId = (await client.query(
      "INSERT INTO partner_companies (slug, name, billing_model) VALUES ($1, 'Gate Partner', 'PARTNER_BILLED') RETURNING id",
      [`gate-${randomUUID().slice(0, 8)}`],
    )).rows[0].id;
    const userId = randomUUID();
    await client.query("INSERT INTO partner_users (id, company_id, principal_type, name, email) VALUES ($1, $2, 'PARTNER', 'Gate User', $3)", [userId, companyId, `gate-${randomUUID()}@example.test`]);
    const jobId = (await client.query(
      "INSERT INTO partner_jobs (company_id, created_by_user_id, client_reference, billing_model_snapshot) VALUES ($1, $2, 'gate-job', 'PARTNER_BILLED') RETURNING id",
      [companyId, userId],
    )).rows[0].id;
    const drawingId = (await client.query(
      "INSERT INTO partner_site_plan_drawings (company_id, job_id, name, sort_order, created_by_user_id) VALUES ($1, $2, 'Ground floor', 0, $3) RETURNING id",
      [companyId, jobId, userId],
    )).rows[0].id;
    const upperDrawingId = (await client.query(
      "INSERT INTO partner_site_plan_drawings (company_id, job_id, name, sort_order, created_by_user_id) VALUES ($1, $2, 'Upper floor', 1, $3) RETURNING id",
      [companyId, jobId, userId],
    )).rows[0].id;
    const loftDrawingId = (await client.query(
      "INSERT INTO partner_site_plan_drawings (company_id, job_id, name, sort_order, created_by_user_id) VALUES ($1, $2, 'Loft', 2, $3) RETURNING id",
      [companyId, jobId, userId],
    )).rows[0].id;

    const roles = await client.query(`SELECT rolname, rolcanlogin, rolinherit
      FROM pg_roles WHERE rolname IN ('partner_artifact_owner','partner_portal_runtime') ORDER BY rolname`);
    assertGate(roles.rowCount === 2 && roles.rows.every((row) => !row.rolcanlogin && !row.rolinherit), "D1 roles must be NOLOGIN NOINHERIT");
    const runtimeOwnsArtifactRole = await client.query("SELECT pg_has_role('partner_portal_runtime','partner_artifact_owner','MEMBER') AS member");
    assertGate(runtimeOwnsArtifactRole.rows[0].member === false, "Runtime role must not be a member of artifact owner");

    const functionSecurity = await client.query(`SELECT p.proname, p.prosecdef, owner.rolname AS owner, p.proconfig,
        has_function_privilege('partner_portal_runtime',p.oid,'EXECUTE') AS runtime_execute,
        pg_get_functiondef(p.oid) AS definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles owner ON owner.oid=p.proowner
      WHERE n.nspname='public' AND p.proname IN (
        'partner_prune_site_plan_pdf_artifacts','partner_publish_site_plan_pdf_artifact','partner_purge_draft_site_plan_drawing'
      ) ORDER BY p.proname`);
    assertGate(functionSecurity.rowCount === 3, "Expected all D1 SECURITY DEFINER functions");
    for (const row of functionSecurity.rows) {
      assertGate(row.prosecdef && row.owner === "partner_artifact_owner" && row.runtime_execute, `${row.proname} must be owner-scoped and executable by runtime`);
      assertGate(row.proconfig?.some((setting) => setting.replaceAll(" ", "") === "search_path=pg_catalog"), `${row.proname} must have a pg_catalog-only search_path`);
    }
    const pruneDefinition = functionSecurity.rows.find((row) => row.proname === "partner_prune_site_plan_pdf_artifacts")?.definition ?? "";
    assertGate(pruneDefinition.includes("running_bytes - c.byte_size < quota_bytes - 1073741824"), "Quota prune must include the cumulative crossing row");
    const purgeDefinition = functionSecurity.rows.find((row) => row.proname === "partner_purge_draft_site_plan_drawing")?.definition ?? "";
    assertGate(purgeDefinition.includes("SET CONSTRAINTS public.partner_site_plan_order_unique DEFERRED"), "Purge must schema-qualify the deferred order constraint under its pg_catalog-only search_path");

    const constraints = await client.query(`SELECT conname, condeferrable, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conname IN ('partner_site_plan_order_unique','partner_site_plan_current_pdf_artifact_fk')`);
    assertGate(constraints.rows.find((row) => row.conname === "partner_site_plan_order_unique")?.condeferrable, "Floor ordering must be deferrable");
    const pointerFk = constraints.rows.find((row) => row.conname === "partner_site_plan_current_pdf_artifact_fk")?.definition ?? "";
    assertGate(pointerFk.includes("FOREIGN KEY (company_id, job_id, id, current_pdf_artifact_id)"), "Current artifact FK must use exact composite identity");

    await client.query(`GRANT partner_portal_runtime TO ${quoteIdentifier((await client.query("SELECT session_user AS role")).rows[0].role)}`);
    await client.query("SET ROLE partner_portal_runtime");
    try {
      const runtimePrivileges = await client.query(`SELECT
        has_column_privilege(current_user,'partner_site_plan_drawings','drawing_data','INSERT') AS can_insert_document,
        has_column_privilege(current_user,'partner_site_plan_drawings','drawing_data','UPDATE') AS can_update_document,
        has_column_privilege(current_user,'partner_site_plan_drawings','current_pdf_artifact_id','UPDATE') AS can_update_pointer`);
      assertGate(runtimePrivileges.rows[0].can_insert_document && runtimePrivileges.rows[0].can_update_document && !runtimePrivileges.rows[0].can_update_pointer, "Runtime drawing privileges must be column-scoped away from the PDF pointer");
      await client.query("UPDATE partner_site_plan_drawings SET name='Ground floor runtime',drawing_data=drawing_data WHERE id=$1", [drawingId]);
      const runtimeDrawingId = (await client.query(
        "INSERT INTO partner_site_plan_drawings(company_id,job_id,name,sort_order,drawing_data,created_by_user_id) VALUES($1,$2,'Runtime floor',3,$3::jsonb,$4) RETURNING id",
        [companyId, jobId, JSON.stringify({ schemaVersion: 1, templateVersion: "site-plan-template-v2", walls: [], textNotes: [], showDimensions: true }), userId],
      )).rows[0].id;
      const stalePurge = await client.query("SELECT * FROM partner_purge_draft_site_plan_drawing($1,$2,$3,99)", [companyId, jobId, upperDrawingId]);
      assertGate(stalePurge.rowCount === 0, "Scoped purge must reject a stale collection revision without mutation");
      await client.query("UPDATE partner_jobs SET submission_state='QUEUED' WHERE id=$1", [jobId]);
      const lockedPurge = await client.query("SELECT * FROM partner_purge_draft_site_plan_drawing($1,$2,$3,0)", [companyId, jobId, upperDrawingId]);
      assertGate(lockedPurge.rowCount === 0, "Scoped purge must reject a non-DRAFT job without mutation");
      await client.query("UPDATE partner_jobs SET submission_state='DRAFT' WHERE id=$1", [jobId]);
      const pdfBytes = Buffer.from("%PDF-1.4\n%D1 gate\n%%EOF\n", "utf8");
      const contentSha = createHash("sha256").update(pdfBytes).digest("hex");
      const artifactId = randomUUID();
      const publishValues = [
        companyId, jobId, drawingId, artifactId, "1".repeat(64), pdfBytes, 0, "site-plan-renderer-v1",
        "site-plan-template-v2", "b82dc68276806628e2574a6a51a6299d1a23df56f4ba8a5a4a06226d3ebd904b",
        contentSha, "ground-floor.pdf", userId, 0, 0, null,
      ];
      await expectRejectedInSavepoint(client, "bad_pdf_sha", `SELECT partner_publish_site_plan_pdf_artifact(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [...publishValues.slice(0, 10), "0".repeat(64), ...publishValues.slice(11)]);
      const published = await client.query(`SELECT partner_publish_site_plan_pdf_artifact(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) AS id`, publishValues);
      assertGate(published.rows[0].id === artifactId, "Definer publisher must return its artifact identity");
      const projected = await client.query(`SELECT a.id,a.byte_size,a.content_sha256,d.current_pdf_artifact_id
        FROM partner_site_plan_pdf_artifacts a JOIN partner_site_plan_drawings d
          ON (d.company_id,d.job_id,d.id)=(a.company_id,a.job_id,a.drawing_id)
        WHERE (a.company_id,a.job_id,a.drawing_id,a.id)=($1,$2,$3,$4)`, [companyId, jobId, drawingId, artifactId]);
      assertGate(projected.rows[0]?.byte_size === pdfBytes.length && projected.rows[0]?.content_sha256 === contentSha && projected.rows[0]?.current_pdf_artifact_id === artifactId, "Published artifact metadata and pointer must match");
      await expectRejectedInSavepoint(client, "runtime_pointer_clear", "UPDATE partner_site_plan_drawings SET current_pdf_artifact_id=NULL WHERE id=$1", [drawingId]);
      await expectRejectedInSavepoint(client, "runtime_pointer_set", "UPDATE partner_site_plan_drawings SET current_pdf_artifact_id=$2 WHERE id=$1", [drawingId, artifactId]);
      await expectRejectedInSavepoint(client, "runtime_artifact_insert", `INSERT INTO partner_site_plan_pdf_artifacts
        (company_id,job_id,drawing_id,id,render_hash,pdf_bytes,byte_size,drawing_revision,renderer_version,template_version,template_sha256,content_sha256,file_name,generated_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [companyId, jobId, drawingId, randomUUID(), "2".repeat(64), pdfBytes, pdfBytes.length, 0, "x", "x", "3".repeat(64), contentSha, "denied.pdf", userId]);
      await expectRejectedInSavepoint(client, "runtime_artifact_update", "UPDATE partner_site_plan_pdf_artifacts SET file_name='denied.pdf' WHERE id=$1", [artifactId]);
      await expectRejectedInSavepoint(client, "runtime_artifact_delete", "DELETE FROM partner_site_plan_pdf_artifacts WHERE id=$1", [artifactId]);
      await expectRejectedInSavepoint(client, "runtime_artifact_truncate", "TRUNCATE partner_site_plan_pdf_artifacts");
      await expectRejectedInSavepoint(client, "runtime_drawing_delete", "DELETE FROM partner_site_plan_drawings WHERE id=$1", [drawingId]);
      await expectRejectedInSavepoint(client, "runtime_drawing_truncate", "TRUNCATE partner_site_plan_drawings");
      const pruned = await client.query("SELECT partner_prune_site_plan_pdf_artifacts($1) AS count", [companyId]);
      assertGate(pruned.rows[0].count === 0, "Prune must preserve the only current artifact");
      const purged = await client.query("SELECT collection_revision,drawing_ids FROM partner_purge_draft_site_plan_drawing($1,$2,$3,$4)", [companyId, jobId, drawingId, 0]);
      assertGate(purged.rows[0]?.collection_revision === 1 && JSON.stringify(purged.rows[0]?.drawing_ids) === JSON.stringify([upperDrawingId, loftDrawingId, runtimeDrawingId]), "Scoped purge must compact order and return the authoritative revision/list");
      const compacted = await client.query("SELECT id,sort_order FROM partner_site_plan_drawings WHERE company_id=$1 AND job_id=$2 ORDER BY sort_order,id", [companyId, jobId]);
      assertGate(compacted.rows.every((row, index) => row.sort_order === index) && compacted.rows.length === 3, "Scoped purge must leave contiguous sort order");
      const gone = await client.query("SELECT count(*)::integer AS drawings FROM partner_site_plan_drawings WHERE id=$1", [drawingId]);
      const artifactsGone = await client.query("SELECT count(*)::integer AS artifacts FROM partner_site_plan_pdf_artifacts WHERE drawing_id=$1", [drawingId]);
      assertGate(gone.rows[0].drawings === 0 && artifactsGone.rows[0].artifacts === 0, "Scoped purge must cascade through immutable artifacts as owner");
      await client.query("SELECT * FROM partner_purge_draft_site_plan_drawing($1,$2,$3,1)", [companyId, jobId, upperDrawingId]);
      await client.query("SELECT * FROM partner_purge_draft_site_plan_drawing($1,$2,$3,2)", [companyId, jobId, loftDrawingId]);
      const emptyPurge = await client.query("SELECT collection_revision,drawing_ids FROM partner_purge_draft_site_plan_drawing($1,$2,$3,3)", [companyId, jobId, runtimeDrawingId]);
      assertGate(emptyPurge.rows[0]?.collection_revision === 4 && emptyPurge.rows[0]?.drawing_ids.length === 0, "Scoped purge must verify the empty-order branch");
    } finally {
      await client.query("RESET ROLE").catch(() => undefined);
    }
    await expectRejectedInSavepoint(client, "bad_submit", "UPDATE partner_jobs SET submission_state = 'SUBMITTED' WHERE id = $1", [jobId]);
    await expectRejectedInSavepoint(client, "bad_settlement", `INSERT INTO partner_job_settlements
      (company_id, job_id, billing_model_snapshot, gross_cents, retained_margin_cents, net_due_cents, created_by_user_id)
      VALUES ($1, $2, 'PARTNER_BILLED', 1000, 1200, -200, $3)`, [companyId, jobId, userId]);
    const amendmentId = (await client.query(
      "INSERT INTO partner_job_amendments (company_id, job_id, sequence, reason, patch, created_by_user_id) VALUES ($1, $2, 1, 'gate', '{}'::jsonb, $3) RETURNING id",
      [companyId, jobId, userId],
    )).rows[0].id;
    await expectRejectedInSavepoint(client, "append_update", "UPDATE partner_job_amendments SET reason = 'changed' WHERE id = $1", [amendmentId]);
    await expectRejectedInSavepoint(client, "append_delete", "DELETE FROM partner_job_amendments WHERE id = $1", [amendmentId]);
    const trackingId = (await client.query(
      `INSERT INTO partner_tracking_facts
       (company_id, job_id, fact_type, value_type, value, source, effective_at, recorded_by_user_id)
       VALUES ($1, $2, 'JOB_COMPLETED', 'BOOLEAN', 'true'::jsonb, 'LOCAL_INTERNAL', now(), $3)
       RETURNING id`,
      [companyId, jobId, userId],
    )).rows[0].id;
    await expectRejectedInSavepoint(client, "tracking_update", "UPDATE partner_tracking_facts SET note = 'changed' WHERE id = $1", [trackingId]);
    await expectRejectedInSavepoint(client, "tracking_delete", "DELETE FROM partner_tracking_facts WHERE id = $1", [trackingId]);
    const auditId = (await client.query(
      `INSERT INTO partner_audit_events (event_type, actor_user_id, subject_user_id, company_id, metadata)
       VALUES ('USER_PROVISIONED', $1, $1, $2, '{}'::jsonb) RETURNING id`,
      [userId, companyId],
    )).rows[0].id;
    await expectRejectedInSavepoint(client, "audit_update", "UPDATE partner_audit_events SET metadata = '{\"changed\":true}'::jsonb WHERE id = $1", [auditId]);
    await expectRejectedInSavepoint(client, "audit_delete", "DELETE FROM partner_audit_events WHERE id = $1", [auditId]);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }

  const migrationRole = (await pool.query("SELECT current_user AS role")).rows[0].role;
  await pool.query(`REVOKE partner_portal_runtime FROM ${quoteIdentifier(migrationRole)}`);

  const d1Down = await migratePartnerOne(pool, "down");
  assertGate(d1Down.version === "004_partner_site_plan_artifacts", "Expected to roll D1 down first");
  const restoredLegacy = await pool.query("SELECT floor_index,drawing_data FROM partner_site_plan_drawings WHERE company_id=$1 AND job_id=$2 AND id=$3", [legacyCompanyId, legacyJobId, legacyDrawingId]);
  assertGate(restoredLegacy.rows[0]?.floor_index === 7 && JSON.stringify(restoredLegacy.rows[0]?.drawing_data) === "{}", "D1 down must restore legacy floor_index and exact empty document semantics");
  const d1Up = await migratePartnerOne(pool, "up");
  assertGate(d1Up.version === "004_partner_site_plan_artifacts", "Expected D1 to reapply after rollback probe");
  const canonicalLegacy = await pool.query("SELECT drawing_data FROM partner_site_plan_drawings WHERE id=$1", [legacyDrawingId]);
  assertGate(canonicalLegacy.rows[0]?.drawing_data?.schemaVersion === 1, "D1 reapply must canonicalize only the exact legacy empty document");

  const e1Up = await migratePartnerOne(pool, "up");
  assertGate(e1Up.version === "005_partner_submission_saga", "Expected E1 to reapply after the D1 rollback probe");

  const e1Roles = await pool.query(`SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname IN ('partner_submission_owner','partner_submission_worker') ORDER BY rolname`);
  assertGate(e1Roles.rowCount === 2 && e1Roles.rows.every((row) => !row.rolcanlogin && !row.rolinherit && !row.rolsuper && !row.rolcreatedb && !row.rolcreaterole && !row.rolreplication && !row.rolbypassrls), "E1 owner and worker groups must have no login, inheritance, or administrative attributes");
  const e1Functions = await pool.query(`SELECT p.proname,p.prosecdef,owner.rolname AS owner,p.proconfig,
      COALESCE(array_to_string(p.proacl,','),'') ~ '(^|,)=X/' AS public_execute,
      has_function_privilege('partner_portal_runtime',p.oid,'EXECUTE') AS runtime_execute,
      has_function_privilege('partner_submission_worker',p.oid,'EXECUTE') AS worker_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles owner ON owner.oid=p.proowner
    WHERE n.nspname='public' AND owner.rolname='partner_submission_owner' AND p.prosecdef`);
  assertGate(e1Functions.rowCount === 12, "Expected every E1 owner SECURITY DEFINER function, including the internal lease lock");
  for (const row of e1Functions.rows) {
    assertGate(row.prosecdef && row.owner === "partner_submission_owner" && !row.public_execute && row.proconfig?.some((setting) => setting.replaceAll(" ", "") === "search_path=pg_catalog"), `${row.proname} must be fixed-path, owner-scoped, and closed to PUBLIC`);
  }
  assertGate(e1Functions.rows.filter((row) => row.runtime_execute).map((row) => row.proname).sort().join(",") === ["partner_consume_submission_rate_limit","partner_freeze_submission","partner_submission_status"].join(","), "Runtime must have only the three approved E1 entry points");
  assertGate(e1Functions.rows.filter((row) => row.worker_execute).length === 9 && !e1Functions.rows.find((row) => row.proname === "partner_freeze_submission")?.worker_execute, "Worker must have only the nine lease-scoped E1 entry points");

  await pool.query(`GRANT partner_portal_runtime TO ${quoteIdentifier(migrationRole)}`);
  const privilegeClient = await pool.connect();
  try {
    await privilegeClient.query("BEGIN"); await privilegeClient.query("SET ROLE partner_portal_runtime");
    await expectRejectedInSavepoint(privilegeClient,"runtime_submission_table_read","SELECT * FROM partner_submission_requests");
    await expectRejectedInSavepoint(privilegeClient,"runtime_submission_audit_forge","INSERT INTO partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata) VALUES('SUBMISSION_FINALIZED',$1,$2,$3,'{}'::jsonb)",[legacyCompanyId,legacyJobId,randomUUID()]);
    await privilegeClient.query("ROLLBACK");
  } finally { privilegeClient.release(); }
  await pool.query(`REVOKE partner_portal_runtime FROM ${quoteIdentifier(migrationRole)}`);

  const cleanE1Down = await migratePartnerOne(pool,"down");
  assertGate(cleanE1Down.version === "005_partner_submission_saga", "Expected a clean E1 down probe");
  for (const objectName of ["partner_submission_snapshots","partner_submission_plan_manifest","partner_submission_requests","partner_submission_plan_deliveries","partner_submission_rate_limits"]) {
    const absent = await pool.query("SELECT to_regclass($1) AS value",[`public.${objectName}`]);
    assertGate(absent.rows[0].value === null, `E1 down must remove ${objectName}`);
  }
  const residualFunctions = await pool.query("SELECT count(*)::integer AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'partner_submission_%'");
  assertGate(residualFunctions.rows[0].count === 0, "E1 down must leave no partner_submission_* functions");
  const residualRoles = await pool.query("SELECT count(*)::integer AS count FROM pg_roles WHERE rolname IN ('partner_submission_owner','partner_submission_worker')");
  assertGate(residualRoles.rows[0].count === 0, "E1 down must remove its NOLOGIN roles");
  const cleanE1Up = await migratePartnerOne(pool,"up");
  assertGate(cleanE1Up.version === "005_partner_submission_saga", "Expected E1 to reapply after clean down");
  const preCycleE4Up = await migratePartnerOne(pool,"up");
  assertGate(preCycleE4Up.version === "006_partner_submission_worker", "Expected E4 to reapply before the complete all-down cycle");
  const preCycleOpsUp = await migratePartnerOne(pool, "up");
  assertGate(preCycleOpsUp.version === "007_partner_operations", "Expected 007 to reapply before the complete all-down cycle");
  await probePartnerOperations(pool);
  const preCyclePolicyUp = await migratePartnerOne(pool, "up");
  assertGate(preCyclePolicyUp.version === "008_partner_quote_policy", "Expected policy reapply before full rollback");

  assertGate((await migratePartnerOne(pool, "up")).version === "009_partner_draft_creation", "Expected creation binding reapply");
  assertGate((await migratePartnerOne(pool, "up")).version === "010_partner_settings_service", "Expected settings service reapply");
  assertGate((await migratePartnerOne(pool, "up")).version === "011_partner_draft_deletion", "Expected draft deletion reapply");
  assertGate((await migratePartnerOne(pool, "up")).version === "012_partner_account_access", "Expected account access reapply");
  assertGate((await migratePartnerOne(pool, "up")).version === "013_partner_manual_links", "Expected manual links reapply");
  assertGate((await migratePartnerOne(pool, "up")).version === "014_partner_live_transfer", "Expected live transfer reapply");
  assertGate((await migratePartnerOne(pool, "up")).version === "015_partner_site_plan_company_lock", "Expected floor-plan company lock reapply");
  assertGate((await migratePartnerOne(pool, "up")).version === "016_partner_submission_notifications", "Expected notification delivery reapply before full rollback");
  assertGate((await migratePartnerOne(pool, "up")).version === "017_partner_notification_owner_access", "Expected notification owner access reapply before full rollback");
  assertGate((await migratePartnerOne(pool, "up")).version === "018_partner_notification_dead_audit", "Expected notification dead-audit reapply before full rollback");
  assertGate((await migratePartnerOne(pool, "up")).version === "019_partner_branded_notification_details", "Expected branded notification reapply before full rollback");
  assertGate((await migratePartnerOne(pool, "up")).version === "020_partner_neutral_submission_v2", "Expected neutral submission reapply before full rollback");
  assertGate((await migratePartnerOne(pool, "up")).version === "021_partner_immediate_submission", "Expected immediate submission reapply before full rollback");
  assertGate((await migratePartnerOne(pool, "up")).version === "022_partner_company_access", "Expected company access reapply");
  assertGate((await migratePartnerOne(pool, "up")).version === "023_partner_note_updates", "Expected partner notes reapply");
  await probePartnerNoteUpdates(pool);
  await assertSitePlanCompanyLock(pool,true);
  await probePartnerAccountAccess(pool);
  await probePartnerSettingsService(pool);
  await probePartnerCompanyAccess(pool);
  await probePartnerCompanyAccessLockOrder(pool);
  const ownerAuthority=async()=>JSON.stringify((await pool.query(`SELECT r.rolname,m.admin_option,m.inherit_option,m.set_option,g.rolname grantor,
    has_schema_privilege(r.rolname,'public','CREATE') schema_create
    FROM pg_roles r LEFT JOIN pg_auth_members m ON m.roleid=r.oid AND m.member=(SELECT oid FROM pg_roles WHERE rolname=current_user)
    LEFT JOIN pg_roles g ON g.oid=m.grantor WHERE r.rolname=ANY($1::text[]) ORDER BY r.rolname,g.rolname`,[["partner_artifact_owner","partner_submission_owner","partner_ops_owner"]])).rows);
  const beforeInjectedFailure=await ownerAuthority();let injected=false,pregrantCount=0;
  const failingPool={connect:async()=>{const actual=await pool.connect();return{query:async(text,values)=>{if(!injected&&/^GRANT /u.test(text)){pregrantCount+=1;if(pregrantCount===2){injected=true;throw new Error("injected owner pregrant failure");}}return actual.query(text,values);},release:()=>actual.release()};}};
  let cleanupProved=false;try{await migratePartnerOne(failingPool,"down");}catch(error){cleanupProved=error.message.includes("injected owner pregrant failure");}
  assertGate(cleanupProved&&await ownerAuthority()===beforeInjectedFailure,"partial migration elevation failure must restore exact memberships and schema CREATE authority");
  const down = await migratePartnerAll(pool, "down");
  if (!down.changed || down.versions.length !== firstUp.versions.length) throw new Error("Migration gate expected every version to roll down");
  const partnerTables = [
    "partner_note_reads", "partner_notification_settings", "partner_account_links", "partner_access_rate_limits", "partner_legacy_create_dispatches", "partner_companies", "partner_users", "partner_sessions", "partner_accounts", "partner_verifications",
    "partner_auth_rate_limits", "partner_jobs", "partner_site_plan_drawings", "partner_submission_attempts",
    "partner_tracking_facts", "partner_job_settlements", "partner_job_amendments", "partner_outbox_events", "partner_audit_events",
    "partner_site_plan_pdf_artifacts", "partner_site_plan_rate_limits", "partner_site_plan_d1_legacy_backup", "partner_job_invoices",
  ];
  for (const table of partnerTables) {
    const absent = await pool.query("SELECT to_regclass($1) AS table_name", [`public.${table}`]);
    if (absent.rows[0].table_name !== null) throw new Error(`Migration gate expected ${table} to be absent after full rollback`);
  }
  const ledger = await pool.query("SELECT count(*)::integer AS count FROM partner_schema_migrations");
  if (ledger.rows[0].count !== 0) throw new Error("Migration gate expected an empty migration ledger after full rollback");

  const secondUp = await migratePartnerAll(pool, "up");
  if (!secondUp.changed || JSON.stringify(secondUp.versions) !== JSON.stringify(firstUp.versions)) {
    throw new Error("Migration gate expected every version to reapply in the same order");
  }
  await assertImmediateSubmissionRoleCatalog(pool);
  await probePartnerOperations(pool);
  await probePartnerSettingsService(pool);
  await probePartnerCompanyAccess(pool);
  await probePartnerCompanyAccessLockOrder(pool);
  await probePartnerDraftDeletion(pool, seedReadySubmission);
  await probePartnerAccountAccess(pool);
  await probePartnerJobLinks(pool, seedReadySubmission);
  await probePartnerLiveTransfer(pool,seedReadySubmission);
  await assertSitePlanCompanyLock(pool,true);
  assertGate((await migratePartnerOne(pool, "down")).version === "023_partner_note_updates", "Expected partner notes rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "022_partner_company_access", "Expected company access rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "021_partner_immediate_submission", "Expected immediate submission rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "020_partner_neutral_submission_v2", "Expected neutral submission rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "019_partner_branded_notification_details", "Expected branded notification rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "018_partner_notification_dead_audit", "Expected notification dead-audit rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "017_partner_notification_owner_access", "Expected notification owner access rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "016_partner_submission_notifications", "Expected notification delivery rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "015_partner_site_plan_company_lock", "Expected floor-plan company lock rollback");
  await assertSitePlanCompanyLock(pool,false);
  assertGate((await migratePartnerOne(pool, "down")).version === "014_partner_live_transfer", "Expected live transfer rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "013_partner_manual_links", "Expected manual links rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "012_partner_account_access", "Expected account access rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "011_partner_draft_deletion", "Expected draft deletion rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "010_partner_settings_service", "Expected settings service rollback");
  assertGate((await migratePartnerOne(pool, "down")).version === "009_partner_draft_creation", "Expected creation binding rollback");
  const policyDown = await migratePartnerOne(pool, "down");
  assertGate(policyDown.version === "008_partner_quote_policy", "Expected portal policy rollback first");
  const cleanOpsDown = await migratePartnerOne(pool, "down");
  assertGate(cleanOpsDown.version === "007_partner_operations", "Expected a clean operations down probe before worker activity");
  await assertPartnerOperationsRemoved(pool);
  const cleanE4Down = await migratePartnerOne(pool,"down");
  assertGate(cleanE4Down.version === "006_partner_submission_worker", "Expected a clean E4 down probe before worker activity");
  const cleanE4Up = await migratePartnerOne(pool,"up");
  assertGate(cleanE4Up.version === "006_partner_submission_worker", "Expected E4 to reapply after its clean rollback probe");
  const expectedWorkerFunctions=["partner_adopt_attached_plan","partner_begin_attachment","partner_begin_plan_upload","partner_checkpoint_notification_accepted","partner_checkpoint_quote_verified","partner_checkpoint_submission_bounded","partner_claim_notification","partner_claim_submission_bounded","partner_finalize_notification","partner_finalize_submission_verified","partner_heartbeat_notification","partner_heartbeat_submission","partner_reconcile_notification","partner_reconcile_submission","partner_release_notification","partner_release_submission_bounded","partner_submission_claimed_plans","partner_submission_claimed_snapshot"];
  const e4WorkerFunctions=await pool.query(`SELECT p.proname,owner.rolname AS owner,p.prosecdef,p.proconfig,has_function_privilege('partner_submission_worker',p.oid,'EXECUTE') AS worker_execute,
      has_function_privilege('partner_portal_runtime',p.oid,'EXECUTE') AS runtime_execute,
      NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_denied
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles owner ON owner.oid=p.proowner
    WHERE n.nspname='public' AND p.prosecdef AND p.proname LIKE 'partner_%' AND has_function_privilege('partner_submission_worker',p.oid,'EXECUTE') ORDER BY p.proname`);
  assertGate(e4WorkerFunctions.rows.map(row=>row.proname).join(",")===expectedWorkerFunctions.join(","),"E4 worker must execute exactly the approved definer set");
  assertGate(e4WorkerFunctions.rows.every(row=>row.owner==='partner_submission_owner'&&row.prosecdef===true&&Array.isArray(row.proconfig)&&row.proconfig.includes('search_path=pg_catalog')),"Every E4 worker definer must have the fixed owner and search path");
  assertGate(e4WorkerFunctions.rows.every(row=>row.runtime_execute===false&&row.public_denied===true),"PUBLIC and the partner runtime role must be denied every E4 worker definer");
  const gateRole=(await pool.query("SELECT current_user AS role")).rows[0].role;
  // The disposable fixture writer needs private CHECK-function execution.
  // SET ROLE runtime/worker probes below still exercise only those restricted groups.
  await pool.query(`GRANT partner_portal_runtime,partner_submission_worker,partner_submission_owner TO ${quoteIdentifier(gateRole)} WITH INHERIT TRUE, SET TRUE`);
  const idempotencyHash=sha256("same-tenant-idempotency-key-0001"); const ready=await seedReadySubmission(pool,`e1-${randomUUID().slice(0,8)}`,"FICTIONAL","VALID",idempotencyHash);
  const replacementArtifactId=randomUUID(); const replacementBytes=Buffer.from("%PDF-1.7\nreplacement gate\n%%EOF\n"); const replacementSha=sha256(replacementBytes);
  await pool.query(`INSERT INTO partner_site_plan_pdf_artifacts(company_id,job_id,drawing_id,id,render_hash,pdf_bytes,byte_size,drawing_revision,renderer_version,template_version,template_sha256,content_sha256,file_name,generated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,0,'partner-site-plan-renderer-v1','site-plan-template-v2','b82dc68276806628e2574a6a51a6299d1a23df56f4ba8a5a4a06226d3ebd904b',$8,'replacement.pdf',$9)`,[ready.companyId,ready.jobId,ready.drawingId,replacementArtifactId,"9".repeat(64),replacementBytes,replacementBytes.length,replacementSha,ready.userId]);
  async function freeze(fixture,requestId=fixture.requestId,snapshotId=fixture.snapshotId,jobRevision=0,floorPlanRevision=0) {
    const c=await pool.connect(); try { await c.query("SET ROLE partner_portal_runtime"); return await c.query(`SELECT * FROM partner_freeze_submission($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,[fixture.companyId,fixture.jobId,fixture.userId,jobRevision,floorPlanRevision,requestId,snapshotId,fixture.idempotencyHash,fixture.canonicalDocument,JSON.stringify(fixture.manifest)]); } finally { await c.query("RESET ROLE").catch(()=>{}); c.release(); }
  }
  const freezes=await Promise.all(Array.from({length:10},()=>freeze(ready)));
  assertGate(freezes.reduce((sum,result)=>sum+result.rowCount,0)===10 && freezes.filter((result)=>result.rows[0]?.replayed===false).length===1 && freezes.every((result)=>/^[0-9a-f]{64}$/.test(result.rows[0]?.authoritative_snapshot_sha256)&&/^[0-9a-f]{64}$/.test(result.rows[0]?.authoritative_request_hash)),"Ten concurrent freezes must converge on one authoritative request and return DB-owned hashes");
  const frozenCounts=await pool.query(`SELECT (SELECT count(*) FROM partner_submission_requests WHERE company_id=$1)::integer requests,(SELECT count(*) FROM partner_submission_snapshots WHERE company_id=$1)::integer snapshots,(SELECT count(*) FROM partner_outbox_events WHERE company_id=$1 AND topic='PARTNER_SUBMISSION_EXECUTE')::integer execute_events`,[ready.companyId]);
  assertGate(frozenCounts.rows[0].requests===1&&frozenCounts.rows[0].snapshots===1&&frozenCounts.rows[0].execute_events===1,"Concurrent freeze must create exactly one request/snapshot/execute event");
  const runtimeIdentityClient=await pool.connect();
  try {
    await runtimeIdentityClient.query("BEGIN");
    await runtimeIdentityClient.query("SET LOCAL ROLE partner_portal_runtime");
    await expectRejectedInSavepoint(runtimeIdentityClient,"runtime_locked_job_identity","UPDATE partner_jobs SET billing_model_snapshot='PARTNER_BILLED' WHERE company_id=$1 AND id=$2",[ready.companyId,ready.jobId]);
  } finally { await runtimeIdentityClient.query("ROLLBACK"); runtimeIdentityClient.release(); }
  let revisionReplayRejected=false; try { await freeze(ready,ready.requestId,ready.snapshotId,1,0); } catch(error) { revisionReplayRejected=error instanceof Error&&error.message.includes("SUBMISSION_REQUEST_BODY_MISMATCH"); }
  assertGate(revisionReplayRejected,"Same-key replay with a changed revision must conflict before replay");
  let randomRequestRejected=false; try { await freeze(ready,randomUUID()); } catch(error) { randomRequestRejected=error instanceof Error&&error.message.includes("SUBMISSION_INVALID_REQUEST_ID"); }
  assertGate(randomRequestRejected,"Independent handlers must use the deterministic tenant/job/idempotency request identity");
  let semanticReplayRejected=false; try { await freeze({...ready,canonicalDocument:ready.canonicalDocument.replace('"notes":"Kia ora"','"notes":"Changed semantic body"')}); } catch(error) { semanticReplayRejected=error instanceof Error&&error.message.includes("SUBMISSION_IDEMPOTENCY_CONFLICT"); }
  assertGate(semanticReplayRejected,"Same-key replay with a changed semantic snapshot must conflict");
  const stalePointer=await seedReadySubmission(pool,`e1stale-${randomUUID().slice(0,8)}`); await pool.query("UPDATE partner_site_plan_drawings SET current_pdf_artifact_id=NULL WHERE company_id=$1 AND job_id=$2 AND id=$3",[stalePointer.companyId,stalePointer.jobId,stalePointer.drawingId]);
  let stalePointerRejected=false; try { await freeze(stalePointer); } catch(error) { stalePointerRejected=error instanceof Error&&error.message.includes("SUBMISSION_PDF_INTEGRITY_FAILED"); } assertGate(stalePointerRejected,"Freeze must reject a stale current-artifact pointer");
  for (const mode of ["BAD_SHA","NON_PDF"]) { const corrupt=await seedReadySubmission(pool,`e1bad-${mode.toLowerCase()}-${randomUUID().slice(0,6)}`,"FICTIONAL",mode); let rejected=false; try { await freeze(corrupt); } catch(error) { rejected=error instanceof Error&&error.message.includes("SUBMISSION_PDF_INTEGRITY_FAILED"); } assertGate(rejected,`Freeze must reject ${mode} PDF artifacts`); }
  await pool.query(`GRANT partner_artifact_owner TO ${quoteIdentifier(gateRole)}`); const artifactOwnerClient=await pool.connect(); try { await artifactOwnerClient.query("SET ROLE partner_artifact_owner"); await artifactOwnerClient.query("UPDATE partner_site_plan_drawings SET current_pdf_artifact_id=$4 WHERE company_id=$1 AND job_id=$2 AND id=$3",[ready.companyId,ready.jobId,ready.drawingId,replacementArtifactId]); } finally { await artifactOwnerClient.query("RESET ROLE").catch(()=>{}); artifactOwnerClient.release(); }
  const pruneClient=await pool.connect(); try { await pruneClient.query("SET ROLE partner_portal_runtime"); await pruneClient.query("SELECT partner_prune_site_plan_pdf_artifacts($1)",[ready.companyId]); } finally { await pruneClient.query("RESET ROLE").catch(()=>{}); pruneClient.release(); }
  const frozenArtifact=await pool.query("SELECT count(*)::integer AS count FROM partner_site_plan_pdf_artifacts WHERE company_id=$1 AND id=$2",[ready.companyId,ready.artifactId]);
  assertGate(frozenArtifact.rows[0].count===1,"Prune must preserve an immutable manifest artifact after it is no longer current");
  await pool.query(`REVOKE partner_artifact_owner FROM ${quoteIdentifier(gateRole)}`);

  const rateResults=await Promise.all(Array.from({length:12},async()=>{const c=await pool.connect();try{await c.query("SET ROLE partner_portal_runtime");return (await c.query("SELECT partner_consume_submission_rate_limit($1,'USER',$2,600,10) AS allowed",[ready.companyId,sha256(ready.userId)])).rows[0].allowed;}finally{await c.query("RESET ROLE").catch(()=>{});c.release();}}));
  assertGate(rateResults.filter(Boolean).length===10,"Atomic submission rate limiter must allow exactly the configured concurrent budget");

  async function claim(worker) { const c=await pool.connect();try{await c.query("SET ROLE partner_submission_worker");return await c.query("SELECT * FROM partner_claim_submission_bounded($1,30)",[worker]);}finally{await c.query("RESET ROLE").catch(()=>{});c.release();} }
  async function claimNotification(worker) { const c=await pool.connect();try{await c.query("SET ROLE partner_submission_worker");return await c.query("SELECT * FROM partner_claim_notification($1,30)",[worker]);}finally{await c.query("RESET ROLE").catch(()=>{});c.release();} }
  async function advanceToQuote(fixture,worker,legacyNumber,legacyId=`legacy-${worker}`) {
    await freeze(fixture);const result=await claim(worker);assertGate(result.rowCount===1&&result.rows[0].company_id===fixture.companyId,"Expected the seeded submission to be claimed");const leaseRow=result.rows[0];
    const c=await pool.connect();try{await c.query("SET ROLE partner_submission_worker");const args=[leaseRow.company_id,leaseRow.job_id,leaseRow.request_id,leaseRow.lease_token,leaseRow.fence_token];
      assertGate((await c.query("SELECT partner_checkpoint_submission_bounded($1,$2,$3,$4,$5,'CREATE_STARTED',NULL,NULL,NULL,NULL) AS ok",args)).rows[0].ok===true,"Create-start checkpoint must succeed");
      assertGate((await c.query("SELECT partner_checkpoint_submission_bounded($1,$2,$3,$4,$5,'LEAD_CREATED',$6,$7,NULL,NULL) AS ok",[...args,legacyId,legacyNumber])).rows[0].ok===true,"Lead checkpoint must succeed");
      assertGate((await c.query("SELECT partner_checkpoint_quote_verified($1,$2,$3,$4,$5,$6) AS ok",[...args,sha256(`quote-${worker}`)])).rows[0].ok===true,"Quote verification checkpoint must succeed");
      return {leaseRow,args};
    }finally{await c.query("RESET ROLE").catch(()=>{});c.release();}
  }
  async function completeFixture(fixture,worker,legacyNumber,legacyId) {
    const advanced=await advanceToQuote(fixture,worker,legacyNumber,legacyId);const c=await pool.connect();try{await c.query("SET ROLE partner_submission_worker");
      assertGate((await c.query("SELECT partner_begin_plan_upload($1,$2,$3,$4,$5,0) AS ok",advanced.args)).rows[0].ok==="STARTED","Upload attempt must start");
      const remoteKey=`gate/${worker}.pdf`;assertGate((await c.query("SELECT partner_checkpoint_submission_bounded($1,$2,$3,$4,$5,'PLAN_UPLOADED',NULL,NULL,0,$6) AS ok",[...advanced.args,remoteKey])).rows[0].ok===true,"Upload checkpoint must succeed");
      assertGate((await c.query("SELECT partner_begin_attachment($1,$2,$3,$4,$5) AS ok",advanced.args)).rows[0].ok==="STARTED","Attachment attempt must start");
      assertGate((await c.query("SELECT partner_adopt_attached_plan($1,$2,$3,$4,$5,0,$6) AS ok",[...advanced.args,remoteKey])).rows[0].ok===true,"Attached plan adoption must succeed");
      assertGate((await c.query("SELECT partner_finalize_submission_verified($1,$2,$3,$4,$5,1) AS ok",advanced.args)).rows[0].ok===true,"Verified finalization must succeed");return advanced;
    }finally{await c.query("RESET ROLE").catch(()=>{});c.release();}
  }
  const [claimA,claimB]=await Promise.all([claim("worker-a"),claim("worker-b")]); const firstClaim=[claimA,claimB].find((result)=>result.rowCount===1); const emptyClaim=[claimA,claimB].find((result)=>result.rowCount===0);
  assertGate(firstClaim&&emptyClaim,"Two workers must not claim the same execute event");
  const lease=firstClaim.rows[0];
  const claimedClient=await pool.connect(); try { await claimedClient.query("SET ROLE partner_submission_worker");
    const projection=await claimedClient.query("SELECT * FROM partner_submission_claimed_snapshot($1,$2,$3,$4,$5)",[lease.company_id,lease.job_id,lease.request_id,lease.lease_token,lease.fence_token]);
    assertGate(projection.rowCount===1&&projection.rows[0].adapter_mode==='FICTIONAL'&&projection.rows[0].legacy_job_prefix==='GT'&&projection.rows[0].legacy_base_url===null&&projection.rows[0].legacy_credential_ciphertext===null&&projection.rows[0].legacy_credential_fingerprint===null&&projection.rows[0].legacy_credential_updated_at===null,"Fictional claimed work must expose frozen prefix and no live endpoint or credential provenance/bytes");
    await expectRejectedInSavepoint(claimedClient,"worker_direct_snapshot","SELECT * FROM partner_submission_snapshots");
    await expectRejectedInSavepoint(claimedClient,"worker_direct_pdf","SELECT pdf_bytes FROM partner_site_plan_pdf_artifacts");
  } finally { await claimedClient.query("RESET ROLE").catch(()=>{}); claimedClient.release(); }
  await pool.query("UPDATE partner_outbox_events SET lease_expires_at=now()-interval '1 second' WHERE company_id=$1 AND request_id=$2 AND topic='PARTNER_SUBMISSION_EXECUTE'",[lease.company_id,lease.request_id]);
  const reclaimed=await claim("worker-c"); assertGate(reclaimed.rowCount===1&&reclaimed.rows[0].fence_token>lease.fence_token,"Expired lease must be reclaimed with a higher fence");
  const staleClient=await pool.connect(); try { await staleClient.query("SET ROLE partner_submission_worker");
    const stale=await staleClient.query("SELECT partner_heartbeat_submission($1,$2,$3,$4,$5,30) AS ok",[lease.company_id,lease.job_id,lease.request_id,lease.lease_token,lease.fence_token]);
    const unsafe=await staleClient.query("SELECT partner_release_submission_bounded($1,$2,$3,$4,$5,'CUSTOMER_NAME_IN_ERROR',1) AS ok",[reclaimed.rows[0].company_id,reclaimed.rows[0].job_id,reclaimed.rows[0].request_id,reclaimed.rows[0].lease_token,reclaimed.rows[0].fence_token]);
    assertGate(stale.rows[0].ok===false&&unsafe.rows[0].ok==='DENIED',"Stale fences and unknown error codes must be rejected without mutation");
  } finally { await staleClient.query("RESET ROLE").catch(()=>{}); staleClient.release(); }
  const phaseClient=await pool.connect(); try { await phaseClient.query("SET ROLE partner_submission_worker"); const args=[reclaimed.rows[0].company_id,reclaimed.rows[0].job_id,reclaimed.rows[0].request_id,reclaimed.rows[0].lease_token,reclaimed.rows[0].fence_token];
    for (const [phase,legacyId,legacyNumber,ordinal,remoteKey] of [["CREATE_STARTED",null,null,null,null],["LEAD_CREATED","legacy-gate-1",7001,null,null]]) {
      const step=await phaseClient.query("SELECT partner_checkpoint_submission_bounded($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS ok",[...args,phase,legacyId,legacyNumber,ordinal,remoteKey]); assertGate(step.rows[0].ok===true,`Checkpoint ${phase} must succeed`);
    }
    const quoteVerified=await phaseClient.query("SELECT partner_checkpoint_quote_verified($1,$2,$3,$4,$5,$6) AS ok",[...args,"a".repeat(64)]);assertGate(quoteVerified.rows[0].ok===true,"Verified quote checkpoint must succeed");
    const uploadStarted=await phaseClient.query("SELECT partner_begin_plan_upload($1,$2,$3,$4,$5,0) AS ok",args);assertGate(uploadStarted.rows[0].ok==="STARTED","Bounded upload attempt must start");
    const uploaded=await phaseClient.query("SELECT partner_checkpoint_submission_bounded($1,$2,$3,$4,$5,'PLAN_UPLOADED',NULL,NULL,0,'gate/ground-floor.pdf') AS ok",args);assertGate(uploaded.rows[0].ok===true,"Plan upload checkpoint must succeed");
    const attachStarted=await phaseClient.query("SELECT partner_begin_attachment($1,$2,$3,$4,$5) AS ok",args);assertGate(attachStarted.rows[0].ok==="STARTED","Bounded attachment attempt must start");
    const attached=await phaseClient.query("SELECT partner_adopt_attached_plan($1,$2,$3,$4,$5,0,'gate/ground-floor.pdf') AS ok",args);assertGate(attached.rows[0].ok===true,"Exact attached plan adoption must succeed");
    await phaseClient.query("RESET ROLE"); const preFinal=await phaseClient.query("SELECT count(*)::integer AS count FROM partner_outbox_events WHERE company_id=$1 AND job_id=$2 AND topic='PARTNER_SUBMISSION_COMPLETED'",[args[0],args[1]]); assertGate(preFinal.rows[0].count===0,"Normal completion notification must not exist before finalization"); await phaseClient.query("SET ROLE partner_submission_worker");
    const finalized=await phaseClient.query("SELECT partner_finalize_submission_verified($1,$2,$3,$4,$5,1) AS ok",args); assertGate(finalized.rows[0].ok===true,"Finalization must atomically complete a fully checkpointed saga");
    const finalizedReplay=await phaseClient.query("SELECT partner_finalize_submission_verified($1,$2,$3,$4,$5,1) AS ok",args); assertGate(finalizedReplay.rows[0].ok===false,"A lost-response finalization retry must not enqueue or mutate twice");
  } finally { await phaseClient.query("RESET ROLE").catch(()=>{}); phaseClient.release(); }
  const completedEvents=await pool.query("SELECT count(*)::integer AS count FROM partner_outbox_events WHERE company_id=$1 AND job_id=$2 AND topic='PARTNER_SUBMISSION_COMPLETED'",[ready.companyId,ready.jobId]);
  assertGate(completedEvents.rows[0].count===1,"Finalization must enqueue exactly one normal completion notification");

  const readyNotification=await claimNotification("notify-ready");assertGate(readyNotification.rowCount===1&&readyNotification.rows[0].company_id===ready.companyId&&readyNotification.rows[0].notification_phase==="READY","A finalized submission notification must claim in READY phase");
  const notificationLease=readyNotification.rows[0];const notificationClient=await pool.connect();try{await notificationClient.query("SET ROLE partner_submission_worker");
    const notificationArgs=[notificationLease.event_id,notificationLease.lease_token,notificationLease.fence_token];const receipt=`gate:${notificationLease.event_id}`;
    assertGate((await notificationClient.query("SELECT partner_checkpoint_notification_accepted($1,$2,$3,$4) AS ok",[...notificationArgs,receipt])).rows[0].ok===true,"Notification provider receipt must checkpoint as ACCEPTED_PENDING");
    assertGate((await notificationClient.query("SELECT partner_release_notification($1,$2,$3,'PROVIDER_TIMEOUT',1) AS ok",notificationArgs)).rows[0].ok==="RELEASED","Accepted-pending notification lookup must be releasable without resend");
    await notificationClient.query("RESET ROLE");await notificationClient.query("UPDATE partner_outbox_events SET available_at=now() WHERE id=$1",[notificationLease.event_id]);
  }finally{await notificationClient.query("RESET ROLE").catch(()=>{});notificationClient.release();}
  const lookupNotification=await claimNotification("notify-lookup");assertGate(lookupNotification.rowCount===1&&lookupNotification.rows[0].notification_phase==="ACCEPTED_PENDING"&&lookupNotification.rows[0].notification_receipt===`gate:${notificationLease.event_id}`,"Accepted provider receipt must resume lookup-only");
  const lookupClient=await pool.connect();try{await lookupClient.query("SET ROLE partner_submission_worker");const row=lookupNotification.rows[0];assertGate((await lookupClient.query("SELECT partner_finalize_notification($1,$2,$3,$4) AS ok",[row.event_id,row.lease_token,row.fence_token,row.notification_receipt])).rows[0].ok===true,"Receipt lookup confirmation must finalize exactly once");}finally{await lookupClient.query("RESET ROLE").catch(()=>{});lookupClient.release();}

  const submissionCapFixture=await seedReadySubmission(pool,`e4-subcap-${randomUUID().slice(0,8)}`);await freeze(submissionCapFixture);
  for(let attempt=1;attempt<=5;attempt+=1){const cappedClaim=await claim(`submission-cap-${attempt}`);assertGate(cappedClaim.rowCount===1&&cappedClaim.rows[0].company_id===submissionCapFixture.companyId,`Submission cap attempt ${attempt} must claim exactly once`);const row=cappedClaim.rows[0];const c=await pool.connect();try{await c.query("SET ROLE partner_submission_worker");const transition=(await c.query("SELECT partner_release_submission_bounded($1,$2,$3,$4,$5,'PROVIDER_TIMEOUT',1) AS ok",[row.company_id,row.job_id,row.request_id,row.lease_token,row.fence_token])).rows[0].ok;assertGate(transition===(attempt===5?"RECONCILED":"RELEASED"),"Submission attempt cap must atomically terminalize at five");}finally{await c.query("RESET ROLE").catch(()=>{});c.release();}if(attempt<5)await pool.query("UPDATE partner_outbox_events SET available_at=now() WHERE company_id=$1 AND request_id=$2 AND topic='PARTNER_SUBMISSION_EXECUTE'",[row.company_id,row.request_id]);}
  const submissionAttemptCount=await pool.query("SELECT count(*)::integer AS count FROM partner_submission_attempts WHERE company_id=$1 AND request_id=$2",[submissionCapFixture.companyId,submissionCapFixture.requestId]);assertGate(submissionAttemptCount.rows[0].count===5,"Submission cap must never create a sixth attempt");

  const uploadCapFixture=await seedReadySubmission(pool,`e4-uploadcap-${randomUUID().slice(0,8)}`);const uploadCap=await advanceToQuote(uploadCapFixture,"upload-cap",8101);const uploadCapClient=await pool.connect();try{await uploadCapClient.query("SET ROLE partner_submission_worker");for(let attempt=1;attempt<=4;attempt+=1){const transition=(await uploadCapClient.query("SELECT partner_begin_plan_upload($1,$2,$3,$4,$5,0) AS ok",uploadCap.args)).rows[0].ok;assertGate(transition===(attempt===4?"RECONCILED":"STARTED"),"Upload cap must independently terminalize before a fourth remote upload");}}finally{await uploadCapClient.query("RESET ROLE").catch(()=>{});uploadCapClient.release();}

  const attachCapFixture=await seedReadySubmission(pool,`e4-attachcap-${randomUUID().slice(0,8)}`);const attachCap=await advanceToQuote(attachCapFixture,"attach-cap",8201);const attachCapClient=await pool.connect();try{await attachCapClient.query("SET ROLE partner_submission_worker");
    assertGate((await attachCapClient.query("SELECT partner_begin_plan_upload($1,$2,$3,$4,$5,0) AS ok",attachCap.args)).rows[0].ok==="STARTED","Attachment-cap fixture upload must start");
    assertGate((await attachCapClient.query("SELECT partner_checkpoint_submission_bounded($1,$2,$3,$4,$5,'PLAN_UPLOADED',NULL,NULL,0,'gate/attach-cap.pdf') AS ok",attachCap.args)).rows[0].ok===true,"Attachment-cap fixture upload must checkpoint");
    for(let attempt=1;attempt<=4;attempt+=1){const transition=(await attachCapClient.query("SELECT partner_begin_attachment($1,$2,$3,$4,$5) AS ok",attachCap.args)).rows[0].ok;assertGate(transition===(attempt===4?"RECONCILED":"STARTED"),"Attachment cap must independently terminalize before a fourth remote attach");}
  }finally{await attachCapClient.query("RESET ROLE").catch(()=>{});attachCapClient.release();}

  const notificationCapFixture=await seedReadySubmission(pool,`e4-notifycap-${randomUUID().slice(0,8)}`);await completeFixture(notificationCapFixture,"notify-cap",8301);
  await pool.query("UPDATE partner_outbox_events SET state='DEAD',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL WHERE topic='PARTNER_SUBMISSION_RECONCILIATION_ALERT' AND request_id=ANY($1::uuid[]) AND state='PENDING'",[[submissionCapFixture.requestId,uploadCapFixture.requestId,attachCapFixture.requestId]]);
  for(let attempt=1;attempt<=5;attempt+=1){const capped=await claimNotification(`notification-cap-${attempt}`);assertGate(capped.rowCount===1&&capped.rows[0].company_id===notificationCapFixture.companyId,`Notification cap attempt ${attempt} must claim once`);const row=capped.rows[0];const c=await pool.connect();try{await c.query("SET ROLE partner_submission_worker");const transition=(await c.query("SELECT partner_release_notification($1,$2,$3,'PROVIDER_TIMEOUT',1) AS ok",[row.event_id,row.lease_token,row.fence_token])).rows[0].ok;assertGate(transition===(attempt===5?"DEAD":"RELEASED"),"Notification cap must atomically dead-letter at five");}finally{await c.query("RESET ROLE").catch(()=>{});c.release();}if(attempt<5)await pool.query("UPDATE partner_outbox_events SET available_at=now() WHERE id=$1",[row.event_id]);}

  const live=await seedReadySubmission(pool,`e1live-${randomUUID().slice(0,8)}`,"LIVE"); await freeze(live); const liveClaim=await claim("worker-live");
  assertGate(liveClaim.rowCount===1&&liveClaim.rows[0].company_id===live.companyId,"Live work must be independently claimable");
  const liveLease=liveClaim.rows[0]; const liveClient=await pool.connect(); try { await liveClient.query("SET ROLE partner_submission_worker");
    const beforeRotation=await liveClient.query("SELECT * FROM partner_submission_claimed_snapshot($1,$2,$3,$4,$5)",[liveLease.company_id,liveLease.job_id,liveLease.request_id,liveLease.lease_token,liveLease.fence_token]);
    assertGate(beforeRotation.rowCount===1&&beforeRotation.rows[0].legacy_job_prefix==='GT'&&beforeRotation.rows[0].legacy_base_url==="https://legacy.example.test"&&beforeRotation.rows[0].legacy_credential_ciphertext&&/^[0-9a-f]{64}$/.test(beforeRotation.rows[0].legacy_credential_fingerprint)&&beforeRotation.rows[0].legacy_credential_updated_at,"A LIVE claim may read only its pinned credential envelope and safe frozen provenance");
  } finally { await liveClient.query("RESET ROLE").catch(()=>{}); liveClient.release(); }
  await pool.query("UPDATE partner_companies SET legacy_credential_ciphertext=$2,legacy_credential_updated_at=legacy_credential_updated_at+interval '1 second' WHERE id=$1",[live.companyId,Buffer.from("rotated-credential")]);
  const rotatedClient=await pool.connect(); try { await rotatedClient.query("SET ROLE partner_submission_worker");
    const afterRotation=await rotatedClient.query("SELECT * FROM partner_submission_claimed_snapshot($1,$2,$3,$4,$5)",[liveLease.company_id,liveLease.job_id,liveLease.request_id,liveLease.lease_token,liveLease.fence_token]);
    assertGate(afterRotation.rowCount===0,"Credential or endpoint rotation must stop claimed work instead of silently switching authority");
  } finally { await rotatedClient.query("RESET ROLE").catch(()=>{}); rotatedClient.release(); }

  const other=await seedReadySubmission(pool,`e1b-${randomUUID().slice(0,8)}`);
  const duplicateKeyRaw=other.canonicalDocument.replace('"notes":"Kia ora"','"notes":"SECRET_SHOULD_NOT_PERSIST","notes":"Kia ora"');
  const otherFreeze=await freeze({...other,canonicalDocument:duplicateKeyRaw});
  assertGate(otherFreeze.rowCount===1&&otherFreeze.rows[0].replayed===false,"The same raw idempotency hash must remain independent across companies");
  const storedCanonical=await pool.query("SELECT canonical_document FROM partner_submission_snapshots WHERE company_id=$1",[other.companyId]);
  assertGate(!storedCanonical.rows[0].canonical_document.includes("SECRET_SHOULD_NOT_PERSIST"),"Freeze must discard caller raw JSON and never persist hidden duplicate-key material");
  await pool.query(`REVOKE partner_portal_runtime,partner_submission_worker FROM ${quoteIdentifier(gateRole)}`);
  // End only disposable fixture leases so this checks the stronger retained-work guard.
  await pool.query("UPDATE partner_outbox_events SET lease_expires_at=now()-interval '1 second' WHERE state='PROCESSING' AND lease_expires_at>=now()");
  let rollbackRefused=false; try { await migratePartnerOne(pool,"down"); } catch(error) { rollbackRefused=error instanceof Error&&error.message.includes("partner worker rollback refused")&&error.message.includes("E4 submission work exists"); }
  assertGate(rollbackRefused,"E4 down must fail closed once worker-v2 submission work exists");
  const finalOpsUp = await migratePartnerOne(pool, "up");
  assertGate(finalOpsUp.version === "007_partner_operations", "Expected 007 to reapply over verified worker activity");
  await probePartnerOperations(pool);
  const finalPolicyUp = await migratePartnerOne(pool, "up");
  assertGate(finalPolicyUp.version === "008_partner_quote_policy", "Expected policy reapply after legacy probes");
  const policyFixture = await seedReadySubmission(pool, "policy-gate");
  const policySnapshot = JSON.parse(policyFixture.canonicalDocument);
  policySnapshot.job.leadSources = ["E1 Gate"];
  policySnapshot.job.quote.consentFeeCents = 0;
  policySnapshot.job.quote.depositBasisPoints = 0;
  const freezePolicy = (value) => pool.query("SELECT * FROM partner_freeze_submission($1,$2,$3,0,0,$4,$5,$6,$7,$8::jsonb)", [policyFixture.companyId, policyFixture.jobId, policyFixture.userId, policyFixture.requestId, policyFixture.snapshotId, policyFixture.idempotencyHash, canonicalJson(value), JSON.stringify(policyFixture.manifest)]);
  let sourceRejected = false;
  try { await freezePolicy({...policySnapshot,job:{...policySnapshot.job,leadSources:["Spoofed company"]}}); } catch (error) { sourceRejected = error.message.includes("SUBMISSION_SNAPSHOT_SOURCE_MISMATCH"); }
  assertGate(sourceRejected, "Company source must be bound to the locked company record");
  await freezePolicy(policySnapshot);
  const policyJob = (await pool.query("SELECT quote_data FROM partner_jobs WHERE id=$1", [policyFixture.jobId])).rows[0];
  assertGate(policyJob.quote_data.consentFeeCents === 0 && policyJob.quote_data.depositBasisPoints === 0, "Freeze must store the zero terms shown in the snapshot");
  assertGate((await migratePartnerOne(pool, "up")).version === "009_partner_draft_creation", "Expected creation binding reapply");
  assertGate((await migratePartnerOne(pool, "up")).version === "010_partner_settings_service", "Expected settings service reapply");
  assertGate((await migratePartnerOne(pool, "up")).version === "011_partner_draft_deletion", "Expected draft deletion reapply");
  assertGate((await migratePartnerOne(pool, "up")).version === "012_partner_account_access", "Expected account access reapply");
  assertGate((await migratePartnerOne(pool, "up")).version === "013_partner_manual_links", "Expected manual links reapply");
  assertGate((await migratePartnerOne(pool, "up")).version === "014_partner_live_transfer", "Expected live transfer reapply");
  assertGate((await migratePartnerOne(pool, "up")).version === "015_partner_site_plan_company_lock", "Expected floor-plan company lock reapply");
  let activeNotificationUpgradeRefused=false;
  try{await migratePartnerOne(pool,"up");}catch(error){activeNotificationUpgradeRefused=error instanceof Error&&error.message.includes("active or accepted notification");}
  assertGate(activeNotificationUpgradeRefused,"Notification upgrade must refuse active or accepted legacy delivery fixtures");
  await pool.query(`UPDATE partner_outbox_events SET state='PENDING',locked_at=NULL,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
    notification_phase='READY',notification_receipt=NULL,notification_accepted_at=NULL
    WHERE topic IN('PARTNER_SUBMISSION_COMPLETED','PARTNER_SUBMISSION_RECONCILIATION_ALERT') AND (state='PROCESSING' OR notification_phase='ACCEPTED_PENDING')`);
  assertGate((await migratePartnerOne(pool, "up")).version === "016_partner_submission_notifications", "Expected notification delivery reapply");
  assertGate((await migratePartnerOne(pool, "up")).version === "017_partner_notification_owner_access", "Expected notification owner access reapply");
  assertGate((await migratePartnerOne(pool, "up")).version === "018_partner_notification_dead_audit", "Expected notification dead-audit reapply");
  await pool.query(`GRANT partner_portal_runtime,partner_submission_worker,partner_ops_runtime TO ${quoteIdentifier(gateRole)} WITH INHERIT TRUE, SET TRUE`);
  await pool.query("UPDATE partner_outbox_events SET state='DEAD',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE topic='PARTNER_SUBMISSION_EXECUTE' AND state IN('PENDING','FAILED','PROCESSING')");
  const notificationBackfillFixture=await seedReadySubmission(pool,`notify-backfill-${randomUUID().slice(0,8)}`);
  const notificationBackfillSnapshot=JSON.parse(notificationBackfillFixture.canonicalDocument);
  notificationBackfillSnapshot.job.leadSources=["E1 Gate"];notificationBackfillSnapshot.job.quote.consentFeeCents=0;notificationBackfillSnapshot.job.quote.depositBasisPoints=0;
  notificationBackfillFixture.canonicalDocument=canonicalJson(notificationBackfillSnapshot);
  const notificationBackfillLegacyId="b".repeat(24);await completeFixture(notificationBackfillFixture,"notify-backfill",9900,notificationBackfillLegacyId);
  const notificationSettingsClient=await pool.connect();try{await notificationSettingsClient.query("SET ROLE partner_ops_runtime");assertGate((await notificationSettingsClient.query("SELECT partner_settings_notification_set('insulhub-settings-service',0,'gate-notify@example.test') ok")).rows[0].ok===true,"Backfill notification recipient must be configured");}finally{await notificationSettingsClient.query("RESET ROLE").catch(()=>{});notificationSettingsClient.release();}
  const notificationBackfillEvent=(await pool.query("SELECT id FROM partner_outbox_events WHERE company_id=$1 AND job_id=$2 AND topic='PARTNER_SUBMISSION_COMPLETED'",[notificationBackfillFixture.companyId,notificationBackfillFixture.jobId])).rows[0]?.id;
  const notificationBackfillClient=await pool.connect();try{await notificationBackfillClient.query("SET ROLE partner_submission_worker");const claimed=(await notificationBackfillClient.query("SELECT * FROM partner_claim_notification_exact($1,'notification-backfill-gate',30)",[notificationBackfillEvent])).rows[0];const context=(await notificationBackfillClient.query("SELECT * FROM partner_notification_delivery_context($1,$2,$3)",[notificationBackfillEvent,claimed.lease_token,claimed.fence_token])).rows[0];
    assertGate((await notificationBackfillClient.query("SELECT partner_begin_notification_dispatch($1,$2,$3,$4,$5,$6,$7,$8) ok",[notificationBackfillEvent,claimed.lease_token,claimed.fence_token,context.recipient_email,context.company_name,context.legacy_job_id,context.legacy_job_number,`https://insulhub.example.test/jobs/${notificationBackfillLegacyId}`])).rows[0].ok===true,"Pre-019 production dispatch must be fenced");
    assertGate((await notificationBackfillClient.query("SELECT partner_checkpoint_notification_accepted($1,$2,$3,'gmail:backfill_gate') ok",[notificationBackfillEvent,claimed.lease_token,claimed.fence_token])).rows[0].ok===true,"Pre-019 Gmail receipt must checkpoint");assertGate((await notificationBackfillClient.query("SELECT partner_finalize_notification($1,$2,$3,'gmail:backfill_gate') ok",[notificationBackfillEvent,claimed.lease_token,claimed.fence_token])).rows[0].ok===true,"Pre-019 Gmail receipt must finalize");
  }finally{await notificationBackfillClient.query("RESET ROLE").catch(()=>{});notificationBackfillClient.release();}
  const beforeNotificationBackfill=(await pool.query("SELECT state,notification_phase,notification_receipt,attempt_count,notification_dispatch_started_at,notification_accepted_at,delivered_at FROM partner_outbox_events WHERE id=$1",[notificationBackfillEvent])).rows[0];
  assertGate((await migratePartnerOne(pool, "up")).version === "019_partner_branded_notification_details", "Expected branded notification reapply");
  const assertNotificationBackfill=async()=>{const row=(await pool.query("SELECT state,notification_phase,notification_receipt,attempt_count,notification_dispatch_started_at,notification_accepted_at,delivered_at,notification_customer_name,notification_property_street,notification_property_suburb,notification_property_city,notification_property_postcode,notification_quote_total_cents FROM partner_outbox_events WHERE id=$1",[notificationBackfillEvent])).rows[0];
    for(const key of ["state","notification_phase","notification_receipt","attempt_count","notification_dispatch_started_at","notification_accepted_at","delivered_at"])assertGate(String(row[key])===String(beforeNotificationBackfill[key]),`019 must preserve delivered notification ${key}`);
    assertGate(row.notification_customer_name===notificationBackfillSnapshot.job.customer.name&&row.notification_property_street===notificationBackfillSnapshot.job.siteAddress.street&&row.notification_property_suburb===notificationBackfillSnapshot.job.siteAddress.suburb&&row.notification_property_city===notificationBackfillSnapshot.job.siteAddress.city&&row.notification_property_postcode===notificationBackfillSnapshot.job.siteAddress.postcode&&Number(row.notification_quote_total_cents)===115000,"019 must backfill exact immutable submitted details");};
  await assertNotificationBackfill();assertGate((await migratePartnerOne(pool,"down")).version==="019_partner_branded_notification_details","Expected branded detail rollback probe");
  const rolledBackNotification=(await pool.query("SELECT state,notification_phase,notification_receipt,attempt_count,notification_dispatch_started_at,notification_accepted_at,delivered_at FROM partner_outbox_events WHERE id=$1",[notificationBackfillEvent])).rows[0];assertGate(JSON.stringify(Object.fromEntries(Object.keys(beforeNotificationBackfill).map(key=>[key,String(rolledBackNotification[key])])))===JSON.stringify(Object.fromEntries(Object.keys(beforeNotificationBackfill).map(key=>[key,String(beforeNotificationBackfill[key])]))),"019 rollback must preserve delivery identity");
  assertGate((await migratePartnerOne(pool,"up")).version==="019_partner_branded_notification_details","Expected branded detail reapply probe");await assertNotificationBackfill();
  assertGate((await migratePartnerOne(pool,"up")).version==="020_partner_neutral_submission_v2","Expected neutral submission reapply after notification probes");
  assertGate((await migratePartnerOne(pool,"up")).version==="021_partner_immediate_submission","Expected immediate submission reapply after notification probes");
  assertGate((await migratePartnerOne(pool, "up")).version === "022_partner_company_access", "Expected company access reapply");
  assertGate((await migratePartnerOne(pool, "up")).version === "023_partner_note_updates", "Expected partner notes reapply");
  await probePartnerNoteUpdates(pool);
  await assertImmediateSubmissionRoleCatalog(pool);
  await assertSitePlanCompanyLock(pool,true);
  await probePartnerAccountAccess(pool);
  await probePartnerSettingsService(pool);
  await probePartnerCompanyAccess(pool);
  await probePartnerCompanyAccessLockOrder(pool);
  await pool.query(`GRANT partner_portal_runtime,partner_submission_worker,partner_ops_runtime TO ${quoteIdentifier(gateRole)} WITH INHERIT TRUE, SET TRUE`);
  await pool.query(`UPDATE partner_outbox_events SET state='DEAD',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
    WHERE topic='PARTNER_SUBMISSION_EXECUTE' AND state IN('PENDING','FAILED','PROCESSING')`);
  const notificationCrashFixture=await seedReadySubmission(pool,`notify-crash-${randomUUID().slice(0,8)}`);
  const notificationCrashSnapshot=JSON.parse(notificationCrashFixture.canonicalDocument);
  notificationCrashSnapshot.job.leadSources=["E1 Gate"];
  notificationCrashSnapshot.job.quote.consentFeeCents=0;
  notificationCrashSnapshot.job.quote.depositBasisPoints=0;
  notificationCrashFixture.canonicalDocument=canonicalJson(notificationCrashSnapshot);
  const notificationCrashJobId="a".repeat(24);
  await completeFixture(notificationCrashFixture,"notify-crash",9901,notificationCrashJobId);
  assertGate((await pool.query("SELECT recipient_email FROM partner_notification_settings WHERE singleton=true")).rows[0]?.recipient_email==='gate-notify@example.test',"Notification recipient must remain configured through the restricted settings function");
  const crashEvent=(await pool.query("SELECT id FROM partner_outbox_events WHERE company_id=$1 AND job_id=$2 AND topic='PARTNER_SUBMISSION_COMPLETED'",[notificationCrashFixture.companyId,notificationCrashFixture.jobId])).rows[0]?.id;
  assertGate(crashEvent,"Crash-reclaim notification fixture must have one completion event");
  const crashClient=await pool.connect();
  try{
    await crashClient.query("SET ROLE partner_submission_worker");
    const claimed=(await crashClient.query("SELECT * FROM partner_claim_notification_exact($1,'notification-crash-gate',30)",[crashEvent])).rows[0];
    assertGate(claimed?.claim_status==='CLAIMED'&&claimed.notification_phase==='READY',"Exact notification must claim the successful completion event");
    const context=(await crashClient.query("SELECT * FROM partner_notification_delivery_context($1,$2,$3)",[crashEvent,claimed.lease_token,claimed.fence_token])).rows[0];
    assertGate(context?.recipient_email==='gate-notify@example.test'&&context.legacy_job_id===notificationCrashJobId&&context.customer_name===notificationCrashSnapshot.job.customer.name&&Number(context.quote_total_cents)>0,"Notification delivery context must be immutable and lease-bound");
    assertGate((await crashClient.query("SELECT partner_begin_notification_dispatch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ok",[crashEvent,claimed.lease_token,claimed.fence_token,context.recipient_email,context.company_name,context.customer_name,context.property_street,context.property_suburb,context.property_city,context.property_postcode,context.quote_total_cents,context.legacy_job_id,context.legacy_job_number,`https://insulhub.example.test/jobs/${notificationCrashJobId}`])).rows[0].ok===true,"Pre-send fence must commit before external delivery");
    await crashClient.query("RESET ROLE");
    await crashClient.query("UPDATE partner_outbox_events SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[crashEvent]);
    await crashClient.query("SET ROLE partner_submission_worker");
    const reclaimed=(await crashClient.query("SELECT * FROM partner_claim_notification_exact($1,'notification-crash-reclaim',30)",[crashEvent])).rows[0];
    assertGate(reclaimed?.claim_status==='DEAD'&&reclaimed.notification_phase==='SEND_STARTED',"Expired SEND_STARTED work must dead-letter without resend");
    await crashClient.query("RESET ROLE");
    const audit=(await crashClient.query("SELECT metadata->>'errorCode' error_code FROM partner_audit_events WHERE company_id=$1 AND job_id=$2 AND submission_request_id=$3 AND event_type='SUBMISSION_NOTIFICATION_DEAD' ORDER BY occurred_at DESC LIMIT 1",[notificationCrashFixture.companyId,notificationCrashFixture.jobId,notificationCrashFixture.requestId])).rows[0];
    assertGate(audit?.error_code==='AMBIGUOUS_LEGACY_RESULT',"SEND_STARTED crash reclaim must append its bounded terminal audit");
  }finally{await crashClient.query("RESET ROLE").catch(()=>{});crashClient.release();}
  await pool.query(`REVOKE partner_portal_runtime,partner_submission_worker,partner_ops_runtime FROM ${quoteIdentifier(gateRole)}`);
  console.log(`Real PostgreSQL migration gate passed for ${firstUp.versions.join(", ")}: all up, probes, all down, empty checks, all up`);
} finally {
  await pool.end();
}
