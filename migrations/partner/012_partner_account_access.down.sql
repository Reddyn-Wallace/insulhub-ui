BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.partner_account_links) OR EXISTS(SELECT 1 FROM public.partner_users WHERE invitation_pending OR password_version>0)
    OR EXISTS(SELECT 1 FROM public.partner_audit_events WHERE event_type LIKE 'ACCOUNT_%')
  THEN RAISE EXCEPTION 'Account access rollback refused: account changes must be preserved'; END IF;
END $$;
DROP TRIGGER partner_access_session_guard ON public.partner_sessions;
DROP TRIGGER partner_access_disable_guard ON public.partner_users;
DROP FUNCTION public.partner_ops_access_invite(text,uuid,text,text,text);
DROP FUNCTION public.partner_ops_access_issue(text,uuid,text,text,text);
DROP FUNCTION public.partner_ops_access_password(text,uuid,text,text);
DROP FUNCTION public.partner_ops_access_users(text,uuid);
DROP FUNCTION public.partner_access_rate_limit(text,integer);
DROP FUNCTION public.partner_access_request_reset(text,text);
DROP FUNCTION public.partner_access_complete(text,text);
DROP FUNCTION public.partner_access_email_result(text,boolean);
DROP FUNCTION public.partner_access_store_link(text,uuid,text,text,text);
DROP FUNCTION public.partner_access_apply_password(text,uuid,text,text,boolean);
DROP FUNCTION public.partner_access_session_guard();
DROP FUNCTION public.partner_access_disable_guard();
DROP TABLE public.partner_account_links,public.partner_access_rate_limits;
ALTER TABLE public.partner_sessions DROP COLUMN password_version;
ALTER TABLE public.partner_users DROP COLUMN invitation_pending,DROP COLUMN password_version;
ALTER TABLE public.partner_audit_events DROP CONSTRAINT partner_audit_event_type;
ALTER TABLE public.partner_audit_events ADD CONSTRAINT partner_audit_event_type CHECK(event_type IN('DRAFT_DELETED',
 'LOGIN_SUCCEEDED','LOGIN_FAILED','LOGOUT','USER_PROVISIONED','USER_DISABLED','SESSIONS_REVOKED','LEGACY_CREDENTIAL_REPLACED',
 'SUBMISSION_FROZEN','SUBMISSION_CLAIMED','SUBMISSION_PHASE_CHECKPOINTED','SUBMISSION_FINALIZED','SUBMISSION_FAILED_RETRYABLE','SUBMISSION_RECONCILIATION_REQUIRED',
 'SUBMISSION_EXECUTE_DISCARDED','SUBMISSION_NOTIFICATION_CLAIMED','SUBMISSION_NOTIFICATION_RELEASED','SUBMISSION_NOTIFICATION_DELIVERED','SUBMISSION_NOTIFICATION_DEAD',
 'OPS_COMPANY_CREATED','OPS_COMPANY_UPDATED','OPS_PARTNER_USER_PROVISIONED','OPS_FACT_RECORDED','OPS_AMENDMENT_RECORDED','OPS_INVOICE_RECORDED','OPS_SETTLEMENT_RECORDED'));
COMMIT;
