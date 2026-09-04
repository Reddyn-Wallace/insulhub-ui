import "server-only";
import type { Pool } from "pg";
import type { PartnerSql } from "./db";
import type { PartnerPrincipal } from "./repository";
import { partnerDemoModeEnabled, withPartnerDemoAtomicOperation } from "./demo";
import { writePartnerAuditEvent } from "./audit";

export type DeleteDraftOutcome = "deleted" | "not_found" | "not_draft" | "stale";
export async function deleteDraftRecord(sql: PartnerSql, principal: PartnerPrincipal, jobId: string, revision: number): Promise<DeleteDraftOutcome> {
  if (process.env.NODE_ENV !== "test" && !partnerDemoModeEnabled()) {
    const result=await sql.query<{outcome:DeleteDraftOutcome}>("SELECT public.partner_delete_draft($1,$2,$3,$4) outcome",[principal.companyId,jobId,principal.userId,revision]);
    if (!result.rows[0]) throw new Error("Draft deletion was not confirmed");
    return result.rows[0].outcome;
  }
  // Explicit local/test emulation; production uses the transaction-atomic definer.
  const work=async():Promise<DeleteDraftOutcome>=>{
    const client=await (sql as Pool).connect();
    try {
      await client.query("BEGIN");
      const company=await client.query("SELECT id FROM partner_companies WHERE id=$1 AND is_active=true FOR UPDATE",[principal.companyId]);
      const actor=await client.query("SELECT id FROM partner_users WHERE id=$1 AND company_id=$2 AND principal_type='PARTNER' AND disabled_at IS NULL",[principal.userId,principal.companyId]);
      if(!company.rows[0]||!actor.rows[0])return "not_found";
      const found=await client.query("SELECT deleted_at,submission_state,submission_checkpoint,submission_started_at,legacy_job_id,revision FROM partner_jobs WHERE company_id=$1 AND id=$2 FOR UPDATE",[principal.companyId,jobId]);
      const job=found.rows[0];
      if(!job||job.deleted_at)return "not_found";
      if(job.submission_state!=="DRAFT"||job.submission_checkpoint!=="NONE"||job.submission_started_at||job.legacy_job_id)return "not_draft";
      for(const table of ["partner_submission_requests","partner_submission_snapshots"])if((await client.query(`SELECT id FROM ${table} WHERE company_id=$1 AND job_id=$2`,[principal.companyId,jobId])).rows.length)return "not_draft";
      if(job.revision!==revision)return "stale";
      const removed=await client.query("UPDATE partner_jobs SET deleted_at=now(),revision=revision+1,updated_at=now() WHERE company_id=$1 AND id=$2 AND deleted_at IS NULL AND submission_state='DRAFT' AND revision=$3 RETURNING id",[principal.companyId,jobId,revision]);
      if(!removed.rows[0])return "stale";
      await writePartnerAuditEvent(client,{type:"DRAFT_DELETED",actorUserId:principal.userId,companyId:principal.companyId,jobId});
      await client.query("COMMIT");return "deleted";
    } finally { await client.query("ROLLBACK");client.release(); }
  };
  return partnerDemoModeEnabled()?withPartnerDemoAtomicOperation(principal.companyId,jobId,work):work();
}
