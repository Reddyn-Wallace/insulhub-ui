import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

// Dedicated PostgreSQL gate only. Every test change is rolled back.
export async function probePartnerDraftDeletion(pool, seedReadySubmission) {
  const c = await pool.connect();
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const rejected = async (name, sql, values=[], expectedReason) => {
    await c.query("SAVEPOINT deletion_probe");
    let failed = false;
    try { await c.query(sql,values); } catch (error) { failed = !expectedReason || error.message.includes(expectedReason); }
    await c.query("ROLLBACK TO SAVEPOINT deletion_probe"); await c.query("RELEASE SAVEPOINT deletion_probe");
    assert(failed, `Expected deletion probe rejection: ${name}`);
  };
  try {
    await c.query("BEGIN");
    const role=(await c.query("SELECT session_user AS name")).rows[0].name;
    await c.query(`GRANT partner_portal_runtime,partner_artifact_owner,partner_submission_owner TO "${role.replaceAll('"','""')}"`);
    const fixture = await seedReadySubmission(c, `delete-${randomUUID()}`);
    const values=[fixture.companyId,fixture.jobId,fixture.userId,0];
    const remove="SELECT public.partner_delete_draft($1,$2,$3,$4) outcome";
    await c.query("SET LOCAL ROLE partner_portal_runtime");
    assert((await c.query(remove,[randomUUID(),...values.slice(1)])).rows[0].outcome==="not_found","Cross-company deletion denied");
    assert((await c.query(remove,[...values.slice(0,3),9])).rows[0].outcome==="stale","Stale delete denied");
    await rejected("runtime cannot set deletion directly","UPDATE partner_jobs SET deleted_at=now() WHERE id=$1",[fixture.jobId]);
    assert((await c.query(remove,values)).rows[0].outcome==="deleted","Restricted runtime can delete including audit/row locks");
    assert((await c.query(remove,values)).rows[0].outcome==="not_found","Repeated deletion not found");
    await rejected("late lead save","UPDATE partner_jobs SET customer_name='Late change' WHERE id=$1",[fixture.jobId],"DRAFT_DELETED");
    await rejected("late plan save","UPDATE partner_site_plan_drawings SET name='Late plan' WHERE id=$1",[fixture.drawingId],"DRAFT_DELETED");
    await rejected("late freeze","SELECT * FROM partner_freeze_submission($1,$2,$3,0,0,$4,$5,$6,$7,$8::jsonb)",[fixture.companyId,fixture.jobId,fixture.userId,fixture.requestId,fixture.snapshotId,fixture.idempotencyHash,fixture.canonicalDocument,JSON.stringify(fixture.manifest)],"SUBMISSION_STALE");
    await c.query("RESET ROLE");
    // Probe the authority used by freeze at its job-update boundary. A full current-revision
    // freeze probe remains blocked by the pre-existing artifact FOR UPDATE privilege gap.
    await c.query("SET LOCAL ROLE partner_submission_owner");
    await rejected("submission owner cannot queue a tombstone at its current revision","UPDATE partner_jobs SET submission_state='QUEUED',submission_checkpoint='FROZEN' WHERE id=$1 AND revision=1",[fixture.jobId],"DRAFT_DELETED");
    await c.query("RESET ROLE");
    assert((await c.query("SELECT 1 FROM partner_jobs WHERE id=$1 AND deleted_at IS NOT NULL",[fixture.jobId])).rowCount===1,"Tombstone retained");
    assert((await c.query("SELECT 1 FROM partner_site_plan_pdf_artifacts WHERE id=$1",[fixture.artifactId])).rowCount===1,"Completed PDF retained");
    assert((await c.query("SELECT 1 FROM partner_audit_events WHERE job_id=$1 AND event_type='DRAFT_DELETED'",[fixture.jobId])).rowCount===1,"Exactly one audit event");
    assert((await c.query("SELECT 1 FROM partner_submission_requests WHERE job_id=$1",[fixture.jobId])).rowCount===0,"Late freeze did not leave a request");
    await c.query("SET LOCAL ROLE partner_artifact_owner");
    await rejected("late artifact publication guard","UPDATE partner_site_plan_drawings SET current_pdf_artifact_id=NULL WHERE id=$1",[fixture.drawingId],"DRAFT_DELETED");
    await c.query("RESET ROLE");
    const down=readFileSync(new URL("../migrations/partner/011_partner_draft_deletion.down.sql",import.meta.url),"utf8").replace(/^BEGIN;\s*/,"").replace(/COMMIT;\s*$/,"");
    await rejected("rollback cannot resurrect deleted drafts",down,[],"Draft deletion rollback refused");
  } finally { await c.query("ROLLBACK"); await c.query("RESET ROLE"); c.release(); }
}
