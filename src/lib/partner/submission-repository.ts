import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PartnerSql } from "./db";
import type { PoolClient } from "pg";
import { partnerDemoModeEnabled, partnerDemoSubmissionPoisoned, poisonPartnerDemoSubmission, withPartnerDemoLock } from "./demo";
import type { PartnerPrincipal } from "./repository";
import {
  buildPartnerSubmissionSnapshot,
  partnerSubmissionArtifactBytes,
  partnerSubmissionPublicStatus,
  type BuiltPartnerSubmissionSnapshot,
  type PartnerSubmissionCandidate,
  type PartnerSubmissionPublicStatus,
} from "./submission";
import type { LeadDraftFields } from "./draft";
import { calculateQuote, type QuoteDraft } from "./quote";
import type { SitePlanDrawingDocument } from "../site-plan-drawings";
import { canonicalJson, normalizeSitePlanRenderInput, sitePlanRenderHash } from "./site-plan-hash";

export interface PartnerSubmissionPreflightRecord {
  jobId: string;
  state: string;
  jobRevision: number;
  floorPlanRevision: number;
  adapterMode: "DISABLED" | "FICTIONAL" | "LIVE";
  contractVersion: string | null;
  legacyJobPrefix: string | null;
  liveConfigurationComplete: boolean;
  checkpoint: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
}

type CandidateRow = {
  id: string; company_id: string; client_reference: string; submission_state: string;
  customer_name: string; customer_mobile: string; customer_email: string; site_address: LeadDraftFields["siteAddress"];
  company_name: string; lead_sources: LeadDraftFields["leadSources"]; notes: string; quote_data: QuoteDraft; revision: number; floor_plan_revision: number;
  submission_adapter_mode: PartnerSubmissionCandidate["companyAdapterMode"]; submission_contract_version: string | null; legacy_job_prefix: string | null;
};

type PlanRow = {
  id: string; name: string; sort_order: number; drawing_data: SitePlanDrawingDocument; revision: number;
  artifact_id: string | null; artifact_drawing_revision: number | null; render_hash: string | null; pdf_bytes: Buffer | null;
  byte_size: number | null; renderer_version: string | null; template_version: string | null; template_sha256: string | null;
  content_sha256: string | null; file_name: string | null;
};
type LockedDrawingRow={id:string;name:string;sort_order:number;drawing_data:SitePlanDrawingDocument;revision:number;current_pdf_artifact_id:string|null;submitted_snapshot_data:SitePlanDrawingDocument|null;submitted_snapshot_at:Date|string|null;submitted_pdf_storage_key:string|null;submitted_pdf_outbox_event_id:string|null};

type StatusRow = { state: unknown; checkpoint: unknown; safe_error_code: unknown; created_at: Date | string; updated_at: Date | string; completed_at: Date | string | null };

function publicStatus(row: StatusRow): PartnerSubmissionPublicStatus { return partnerSubmissionPublicStatus({ state: row.state, checkpoint: row.checkpoint, safeErrorCode: row.safe_error_code, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at }); }
function demoEnabled(env: NodeJS.ProcessEnv): boolean { try { return partnerDemoModeEnabled(env); } catch { return false; } }
type TransactionalSql = PartnerSql & { connect?: () => Promise<PoolClient> };

export class PartnerSubmissionRepository {
  constructor(private readonly sql: TransactionalSql, private readonly env: NodeJS.ProcessEnv = process.env) {}

  async preflight(principal: PartnerPrincipal, jobId: string): Promise<PartnerSubmissionPreflightRecord | null> {
    if(demoEnabled(this.env)&&partnerDemoSubmissionPoisoned(principal.companyId,jobId))throw new Error("SUBMISSION_DEMO_RESET_REQUIRED");
    const result = await this.sql.query<{
      id: string; submission_state: string; revision: number; floor_plan_revision: number; submission_adapter_mode: PartnerSubmissionPreflightRecord["adapterMode"];
      submission_contract_version: string | null; legacy_job_prefix: string | null; live_configuration_complete: boolean; submission_checkpoint: string;
      created_at: Date | string; updated_at: Date | string; submitted_at: Date | string | null;
    }>(`SELECT j.id,j.submission_state,j.revision,j.floor_plan_revision,j.submission_checkpoint,j.created_at,j.updated_at,j.submitted_at,c.submission_adapter_mode,c.submission_contract_version,c.legacy_job_prefix,
      (c.legacy_base_url IS NOT NULL AND c.legacy_credential_ciphertext IS NOT NULL AND c.legacy_credential_nonce IS NOT NULL
       AND c.legacy_credential_key_version IS NOT NULL AND c.legacy_credential_updated_at IS NOT NULL) AS live_configuration_complete
      FROM partner_jobs j JOIN partner_companies c ON c.id=j.company_id AND c.is_active=true
      WHERE j.company_id=$1 AND j.id=$2 AND j.deleted_at IS NULL`, [principal.companyId, jobId]);
    const row = result.rows[0];
    return row ? { jobId: row.id, state: row.submission_state, jobRevision: Number(row.revision), floorPlanRevision: Number(row.floor_plan_revision), adapterMode: row.submission_adapter_mode, contractVersion: row.submission_contract_version, legacyJobPrefix: row.legacy_job_prefix, liveConfigurationComplete: row.live_configuration_complete === true, checkpoint: row.submission_checkpoint, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null } : null;
  }

  async loadCandidate(principal: PartnerPrincipal, jobId: string, idempotencyKeyHash: string): Promise<PartnerSubmissionCandidate | null> {
    if(demoEnabled(this.env)&&partnerDemoSubmissionPoisoned(principal.companyId,jobId))throw new Error("SUBMISSION_DEMO_RESET_REQUIRED");
    const job = await this.sql.query<CandidateRow>(`SELECT j.id,j.company_id,j.client_reference,j.submission_state,j.customer_name,j.customer_mobile,j.customer_email,
      j.site_address,j.lead_sources,j.notes,j.quote_data,j.revision,j.floor_plan_revision,c.name AS company_name,c.submission_adapter_mode,c.submission_contract_version,c.legacy_job_prefix
      FROM partner_jobs j JOIN partner_companies c ON c.id=j.company_id AND c.is_active=true
      WHERE j.company_id=$1 AND j.id=$2 AND j.deleted_at IS NULL`, [principal.companyId, jobId]);
    const row = job.rows[0]; if (!row) return null;
    const plans = await this.sql.query<PlanRow>(`SELECT d.id,d.name,d.sort_order,d.drawing_data,d.revision,
      a.id AS artifact_id,a.drawing_revision AS artifact_drawing_revision,a.render_hash,a.pdf_bytes,a.byte_size,a.renderer_version,a.template_version,a.template_sha256,a.content_sha256,a.file_name
      FROM partner_site_plan_drawings d LEFT JOIN partner_site_plan_pdf_artifacts a
      ON (a.company_id,a.job_id,a.drawing_id,a.id)=(d.company_id,d.job_id,d.id,d.current_pdf_artifact_id)
      WHERE d.company_id=$1 AND d.job_id=$2 ORDER BY d.sort_order,d.id`, [principal.companyId, jobId]);
    return {
      companyId: row.company_id, companyName: row.company_name, jobId: row.id, idempotencyKeyHash, companyAdapterMode: row.submission_adapter_mode,
      companyContractVersion: row.submission_contract_version, companyLegacyJobPrefix: row.legacy_job_prefix,
      jobRevision: Number(row.revision), floorPlanRevision: Number(row.floor_plan_revision), submissionState: row.submission_state,
      clientReference: row.client_reference, customerName: row.customer_name,
      customerMobile: row.customer_mobile, customerEmail: row.customer_email, siteAddress: row.site_address,
      leadSources: row.lead_sources, notes: row.notes, quote: row.quote_data,
      plans: plans.rows.map((plan) => {
        let artifact = null;
        if (plan.artifact_id && plan.pdf_bytes && plan.content_sha256 && plan.render_hash && plan.renderer_version && plan.template_version && plan.template_sha256 && plan.file_name && plan.artifact_drawing_revision !== null) {
          const bytes = partnerSubmissionArtifactBytes(plan.artifact_id, new Uint8Array(plan.pdf_bytes), this.env);
          artifact = { id: plan.artifact_id, drawingRevision: Number(plan.artifact_drawing_revision), renderHash: plan.render_hash, contentSha256: plan.content_sha256,
            byteSize: bytes.byteLength, bytes, rendererVersion: plan.renderer_version, templateVersion: plan.template_version, templateSha256: plan.template_sha256, localFileName: plan.file_name };
        }
        return { id: plan.id, name: plan.name, sortOrder: Number(plan.sort_order), revision: Number(plan.revision), document: plan.drawing_data, currentArtifact: artifact };
      }),
    };
  }

  async status(principal: PartnerPrincipal, jobId: string): Promise<PartnerSubmissionPublicStatus | null> {
    if(demoEnabled(this.env)&&partnerDemoSubmissionPoisoned(principal.companyId,jobId))throw new Error("SUBMISSION_DEMO_RESET_REQUIRED");
    if (demoEnabled(this.env)) {
      const result = await this.sql.query<StatusRow>(`SELECT r.state,j.submission_checkpoint AS checkpoint,r.safe_error_code,r.created_at,r.updated_at,r.completed_at
        FROM partner_submission_requests r JOIN partner_jobs j ON (j.company_id,j.id)=(r.company_id,r.job_id) WHERE r.company_id=$1 AND r.job_id=$2`, [principal.companyId, jobId]);
      if(!result.rows[0])return null;const status=publicStatus(result.rows[0]);
      const notification=await this.sql.query<{state:string}>(`SELECT state FROM partner_outbox_events WHERE company_id=$1 AND job_id=$2 AND request_id=(SELECT id FROM partner_submission_requests WHERE company_id=$1 AND job_id=$2) AND topic IN('PARTNER_SUBMISSION_COMPLETED','PARTNER_SUBMISSION_RECONCILIATION_ALERT') ORDER BY created_at DESC LIMIT 1`,[principal.companyId,jobId]);
      const state=notification.rows[0]?.state;return{...status,notification:state==="DELIVERED"?"DELIVERED":state==="DEAD"?"DEAD":"PENDING"};
    }
    const result = await this.sql.query<StatusRow>("SELECT * FROM partner_submission_status($1,$2)", [principal.companyId, jobId]);
    return result.rows[0] ? publicStatus(result.rows[0]) : null;
  }

  async requestId(principal:PartnerPrincipal,jobId:string):Promise<string|null>{
    if(demoEnabled(this.env)){const result=await this.sql.query<{id:string}>("SELECT id FROM partner_submission_requests WHERE company_id=$1 AND job_id=$2",[principal.companyId,jobId]);return result.rows[0]?.id??null;}
    const result=await this.sql.query<{id:string|null}>("SELECT partner_submission_request_id($1,$2) AS id",[principal.companyId,jobId]);return result.rows[0]?.id??null;
  }

  async consumeRateLimit(principal: PartnerPrincipal, userHash: string, companyHash: string, ipHash: string): Promise<boolean> {
    if (demoEnabled(this.env)) return true;
    const result = await this.sql.query<{ user_allowed: boolean; company_allowed: boolean; ip_allowed: boolean }>(`SELECT
      partner_consume_submission_rate_limit($1,'USER',$2,300,12) AS user_allowed,
      partner_consume_submission_rate_limit($1,'COMPANY',$3,300,40) AS company_allowed,
      partner_consume_submission_rate_limit($1,'IP_HASH',$4,300,30) AS ip_allowed`, [principal.companyId, userHash, companyHash, ipHash]);
    const row = result.rows[0]; return Boolean(row?.user_allowed && row.company_allowed && row.ip_allowed);
  }

  async consumeStatusRateLimit(principal: PartnerPrincipal, userHash: string, companyHash: string, ipHash: string): Promise<boolean> {
    if (demoEnabled(this.env)) return true;
    const result = await this.sql.query<{ user_allowed: boolean; company_allowed: boolean; ip_allowed: boolean }>(`SELECT
      partner_consume_submission_rate_limit($1,'USER',$2,300,120) AS user_allowed,
      partner_consume_submission_rate_limit($1,'COMPANY',$3,300,400) AS company_allowed,
      partner_consume_submission_rate_limit($1,'IP_HASH',$4,300,240) AS ip_allowed`, [principal.companyId, userHash, companyHash, ipHash]);
    const row = result.rows[0]; return Boolean(row?.user_allowed && row.company_allowed && row.ip_allowed);
  }

  async freeze(principal: PartnerPrincipal, candidate: PartnerSubmissionCandidate, built: BuiltPartnerSubmissionSnapshot): Promise<{ status: PartnerSubmissionPublicStatus; replayed: boolean }> {
    if (demoEnabled(this.env)) return this.freezeDemo(principal, candidate, built);
    const snapshotId = randomUUID();
    const frozen = await this.sql.query<{ replayed: boolean }>("SELECT * FROM partner_freeze_submission($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)", [
      principal.companyId, candidate.jobId, principal.userId, candidate.jobRevision, candidate.floorPlanRevision, built.requestId, snapshotId,
      candidate.idempotencyKeyHash, built.canonicalDocument, JSON.stringify(built.manifest),
    ]);
    if (!frozen.rows[0]) throw new Error("SUBMISSION_NOT_FOUND");
    const status = await this.status(principal, candidate.jobId); if (!status) throw new Error("SUBMISSION_STATUS_UNAVAILABLE");
    return { status, replayed: frozen.rows[0].replayed === true };
  }

  private async freezeDemo(principal: PartnerPrincipal, candidate: PartnerSubmissionCandidate, built: BuiltPartnerSubmissionSnapshot): Promise<{ status: PartnerSubmissionPublicStatus; replayed: boolean }> {
    // One company-scoped fictional remote/database critical section also makes
    // same-key reuse across two jobs deterministic rather than a raw unique race.
    const lockKey=`${principal.companyId}:submission`;return withPartnerDemoLock(lockKey, async () => {
      if(partnerDemoSubmissionPoisoned(principal.companyId,candidate.jobId))throw new Error("SUBMISSION_DEMO_RESET_REQUIRED");
      if (!this.sql.connect) throw new Error("SUBMISSION_TRANSACTION_UNAVAILABLE");
      const client = await this.sql.connect(); const runner: PartnerSql = client;
      let insertedSnapshotId:string|null=null;let insertedOutboxId:string|null=null;let originalDrawings:LockedDrawingRow[]=[];let drawingsTouched=false;
      let originalJob:{quote_data: QuoteDraft; quote_total_cents: number; submission_state:string;submission_checkpoint:string;submission_adapter_mode_snapshot:string|null;submission_contract_version_snapshot:string|null;legacy_job_prefix_snapshot:string|null;submission_started_at:Date|string|null;submitted_at:Date|string|null;updated_at:Date|string}|null=null;let jobTouched=false;
      try {
        await client.query("BEGIN");
        const locked = await runner.query<{ quote_data: QuoteDraft; quote_total_cents: number; submission_state: string; submission_checkpoint:string; submission_adapter_mode_snapshot:string|null; submission_contract_version_snapshot:string|null; legacy_job_prefix_snapshot:string|null; submission_started_at:Date|string|null; submitted_at:Date|string|null; revision: number; floor_plan_revision: number; site_address: LeadDraftFields["siteAddress"]; updated_at:Date|string; company_name: string; submission_adapter_mode: string; submission_contract_version: string | null; legacy_job_prefix: string | null }>(`SELECT j.quote_data,j.quote_total_cents,j.submission_state,j.submission_checkpoint,j.submission_adapter_mode_snapshot,j.submission_contract_version_snapshot,j.legacy_job_prefix_snapshot,j.submission_started_at,j.submitted_at,j.revision,j.floor_plan_revision,j.site_address,j.updated_at,c.name AS company_name,c.submission_adapter_mode,c.submission_contract_version,c.legacy_job_prefix
          FROM partner_jobs j JOIN partner_companies c ON c.id=j.company_id WHERE j.company_id=$1 AND j.id=$2 AND j.deleted_at IS NULL FOR UPDATE`, [principal.companyId,candidate.jobId]);
        const current = locked.rows[0]; if (!current) throw new Error("SUBMISSION_NOT_FOUND");originalJob={quote_data:current.quote_data,quote_total_cents:current.quote_total_cents,submission_state:current.submission_state,submission_checkpoint:current.submission_checkpoint,submission_adapter_mode_snapshot:current.submission_adapter_mode_snapshot,submission_contract_version_snapshot:current.submission_contract_version_snapshot,legacy_job_prefix_snapshot:current.legacy_job_prefix_snapshot,submission_started_at:current.submission_started_at,submitted_at:current.submitted_at,updated_at:current.updated_at};
        const reusedKey=await runner.query<{job_id:string;request_hash:string}>(`SELECT job_id,request_hash FROM partner_submission_requests WHERE company_id=$1 AND idempotency_key_hash=$2`,[principal.companyId,candidate.idempotencyKeyHash]);
        if(reusedKey.rows[0]&&(reusedKey.rows[0].job_id!==candidate.jobId||reusedKey.rows[0].request_hash!==built.candidateRequestHash))throw new Error("SUBMISSION_IDEMPOTENCY_CONFLICT");
        const existing = await runner.query<StatusRow>(`SELECT r.state,j.submission_checkpoint AS checkpoint,r.safe_error_code,r.created_at,r.updated_at,r.completed_at
          FROM partner_submission_requests r JOIN partner_jobs j ON (j.company_id,j.id)=(r.company_id,r.job_id) WHERE r.company_id=$1 AND r.job_id=$2`, [principal.companyId,candidate.jobId]);
        if (existing.rows[0]) { await client.query("COMMIT"); return { status: publicStatus(existing.rows[0]), replayed:true }; }
        if (current.submission_state !== "DRAFT" || Number(current.revision) !== candidate.jobRevision || Number(current.floor_plan_revision) !== candidate.floorPlanRevision
          || current.company_name !== candidate.companyName || current.submission_adapter_mode !== candidate.companyAdapterMode || current.submission_contract_version !== candidate.companyContractVersion || current.legacy_job_prefix !== candidate.companyLegacyJobPrefix) throw new Error("SUBMISSION_STALE");
        const drawings = await runner.query<LockedDrawingRow>(`SELECT id,name,sort_order,drawing_data,revision,current_pdf_artifact_id,submitted_snapshot_data,submitted_snapshot_at,submitted_pdf_storage_key,submitted_pdf_outbox_event_id FROM partner_site_plan_drawings WHERE company_id=$1 AND job_id=$2 ORDER BY sort_order,id FOR UPDATE`,[principal.companyId,candidate.jobId]);originalDrawings=drawings.rows;
        if(drawings.rows.length!==built.manifest.length)throw new Error("SUBMISSION_PLAN_SET_MISMATCH");
        for(const [index,drawing] of drawings.rows.entries()){
          const item=built.manifest[index];const plan=candidate.plans[index];
          if(!item||!plan||drawing.id!==item.drawingId||drawing.id!==plan.id||Number(drawing.sort_order)!==index||Number(drawing.revision)!==item.drawingRevision||drawing.name!==plan.name||canonicalJson(drawing.drawing_data)!==item.documentCanonical)throw new Error("SUBMISSION_STALE");
          const artifacts=await runner.query<{id:string;drawing_revision:number;render_hash:string;pdf_bytes:Buffer;renderer_version:string;template_version:string;template_sha256:string;content_sha256:string;file_name:string}>(`SELECT id,drawing_revision,render_hash,pdf_bytes,renderer_version,template_version,template_sha256,content_sha256,file_name FROM partner_site_plan_pdf_artifacts WHERE company_id=$1 AND job_id=$2 AND drawing_id=$3 AND id=$4 FOR UPDATE`,[principal.companyId,candidate.jobId,drawing.id,drawing.current_pdf_artifact_id]);
          const artifact=artifacts.rows[0];const expectedArtifact=plan.currentArtifact;if(!artifact||!expectedArtifact||artifact.id!==item.artifactId||Number(artifact.drawing_revision)!==Number(drawing.revision))throw new Error("SUBMISSION_PDF_STALE");
          const bytes=partnerSubmissionArtifactBytes(artifact.id,new Uint8Array(artifact.pdf_bytes),this.env);const contentSha=createHash("sha256").update(bytes).digest("hex");
          const expectedRender=sitePlanRenderHash(normalizeSitePlanRenderInput({drawingName:drawing.name,siteAddress:current.site_address,document:drawing.drawing_data}));
          if(bytes.byteLength!==item.byteSize||Buffer.from(bytes).subarray(0,5).toString()!=="%PDF-"||contentSha!==artifact.content_sha256||contentSha!==item.contentSha256||artifact.render_hash!==expectedRender||artifact.render_hash!==item.renderHash||artifact.renderer_version!==expectedArtifact.rendererVersion||artifact.template_version!==expectedArtifact.templateVersion||artifact.template_sha256!==expectedArtifact.templateSha256||artifact.file_name!==expectedArtifact.localFileName)throw new Error("SUBMISSION_PDF_INTEGRITY_FAILED");
        }
        const snapshotId = randomUUID(); insertedSnapshotId=snapshotId;const now = new Date();
        const authoritative = built.canonicalDocument; const snapshotSha = createHash("sha256").update(authoritative).digest("hex");
        await runner.query(`INSERT INTO partner_submission_snapshots(company_id,job_id,id,schema_version,job_revision,floor_plan_revision,adapter_mode,contract_version,legacy_job_prefix,canonical_document,snapshot_data,snapshot_sha256,byte_size,created_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10::jsonb,$11,$12,$13)`, [principal.companyId,candidate.jobId,snapshotId,built.snapshot.schemaVersion,candidate.jobRevision,candidate.floorPlanRevision,candidate.companyAdapterMode,candidate.companyContractVersion,candidate.companyLegacyJobPrefix,authoritative,snapshotSha,Buffer.byteLength(authoritative),principal.userId]);
        for (const item of built.manifest) {
          const plan = candidate.plans.find((value) => value.id === item.drawingId)!; const artifact = plan.currentArtifact!;
          await runner.query(`INSERT INTO partner_submission_plan_manifest(company_id,job_id,snapshot_id,ordinal,drawing_id,artifact_id,drawing_revision,drawing_name,document_sha256,render_hash,content_sha256,byte_size,renderer_version,template_version,template_sha256,local_file_name,remote_file_name)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [principal.companyId,candidate.jobId,snapshotId,item.ordinal,item.drawingId,item.artifactId,item.drawingRevision,plan.name,item.documentSha256,item.renderHash,item.contentSha256,item.byteSize,artifact.rendererVersion,artifact.templateVersion,artifact.templateSha256,artifact.localFileName,item.remoteFileName]);
        }
        await runner.query(`INSERT INTO partner_submission_requests(company_id,job_id,id,snapshot_id,idempotency_key_hash,request_hash,created_by_user_id,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`, [principal.companyId,candidate.jobId,built.requestId,snapshotId,candidate.idempotencyKeyHash,built.candidateRequestHash,principal.userId,now]);
        for (const item of built.manifest) await runner.query(`INSERT INTO partner_submission_plan_deliveries(company_id,job_id,request_id,snapshot_id,ordinal,drawing_id) VALUES($1,$2,$3,$4,$5,$6)`, [principal.companyId,candidate.jobId,built.requestId,snapshotId,item.ordinal,item.drawingId]);
        const outbox=await runner.query<{id:string}>(`INSERT INTO partner_outbox_events(company_id,job_id,request_id,topic,idempotency_key,payload) VALUES($1,$2,$3,'PARTNER_SUBMISSION_EXECUTE',$4,$5::jsonb) RETURNING id`, [principal.companyId,candidate.jobId,built.requestId,`submission-execute:${principal.companyId}:${candidate.jobId}:${candidate.idempotencyKeyHash}`,JSON.stringify({schemaVersion:1,requestId:built.requestId,snapshotId})]);insertedOutboxId=outbox.rows[0]?.id??null;if(!insertedOutboxId)throw new Error("SUBMISSION_OUTBOX_FAILED");
        drawingsTouched=true;for(const drawing of drawings.rows){const changed=await runner.query(`UPDATE partner_site_plan_drawings SET submitted_snapshot_data=drawing_data,submitted_snapshot_at=$4,submitted_pdf_storage_key=NULL,submitted_pdf_outbox_event_id=$5 WHERE company_id=$1 AND job_id=$2 AND id=$3`,[principal.companyId,candidate.jobId,drawing.id,now,outbox.rows[0]?.id]);if(changed.rowCount!==1)throw new Error("SUBMISSION_STALE");}
        const updated = await runner.query(`UPDATE partner_jobs SET quote_data=$9::jsonb,quote_total_cents=$10,submission_state='QUEUED',submission_checkpoint='FROZEN',submission_adapter_mode_snapshot=$3,submission_contract_version_snapshot=$4,legacy_job_prefix_snapshot=$5,updated_at=$6 WHERE company_id=$1 AND id=$2 AND submission_state='DRAFT' AND revision=$7 AND floor_plan_revision=$8`, [principal.companyId,candidate.jobId,candidate.companyAdapterMode,candidate.companyContractVersion,candidate.companyLegacyJobPrefix,now,candidate.jobRevision,candidate.floorPlanRevision,JSON.stringify(built.snapshot.job.quote),calculateQuote(built.snapshot.job.quote).totalCents]);
        if (updated.rowCount !== 1) throw new Error("SUBMISSION_STALE");jobTouched=true;
        const statusResult = await runner.query<StatusRow>(`SELECT r.state,j.submission_checkpoint AS checkpoint,r.safe_error_code,r.created_at,r.updated_at,r.completed_at FROM partner_submission_requests r JOIN partner_jobs j ON (j.company_id,j.id)=(r.company_id,r.job_id) WHERE r.company_id=$1 AND r.job_id=$2`, [principal.companyId,candidate.jobId]);
        if (!statusResult.rows[0]) throw new Error("SUBMISSION_STATUS_UNAVAILABLE");
        await client.query("COMMIT"); return { status: publicStatus(statusResult.rows[0]), replayed:false };
      } catch (error) {
        try{await client.query("ROLLBACK");}catch{/* compensation still runs */}
        // pg-mem does not guarantee transaction rollback across its Pool shim.
        // Compensate only objects carrying this freshly derived request/snapshot.
        try {
          if(drawingsTouched&&insertedOutboxId)for(const drawing of originalDrawings)await this.sql.query(`UPDATE partner_site_plan_drawings SET submitted_snapshot_data=$5::jsonb,submitted_snapshot_at=$6,submitted_pdf_storage_key=$7,submitted_pdf_outbox_event_id=$8 WHERE company_id=$1 AND job_id=$2 AND id=$3 AND submitted_pdf_outbox_event_id=$4`,[principal.companyId,candidate.jobId,drawing.id,insertedOutboxId,drawing.submitted_snapshot_data?JSON.stringify(drawing.submitted_snapshot_data):null,drawing.submitted_snapshot_at,drawing.submitted_pdf_storage_key,drawing.submitted_pdf_outbox_event_id]);
          if(jobTouched&&originalJob)await this.sql.query(`UPDATE partner_jobs SET submission_state=$3,submission_checkpoint=$4,submission_adapter_mode_snapshot=$5,submission_contract_version_snapshot=$6,legacy_job_prefix_snapshot=$7,submission_started_at=$8,submitted_at=$9,updated_at=$10,quote_data=$11::jsonb,quote_total_cents=$12 WHERE company_id=$1 AND id=$2 AND submission_state='QUEUED' AND submission_checkpoint='FROZEN'`,[principal.companyId,candidate.jobId,originalJob.submission_state,originalJob.submission_checkpoint,originalJob.submission_adapter_mode_snapshot,originalJob.submission_contract_version_snapshot,originalJob.legacy_job_prefix_snapshot,originalJob.submission_started_at,originalJob.submitted_at,originalJob.updated_at,JSON.stringify(originalJob.quote_data),originalJob.quote_total_cents]);
          await this.sql.query(`DELETE FROM partner_submission_plan_deliveries WHERE company_id=$1 AND job_id=$2 AND request_id=$3`,[principal.companyId,candidate.jobId,built.requestId]);
          await this.sql.query(`DELETE FROM partner_outbox_events WHERE company_id=$1 AND job_id=$2 AND request_id=$3 AND topic='PARTNER_SUBMISSION_EXECUTE'`,[principal.companyId,candidate.jobId,built.requestId]);
          await this.sql.query(`DELETE FROM partner_submission_requests WHERE company_id=$1 AND job_id=$2 AND id=$3`,[principal.companyId,candidate.jobId,built.requestId]);
          if(insertedSnapshotId){await this.sql.query(`DELETE FROM partner_submission_plan_manifest WHERE company_id=$1 AND job_id=$2 AND snapshot_id=$3`,[principal.companyId,candidate.jobId,insertedSnapshotId]);await this.sql.query(`DELETE FROM partner_submission_snapshots WHERE company_id=$1 AND job_id=$2 AND id=$3`,[principal.companyId,candidate.jobId,insertedSnapshotId]);}
          const residue=await this.sql.query<{snapshots:number;manifest:number;requests:number;deliveries:number;outbox:number}>(`SELECT
            (SELECT count(*) FROM partner_submission_snapshots WHERE company_id=$1 AND job_id=$2 AND id=$3) AS snapshots,
            (SELECT count(*) FROM partner_submission_plan_manifest WHERE company_id=$1 AND job_id=$2 AND snapshot_id=$3) AS manifest,
            (SELECT count(*) FROM partner_submission_requests WHERE company_id=$1 AND job_id=$2 AND id=$4) AS requests,
            (SELECT count(*) FROM partner_submission_plan_deliveries WHERE company_id=$1 AND job_id=$2 AND request_id=$4) AS deliveries,
            (SELECT count(*) FROM partner_outbox_events WHERE company_id=$1 AND job_id=$2 AND request_id=$4 AND topic='PARTNER_SUBMISSION_EXECUTE') AS outbox`,[principal.companyId,candidate.jobId,insertedSnapshotId,built.requestId]);
          const counts=residue.rows[0];if(!counts||[counts.snapshots,counts.manifest,counts.requests,counts.deliveries,counts.outbox].some((value)=>Number(value)!==0))throw new Error("compensation residue");
          const sameTime=(actual:Date|string|null,expected:Date|string|null)=>actual===null||expected===null?actual===expected:new Date(actual).toISOString()===new Date(expected).toISOString();
          if(originalJob){const restored=await this.sql.query<typeof originalJob>(`SELECT quote_data,quote_total_cents,submission_state,submission_checkpoint,submission_adapter_mode_snapshot,submission_contract_version_snapshot,legacy_job_prefix_snapshot,submission_started_at,submitted_at,updated_at FROM partner_jobs WHERE company_id=$1 AND id=$2`,[principal.companyId,candidate.jobId]);const value=restored.rows[0];if(!value||canonicalJson(value.quote_data)!==canonicalJson(originalJob.quote_data)||Number(value.quote_total_cents)!==Number(originalJob.quote_total_cents)||value.submission_state!==originalJob.submission_state||value.submission_checkpoint!==originalJob.submission_checkpoint||value.submission_adapter_mode_snapshot!==originalJob.submission_adapter_mode_snapshot||value.submission_contract_version_snapshot!==originalJob.submission_contract_version_snapshot||value.legacy_job_prefix_snapshot!==originalJob.legacy_job_prefix_snapshot||!sameTime(value.submission_started_at,originalJob.submission_started_at)||!sameTime(value.submitted_at,originalJob.submitted_at)||!sameTime(value.updated_at,originalJob.updated_at))throw new Error("job compensation mismatch");}
          if(originalDrawings.length||drawingsTouched){const restoredDrawings=await this.sql.query<Pick<LockedDrawingRow,"id"|"submitted_snapshot_data"|"submitted_snapshot_at"|"submitted_pdf_storage_key"|"submitted_pdf_outbox_event_id">>(`SELECT id,submitted_snapshot_data,submitted_snapshot_at,submitted_pdf_storage_key,submitted_pdf_outbox_event_id FROM partner_site_plan_drawings WHERE company_id=$1 AND job_id=$2 ORDER BY sort_order,id`,[principal.companyId,candidate.jobId]);
          if(restoredDrawings.rows.length!==originalDrawings.length||restoredDrawings.rows.some((value,index)=>{const expected=originalDrawings[index];return !expected||value.id!==expected.id||canonicalJson(value.submitted_snapshot_data)!==canonicalJson(expected.submitted_snapshot_data)||!sameTime(value.submitted_snapshot_at,expected.submitted_snapshot_at)||value.submitted_pdf_storage_key!==expected.submitted_pdf_storage_key||value.submitted_pdf_outbox_event_id!==expected.submitted_pdf_outbox_event_id;}))throw new Error("drawing compensation mismatch");}
        }catch{poisonPartnerDemoSubmission(principal.companyId,candidate.jobId);throw new Error("SUBMISSION_DEMO_RESET_REQUIRED");}
        throw error;
      } finally { client.release(); }
    });
  }
}

export function partnerSubmissionScopeHash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function buildAuthoritativePartnerSubmission(candidate: PartnerSubmissionCandidate): BuiltPartnerSubmissionSnapshot { return buildPartnerSubmissionSnapshot(candidate); }
