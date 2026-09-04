import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverPartnerMigrations, migratePartnerAll, migratePartnerOne, PARTNER_MIGRATION_LOCK_ID, restorePartnerOwnerGrants } from "../../../scripts/partner-migrations.mjs";
import { createPartnerTestDatabase } from "./test-db";

const up = readFileSync(resolve("migrations/partner/001_partner_portal_foundation.up.sql"), "utf8");
const down = readFileSync(resolve("migrations/partner/001_partner_portal_foundation.down.sql"), "utf8");
const draftUp = readFileSync(resolve("migrations/partner/002_partner_lead_drafts.up.sql"), "utf8");
const draftDown = readFileSync(resolve("migrations/partner/002_partner_lead_drafts.down.sql"), "utf8");
const quoteUp = readFileSync(resolve("migrations/partner/003_partner_quote_drafts.up.sql"), "utf8");
const quoteDown = readFileSync(resolve("migrations/partner/003_partner_quote_drafts.down.sql"), "utf8");
const plansUp = readFileSync(resolve("migrations/partner/004_partner_site_plan_artifacts.up.sql"), "utf8");
const plansDown = readFileSync(resolve("migrations/partner/004_partner_site_plan_artifacts.down.sql"), "utf8");
const submissionUp = readFileSync(resolve("migrations/partner/005_partner_submission_saga.up.sql"), "utf8");
const submissionDown = readFileSync(resolve("migrations/partner/005_partner_submission_saga.down.sql"), "utf8");
const workerUp = readFileSync(resolve("migrations/partner/006_partner_submission_worker.up.sql"), "utf8");
const workerDown = readFileSync(resolve("migrations/partner/006_partner_submission_worker.down.sql"), "utf8");
const opsUp = readFileSync(resolve("migrations/partner/007_partner_operations.up.sql"), "utf8");
const opsDown = readFileSync(resolve("migrations/partner/007_partner_operations.down.sql"), "utf8");
const postgresGate = readFileSync(resolve("scripts/partner-postgres-gate.mjs"), "utf8");

describe("partner portal migration", () => {
  it("restores SET-only self-grants exactly and removes only newly added grants", async () => {
    const calls: string[]=[];
    const full={admin_option:false,inherit_option:true,set_option:true};
    const client={query:async(text:string)=>{
      calls.push(text);
      if(text.includes("JOIN pg_auth_members"))return {rows:[
        {rolname:"partner_submission_owner",...full},
        {rolname:"partner_ops_owner",...full},
      ]};
      if(text==="SELECT session_user AS role")return {rows:[{role:'test_migrator'}]};
      if(text.startsWith("SELECT rolname FROM pg_roles"))return {rows:[
        {rolname:"partner_submission_owner"},{rolname:"partner_ops_owner"},
      ]};
      return {rows:[]};
    }};
    await restorePartnerOwnerGrants(client,[{rolname:"partner_submission_owner",admin_option:false,inherit_option:false,set_option:true}]);
    expect(calls).toContain('GRANT "partner_submission_owner" TO "test_migrator" WITH ADMIN false, INHERIT false, SET true GRANTED BY "test_migrator"');
    expect(calls).toContain('REVOKE "partner_ops_owner" FROM "test_migrator" GRANTED BY "test_migrator"');
    expect(calls.filter(call=>call.startsWith("GRANT ")||call.startsWith("REVOKE "))).toHaveLength(2);
  });

  it("pins account access grants, transactional session fences, private link helpers and full rollback coverage",()=>{
    const access=readFileSync(resolve("migrations/partner/012_partner_account_access.up.sql"),"utf8");
    const rollback=readFileSync(resolve("migrations/partner/012_partner_account_access.down.sql"),"utf8");
    const probes=readFileSync(resolve("scripts/partner-account-access-postgres-probes.mjs"),"utf8");
    for(const required of ["GRANT CREATE ON SCHEMA public TO partner_ops_owner","REVOKE CREATE ON SCHEMA public FROM partner_ops_owner",
      "SECURITY DEFINER SET search_path=pg_catalog","u.password_version<>NEW.password_version","WHERE token_hash=target_hash AND l.expires_at>now()"]){
      if(required.includes("WHERE token_hash=")) expect(access).toContain("WHERE l.token_hash=target_hash AND l.expires_at>now()");
      else expect(access).toContain(required);
    }
    expect(access).toContain("REVOKE ALL ON FUNCTION public.partner_access_apply_password");
    expect(access).toContain("REVOKE ALL ON FUNCTION public.partner_access_store_link");
    expect(access).toContain("partner_access.added_owner_membership");
    expect(rollback).toContain("Account access rollback refused");
    for(const required of ["single-use token","all sessions revoked","cross company denied","no temporary password","disable trigger invalidates links"])expect(probes).toContain(required);
    expect(postgresGate).toContain("probePartnerAccountAccess(pool)");
    expect(postgresGate).toContain('version === "012_partner_account_access"');
    expect(postgresGate).toContain("non-superuser migration login");
  });
  it("defines scoped draft deletion, audit support, rollback safety and real-PG privilege probes", () => {
    const deletionUp=readFileSync(resolve("migrations/partner/011_partner_draft_deletion.up.sql"),"utf8");
    const deletionDown=readFileSync(resolve("migrations/partner/011_partner_draft_deletion.down.sql"),"utf8");
    const probes=readFileSync(resolve("scripts/partner-draft-deletion-postgres-probes.mjs"),"utf8");
    for(const required of ["SECURITY DEFINER SET search_path=pg_catalog", "GRANT UPDATE(id) ON public.partner_users TO partner_submission_owner", "CHECK(event_type IN(\'DRAFT_DELETED\'", "AND principal_type=\'PARTNER\' AND disabled_at IS NULL FOR SHARE", "AND submission_checkpoint=\'NONE\'", "partner_deleted_draft_plan_guard", "GRANT EXECUTE ON FUNCTION public.partner_delete_draft"]) expect(deletionUp).toContain(required);
    expect(deletionUp).not.toContain("GRANT UPDATE(deleted_at)");
    expect(deletionDown).toContain("Draft deletion rollback refused");
    expect(deletionDown).toContain("REVOKE UPDATE(id)");
    for(const required of ["SET LOCAL ROLE partner_portal_runtime","DRAFT_DELETED","SUBMISSION_STALE","AND revision=1","SET LOCAL ROLE partner_artifact_owner","ROLLBACK"])expect(probes).toContain(required);
    expect(postgresGate).toContain("probePartnerDraftDeletion(pool, seedReadySubmission)");
  });
  it("locks active companies for floor-plan mutations without granting company updates to the portal", () => {
    const lockUp=readFileSync(resolve("migrations/partner/015_partner_site_plan_company_lock.up.sql"),"utf8");
    const lockDown=readFileSync(resolve("migrations/partner/015_partner_site_plan_company_lock.down.sql"),"utf8");
    for(const required of ["partner_lock_site_plan_company(target_company uuid)","SECURITY DEFINER","SET search_path=pg_catalog","WHERE id=target_company AND is_active=true","FOR UPDATE","OWNER TO partner_artifact_owner","GRANT EXECUTE ON FUNCTION public.partner_lock_site_plan_company(uuid) TO partner_portal_runtime"])expect(lockUp).toContain(required);
    expect(lockUp).not.toMatch(/GRANT UPDATE(?:\([^)]*\))? ON (?:public\.)?partner_companies TO partner_portal_runtime/);
    expect(lockDown).toContain("DROP FUNCTION public.partner_lock_site_plan_company(uuid)");
    expect(postgresGate).toContain("partner_lock_site_plan_company");
  });
  it("adds a fenced, exact and reversible production notification boundary",()=>{
    const notifyUp=readFileSync(resolve("migrations/partner/016_partner_submission_notifications.up.sql"),"utf8");
    const notifyDown=readFileSync(resolve("migrations/partner/016_partner_submission_notifications.down.sql"),"utf8");
    for(const required of ["notification_phase IN('READY','SEND_STARTED','ACCEPTED_PENDING')","partner_begin_notification_dispatch","notification_dispatch_started_at=now()","partner_claim_notification_exact","topic='PARTNER_SUBMISSION_COMPLETED'","partner_notification_delivery_context","partner_notification_test_status","s.recipient_email IS NOT NULL","state=CASE WHEN started OR attempt_count>=5 THEN 'DEAD' ELSE 'FAILED' END","VALUES('SUBMISSION_NOTIFICATION_DEAD',item.company_id,item.job_id,item.request_id","GRANT EXECUTE ON FUNCTION public.partner_settings_notification_get"] )expect(notifyUp).toContain(required);
    expect(notifyUp).not.toMatch(/GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON (?:TABLE )?public\.partner_notification_settings TO partner_(?:portal_runtime|submission_worker|ops_runtime)/);
    const notifyOwnerAccess=readFileSync(resolve("migrations/partner/017_partner_notification_owner_access.up.sql"),"utf8");
    expect(notifyOwnerAccess).toContain("GRANT SELECT ON TABLE public.partner_notification_settings TO partner_submission_owner");
    expect(notifyOwnerAccess).not.toMatch(/TO partner_(?:portal_runtime|submission_worker|ops_runtime)/);
    const notifyDeadAudit=readFileSync(resolve("migrations/partner/018_partner_notification_dead_audit.up.sql"),"utf8");
    expect(notifyDeadAudit).toContain("VALUES('SUBMISSION_NOTIFICATION_DEAD',item.company_id,item.job_id,item.request_id");
    expect(notifyDeadAudit).toContain("CREATE OR REPLACE FUNCTION public.partner_claim_notification_exact");
    expect(notifyDown).toContain("rollback refused: clear configured recipient and delivery history first");
    expect(notifyDown).toContain("DROP TABLE public.partner_notification_settings");
    const branded=readFileSync(resolve("migrations/partner/019_partner_branded_notification_details.up.sql"),"utf8");
    const brandedDown=readFileSync(resolve("migrations/partner/019_partner_branded_notification_details.down.sql"),"utf8");
    for(const required of ["snapshot.snapshot_data#>>'{job,customer,name}'","notification_customer_name","notification_quote_total_cents","delivery in progress","partner_begin_notification_dispatch(uuid,uuid,bigint,text,text,text,text,text,text,text,bigint,text,bigint,text)"])expect(branded).toContain(required);
    expect(brandedDown).toContain("rollback refused: delivery in progress");expect(brandedDown).toContain("partner_begin_notification_dispatch(uuid,uuid,bigint,text,text,text,bigint,text)");
    for(const required of ["notificationBackfillFixture","gmail:backfill_gate","019 must preserve delivered notification","019 must backfill exact immutable submitted details","019 rollback must preserve delivery identity"])expect(postgresGate).toContain(required);
  });
  it("defines a reversible E4 bounded worker and notification boundary", () => {
    for (const signature of [
      "partner_claim_submission_bounded(text,integer)",
      "partner_begin_plan_upload(uuid,uuid,uuid,uuid,bigint,integer)",
      "partner_begin_attachment(uuid,uuid,uuid,uuid,bigint)",
      "partner_finalize_submission_verified(uuid,uuid,uuid,uuid,bigint,integer)",
      "partner_claim_notification(text,integer)",
      "partner_finalize_notification(uuid,uuid,bigint,text)",
    ]) {
      expect(workerUp).toContain(signature);
      expect(workerDown).toContain(`DROP FUNCTION public.${signature}`);
    }
    expect(workerUp).toContain("LEFT JOIN public.partner_submission_plan_deliveries");
    expect(workerUp).toContain("delivery_count=manifest_count AND artifact_count=manifest_count AND valid_count=manifest_count");
    expect(workerUp).not.toContain("canonical_document::jsonb");
    expect(workerUp).toContain("notification_backfilled=true");
    expect(workerUp).toContain("claim_status text,queue_age_bucket text,reclaimed_lease boolean");
    expect(workerUp).toContain("SUBMISSION_EXECUTE_DISCARDED");
    expect(workerUp).toContain("FOR UPDATE OF o SKIP LOCKED LIMIT 1");
    expect(workerUp).toContain("partner_submission_delivery_remote_key_unique");
    expect(workerUp).toContain("count(DISTINCT remote_storage_key) FROM public.partner_submission_plan_deliveries");
    expect(workerUp).toContain("drawing.submitted_pdf_storage_key IS DISTINCT FROM d.remote_storage_key");
    expect(workerUp).toContain("claim_status:='RECONCILED'");
    expect(workerDown).toContain("notification_backfilled=true AND notification_phase='READY'");
    expect(workerDown).toContain("E4 submission work exists");
    expect(workerDown).toContain("MALFORMED_FROZEN_STATE','NOTIFICATION_REJECTED");
    expect(workerDown).toContain("SELECT value IN ('LEASE_EXPIRED','NETWORK_ERROR','PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE','PROVIDER_REJECTED','UPLOAD_FAILED','ATTACH_FAILED','CREDENTIAL_ROTATED','AMBIGUOUS_LEGACY_RESULT','SUBMISSION_LEASE_LOST')");
    expect(postgresGate).toContain("006_partner_submission_worker");
    expect(postgresGate).toContain("partner_claim_submission_bounded");
    expect(postgresGate).toContain("partner_checkpoint_quote_verified");
    expect(postgresGate).toContain("partner_finalize_submission_verified");
    expect(postgresGate).not.toContain("SELECT * FROM partner_claim_submission($1,30)");
  });
  it("defines and reverses the E1 immutable saga and narrow authority", () => {
    for (const table of ["partner_submission_snapshots", "partner_submission_plan_manifest", "partner_submission_requests", "partner_submission_plan_deliveries", "partner_submission_rate_limits"]) {
      expect(submissionUp).toContain(`CREATE TABLE public.${table}`);
      expect(submissionDown).toContain(`DROP TABLE public.${table}`);
    }
    expect(submissionUp).toContain("SECURITY DEFINER SET search_path=pg_catalog");
    expect(submissionUp).not.toContain("PARTNER_INTERNAL_LEAD_CREATED");
    expect(submissionUp).toContain("PARTNER_SUBMISSION_COMPLETED");
    expect(submissionUp).toContain("substring(artifact_row.pdf_bytes FROM 1 FOR 5)");
    expect(submissionUp).toContain("partner_submission_guard_audit");
    expect(submissionUp).toContain("target_canonical_document := snapshot_value::text");
    expect(submissionUp).toContain("partner_submission_request_id(target_company,target_job,target_idempotency_hash)");
    expect(submissionUp).toContain("target_request_id IS DISTINCT FROM public.partner_submission_request_id");
    expect(submissionDown).toContain("DROP FUNCTION public.partner_submission_request_id(uuid,uuid,text)");
    expect(submissionUp).toContain("partner_consume_submission_rate_limit");
    expect(submissionUp).toContain("ALTER FUNCTION public.partner_freeze_submission(uuid,uuid,text,integer,integer,uuid,uuid,text,text,jsonb) OWNER TO partner_submission_owner");
    expect(submissionDown).toContain("DROP FUNCTION public.partner_freeze_submission(uuid,uuid,text,integer,integer,uuid,uuid,text,text,jsonb)");
    expect(submissionUp).toContain("partner_submission_worker NOLOGIN NOINHERIT");
    expect(submissionUp).toContain("legacy_job_prefix text,checkpoint text");
    expect(submissionUp).toContain("legacy_credential_fingerprint text,legacy_credential_updated_at timestamptz");
    expect(submissionUp).toContain("CASE WHEN s.adapter_mode='LIVE' THEN s.legacy_credential_fingerprint::text ELSE NULL END");
    expect(submissionUp).not.toContain("GRANT SELECT ON public.partner_submission_requests TO partner_portal_runtime");
    expect(submissionDown).toContain("rollback refused");
    expect(submissionDown).toContain("DROP FUNCTION public.partner_submission_guard_audit_insert()");
  });

  it("contains the full versioned foundation and security invariants", () => {
    for (const table of [
      "partner_companies", "partner_users", "partner_sessions", "partner_jobs", "partner_site_plan_drawings",
      "partner_submission_attempts", "partner_tracking_facts", "partner_job_settlements", "partner_job_amendments", "partner_outbox_events", "partner_audit_events",
    ]) {
      expect(up).toContain(`CREATE TABLE ${table}`);
      expect(down).toContain(`DROP TABLE IF EXISTS ${table}`);
    }
    expect(up).toContain("partner_users_membership");
    expect(up).toContain("partner_users_email_lowercase");
    expect(up).toContain("partner_jobs_company_reference_unique");
    expect(up).toContain("partner_submission_idempotency_unique");
    expect(up).toContain("partner_submission_phase");
    expect(up).toContain("'AMBIGUOUS', 'RECONCILIATION_REQUIRED'");
    expect(up).toContain("partner_jobs_creator_membership_fk");
    expect(up).toContain("partner_site_plan_creator_membership_fk");
    expect(up).toContain("partner_job_amendments_append_only");
    expect(up).toContain("partner_audit_events_append_only");
    expect(up).toContain("partner_tracking_facts_append_only");
    expect(up).toContain("legacy_credential_key_version > 0");
    expect(up).toMatch(/quote_total_cents IS NULL OR quote_total_cents >= 0/);
    expect(up).toContain("revision >= 0");
    expect(up).toContain("submission_started_at timestamptz");
    expect(up).toContain("submitted_pdf_outbox_event_id uuid");
    expect(up).toContain("partner_settlement_calculation");
    expect(up).toContain("pg_column_size(metadata) <= 16384");
    expect(up).toContain("name varchar(120)");
    expect(up).toContain("reason varchar(1000)");
    expect(up).toContain("topic varchar(200)");
    expect(up).toContain("legacy_job_id varchar(120)");
  });

  it("applies and rolls back the portable schema path", () => {
    const { db, rollback } = createPartnerTestDatabase();
    expect(db.public.getTable("partner_jobs")).toBeDefined();
    expect(db.public.getTable("partner_sessions")).toBeDefined();
    expect(db.public.getTable("partner_submission_snapshots")).toBeDefined();
    expect(db.public.getTable("partner_submission_rate_limits")).toBeDefined();
    rollback();
    expect(() => db.public.getTable("partner_jobs")).toThrow();
    expect(() => db.public.getTable("partner_sessions")).toThrow();
  });

  it("enforces user membership, enums and nonnegative money", async () => {
    const { Pool } = createPartnerTestDatabase();
    const pool = new Pool();
    const company = await pool.query("INSERT INTO partner_companies (slug, name, billing_model) VALUES ('pilot', 'Pilot', 'INSULHUB_BILLED') RETURNING id");
    const companyId = company.rows[0].id;
    await expect(pool.query("INSERT INTO partner_users (id, company_id, principal_type, name, email) VALUES ('bad', NULL, 'PARTNER', 'Bad', 'bad@example.test')")).rejects.toThrow();
    await pool.query("INSERT INTO partner_users (id, company_id, principal_type, name, email) VALUES ('user-1', $1, 'PARTNER', 'User', 'user@example.test')", [companyId]);
    await expect(pool.query("INSERT INTO partner_users (id, company_id, principal_type, name, email) VALUES ('upper', $1, 'PARTNER', 'Upper', 'Upper@Example.Test')", [companyId])).rejects.toThrow();
    await expect(pool.query("INSERT INTO partner_jobs (company_id, created_by_user_id, client_reference, billing_model_snapshot, quote_total_cents) VALUES ($1, 'user-1', 'bad-money', 'INSULHUB_BILLED', -1)", [companyId])).rejects.toThrow();
    await expect(pool.query("INSERT INTO partner_jobs (company_id, created_by_user_id, client_reference, billing_model_snapshot, submission_state) VALUES ($1, 'user-1', 'missing-submit-time', 'INSULHUB_BILLED', 'SUBMITTED')", [companyId])).rejects.toThrow();
    const jobId = (await pool.query("INSERT INTO partner_jobs (company_id, created_by_user_id, client_reference, billing_model_snapshot, submission_state, submission_started_at) VALUES ($1, 'user-1', 'retryable', 'INSULHUB_BILLED', 'FAILED_RETRYABLE', now()) RETURNING id", [companyId])).rows[0].id;
    await expect(pool.query(`INSERT INTO partner_submission_attempts
      (company_id, job_id, attempt_number, idempotency_key, phase, outcome, started_at, finished_at)
      VALUES ($1, $2, 1, 'attempt-1', 'CREATING_LEAD', 'AMBIGUOUS', now(), now())`, [companyId, jobId])).rejects.toThrow();
    await expect(pool.query(`INSERT INTO partner_job_settlements
      (company_id, job_id, billing_model_snapshot, gross_cents, manual_commission_cents, net_due_cents, created_by_user_id)
      VALUES ($1, $2, 'INSULHUB_BILLED', 1000, 200, -1, 'user-1')`, [companyId, jobId])).rejects.toThrow();
    await pool.query(`INSERT INTO partner_job_settlements
      (company_id, job_id, billing_model_snapshot, gross_cents, manual_commission_cents, net_due_cents, created_by_user_id)
      VALUES ($1, $2, 'INSULHUB_BILLED', 1000, 200, 200, 'user-1')`, [companyId, jobId]);
    await expect(pool.query("INSERT INTO partner_tracking_facts (company_id, job_id, fact_type, value_type, value, source, effective_at) VALUES ($1, $2, 'INSTALL_DATE_SET', 'DATE', $3::jsonb, 'LOCAL_INTERNAL', now())", [companyId, jobId, JSON.stringify("2026-09-01")])).rejects.toThrow();
    await expect(pool.query("INSERT INTO partner_jobs (company_id, created_by_user_id, client_reference, billing_model_snapshot) VALUES ($1, 'user-1', $2, 'INSULHUB_BILLED')", [companyId, "x".repeat(121)])).rejects.toThrow();
    await pool.end();
  });

  it("enforces fact-specific DATE and BOOLEAN tracking shapes", async () => {
    const { Pool } = createPartnerTestDatabase();
    const pool = new Pool();
    const companyId = (await pool.query("INSERT INTO partner_companies (slug, name, billing_model) VALUES ('facts', 'Facts', 'INSULHUB_BILLED') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO partner_users (id, company_id, principal_type, name, email) VALUES ('facts-user', $1, 'PARTNER', 'User', 'facts@example.test')", [companyId]);
    const jobId = (await pool.query("INSERT INTO partner_jobs (company_id, created_by_user_id, client_reference, billing_model_snapshot) VALUES ($1, 'facts-user', 'facts-job', 'INSULHUB_BILLED') RETURNING id", [companyId])).rows[0].id;

    await expect(pool.query(`INSERT INTO partner_tracking_facts
      (company_id, job_id, fact_type, value_type, value, source, install_date)
      VALUES ($1, $2, 'INSTALL_DATE_SET', 'DATE', NULL, 'LOCAL_INTERNAL', '2026-09-01')`, [companyId, jobId])).resolves.toBeDefined();

    for (const factType of ["EBA_COMPLETED", "JOB_COMPLETED", "INVOICE_SENT", "COMMISSION_PAID", "REMITTANCE_RECEIVED", "CANCELLED"]) {
      await expect(pool.query(`INSERT INTO partner_tracking_facts
        (company_id, job_id, fact_type, value_type, value, source, effective_at)
        VALUES ($1, $2, $3, 'BOOLEAN', 'true'::jsonb, 'LOCAL_INTERNAL', now())`, [companyId, jobId, factType])).resolves.toBeDefined();
    }

    await expect(pool.query(`INSERT INTO partner_tracking_facts
      (company_id, job_id, fact_type, value_type, value, source, install_date)
      VALUES ($1, $2, 'INSTALL_DATE_SET', 'DATE', '"unrelated"'::jsonb, 'LOCAL_INTERNAL', '2026-09-02')`, [companyId, jobId])).rejects.toThrow();
    await expect(pool.query(`INSERT INTO partner_tracking_facts
      (company_id, job_id, fact_type, value_type, value, source, install_date, effective_at)
      VALUES ($1, $2, 'INSTALL_DATE_SET', 'DATE', NULL, 'LOCAL_INTERNAL', '2026-09-02', now())`, [companyId, jobId])).rejects.toThrow();
    await expect(pool.query(`INSERT INTO partner_tracking_facts
      (company_id, job_id, fact_type, value_type, value, source)
      VALUES ($1, $2, 'INSTALL_DATE_SET', 'DATE', NULL, 'LOCAL_INTERNAL')`, [companyId, jobId])).rejects.toThrow();
    await expect(pool.query(`INSERT INTO partner_tracking_facts
      (company_id, job_id, fact_type, value_type, value, source, install_date)
      VALUES ($1, $2, 'INSTALL_DATE_SET', 'BOOLEAN', 'true'::jsonb, 'LOCAL_INTERNAL', '2026-09-02')`, [companyId, jobId])).rejects.toThrow();
    await expect(pool.query(`INSERT INTO partner_tracking_facts
      (company_id, job_id, fact_type, value_type, value, source, effective_at, install_date)
      VALUES ($1, $2, 'JOB_COMPLETED', 'BOOLEAN', 'true'::jsonb, 'LOCAL_INTERNAL', now(), '2026-09-02')`, [companyId, jobId])).rejects.toThrow();
    await expect(pool.query(`INSERT INTO partner_tracking_facts
      (company_id, job_id, fact_type, value_type, value, source, effective_at)
      VALUES ($1, $2, 'EBA_COMPLETED', 'DATE', NULL, 'LOCAL_INTERNAL', now())`, [companyId, jobId])).rejects.toThrow();
    await expect(pool.query(`INSERT INTO partner_tracking_facts
      (company_id, job_id, fact_type, value_type, value, source)
      VALUES ($1, $2, 'INVOICE_SENT', 'BOOLEAN', 'true'::jsonb, 'LOCAL_INTERNAL')`, [companyId, jobId])).rejects.toThrow();
    await expect(pool.query(`INSERT INTO partner_tracking_facts
      (company_id, job_id, fact_type, value_type, value, source, effective_at)
      VALUES ($1, $2, 'CANCELLED', 'BOOLEAN', 'false'::jsonb, 'LOCAL_INTERNAL', now())`, [companyId, jobId])).rejects.toThrow();
    await pool.end();
  });

  it("enforces bounded, nonblank drawing and durable-delivery text", async () => {
    const { Pool } = createPartnerTestDatabase();
    const pool = new Pool();
    const companyId = (await pool.query("INSERT INTO partner_companies (slug, name, billing_model) VALUES ('bounds', 'Bounds', 'INSULHUB_BILLED') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO partner_users (id, company_id, principal_type, name, email) VALUES ('bounds-user', $1, 'PARTNER', 'User', 'bounds@example.test')", [companyId]);
    const jobId = (await pool.query("INSERT INTO partner_jobs (company_id, created_by_user_id, client_reference, billing_model_snapshot) VALUES ($1, 'bounds-user', 'bounds-job', 'INSULHUB_BILLED') RETURNING id", [companyId])).rows[0].id;
    await expect(pool.query("INSERT INTO partner_site_plan_drawings (company_id, job_id, name, created_by_user_id) VALUES ($1, $2, '   ', 'bounds-user')", [companyId, jobId])).rejects.toThrow();
    await expect(pool.query("INSERT INTO partner_site_plan_drawings (company_id, job_id, name, created_by_user_id) VALUES ($1, $2, ' padded ', 'bounds-user')", [companyId, jobId])).rejects.toThrow();
    await expect(pool.query("INSERT INTO partner_site_plan_drawings (company_id, job_id, name, created_by_user_id) VALUES ($1, $2, $3, 'bounds-user')", [companyId, jobId, "x".repeat(121)])).rejects.toThrow();
    await expect(pool.query("INSERT INTO partner_job_amendments (company_id, job_id, sequence, reason, patch, created_by_user_id) VALUES ($1, $2, 1, '   ', '{}'::jsonb, 'bounds-user')", [companyId, jobId])).rejects.toThrow();
    await expect(pool.query("INSERT INTO partner_outbox_events (company_id, job_id, topic, idempotency_key, payload) VALUES ($1, $2, '   ', 'bounds-1', '{}'::jsonb)", [companyId, jobId])).rejects.toThrow();
    await pool.end();
  });

  it("discovers complete numbered migrations in deterministic order", () => {
    expect(discoverPartnerMigrations([
      "010_second.down.sql", "001_first.up.sql", "010_second.up.sql", "README.md", "001_first.down.sql",
    ]).map((migration) => migration.version)).toEqual(["001_first", "010_second"]);
    expect(() => discoverPartnerMigrations(["001_incomplete.up.sql"])).toThrow("both up and down");
    expect(PARTNER_MIGRATION_LOCK_ID).toBeTypeOf("number");
  });

  it("adds reversible bounded lead-draft fields without rewriting the foundation migration", () => {
    for (const field of ["customer_mobile varchar(40)", "customer_email varchar(254)", "lead_sources jsonb", "notes varchar(4000)"]) {
      expect(draftUp).toContain(field);
    }
    expect(draftUp).toContain("partner_jobs_site_address_size");
    expect(draftUp).toContain("partner_jobs_lead_sources_array");
    for (const field of ["notes", "lead_sources", "customer_email", "customer_mobile"]) {
      expect(draftDown).toContain(`DROP COLUMN IF EXISTS ${field}`);
    }
  });

  it("adds reversible nullable company quote defaults and immutable per-job snapshots", () => {
    for (const field of ["quote_default_wall_rate_cents", "quote_default_ceiling_rate_cents", "quote_default_deposit_basis_points", "quote_default_consent_fee_cents", "quote_default_extras", "quote_defaults_revision"]) expect(quoteUp).toContain(field);
    expect(quoteUp).toContain("quote_data jsonb");
    expect(quoteUp).toContain("quote_defaults_snapshot jsonb");
    expect(quoteUp).toContain("partner_jobs_quote_initialization_complete");
    expect(quoteUp).toContain("BETWEEN 0 AND 10000");
    expect(quoteUp).toContain("partner_quote_extras_valid");
    expect(quoteUp).toContain("BETWEEN 1 AND 10000000");
    for (const field of ["quote_data", "quote_defaults_snapshot", "quote_default_wall_rate_cents"]) expect(quoteDown).toContain(`DROP COLUMN IF EXISTS ${field}`);
  });

  it("adds the reversible strict floor-plan and immutable PDF artifact schema", () => {
    expect(plansUp).toContain("partner_site_plan_document_valid");
    expect(plansUp).toContain("octet_length(value::text)>262144");
    expect(plansUp).toContain("floor_plan_revision integer NOT NULL DEFAULT 0");
    expect(plansUp).toContain("partner_site_plan_order_unique UNIQUE (company_id, job_id, sort_order) DEFERRABLE");
    expect(plansUp).toContain("CREATE TABLE partner_site_plan_pdf_artifacts");
    expect(plansUp).toContain("byte_size = octet_length(pdf_bytes)");
    expect(plansUp).toContain("partner_pdf_artifact_immutable");
    expect(plansUp).toContain("SECURITY DEFINER");
    expect(plansUp.match(/SECURITY DEFINER\s+SET search_path ?= ?pg_catalog/g)).toHaveLength(3);
    expect(plansUp).toContain("public.digest(target_pdf,'sha256')");
    expect(plansUp).toContain("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public");
    expect(plansUp).toContain("GRANT EXECUTE ON FUNCTION public.digest(bytea,text) TO partner_artifact_owner");
    expect(plansUp).toContain("partner_artifact_owner NOLOGIN");
    expect(plansUp).toContain("partner_portal_runtime NOLOGIN");
    expect(plansUp).toContain("ALTER ROLE partner_artifact_owner NOLOGIN NOINHERIT");
    expect(plansUp).toContain("ALTER ROLE partner_portal_runtime NOLOGIN NOINHERIT");
    expect(plansUp).toContain("partner_publish_site_plan_pdf_artifact");
    expect(plansUp).toContain("partner_purge_draft_site_plan_drawing");
    expect(plansUp).toContain("REVOKE INSERT,UPDATE,DELETE,TRUNCATE");
    expect(plansUp).toContain("duplicate_name_groups");
    expect(plansUp).toContain("invalid_order_jobs");
    expect(plansUp).toContain("c.running_bytes - c.byte_size < quota_bytes - 1073741824");
    expect(plansUp).toContain("partner_site_plan_d1_legacy_backup");
    const preflightOnly=plansUp.slice(0,plansUp.indexOf("UPDATE partner_site_plan_drawings\nSET drawing_data"));
    expect(preflightOnly).not.toMatch(/UPDATE partner_site_plan_drawings\s+SET\s+(?:name|sort_order)/i);
    expect(plansUp).toContain("GRANT INSERT(company_id,job_id,name,sort_order,drawing_data,created_by_user_id)");
    expect(plansUp).toContain("GRANT UPDATE(name,sort_order,drawing_data,revision,updated_at)");
    expect(plansUp).toContain("REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON partner_site_plan_drawings");
    expect(plansUp).toContain("UPDATE(id,company_id,job_id,created_by_user_id,current_pdf_artifact_id");
    expect(plansUp).not.toContain("GRANT SELECT,INSERT,UPDATE ON partner_site_plan_drawings");
    expect(plansUp).toContain("SET CONSTRAINTS public.partner_site_plan_order_unique DEFERRED");
    expect(plansUp).not.toMatch(/SET CONSTRAINTS partner_site_plan_order_unique DEFERRED/);
    expect(plansUp).toContain("RETURN NEXT");
    expect(plansDown).toContain("DROP TABLE IF EXISTS partner_site_plan_pdf_artifacts");
    expect(plansDown).toContain("ADD COLUMN floor_index");
    expect(plansDown).toContain("drawing_data=CASE WHEN b.drawing_data_was_empty THEN '{}'::jsonb");
    expect(plansDown).toContain("REVOKE SELECT,INSERT,UPDATE,DELETE ON partner_jobs FROM partner_portal_runtime");
    expect(plansDown).toContain("REVOKE USAGE ON SCHEMA public FROM partner_artifact_owner,partner_portal_runtime");
  });

  it("keeps the real-PostgreSQL D1 gate destructive, role-scoped and complete", () => {
    expect(postgresGate).toContain("PARTNER_MIGRATION_TEST_DATABASE_URL");
    expect(postgresGate).toContain("duplicate_name_groups=1");
    expect(postgresGate).toContain("invalid_order_jobs=1");
    expect(postgresGate).toContain("SET ROLE partner_portal_runtime");
    expect(postgresGate).toContain("runtime_artifact_insert");
    expect(postgresGate).toContain("runtime_artifact_update");
    expect(postgresGate).toContain("runtime_artifact_delete");
    expect(postgresGate).toContain("runtime_drawing_delete");
    expect(postgresGate).toContain("runtime_pointer_clear");
    expect(postgresGate).toContain("runtime_pointer_set");
    expect(postgresGate).toContain("Runtime drawing privileges must be column-scoped away from the PDF pointer");
    expect(postgresGate).toContain("Scoped purge must verify the empty-order branch");
    expect(postgresGate).toContain("running_bytes - c.byte_size < quota_bytes - 1073741824");
    expect(postgresGate).toContain("partner_site_plan_d1_legacy_backup");
    expect(postgresGate).toContain("D1 down must restore legacy floor_index and exact empty document semantics");
    expect(postgresGate).toContain("Ten concurrent freezes must converge on one authoritative request");
    expect(postgresGate).toContain("Two workers must not claim the same execute event");
    expect(postgresGate).toContain("Stale fences and unknown error codes must be rejected without mutation");
    expect(postgresGate).toContain("E4 down must fail closed once worker-v2 submission work exists");
  });

  it("keeps pg-mem's D1 document check in canonical parser parity", async () => {
    const { Pool } = createPartnerTestDatabase(); const pool = new Pool();
    const companyId = (await pool.query("INSERT INTO partner_companies(slug,name,billing_model) VALUES('document-parity','Parity','INSULHUB_BILLED') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO partner_users(id,company_id,principal_type,name,email) VALUES('parity-user',$1,'PARTNER','Parity','parity@test')", [companyId]);
    const jobId = (await pool.query("INSERT INTO partner_jobs(company_id,created_by_user_id,client_reference,billing_model_snapshot) VALUES($1,'parity-user','parity','INSULHUB_BILLED') RETURNING id", [companyId])).rows[0].id;
    const valid = { schemaVersion: 1, templateVersion: "site-plan-template-v2", walls: [{ id: "wall-1", start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, style: "solid" }], textNotes: [{ id: "note-1", text: "Kia ora\nTāmaki", x: 1, y: 1, fontSize: 0.5 }], showDimensions: true };
    await expect(pool.query("INSERT INTO partner_site_plan_drawings(company_id,job_id,name,sort_order,drawing_data,created_by_user_id) VALUES($1,$2,'Valid',0,$3::jsonb,'parity-user')", [companyId, jobId, JSON.stringify(valid)])).resolves.toBeDefined();
    const malformed = { ...valid, walls: [{ ...valid.walls[0], start: { x: 0, y: 0, z: 1 } }] };
    await expect(pool.query("INSERT INTO partner_site_plan_drawings(company_id,job_id,name,sort_order,drawing_data,created_by_user_id) VALUES($1,$2,'Malformed',1,$3::jsonb,'parity-user')", [companyId, jobId, JSON.stringify(malformed)])).rejects.toThrow();
    const nonCanonical = { ...valid, textNotes: [{ ...valid.textNotes[0], text: "Ta\u0304maki" }] };
    await expect(pool.query("INSERT INTO partner_site_plan_drawings(company_id,job_id,name,sort_order,drawing_data,created_by_user_id) VALUES($1,$2,'Noncanonical',1,$3::jsonb,'parity-user')", [companyId, jobId, JSON.stringify(nonCanonical)])).rejects.toThrow();
    await pool.end();
  });

  it("enforces quote-default money, JSON and initialization invariants", async () => {
    const { Pool } = createPartnerTestDatabase(); const pool = new Pool();
    await expect(pool.query("INSERT INTO partner_companies (slug, name, billing_model, quote_default_wall_rate_cents) VALUES ('bad-rate', 'Bad', 'INSULHUB_BILLED', 0)")).rejects.toThrow();
    await expect(pool.query("INSERT INTO partner_companies (slug, name, billing_model, quote_default_wall_rate_cents) VALUES ('huge-rate', 'Bad', 'INSULHUB_BILLED', 10000001)")).rejects.toThrow();
    await expect(pool.query("INSERT INTO partner_companies (slug, name, billing_model, quote_default_deposit_basis_points) VALUES ('bad-deposit', 'Bad', 'INSULHUB_BILLED', 10001)")).rejects.toThrow();
    await expect(pool.query("INSERT INTO partner_companies (slug, name, billing_model, quote_default_consent_fee_cents) VALUES ('huge-consent', 'Bad', 'INSULHUB_BILLED', 1000000001)")).rejects.toThrow();
    await expect(pool.query("INSERT INTO partner_companies (slug, name, billing_model, quote_default_extras) VALUES ('bad-extra', 'Bad', 'INSULHUB_BILLED', $1::jsonb)", [JSON.stringify([{ id: "x", name: "", priceCents: 0 }])])).rejects.toThrow();
    await expect(pool.query("INSERT INTO partner_companies (slug, name, billing_model, quote_default_extras) VALUES ('duplicate-extra', 'Bad', 'INSULHUB_BILLED', $1::jsonb)", [JSON.stringify([{ id: "x", name: "One", priceCents: 0 }, { id: "x", name: "Two", priceCents: 0 }])])).rejects.toThrow();
    const companyId = (await pool.query("INSERT INTO partner_companies (slug, name, billing_model) VALUES ('quote-ok', 'Quote', 'INSULHUB_BILLED') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO partner_users (id, company_id, principal_type, name, email) VALUES ('quote-user', $1, 'PARTNER', 'User', 'quote@test')", [companyId]);
    await expect(pool.query("INSERT INTO partner_jobs (company_id, created_by_user_id, client_reference, billing_model_snapshot, quote_data) VALUES ($1, 'quote-user', 'partial', 'INSULHUB_BILLED', '{}'::jsonb)", [companyId])).rejects.toThrow();
    await pool.end();
  });

  it("serializes and transactionally applies exactly one discovered version", async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const client = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        if (text === "SELECT session_user AS role") return { rows: [{role:"test_migrator"}], rowCount: 1 };
        if (text.startsWith("SELECT version")) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client };
    await expect(migratePartnerOne(pool, "up")).resolves.toEqual({ changed: true, direction: "up", version: "001_partner_portal_foundation" });
    expect(calls[0]).toEqual({ text: "SELECT pg_advisory_lock($1)", values: [PARTNER_MIGRATION_LOCK_ID] });
    expect(calls.some((call) => call.text === "BEGIN")).toBe(true);
    expect(calls.some((call) => call.text.includes("CREATE TABLE partner_companies"))).toBe(true);
    expect(calls.some((call) => call.text.startsWith("INSERT INTO partner_schema_migrations"))).toBe(true);
    expect(calls.some((call) => call.text === "COMMIT")).toBe(true);
    expect(calls.at(-1)).toEqual({ text: "SELECT pg_advisory_unlock($1)", values: [PARTNER_MIGRATION_LOCK_ID] });
  });

  it("applies and reverts all numbered versions until exhausted", async () => {
    const applied = new Set<string>();
    const client = {
      query: async (text: string, values?: unknown[]) => {
        if (text.startsWith("SELECT version")) return { rows: [...applied].map((version) => ({ version })), rowCount: applied.size };
        if (text === "SELECT session_user AS role") return { rows: [{role:"test_migrator"}], rowCount: 1 };
        if (text.startsWith("INSERT INTO partner_schema_migrations")) applied.add(String(values?.[0]));
        if (text.startsWith("DELETE FROM partner_schema_migrations")) applied.delete(String(values?.[0]));
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client };
await expect(migratePartnerAll(pool, "up")).resolves.toEqual({ changed: true, direction: "up", versions: ["001_partner_portal_foundation", "002_partner_lead_drafts", "003_partner_quote_drafts", "004_partner_site_plan_artifacts", "005_partner_submission_saga", "006_partner_submission_worker", "007_partner_operations", "008_partner_quote_policy", "009_partner_draft_creation", "010_partner_settings_service", "011_partner_draft_deletion", "012_partner_account_access", "013_partner_manual_links", "014_partner_live_transfer", "015_partner_site_plan_company_lock", "016_partner_submission_notifications", "017_partner_notification_owner_access", "018_partner_notification_dead_audit", "019_partner_branded_notification_details", "020_partner_neutral_submission_v2", "021_partner_immediate_submission", "022_partner_company_access", "023_partner_note_updates"] });
    expect([...applied]).toEqual(["001_partner_portal_foundation", "002_partner_lead_drafts", "003_partner_quote_drafts", "004_partner_site_plan_artifacts", "005_partner_submission_saga", "006_partner_submission_worker", "007_partner_operations", "008_partner_quote_policy", "009_partner_draft_creation", "010_partner_settings_service", "011_partner_draft_deletion", "012_partner_account_access", "013_partner_manual_links", "014_partner_live_transfer", "015_partner_site_plan_company_lock", "016_partner_submission_notifications", "017_partner_notification_owner_access", "018_partner_notification_dead_audit", "019_partner_branded_notification_details", "020_partner_neutral_submission_v2", "021_partner_immediate_submission", "022_partner_company_access", "023_partner_note_updates"]);
    await expect(migratePartnerAll(pool, "down")).resolves.toEqual({ changed: true, direction: "down", versions: ["023_partner_note_updates", "022_partner_company_access", "021_partner_immediate_submission", "020_partner_neutral_submission_v2", "019_partner_branded_notification_details", "018_partner_notification_dead_audit", "017_partner_notification_owner_access", "016_partner_submission_notifications", "015_partner_site_plan_company_lock", "014_partner_live_transfer", "013_partner_manual_links", "012_partner_account_access", "011_partner_draft_deletion", "010_partner_settings_service", "009_partner_draft_creation", "008_partner_quote_policy", "007_partner_operations", "006_partner_submission_worker", "005_partner_submission_saga", "004_partner_site_plan_artifacts", "003_partner_quote_drafts", "002_partner_lead_drafts", "001_partner_portal_foundation"] });
    expect([...applied]).toEqual([]);
  });

  it("keeps the partner-ops SECURITY DEFINER signatures exact", () => {
    expect(opsUp).toContain("CREATE OR REPLACE FUNCTION public.partner_ops_authorize(actor text, required text)");
    expect(opsUp).toContain("ALTER FUNCTION public.partner_ops_authorize(text,text) OWNER TO partner_ops_owner");
    expect(opsUp).toContain("REVOKE ALL ON FUNCTION public.partner_ops_authorize(text,text)");
    expect(opsDown).toContain("DROP FUNCTION IF EXISTS public.partner_ops_authorize(text,text)");
    expect(opsUp).toContain("partner_partner_tracking_projection(actor text,target_company uuid,target_job uuid)");
    expect(opsUp).toContain("partner_ops_partner_user_create(actor text,target_company uuid,target_id text,target_name text,target_email text,target_password_hash text)");
  });

  it("makes the one-shot live production test claim exact and atomic",()=>{
    const liveUp=readFileSync(resolve("migrations/partner/014_partner_live_transfer.up.sql"),"utf8");
    const liveDown=readFileSync(resolve("migrations/partner/014_partner_live_transfer.down.sql"),"utf8");
    for(const required of ["partner_claim_live_test_request(target_request uuid,target_worker text","LOCK TABLE public.partner_outbox_events IN SHARE ROW EXCLUSIVE MODE","LOCK TABLE public.partner_legacy_create_dispatches IN SHARE ROW EXCLUSIVE MODE","request_id IS DISTINCT FROM target_request","LIVE_TEST_CLAIM_MISMATCH","GRANT EXECUTE ON FUNCTION public.partner_begin_legacy_create_dispatch"])
      expect(liveUp).toContain(required);
    expect(liveDown).toContain("DROP FUNCTION IF EXISTS public.partner_claim_live_test_request(uuid,text,integer)");
  });

  it("allows immediate processing to claim only the newly frozen request",()=>{
    const immediateUp=readFileSync(resolve("migrations/partner/021_partner_immediate_submission.up.sql"),"utf8");
    const immediateDown=readFileSync(resolve("migrations/partner/021_partner_immediate_submission.down.sql"),"utf8");
    for(const required of ["partner_claim_submission_exact(target_company uuid,target_job uuid,target_request uuid","(o.company_id,o.job_id,o.request_id)=(target_company,target_job,target_request)","o.state='PENDING' AND o.attempt_count=0","NOT EXISTS(SELECT 1 FROM public.partner_submission_attempts","partner_claim_submission_notification_exact(target_company uuid,target_job uuid,target_request uuid","phase','NO_RECIPIENT'","state='DEAD',last_error_code='NOTIFICATION_REJECTED'","GRANT EXECUTE ON FUNCTION public.partner_claim_submission_exact"])
      expect(immediateUp).toContain(required);
    expect(immediateUp).not.toContain("partner_claim_submission_bounded(");
    expect(immediateDown).toContain("DROP FUNCTION IF EXISTS public.partner_claim_submission_exact");
  });
});
