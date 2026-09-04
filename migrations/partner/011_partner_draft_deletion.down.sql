BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.partner_jobs WHERE deleted_at IS NOT NULL)
    THEN RAISE EXCEPTION 'Draft deletion rollback refused: removed drafts would become visible'; END IF;
END $$;
DROP FUNCTION public.partner_delete_draft(uuid,uuid,text,integer);
DROP TRIGGER partner_deleted_draft_plan_guard ON public.partner_site_plan_drawings;
DROP FUNCTION public.partner_guard_deleted_draft_plan();
DROP TRIGGER partner_deleted_draft_guard ON public.partner_jobs;
DROP FUNCTION public.partner_guard_deleted_draft();
ALTER TABLE public.partner_jobs DROP CONSTRAINT partner_deleted_draft_only, DROP COLUMN deleted_at;
REVOKE UPDATE(id) ON public.partner_users FROM partner_submission_owner;
ALTER TABLE public.partner_audit_events DROP CONSTRAINT partner_audit_event_type;
ALTER TABLE public.partner_audit_events ADD CONSTRAINT partner_audit_event_type CHECK(event_type IN(
 'LOGIN_SUCCEEDED','LOGIN_FAILED','LOGOUT','USER_PROVISIONED','USER_DISABLED','SESSIONS_REVOKED','LEGACY_CREDENTIAL_REPLACED',
 'SUBMISSION_FROZEN','SUBMISSION_CLAIMED','SUBMISSION_PHASE_CHECKPOINTED','SUBMISSION_FINALIZED','SUBMISSION_FAILED_RETRYABLE','SUBMISSION_RECONCILIATION_REQUIRED',
 'SUBMISSION_EXECUTE_DISCARDED','SUBMISSION_NOTIFICATION_CLAIMED','SUBMISSION_NOTIFICATION_RELEASED','SUBMISSION_NOTIFICATION_DELIVERED','SUBMISSION_NOTIFICATION_DEAD',
 'OPS_COMPANY_CREATED','OPS_COMPANY_UPDATED','OPS_PARTNER_USER_PROVISIONED','OPS_FACT_RECORDED','OPS_AMENDMENT_RECORDED','OPS_INVOICE_RECORDED','OPS_SETTLEMENT_RECORDED'));
COMMIT;
