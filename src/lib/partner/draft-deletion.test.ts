import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_SITE_PLAN_DOCUMENT } from "../site-plan-drawings";
import { EMPTY_LEAD_DRAFT } from "./draft";
import { PartnerRepository, type PartnerPrincipal } from "./repository";
import { PartnerSitePlanRepository } from "./site-plan-repository";
import { PartnerOperationsRepository } from "./operations-repository";
import { PartnerSubmissionRepository } from "./submission-repository";
import { createPartnerTestDatabase } from "./test-db";

const pools: Array<{end():Promise<void>}> = [];
afterEach(async () => { await Promise.all(pools.splice(0).map(pool => pool.end())); });
async function fixture() {
  const { Pool } = createPartnerTestDatabase(); const pool = new Pool(); pools.push(pool);
  const a = (await pool.query("INSERT INTO partner_companies(slug,name,billing_model)VALUES('a','A','INSULHUB_BILLED') RETURNING id")).rows[0].id;
  const b = (await pool.query("INSERT INTO partner_companies(slug,name,billing_model)VALUES('b','B','PARTNER_BILLED') RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO partner_users(id,company_id,principal_type,name,email)VALUES('a1',$1,'PARTNER','A','a1@test'),('a2',$1,'PARTNER','A2','a2@test'),('b1',$2,'PARTNER','B','b1@test')",[a,b]);
  const principal: PartnerPrincipal = {userId:"a1",companyId:a,principalType:"PARTNER"};
  const repository = new PartnerRepository(pool), plans = new PartnerSitePlanRepository(pool);
  const key = randomUUID(), job = await repository.createDraft(principal,EMPTY_LEAD_DRAFT,key);
  return {pool,principal,other:{userId:"b1",companyId:b,principalType:"PARTNER"} as PartnerPrincipal,repository,plans,key,job};
}
describe("draft deletion", () => {
  it("shares deletion within a company, preserves tombstone/audit, and rejects stale create replay", async () => {
    const {pool,principal,repository,key,job} = await fixture();
    expect(await repository.deleteDraft({...principal,userId:"a2"},job.id,job.revision)).toBe("deleted");
    expect(await repository.getJob(principal,job.id)).toBeNull();
    expect(await repository.listJobs(principal)).toHaveLength(0);
    expect(await repository.updateDraft(principal,job.id,0,EMPTY_LEAD_DRAFT)).toEqual({outcome:"not_found"});
    expect(await repository.deleteDraft(principal,job.id,0)).toBe("not_found");
    await expect(repository.createDraft(principal,EMPTY_LEAD_DRAFT,key)).rejects.toThrow("deleted");
    expect((await pool.query("SELECT deleted_at FROM partner_jobs WHERE id=$1",[job.id])).rows[0].deleted_at).toBeTruthy();
    expect((await pool.query("SELECT actor_user_id FROM partner_audit_events WHERE event_type='DRAFT_DELETED'")).rows).toEqual([{actor_user_id:"a2"}]);
  });
  it("denies other companies and stale revisions without changing the draft", async () => {
    const {principal,other,repository,job} = await fixture();
    expect(await repository.deleteDraft(other,job.id,0)).toBe("not_found");
    await repository.updateDraft(principal,job.id,0,{...EMPTY_LEAD_DRAFT,customerName:"Newer"});
    expect(await repository.deleteDraft(principal,job.id,0)).toBe("stale");
    expect((await repository.getJob(principal,job.id))?.customerName).toBe("Newer");
    expect(await repository.deleteDraft(principal,job.id,1)).toBe("deleted");
  });
  it.each(["QUEUED","CREATING_LEAD","UPDATING_QUOTE","ATTACHING_PLANS","SUBMITTED","FAILED_RETRYABLE","RECONCILIATION_REQUIRED"])("blocks %s jobs",async submissionState=>{
    const {pool,principal,repository,job}=await fixture();
    await pool.query("UPDATE partner_jobs SET submission_state=$2,submission_started_at=now(),submitted_at=CASE WHEN $2=\'SUBMITTED\' THEN now() ELSE NULL END WHERE id=$1",[job.id,submissionState]);
    expect(await repository.deleteDraft(principal,job.id,0)).toBe("not_draft");
  });
  it("rechecks disabled users and inactive companies at deletion",async()=>{
    const {pool,principal,repository,job}=await fixture();
    await pool.query("UPDATE partner_users SET disabled_at=now() WHERE id=$1",[principal.userId]);
    expect(await repository.deleteDraft(principal,job.id,0)).toBe("not_found");
    await pool.query("UPDATE partner_companies SET is_active=false WHERE id=$1",[principal.companyId]);
    expect(await repository.deleteDraft({...principal,userId:"a2"},job.id,0)).toBe("not_found");
  });
  it("hides completed PDFs and all nested resources, retains data, rejects late plan saves/publication and submission", async () => {
    const {pool,principal,repository,plans,job}=await fixture();
    const document={...EMPTY_SITE_PLAN_DOCUMENT,walls:[{id:"wall",start:{x:1,y:1},end:{x:5,y:1},style:"solid" as const}]};
    await plans.create(principal,job.id,0,"Ground floor",document);
    const floor=(await plans.list(principal,job.id))!.floors[0];
    const snapshot=(await plans.renderSnapshot(principal,job.id,floor.id))!;
    const bytes=Buffer.from("%PDF-test"),pdf={bytes,contentSha256:createHash("sha256").update(bytes).digest("hex")};
    const published=(await plans.publish(principal,job.id,floor.id,snapshot,pdf,"Ground.pdf"))!;
    const lateSnapshot=(await plans.renderSnapshot(principal,job.id,floor.id))!;
    expect(published.pdfReady).toBe(true);
    expect((await plans.download(principal,job.id,floor.id))?.bytes).toEqual(bytes);
    expect(await repository.deleteDraft(principal,job.id,0)).toBe("deleted");
    expect(await plans.list(principal,job.id)).toBeNull();
    expect(await plans.get(principal,job.id,floor.id)).toBeNull();
    expect(await repository.getDrawing(principal,job.id,floor.id)).toBeNull();
    expect(await plans.download(principal,job.id,floor.id)).toBeNull();
    expect(await plans.renderSnapshot(principal,job.id,floor.id)).toBeNull();
    expect(await plans.patch(principal,job.id,floor.id,0,{name:"Late edit"})).toMatchObject({outcome:"not_found"});
    expect(await plans.create(principal,job.id,1,"Late floor",document)).toMatchObject({outcome:"not_found"});
    expect(await plans.remove(principal,job.id,floor.id,1)).toMatchObject({outcome:"not_found"});
    expect(await plans.publish(principal,job.id,floor.id,lateSnapshot,pdf,"Late.pdf")).toBeNull();
    const submissions = new PartnerSubmissionRepository(pool);
    expect(await submissions.preflight(principal,job.id)).toBeNull();
    expect(await new PartnerOperationsRepository(pool,true).partnerProjection(principal.companyId,job.id,principal.userId)).toBeNull();
    expect(await submissions.loadCandidate(principal,job.id,"0".repeat(64))).toBeNull();
    expect((await pool.query("SELECT id FROM partner_site_plan_drawings WHERE job_id=$1",[job.id])).rows).toHaveLength(1);
    expect((await pool.query("SELECT id FROM partner_site_plan_pdf_artifacts WHERE job_id=$1",[job.id])).rows).toHaveLength(1);
  });
});
