import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { LINK_GATE_SIGNATURES } from "./partner-ops-postgres-probes.mjs";

/** Disposable PostgreSQL gate only; every fixture and role grant rolls back. */
export async function probePartnerJobLinks(pool, seed) {
  const c = await pool.connect();
  const assert = (value, message) => { if (!value) throw Error("Manual links gate: " + message); };
  const denied = async (sql, values = []) => {
    await c.query("SAVEPOINT link_probe"); let rejected = false;
    try { await c.query(sql, values); } catch { rejected = true; }
    await c.query("ROLLBACK TO SAVEPOINT link_probe"); await c.query("RELEASE SAVEPOINT link_probe");
    assert(rejected, "unsafe operation unexpectedly succeeded");
  };
  const actor = "insulhub-settings-service", legacy = "a".repeat(24);
  const status = JSON.stringify({ ebaCompleted: true, installDate: "2026-09-04", jobCompleted: false, invoiceRecorded: true });
  const commit = "SELECT public.partner_ops_job_link($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz) result";
  try {
    await c.query("BEGIN");
    const login = (await c.query("SELECT session_user name")).rows[0].name;
    await c.query(`GRANT partner_ops_runtime,partner_portal_runtime,partner_submission_owner,partner_artifact_owner,partner_submission_worker TO "${login.replaceAll('"','""')}" WITH INHERIT TRUE, SET TRUE`);
    const signatures = (await c.query(`SELECT p.prosecdef,p.proconfig,r.rolname,
      has_function_privilege('partner_ops_runtime',p.oid,'EXECUTE') ops,
      has_function_privilege('partner_portal_runtime',p.oid,'EXECUTE') portal,
      has_function_privilege('partner_submission_worker',p.oid,'EXECUTE') worker
      FROM unnest($1::text[]) s JOIN pg_proc p ON p.oid=to_regprocedure(s) JOIN pg_roles r ON r.oid=p.proowner`, [LINK_GATE_SIGNATURES])).rows;
    assert(signatures.length === 4 && signatures.every(row => row.prosecdef && row.proconfig.join() === "search_path=pg_catalog" && row.rolname === "partner_ops_owner" && row.ops && !row.portal && !row.worker), "exact staff function privileges");
    assert(!(await c.query("SELECT has_function_privilege('partner_ops_runtime','public.partner_link_commit(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz)','EXECUTE') allowed")).rows[0].allowed, "private bridge inaccessible to runtime");
    const first = await seed(c, "link-" + randomUUID()), other = await seed(c, "link-" + randomUUID());
    const args = [actor, first.companyId, first.jobId, 0, legacy, 555, status, new Date()];
    await c.query("SET LOCAL ROLE partner_ops_runtime");
    await denied(commit, args); // Drafts cannot be silently submitted by staff.
    await denied(commit, ["not-an-internal-user", ...args.slice(1)]);
    await c.query("RESET ROLE");
    const freezeSubmitted=async(fixture,source)=>{const snapshot=JSON.parse(fixture.canonicalDocument);snapshot.job.leadSources=[source];snapshot.job.quote.depositBasisPoints=0;snapshot.job.quote.consentFeeCents=0;await c.query("UPDATE partner_jobs SET quote_data=$2::jsonb WHERE id=$1",[fixture.jobId,JSON.stringify(snapshot.job.quote)]);await c.query("SET LOCAL ROLE partner_portal_runtime");await c.query("SELECT * FROM partner_freeze_submission($1,$2,$3,0,0,$4,$5,$6,$7,$8::jsonb)",[fixture.companyId,fixture.jobId,fixture.userId,fixture.requestId,fixture.snapshotId,fixture.idempotencyHash,JSON.stringify(snapshot),JSON.stringify(fixture.manifest)]);await c.query("RESET ROLE");};
    await freezeSubmitted(first,"E1 Gate");await freezeSubmitted(other,"E1 Gate");
    await c.query("SET LOCAL ROLE partner_submission_owner");
    await c.query("UPDATE partner_jobs SET submission_state='FAILED_RETRYABLE',submission_started_at=now() WHERE id IN($1,$2)", [first.jobId, other.jobId]);
    await c.query("RESET ROLE");
    const quoteBefore = (await c.query("SELECT quote_data FROM partner_jobs WHERE id=$1", [first.jobId])).rows[0].quote_data;
    await c.query("SET LOCAL ROLE partner_ops_runtime");
    await denied(commit, [actor, other.companyId, first.jobId, ...args.slice(3)]);
    await denied(commit, [actor, first.companyId, first.jobId, 99, ...args.slice(4)]);
    await denied(commit, [actor, first.companyId, first.jobId, null, ...args.slice(4)]);
    await denied("UPDATE partner_jobs SET legacy_job_id=$1 WHERE id=$2", [legacy, first.jobId]);
    assert((await c.query(commit, args)).rows[0].result, "first link");
    assert(!(await c.query(commit, args)).rows[0].result, "same-link confirmation is idempotent");
    await denied(commit, [actor, first.companyId, first.jobId, 0, "b".repeat(24), 556, status, new Date()]);
    await denied(commit, [actor, other.companyId, other.jobId, 0, legacy, 555, status, new Date()]);
    const rows = (await c.query("SELECT partner_ops_job_links($1,$2) result", [actor, first.companyId])).rows[0].result;
    assert(rows.length === 1 && rows[0].linkedJobNumber === 555 && rows[0].linkedStatus.ebaCompleted, "bounded company read projection");
    assert((await c.query("SELECT partner_ops_link_lookup($1,$2) result", [actor, legacy])).rows[0].result.jobId === first.jobId, "lookup mapping");
    const newer = new Date(Date.now() + 500), older = new Date(Date.now() + 100);
    const cleared = JSON.stringify({ ebaCompleted: false, installDate: null, jobCompleted: null, invoiceRecorded: false });
    assert((await c.query("SELECT partner_ops_job_status($1,$2,$3::jsonb,$4) result", [actor, legacy, cleared, newer])).rows[0].result, "new observation accepted");
    assert(!(await c.query("SELECT partner_ops_job_status($1,$2,$3::jsonb,$4) result", [actor, legacy, status, older])).rows[0].result, "late older observation fenced");
    await denied("SELECT partner_ops_job_status($1,$2,$3::jsonb,now())", [actor, legacy, JSON.stringify({ ebaCompleted: "yes" })]);
    await c.query("RESET ROLE");
    assert(JSON.stringify((await c.query("SELECT quote_data FROM partner_jobs WHERE id=$1", [first.jobId])).rows[0].quote_data) === JSON.stringify(quoteBefore), "quote unchanged");
    assert((await c.query("SELECT 1 FROM partner_site_plan_pdf_artifacts WHERE id=$1", [first.artifactId])).rowCount === 1, "PDF untouched");
    assert((await c.query("SELECT count(*)::int count FROM partner_manual_job_links WHERE job_id=$1", [first.jobId])).rows[0].count === 1, "single provenance record");
    await c.query("SET LOCAL ROLE partner_portal_runtime");
    assert((await c.query("SELECT eba_completed,install_date,job_completed FROM partner_manual_job_links WHERE company_id=$1 AND job_id=$2", [first.companyId, first.jobId])).rows[0].eba_completed === false, "current false values replace old facts");
    await denied("UPDATE partner_manual_job_links SET eba_completed=true WHERE job_id=$1", [first.jobId]);
    await denied(commit, args);
    await denied("UPDATE partner_jobs SET customer_name='late edit' WHERE id=$1", [first.jobId]);
    await c.query("RESET ROLE");
    await c.query("SET LOCAL ROLE partner_submission_owner");
    await denied("UPDATE partner_jobs SET legacy_job_id=$1 WHERE id=$2", [legacy.toUpperCase(), other.jobId]);
    await denied("UPDATE partner_jobs SET submission_state='FAILED_RETRYABLE',submitted_at=NULL WHERE id=$1", [first.jobId]);
    assert(!(await c.query("SELECT partner_checkpoint_submission_bounded($1,$2,$3,$4,1,'CREATE_STARTED',NULL,NULL,NULL,NULL) result", [first.companyId, first.jobId, randomUUID(), randomUUID()])).rows[0].result, "late worker checkpoint fails closed");
    await c.query("RESET ROLE");
    await denied("DELETE FROM partner_manual_job_links WHERE job_id=$1", [first.jobId]);
    await c.query("SET LOCAL ROLE partner_submission_owner");
    await c.query("UPDATE partner_outbox_events SET state='DEAD',last_error_code='AMBIGUOUS_LEGACY_RESULT' WHERE job_id=$1 AND topic='PARTNER_SUBMISSION_EXECUTE'",[other.jobId]);
    await c.query("RESET ROLE");
    // Exercise the real freeze/claim path, not a fabricated successful receipt.
    const pending = await seed(c, "link-pending-" + randomUUID());
    const snapshot = JSON.parse(pending.canonicalDocument);
    snapshot.job.leadSources = ["E1 Gate"];
    snapshot.job.quote.depositBasisPoints = 0;
    snapshot.job.quote.consentFeeCents = 0;
    await c.query("UPDATE partner_jobs SET quote_data=$2::jsonb WHERE id=$1", [pending.jobId, JSON.stringify(snapshot.job.quote)]);
    await c.query("SET LOCAL ROLE partner_portal_runtime");
    await c.query("SELECT * FROM partner_freeze_submission($1,$2,$3,0,0,$4,$5,$6,$7,$8::jsonb)", [pending.companyId,pending.jobId,pending.userId,pending.requestId,pending.snapshotId,pending.idempotencyHash,JSON.stringify(snapshot),JSON.stringify(pending.manifest)]);
    await c.query("RESET ROLE");
    await c.query("SET LOCAL ROLE partner_submission_worker");
    const claim = (await c.query("SELECT * FROM partner_claim_submission_bounded('link-gate',120)")).rows[0];
    assert(claim?.job_id === pending.jobId, "real worker claim");
    await c.query("RESET ROLE");
    await c.query("SET LOCAL ROLE partner_submission_owner");
    await c.query("UPDATE partner_jobs SET submission_state='FAILED_RETRYABLE',submission_started_at=now() WHERE id=$1", [pending.jobId]);
    await c.query("RESET ROLE");
    const pendingArgs = [actor,pending.companyId,pending.jobId,0,"c".repeat(24),557,status,new Date()];
    await c.query("SET LOCAL ROLE partner_ops_runtime");
    await denied(commit, pendingArgs); // Live lease/in-progress work.
    await c.query("RESET ROLE");
    await c.query("SET LOCAL ROLE partner_submission_owner");
    await c.query("UPDATE partner_outbox_events SET lease_expires_at=now()-interval '1 minute' WHERE job_id=$1", [pending.jobId]);
    await c.query("UPDATE partner_submission_attempts SET created_at=now()-interval '2 minutes',started_at=now()-interval '2 minutes',heartbeat_at=now()-interval '2 minutes',lease_expires_at=now()-interval '1 minute' WHERE job_id=$1", [pending.jobId]);
    await c.query("RESET ROLE");
    await c.query("SET LOCAL ROLE partner_ops_runtime");
    await denied(commit, pendingArgs); // Expiry alone never makes in-flight work safe.
    await c.query("RESET ROLE");
    await c.query("SET LOCAL ROLE partner_submission_owner");
    await c.query("UPDATE partner_submission_attempts SET outcome='FAILED_RETRYABLE',error_code='NETWORK_ERROR',finished_at=now() WHERE job_id=$1", [pending.jobId]);
    await c.query("UPDATE partner_outbox_events SET state='FAILED',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL WHERE job_id=$1", [pending.jobId]);
    // Persisted dispatch evidence remains authoritative even after reconciliation
    // overwrites the current phase; a claim's CREATING_LEAD label alone is not.
    await c.query("SAVEPOINT dispatched");
    await c.query("INSERT INTO partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata) VALUES('SUBMISSION_PHASE_CHECKPOINTED',$1,$2,$3,'{\"phase\":\"CREATE_STARTED\"}')", [pending.companyId,pending.jobId,pending.requestId]);
    await c.query("UPDATE partner_jobs SET submission_checkpoint='RECONCILIATION' WHERE id=$1", [pending.jobId]);
    await c.query("SET LOCAL ROLE partner_ops_runtime"); await denied(commit,pendingArgs);
    await c.query("ROLLBACK TO SAVEPOINT dispatched"); await c.query("RELEASE SAVEPOINT dispatched"); await c.query("RESET ROLE");
    await c.query("SET LOCAL ROLE partner_ops_runtime");
    assert((await c.query(commit,pendingArgs)).rows[0].result, "terminal never-dispatched failure may link");
    await c.query("RESET ROLE");
    assert((await c.query("SELECT state FROM partner_outbox_events WHERE job_id=$1 AND topic='PARTNER_SUBMISSION_EXECUTE'",[pending.jobId])).rows[0].state==="DEAD","stale execute is terminalized");
    assert((await c.query("SELECT state FROM partner_submission_requests WHERE job_id=$1",[pending.jobId])).rows[0].state!=="SUCCEEDED","no fabricated successful transfer");
    await c.query("SET LOCAL ROLE partner_submission_worker");
    assert(!(await c.query("SELECT partner_checkpoint_submission_bounded($1,$2,$3,$4,$5,'CREATE_STARTED',NULL,NULL,NULL,NULL) result",[pending.companyId,pending.jobId,pending.requestId,claim.lease_token,claim.fence_token])).rows[0].result,"old claimed worker is fenced after link");
    await c.query("RESET ROLE");
    const down = readFileSync(new URL("../migrations/partner/013_partner_manual_links.down.sql", import.meta.url), "utf8").replace(/^BEGIN;\s*/, "").replace(/COMMIT;\s*$/, "");
    await denied(down);
  } finally { await c.query("ROLLBACK"); await c.query("RESET ROLE"); c.release(); }
}
