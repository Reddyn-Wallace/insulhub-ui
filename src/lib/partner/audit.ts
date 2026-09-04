import "server-only";
import type { PartnerSql } from "./db";

export type PartnerAuditEventType =
  | "ACCOUNT_LINK_ISSUED"
  | "ACCOUNT_EMAIL_ACCEPTED"
  | "ACCOUNT_EMAIL_UNCONFIRMED"
  | "ACCOUNT_PASSWORD_CHANGED"
  | "DRAFT_DELETED"
  | "LOGIN_SUCCEEDED"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "USER_PROVISIONED"
  | "USER_DISABLED"
  | "SESSIONS_REVOKED"
  | "LEGACY_CREDENTIAL_REPLACED"
  | "SUBMISSION_FROZEN"
  | "SUBMISSION_CLAIMED"
  | "SUBMISSION_PHASE_CHECKPOINTED"
  | "SUBMISSION_FINALIZED"
  | "SUBMISSION_FAILED_RETRYABLE"
  | "SUBMISSION_RECONCILIATION_REQUIRED"
  | "OPS_COMPANY_CREATED"
  | "OPS_COMPANY_UPDATED"
  | "OPS_PARTNER_USER_PROVISIONED"
  | "OPS_FACT_RECORDED"
  | "OPS_AMENDMENT_RECORDED"
  | "OPS_INVOICE_RECORDED"
  | "OPS_SETTLEMENT_RECORDED";

const SAFE_METADATA_KEYS = new Set(["outcome", "reason", "principalType", "keyVersion", "requestMethod", "phase", "errorCode", "contractVersion", "attemptNumber"]);
const SENSITIVE_KEY = /(password|secret|token|cookie|credential|cipher|authorization|session)/i;

export function sanitizeAuditMetadata(input: Record<string, unknown> = {}): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_METADATA_KEYS.has(key) || SENSITIVE_KEY.test(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") safe[key] = value;
  }
  return safe;
}

export async function writePartnerAuditEvent(
  sql: PartnerSql,
  event: {
    type: PartnerAuditEventType;
    actorUserId?: string | null;
    subjectUserId?: string | null;
    companyId?: string | null;
    jobId?: string | null;
    submissionRequestId?: string | null;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (event.requestId && event.requestId.length > 200) throw new Error("Partner audit request ID is too long");
  const metadata = JSON.stringify(sanitizeAuditMetadata(event.metadata));
  if (Buffer.byteLength(metadata, "utf8") > 16_384) throw new Error("Partner audit metadata is too large");
  await sql.query(
    `INSERT INTO partner_audit_events
      (event_type, actor_user_id, subject_user_id, company_id, job_id, submission_request_id, request_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [event.type, event.actorUserId ?? null, event.subjectUserId ?? null, event.companyId ?? null, event.jobId ?? null, event.submissionRequestId ?? null, event.requestId ?? null, metadata],
  );
}
