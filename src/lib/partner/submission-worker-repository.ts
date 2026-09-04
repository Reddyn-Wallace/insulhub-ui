import "server-only";
import { createHash } from "node:crypto";
import type { PartnerSql } from "./db";
import type { NotificationDeliveryContext } from "./legacy/types";

export type WorkerSafeErrorCode = "NETWORK_ERROR" | "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "PROVIDER_REJECTED" | "UPLOAD_FAILED" | "ATTACH_FAILED" | "CREDENTIAL_ROTATED" | "AMBIGUOUS_LEGACY_RESULT" | "SUBMISSION_LEASE_LOST" | "MALFORMED_FROZEN_STATE" | "NOTIFICATION_REJECTED";

export interface SubmissionLease {
  companyId: string; jobId: string; requestId: string; snapshotId: string; leaseToken: string; fenceToken: number; attemptNumber: number;
}
export type WorkerQueueAgeBucket = "LT_1M" | "LT_5M" | "LT_1H" | "GTE_1H";
export interface WorkerClaimTelemetry { queueAgeBucket: WorkerQueueAgeBucket; reclaimedLease: boolean }
export type SubmissionClaim = ({ kind:"LEASE"; lease:SubmissionLease } | { kind:"RECONCILED" } | { kind:"SUCCEEDED" }) & WorkerClaimTelemetry;

export interface ClaimedSubmissionSnapshot {
  canonicalDocument: string; snapshotSha256: string; adapterMode: "FICTIONAL" | "LIVE"; contractVersion: string; legacyJobPrefix: string;
  checkpoint: "FROZEN" | "CREATE_STARTED" | "LEAD_CREATED" | "QUOTE_UPDATED" | "PLANS_ATTACHED";
  legacyJobId: string | null; legacyJobNumber: number | null; finalQuoteNumber: string | null; legacyBaseUrl: string | null;
  legacyCredentialCiphertext: Buffer | null; legacyCredentialNonce: Buffer | null; legacyCredentialKeyVersion: number | null;
  legacyCredentialFingerprint: string | null; legacyCredentialUpdatedAt: Date | string | null; remoteQuoteFingerprint: string | null;
}

export interface ClaimedSubmissionPlan {
  ordinal: number; drawingId: string; artifactId: string; drawingRevision: number; drawingName: string; documentSha256: string; renderHash: string; rendererVersion: string; templateVersion: string; templateSha256: string;
  localFileName: string; remoteFileName: string; contentSha256: string; byteSize: number; pdfBytes: Buffer;
  deliveryState: "PENDING" | "UPLOADING" | "UPLOADED" | "ATTACHED" | "FAILED" | "RECONCILIATION_REQUIRED"; remoteStorageKey: string | null;
}

export interface NotificationLease {
  eventId: string; companyId: string; jobId: string; requestId: string; topic: "PARTNER_SUBMISSION_COMPLETED" | "PARTNER_SUBMISSION_RECONCILIATION_ALERT";
  phase: "READY" | "ACCEPTED_PENDING"; receipt: string | null; leaseToken: string; fenceToken: number; attemptNumber: number;
}
export type NotificationClaim = ({ kind:"LEASE"; lease:NotificationLease } | { kind:"DEAD" }) & WorkerClaimTelemetry;

type LeaseParams = Pick<SubmissionLease, "companyId" | "jobId" | "requestId" | "leaseToken" | "fenceToken">;
const bool = (rows: Array<Record<string, unknown>>, key: string): boolean => rows[0]?.[key] === true;
const retryDelaySeconds = (delayMs: number): number => Math.max(1, Math.min(Math.ceil(delayMs / 1_000), 7 * 24 * 60 * 60));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const SAFE_TEXT = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

export class WorkerClaimIntegrityError extends Error {
  constructor(readonly target: "SUBMISSION" | "NOTIFICATION") { super(`PARTNER_${target}_CLAIM_INTEGRITY`); this.name = "WorkerClaimIntegrityError"; }
}

const uuid = (value: unknown): string | null => typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
const text = (value: unknown, max: number, pattern?: RegExp): string | null => typeof value === "string" && value.length > 0 && value.length <= max
  && !/[\u0000-\u001f\u007f-\u009f]/u.test(value) && (!pattern || pattern.test(value)) ? value : null;
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^-?[0-9]+$/.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
};
const date = (value: unknown): Date | string | null => {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? value : null;
};
const malformed = (target: "SUBMISSION" | "NOTIFICATION"): never => { throw new WorkerClaimIntegrityError(target); };
const claimTelemetry = (row: Record<string, unknown>, target: "SUBMISSION" | "NOTIFICATION"): WorkerClaimTelemetry => {
  const queueAgeBucket = row.queue_age_bucket;
  if (!(queueAgeBucket === "LT_1M" || queueAgeBucket === "LT_5M" || queueAgeBucket === "LT_1H" || queueAgeBucket === "GTE_1H") || typeof row.reclaimed_lease !== "boolean") malformed(target);
  return { queueAgeBucket: queueAgeBucket as WorkerQueueAgeBucket, reclaimedLease: row.reclaimed_lease as boolean };
};

export interface PartnerSubmissionWorkerStore {
  claimSubmission(workerId:string,leaseSeconds?:number):Promise<SubmissionClaim|null>;
  heartbeatSubmission(lease:LeaseParams,leaseSeconds?:number):Promise<boolean>;
  claimedSnapshot(lease:LeaseParams):Promise<ClaimedSubmissionSnapshot|null>;
  claimedPlans(lease:LeaseParams):Promise<ClaimedSubmissionPlan[]>;
  checkpoint(lease:LeaseParams,phase:string,values?:{legacyId?:string;legacyNumber?:number;ordinal?:number;remoteKey?:string}):Promise<boolean>;
  beginLiveCreate?(lease:LeaseParams):Promise<string|null>;
  recordLiveCreate?(lease:Pick<LeaseParams,"companyId"|"jobId"|"requestId">,permitId:string,legacyId:string,legacyNumber:number):Promise<boolean>;
  liveCreateReceipt?(lease:Pick<LeaseParams,"companyId"|"jobId"|"requestId">):Promise<{permitId:string;legacyId:string|null;legacyNumber:number|null}|null>;
  beginUpload(lease:LeaseParams,ordinal:number):Promise<"STARTED"|"RECONCILED"|"DENIED">;
  checkpointQuoteVerified(lease:LeaseParams,fingerprint:string):Promise<boolean>;
  beginAttachment(lease:LeaseParams):Promise<"STARTED"|"RECONCILED"|"DENIED">;
  adoptAttachedPlan(lease:LeaseParams,ordinal:number,remoteKey:string):Promise<boolean>;
  releaseSubmission(lease:LeaseParams,code:WorkerSafeErrorCode,delayMs:number):Promise<"RELEASED"|"RECONCILED"|"DENIED">;
  reconcileSubmission(lease:LeaseParams,code:WorkerSafeErrorCode):Promise<boolean>;
  finalizeSubmission(lease:LeaseParams,planCount:number):Promise<boolean>;
  claimNotification(workerId:string,leaseSeconds?:number):Promise<NotificationClaim|null>;
  notificationDeliveryContext?(lease:NotificationLease,jobOrigin:string):Promise<NotificationDeliveryContext|null>;
  beginNotificationDispatch?(lease:NotificationLease,context:NotificationDeliveryContext):Promise<boolean>;
  heartbeatNotification(lease:NotificationLease,leaseSeconds?:number):Promise<boolean>;
  checkpointNotificationAccepted(lease:NotificationLease,receipt:string):Promise<boolean>;
  releaseNotification(lease:NotificationLease,code:WorkerSafeErrorCode,delayMs:number):Promise<"RELEASED"|"DEAD"|"DENIED">;
  finalizeNotification(lease:NotificationLease,receipt:string):Promise<boolean>;
  reconcileNotification(lease:NotificationLease,code:WorkerSafeErrorCode):Promise<boolean>;
}

export class PartnerSubmissionWorkerRepository implements PartnerSubmissionWorkerStore {
  constructor(private readonly sql: PartnerSql,private readonly options:{liveTestRequestId?:string;notificationEventId?:string;immediateScope?:{companyId:string;jobId:string;requestId:string}}={}) {
    if(options.liveTestRequestId&&!UUID.test(options.liveTestRequestId))throw new Error("PARTNER_LIVE_TEST_REQUEST_INVALID");
    if(options.notificationEventId&&!UUID.test(options.notificationEventId))throw new Error("PARTNER_NOTIFICATION_EVENT_INVALID");
    if(options.immediateScope&&![options.immediateScope.companyId,options.immediateScope.jobId,options.immediateScope.requestId].every(value=>UUID.test(value)))throw new Error("PARTNER_IMMEDIATE_SCOPE_INVALID");
  }

  async claimSubmission(workerId: string, leaseSeconds = 120): Promise<SubmissionClaim | null> {
    const result = this.options.immediateScope
      ? await this.sql.query<Record<string, unknown>>("SELECT * FROM partner_claim_submission_exact($1,$2,$3,$4,$5)",[this.options.immediateScope.companyId,this.options.immediateScope.jobId,this.options.immediateScope.requestId,workerId,leaseSeconds])
      : this.options.liveTestRequestId
      ? await this.sql.query<Record<string, unknown>>("SELECT * FROM partner_claim_live_test_request($1,$2,$3)",[this.options.liveTestRequestId,workerId,leaseSeconds])
      : await this.sql.query<Record<string, unknown>>("SELECT * FROM partner_claim_submission_bounded($1,$2)", [workerId, leaseSeconds]);
    const row = result.rows[0]; if (!row) return null;const telemetry=claimTelemetry(row,"SUBMISSION");if(row.claim_status==="RECONCILED")return{kind:"RECONCILED",...telemetry};if(row.claim_status==="SUCCEEDED")return{kind:"SUCCEEDED",...telemetry};if(row.claim_status!=="CLAIMED")malformed("SUBMISSION");
    const companyId=uuid(row.company_id),jobId=uuid(row.job_id),requestId=uuid(row.request_id),snapshotId=uuid(row.snapshot_id),leaseToken=uuid(row.lease_token);
    const fenceToken=integer(row.fence_token,1),attemptNumber=integer(row.attempt_number,1,5);
    if(!companyId||!jobId||!requestId||!snapshotId||!leaseToken||fenceToken===null||attemptNumber===null)malformed("SUBMISSION");
    return {kind:"LEASE",lease:{ companyId:companyId!,jobId:jobId!,requestId:requestId!,snapshotId:snapshotId!,leaseToken:leaseToken!,fenceToken:fenceToken!,attemptNumber:attemptNumber! },...telemetry};
  }

  async heartbeatSubmission(lease: LeaseParams, leaseSeconds = 120): Promise<boolean> {
    const result = await this.sql.query<Record<string, unknown>>("SELECT partner_heartbeat_submission($1,$2,$3,$4,$5,$6) AS ok", [lease.companyId, lease.jobId, lease.requestId, lease.leaseToken, lease.fenceToken, leaseSeconds]);
    return bool(result.rows, "ok");
  }

  async claimedSnapshot(lease: LeaseParams): Promise<ClaimedSubmissionSnapshot | null> {
    const result = await this.sql.query<Record<string, unknown>>("SELECT * FROM partner_submission_claimed_snapshot($1,$2,$3,$4,$5)", [lease.companyId, lease.jobId, lease.requestId, lease.leaseToken, lease.fenceToken]);
    const row = result.rows[0]; if (!row) return null;
    const canonicalDocument=text(row.canonical_document,6*1024*1024),snapshotSha256=text(row.snapshot_sha256,64,SHA);
    const adapterMode=row.adapter_mode==="FICTIONAL"||row.adapter_mode==="LIVE"?row.adapter_mode:null;
    const contractVersion=text(row.contract_version,80,/^[A-Za-z0-9][A-Za-z0-9._-]*$/),legacyJobPrefix=text(row.legacy_job_prefix,40,/^[A-Z0-9][A-Z0-9-]*$/);
    const checkpoints=new Set(["FROZEN","CREATE_STARTED","LEAD_CREATED","QUOTE_UPDATED","PLANS_ATTACHED"]);const checkpoint=typeof row.checkpoint==="string"&&checkpoints.has(row.checkpoint)?row.checkpoint as ClaimedSubmissionSnapshot["checkpoint"]:null;
    const legacyJobId=row.legacy_job_id==null?null:text(row.legacy_job_id,120,SAFE_TEXT);const legacyJobNumber=row.legacy_job_number==null?null:integer(row.legacy_job_number,1);
    const finalQuoteNumber=row.final_quote_number==null?null:text(row.final_quote_number,120,SAFE_TEXT);
    const legacyBaseUrl=row.legacy_base_url==null?null:text(row.legacy_base_url,2048);const ciphertext=Buffer.isBuffer(row.legacy_credential_ciphertext)?Buffer.from(row.legacy_credential_ciphertext):null;
    const nonce=Buffer.isBuffer(row.legacy_credential_nonce)?Buffer.from(row.legacy_credential_nonce):null;const keyVersion=row.legacy_credential_key_version==null?null:integer(row.legacy_credential_key_version,1);
    const fingerprint=row.legacy_credential_fingerprint==null?null:text(row.legacy_credential_fingerprint,64,SHA);const updated=row.legacy_credential_updated_at==null?null:date(row.legacy_credential_updated_at);
    const remoteQuoteFingerprint=row.remote_quote_fingerprint==null?null:text(row.remote_quote_fingerprint,64,SHA);
    if(!canonicalDocument||!snapshotSha256||createHash("sha256").update(canonicalDocument).digest("hex")!==snapshotSha256||!adapterMode||!contractVersion||!legacyJobPrefix||!checkpoint
      ||(row.legacy_job_id!=null&&!legacyJobId)||(row.legacy_job_number!=null&&legacyJobNumber===null)||(row.final_quote_number!=null&&!finalQuoteNumber)||(row.remote_quote_fingerprint!=null&&!remoteQuoteFingerprint)
      ||(adapterMode==="FICTIONAL"&&(legacyBaseUrl!==null||ciphertext!==null||nonce!==null||keyVersion!==null||fingerprint!==null||updated!==null))
      ||(adapterMode==="LIVE"&&(!legacyBaseUrl||!ciphertext||ciphertext.length<1||!nonce||nonce.length<12||keyVersion===null||!fingerprint||!updated)))malformed("SUBMISSION");
    return { canonicalDocument:canonicalDocument!,snapshotSha256:snapshotSha256!,adapterMode:adapterMode!,contractVersion:contractVersion!,legacyJobPrefix:legacyJobPrefix!,checkpoint:checkpoint!,legacyJobId,legacyJobNumber,finalQuoteNumber,legacyBaseUrl,
      legacyCredentialCiphertext:ciphertext,legacyCredentialNonce:nonce,legacyCredentialKeyVersion:keyVersion,legacyCredentialFingerprint:fingerprint,legacyCredentialUpdatedAt:updated,remoteQuoteFingerprint };
  }

  async claimedPlans(lease: LeaseParams): Promise<ClaimedSubmissionPlan[]> {
    const result = await this.sql.query<Record<string, unknown>>("SELECT * FROM partner_submission_claimed_plans($1,$2,$3,$4,$5)", [lease.companyId, lease.jobId, lease.requestId, lease.leaseToken, lease.fenceToken]);
    if(result.rows.length<1||result.rows.length>20)malformed("SUBMISSION");
    const states=new Set(["PENDING","UPLOADING","UPLOADED","ATTACHED","FAILED","RECONCILIATION_REQUIRED"]);const drawings=new Set<string>(),artifacts=new Set<string>(),names=new Set<string>();
    return result.rows.map((row,index) => {
      const ordinal=integer(row.ordinal,0,19),drawingId=uuid(row.drawing_id),artifactId=uuid(row.artifact_id),drawingRevision=integer(row.drawing_revision,0);
      const drawingName=text(row.drawing_name,120),documentSha256=text(row.document_sha256,64,SHA),renderHash=text(row.render_hash,64,SHA),rendererVersion=text(row.renderer_version,80,/^[A-Za-z0-9][A-Za-z0-9._-]*$/),templateVersion=text(row.template_version,80,/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const templateSha256=text(row.template_sha256,64,SHA),localFileName=text(row.local_file_name,240),remoteFileName=text(row.remote_file_name,240,/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const contentSha256=text(row.content_sha256,64,SHA),byteSize=integer(row.byte_size,1,5*1024*1024);const pdfBytes=Buffer.isBuffer(row.pdf_bytes)?Buffer.from(row.pdf_bytes):null;
      const deliveryState=typeof row.delivery_state==="string"&&states.has(row.delivery_state)?row.delivery_state as ClaimedSubmissionPlan["deliveryState"]:null;
      const remoteStorageKey=row.remote_storage_key==null?null:text(row.remote_storage_key,500,/^[A-Za-z0-9][A-Za-z0-9._/-]*$/);
      if(ordinal!==index||!drawingId||!artifactId||drawingRevision===null||!drawingName||!documentSha256||!renderHash||!rendererVersion||!templateVersion||!templateSha256||!localFileName||!remoteFileName||!contentSha256||byteSize===null||!pdfBytes||pdfBytes.length!==byteSize
        ||pdfBytes.subarray(0,5).toString("ascii")!=="%PDF-"||createHash("sha256").update(pdfBytes).digest("hex")!==contentSha256||!deliveryState
        ||((deliveryState==="UPLOADED"||deliveryState==="ATTACHED")&&!remoteStorageKey)||((deliveryState==="PENDING"||deliveryState==="FAILED"||deliveryState==="UPLOADING")&&remoteStorageKey!==null)||(remoteStorageKey?.includes(".."))
        ||drawings.has(drawingId)||artifacts.has(artifactId)||names.has(remoteFileName))malformed("SUBMISSION");
      drawings.add(drawingId!);artifacts.add(artifactId!);names.add(remoteFileName!);
      return {ordinal:ordinal!,drawingId:drawingId!,artifactId:artifactId!,drawingRevision:drawingRevision!,drawingName:drawingName!,documentSha256:documentSha256!,renderHash:renderHash!,rendererVersion:rendererVersion!,templateVersion:templateVersion!,templateSha256:templateSha256!,localFileName:localFileName!,remoteFileName:remoteFileName!,contentSha256:contentSha256!,byteSize:byteSize!,pdfBytes:pdfBytes!,deliveryState:deliveryState!,remoteStorageKey};
    });
  }

  async checkpoint(lease: LeaseParams, phase: string, values: { legacyId?: string; legacyNumber?: number; ordinal?: number; remoteKey?: string } = {}): Promise<boolean> {
    const result = await this.sql.query<Record<string, unknown>>("SELECT partner_checkpoint_submission_bounded($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS ok",
      [lease.companyId, lease.jobId, lease.requestId, lease.leaseToken, lease.fenceToken, phase, values.legacyId ?? null, values.legacyNumber ?? null, values.ordinal ?? null, values.remoteKey ?? null]);
    return bool(result.rows, "ok");
  }

  async beginLiveCreate(lease:LeaseParams):Promise<string|null>{
    const result=await this.sql.query<{permit_id:string|null}>("SELECT public.partner_begin_legacy_create_dispatch($1,$2,$3,$4,$5) permit_id",[lease.companyId,lease.jobId,lease.requestId,lease.leaseToken,lease.fenceToken]);
    return uuid(result.rows[0]?.permit_id)??null;
  }

  async recordLiveCreate(lease:Pick<LeaseParams,"companyId"|"jobId"|"requestId">,permitId:string,legacyId:string,legacyNumber:number):Promise<boolean>{
    if(!uuid(permitId)||!/^[0-9a-f]{24}$/.test(legacyId)||integer(legacyNumber,1)===null)return false;
    const result=await this.sql.query<Record<string,unknown>>("SELECT public.partner_record_legacy_create_result($1,$2,$3,$4,$5,$6) ok",[lease.companyId,lease.jobId,lease.requestId,permitId,legacyId,legacyNumber]);
    return bool(result.rows,"ok");
  }

  async liveCreateReceipt(lease:Pick<LeaseParams,"companyId"|"jobId"|"requestId">):Promise<{permitId:string;legacyId:string|null;legacyNumber:number|null}|null>{
    const result=await this.sql.query<Record<string,unknown>>("SELECT * FROM public.partner_legacy_create_receipt($1,$2,$3)",[lease.companyId,lease.jobId,lease.requestId]);const row=result.rows[0];if(!row)return null;
    const permitId=uuid(row.permit_id),legacyId=row.legacy_job_id==null?null:text(row.legacy_job_id,24,/^[0-9a-f]{24}$/),legacyNumber=row.legacy_job_number==null?null:integer(row.legacy_job_number,1);
    if(!permitId||(legacyId===null)!==(legacyNumber===null))malformed("SUBMISSION");return{permitId:permitId!,legacyId,legacyNumber};
  }

  async beginUpload(lease: LeaseParams, ordinal: number): Promise<"STARTED" | "RECONCILED" | "DENIED"> {
    const result = await this.sql.query<Record<string, unknown>>("SELECT partner_begin_plan_upload($1,$2,$3,$4,$5,$6) AS ok", [lease.companyId, lease.jobId, lease.requestId, lease.leaseToken, lease.fenceToken, ordinal]);
    const value=result.rows[0]?.ok;return value==="STARTED"||value==="RECONCILED"?value:"DENIED";
  }

  async checkpointQuoteVerified(lease: LeaseParams, fingerprint: string): Promise<boolean> {
    const result = await this.sql.query<Record<string, unknown>>("SELECT partner_checkpoint_quote_verified($1,$2,$3,$4,$5,$6) AS ok", [lease.companyId, lease.jobId, lease.requestId, lease.leaseToken, lease.fenceToken, fingerprint]);
    return bool(result.rows, "ok");
  }

  async beginAttachment(lease: LeaseParams): Promise<"STARTED" | "RECONCILED" | "DENIED"> {
    const result = await this.sql.query<Record<string, unknown>>("SELECT partner_begin_attachment($1,$2,$3,$4,$5) AS ok", [lease.companyId, lease.jobId, lease.requestId, lease.leaseToken, lease.fenceToken]);
    const value=result.rows[0]?.ok;return value==="STARTED"||value==="RECONCILED"?value:"DENIED";
  }

  async adoptAttachedPlan(lease: LeaseParams, ordinal: number, remoteKey: string): Promise<boolean> {
    const result = await this.sql.query<Record<string, unknown>>("SELECT partner_adopt_attached_plan($1,$2,$3,$4,$5,$6,$7) AS ok", [lease.companyId, lease.jobId, lease.requestId, lease.leaseToken, lease.fenceToken, ordinal, remoteKey]);
    return bool(result.rows, "ok");
  }

  async releaseSubmission(lease: LeaseParams, code: WorkerSafeErrorCode, delayMs: number): Promise<"RELEASED" | "RECONCILED" | "DENIED"> {
    const result = await this.sql.query<Record<string, unknown>>("SELECT partner_release_submission_bounded($1,$2,$3,$4,$5,$6,$7) AS ok", [lease.companyId, lease.jobId, lease.requestId, lease.leaseToken, lease.fenceToken, code, retryDelaySeconds(delayMs)]);
    const value=result.rows[0]?.ok;return value==="RELEASED"||value==="RECONCILED"?value:"DENIED";
  }

  async reconcileSubmission(lease: LeaseParams, code: WorkerSafeErrorCode): Promise<boolean> {
    const result = await this.sql.query<Record<string, unknown>>("SELECT partner_reconcile_submission($1,$2,$3,$4,$5,$6) AS ok", [lease.companyId, lease.jobId, lease.requestId, lease.leaseToken, lease.fenceToken, code]);
    return bool(result.rows, "ok");
  }

  async finalizeSubmission(lease: LeaseParams, planCount: number): Promise<boolean> {
    const result = await this.sql.query<Record<string, unknown>>("SELECT partner_finalize_submission_verified($1,$2,$3,$4,$5,$6) AS ok", [lease.companyId, lease.jobId, lease.requestId, lease.leaseToken, lease.fenceToken, planCount]);
    return bool(result.rows, "ok");
  }

  async claimNotification(workerId: string, leaseSeconds = 120): Promise<NotificationClaim | null> {
    const result = this.options.immediateScope
      ? await this.sql.query<Record<string, unknown>>("SELECT * FROM partner_claim_submission_notification_exact($1,$2,$3,$4,$5)",[this.options.immediateScope.companyId,this.options.immediateScope.jobId,this.options.immediateScope.requestId,workerId,leaseSeconds])
      : this.options.notificationEventId
      ? await this.sql.query<Record<string, unknown>>("SELECT * FROM partner_claim_notification_exact($1,$2,$3)",[this.options.notificationEventId,workerId,leaseSeconds])
      : await this.sql.query<Record<string, unknown>>("SELECT * FROM partner_claim_notification($1,$2)", [workerId, leaseSeconds]);
    const row = result.rows[0]; if (!row) return null;const telemetry=claimTelemetry(row,"NOTIFICATION");if(row.claim_status==="DEAD")return{kind:"DEAD",...telemetry};if(row.claim_status!=="CLAIMED")malformed("NOTIFICATION");
    const eventId=uuid(row.event_id),companyId=uuid(row.company_id),jobId=uuid(row.job_id),requestId=uuid(row.request_id),leaseToken=uuid(row.lease_token);
    const topic=row.topic==="PARTNER_SUBMISSION_COMPLETED"||row.topic==="PARTNER_SUBMISSION_RECONCILIATION_ALERT"?row.topic:null;
    const phase=row.notification_phase==="READY"||row.notification_phase==="ACCEPTED_PENDING"?row.notification_phase:null;
    const receipt=row.notification_receipt==null?null:text(row.notification_receipt,200,/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);const fenceToken=integer(row.fence_token,1),attemptNumber=integer(row.attempt_number,1,5);
    if(!eventId||!companyId||!jobId||!requestId||!topic||!phase||!leaseToken||fenceToken===null||attemptNumber===null||(phase==="READY"&&receipt!==null)||(phase==="ACCEPTED_PENDING"&&!receipt))malformed("NOTIFICATION");
    return {kind:"LEASE",lease:{eventId:eventId!,companyId:companyId!,jobId:jobId!,requestId:requestId!,topic:topic!,phase:phase!,receipt,leaseToken:leaseToken!,fenceToken:fenceToken!,attemptNumber:attemptNumber!},...telemetry};
  }

  async notificationDeliveryContext(lease:NotificationLease,jobOrigin:string):Promise<NotificationDeliveryContext|null>{
    let origin:URL;try{origin=new URL(jobOrigin);}catch{return null;}
    if(origin.origin!==jobOrigin||origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash||!["http:","https:"].includes(origin.protocol))return null;
    const result=await this.sql.query<Record<string,unknown>>("SELECT * FROM partner_notification_delivery_context($1,$2,$3)",[lease.eventId,lease.leaseToken,lease.fenceToken]);
    const row=result.rows[0];if(!row)return null;
    const recipient=text(row.recipient_email,254),companyName=text(row.company_name,160),customerName=text(row.customer_name,200);
    const street=text(row.property_street,500),suburb=text(row.property_suburb,200),city=text(row.property_city,200),postcode=text(row.property_postcode,20);
    const quoteTotalCents=integer(row.quote_total_cents,0,Number.MAX_SAFE_INTEGER),legacyJobId=text(row.legacy_job_id,24,/^[a-f0-9]{24}$/),legacyJobNumber=integer(row.legacy_job_number,1);
    if(!recipient||recipient!==recipient.trim().toLowerCase()||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)||!companyName?.trim()||!customerName?.trim()
      ||street===null||suburb===null||city===null||postcode===null||quoteTotalCents===null||!legacyJobId||legacyJobNumber===null)return null;
    return{recipientEmail:recipient,companyName:companyName!,customerName:customerName!,propertyAddress:{street,suburb,city,postcode},quoteTotalCents,
      legacyJobId:legacyJobId!,legacyJobNumber:legacyJobNumber!,jobUrl:new URL(`/jobs/${legacyJobId}`,origin).toString()};
  }

  async beginNotificationDispatch(lease:NotificationLease,context:NotificationDeliveryContext):Promise<boolean>{
    const result=await this.sql.query<Record<string,unknown>>("SELECT partner_begin_notification_dispatch($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) AS ok",
      [lease.eventId,lease.leaseToken,lease.fenceToken,context.recipientEmail,context.companyName,context.customerName,context.propertyAddress.street,context.propertyAddress.suburb,
        context.propertyAddress.city,context.propertyAddress.postcode,context.quoteTotalCents,context.legacyJobId,context.legacyJobNumber,context.jobUrl]);
    return bool(result.rows,"ok");
  }

  async heartbeatNotification(lease: NotificationLease, leaseSeconds = 120): Promise<boolean> {
    const result = await this.sql.query<Record<string, unknown>>("SELECT partner_heartbeat_notification($1,$2,$3,$4) AS ok", [lease.eventId, lease.leaseToken, lease.fenceToken, leaseSeconds]); return bool(result.rows, "ok");
  }
  async checkpointNotificationAccepted(lease: NotificationLease, receipt: string): Promise<boolean> {
    const result = await this.sql.query<Record<string, unknown>>("SELECT partner_checkpoint_notification_accepted($1,$2,$3,$4) AS ok", [lease.eventId, lease.leaseToken, lease.fenceToken, receipt]); return bool(result.rows, "ok");
  }
  async releaseNotification(lease: NotificationLease, code: WorkerSafeErrorCode, delayMs: number): Promise<"RELEASED" | "DEAD" | "DENIED"> {
    const result = await this.sql.query<Record<string, unknown>>("SELECT partner_release_notification($1,$2,$3,$4,$5) AS ok", [lease.eventId, lease.leaseToken, lease.fenceToken, code, retryDelaySeconds(delayMs)]);const value=result.rows[0]?.ok;return value==="RELEASED"||value==="DEAD"?value:"DENIED";
  }
  async finalizeNotification(lease: NotificationLease, receipt: string): Promise<boolean> {
    const result = await this.sql.query<Record<string, unknown>>("SELECT partner_finalize_notification($1,$2,$3,$4) AS ok", [lease.eventId, lease.leaseToken, lease.fenceToken, receipt]); return bool(result.rows, "ok");
  }
  async reconcileNotification(lease: NotificationLease, code: WorkerSafeErrorCode): Promise<boolean> {
    const result = await this.sql.query<Record<string, unknown>>("SELECT partner_reconcile_notification($1,$2,$3,$4) AS ok", [lease.eventId, lease.leaseToken, lease.fenceToken, code]); return bool(result.rows, "ok");
  }
}
