BEGIN;
-- Owner rights are temporary and restricted to this schema migration.
DO $$ BEGIN EXECUTE format('GRANT partner_submission_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user); END $$;
GRANT CREATE ON SCHEMA public TO partner_submission_owner;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.partner_outbox_events WHERE state='PROCESSING' AND lease_expires_at>=now()) THEN RAISE EXCEPTION 'partner worker rollback refused: active lease'; END IF;
  IF EXISTS(SELECT 1 FROM public.partner_submission_requests WHERE worker_v2_started OR attach_attempt_count>0) THEN
    RAISE EXCEPTION 'partner worker rollback refused: E4 submission work exists';
  END IF;
  IF EXISTS(SELECT 1 FROM public.partner_submission_requests WHERE safe_error_code IN('MALFORMED_FROZEN_STATE','NOTIFICATION_REJECTED'))
    OR EXISTS(SELECT 1 FROM public.partner_submission_attempts WHERE error_code IN('MALFORMED_FROZEN_STATE','NOTIFICATION_REJECTED'))
    OR EXISTS(SELECT 1 FROM public.partner_submission_plan_deliveries WHERE safe_error_code IN('MALFORMED_FROZEN_STATE','NOTIFICATION_REJECTED'))
    OR EXISTS(SELECT 1 FROM public.partner_outbox_events WHERE last_error_code IN('MALFORMED_FROZEN_STATE','NOTIFICATION_REJECTED')) THEN
    RAISE EXCEPTION 'partner worker rollback refused: E4 error state exists';
  END IF;
END $$;
ALTER TABLE public.partner_outbox_events DROP CONSTRAINT partner_outbox_notification_topic_phase;
UPDATE public.partner_outbox_events SET notification_phase=NULL,notification_backfilled=false
  WHERE notification_backfilled=true AND notification_phase='READY' AND notification_receipt IS NULL AND notification_accepted_at IS NULL;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.partner_outbox_events WHERE notification_phase IS NOT NULL OR notification_receipt IS NOT NULL OR notification_accepted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'partner worker rollback refused: processed notification work exists';
  END IF;
END $$;
DROP INDEX public.partner_outbox_notification_claim_idx;
DROP INDEX public.partner_submission_delivery_remote_key_unique;
DROP TRIGGER partner_notification_prepare ON public.partner_outbox_events;
DROP FUNCTION public.partner_notification_prepare_insert();
DROP FUNCTION public.partner_reconcile_notification(uuid,uuid,bigint,text);
DROP FUNCTION public.partner_finalize_notification(uuid,uuid,bigint,text);
DROP FUNCTION public.partner_release_notification(uuid,uuid,bigint,text,integer);
DROP FUNCTION public.partner_checkpoint_notification_accepted(uuid,uuid,bigint,text);
DROP FUNCTION public.partner_heartbeat_notification(uuid,uuid,bigint,integer);
DROP FUNCTION public.partner_notification_lock_lease(uuid,uuid,bigint);
DROP FUNCTION public.partner_claim_notification(text,integer);
DROP FUNCTION public.partner_finalize_submission_verified(uuid,uuid,uuid,uuid,bigint,integer);
DROP FUNCTION public.partner_begin_attachment(uuid,uuid,uuid,uuid,bigint);
DROP FUNCTION public.partner_adopt_attached_plan(uuid,uuid,uuid,uuid,bigint,integer,text);
DROP FUNCTION public.partner_checkpoint_quote_verified(uuid,uuid,uuid,uuid,bigint,text);
DROP FUNCTION public.partner_release_submission_bounded(uuid,uuid,uuid,uuid,bigint,text,integer);
DROP FUNCTION public.partner_checkpoint_submission_bounded(uuid,uuid,uuid,uuid,bigint,text,text,bigint,integer,text);
DROP FUNCTION public.partner_begin_plan_upload(uuid,uuid,uuid,uuid,bigint,integer);
DROP FUNCTION public.partner_claim_submission_bounded(text,integer);
DROP FUNCTION public.partner_worker_snapshot_matches(text,jsonb);
DROP FUNCTION public.partner_submission_claimed_snapshot(uuid,uuid,uuid,uuid,bigint);
CREATE FUNCTION public.partner_submission_claimed_snapshot(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint)
RETURNS TABLE(canonical_document text,snapshot_sha256 text,adapter_mode text,contract_version text,legacy_job_prefix text,checkpoint text,legacy_job_id text,legacy_job_number bigint,final_quote_number text,legacy_base_url text,legacy_credential_ciphertext bytea,legacy_credential_nonce bytea,legacy_credential_key_version integer,legacy_credential_fingerprint text,legacy_credential_updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT public.partner_submission_lock_lease(target_company,target_job,target_request,target_lease,target_fence) THEN RETURN; END IF;
  RETURN QUERY SELECT s.canonical_document,s.snapshot_sha256::text,s.adapter_mode::text,s.contract_version::text,s.legacy_job_prefix::text,j.submission_checkpoint::text,j.legacy_job_id::text,j.legacy_job_number,j.final_quote_number::text,
    CASE WHEN s.adapter_mode='LIVE' THEN c.legacy_base_url ELSE NULL END,CASE WHEN s.adapter_mode='LIVE' THEN c.legacy_credential_ciphertext ELSE NULL END,
    CASE WHEN s.adapter_mode='LIVE' THEN c.legacy_credential_nonce ELSE NULL END,CASE WHEN s.adapter_mode='LIVE' THEN c.legacy_credential_key_version ELSE NULL END,
    CASE WHEN s.adapter_mode='LIVE' THEN s.legacy_credential_fingerprint::text ELSE NULL END,CASE WHEN s.adapter_mode='LIVE' THEN s.legacy_credential_updated_at_snapshot ELSE NULL END
  FROM public.partner_submission_requests r JOIN public.partner_submission_snapshots s ON(s.company_id,s.job_id,s.id)=(r.company_id,r.job_id,r.snapshot_id)
  JOIN public.partner_companies c ON c.id=r.company_id JOIN public.partner_jobs j ON(j.company_id,j.id)=(r.company_id,r.job_id)
  WHERE r.company_id=target_company AND r.job_id=target_job AND r.id=target_request
    AND c.submission_adapter_mode=s.adapter_mode AND c.submission_contract_version=s.contract_version AND c.legacy_job_prefix=s.legacy_job_prefix
    AND (s.adapter_mode='FICTIONAL' OR (c.legacy_base_url IS NOT DISTINCT FROM s.legacy_base_url_snapshot AND c.legacy_credential_key_version IS NOT DISTINCT FROM s.legacy_credential_key_version_snapshot AND c.legacy_credential_updated_at IS NOT DISTINCT FROM s.legacy_credential_updated_at_snapshot AND encode(public.digest(c.legacy_credential_ciphertext||c.legacy_credential_nonce,'sha256'),'hex') IS NOT DISTINCT FROM s.legacy_credential_fingerprint));
END $$;
ALTER FUNCTION public.partner_submission_claimed_snapshot(uuid,uuid,uuid,uuid,bigint) OWNER TO partner_submission_owner;
REVOKE ALL ON FUNCTION public.partner_submission_claimed_snapshot(uuid,uuid,uuid,uuid,bigint) FROM PUBLIC,partner_portal_runtime,partner_submission_worker;
GRANT EXECUTE ON FUNCTION public.partner_submission_claimed_snapshot(uuid,uuid,uuid,uuid,bigint) TO partner_submission_worker;
DROP FUNCTION public.partner_submission_claimed_plans(uuid,uuid,uuid,uuid,bigint);
CREATE FUNCTION public.partner_submission_claimed_plans(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint)
RETURNS TABLE(ordinal smallint,drawing_id uuid,artifact_id uuid,remote_file_name text,content_sha256 text,byte_size integer,pdf_bytes bytea,delivery_state text,remote_storage_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT public.partner_submission_lock_lease(target_company,target_job,target_request,target_lease,target_fence) THEN RETURN; END IF;
  RETURN QUERY SELECT m.ordinal,m.drawing_id,m.artifact_id,m.remote_file_name::text,m.content_sha256::text,m.byte_size,a.pdf_bytes,d.state::text,d.remote_storage_key::text
  FROM public.partner_submission_requests r JOIN public.partner_submission_plan_manifest m ON(m.company_id,m.job_id,m.snapshot_id)=(r.company_id,r.job_id,r.snapshot_id)
  JOIN public.partner_site_plan_pdf_artifacts a ON(a.company_id,a.job_id,a.drawing_id,a.id)=(m.company_id,m.job_id,m.drawing_id,m.artifact_id)
  JOIN public.partner_submission_plan_deliveries d ON(d.company_id,d.job_id,d.request_id,d.snapshot_id,d.ordinal,d.drawing_id)=(r.company_id,r.job_id,r.id,r.snapshot_id,m.ordinal,m.drawing_id)
  WHERE r.company_id=target_company AND r.job_id=target_job AND r.id=target_request ORDER BY m.ordinal;
END $$;
ALTER FUNCTION public.partner_submission_claimed_plans(uuid,uuid,uuid,uuid,bigint) OWNER TO partner_submission_owner;
REVOKE ALL ON FUNCTION public.partner_submission_claimed_plans(uuid,uuid,uuid,uuid,bigint) FROM PUBLIC,partner_portal_runtime,partner_submission_worker;
GRANT EXECUTE ON FUNCTION public.partner_submission_claimed_plans(uuid,uuid,uuid,uuid,bigint) TO partner_submission_worker;
ALTER TABLE public.partner_outbox_events DROP CONSTRAINT partner_outbox_notification_receipt,DROP CONSTRAINT partner_outbox_notification_phase,DROP COLUMN notification_backfilled,DROP COLUMN notification_accepted_at,DROP COLUMN notification_receipt,DROP COLUMN notification_phase;
ALTER TABLE public.partner_submission_requests DROP CONSTRAINT partner_submission_remote_quote_fingerprint,DROP CONSTRAINT partner_submission_attach_attempt_count,DROP COLUMN remote_quote_fingerprint,DROP COLUMN attach_attempt_count,DROP COLUMN worker_v2_started;
ALTER TABLE public.partner_audit_events DROP CONSTRAINT partner_audit_event_type;
ALTER TABLE public.partner_audit_events ADD CONSTRAINT partner_audit_event_type CHECK(event_type IN('LOGIN_SUCCEEDED','LOGIN_FAILED','LOGOUT','USER_PROVISIONED','USER_DISABLED','SESSIONS_REVOKED','LEGACY_CREDENTIAL_REPLACED','SUBMISSION_FROZEN','SUBMISSION_CLAIMED','SUBMISSION_PHASE_CHECKPOINTED','SUBMISSION_FINALIZED','SUBMISSION_FAILED_RETRYABLE','SUBMISSION_RECONCILIATION_REQUIRED'));
CREATE OR REPLACE FUNCTION public.partner_submission_safe_error_code(value text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT value IN ('LEASE_EXPIRED','NETWORK_ERROR','PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE','PROVIDER_REJECTED','UPLOAD_FAILED','ATTACH_FAILED','CREDENTIAL_ROTATED','AMBIGUOUS_LEGACY_RESULT','SUBMISSION_LEASE_LOST')
$$;
ALTER FUNCTION public.partner_submission_safe_error_code(text) OWNER TO partner_submission_owner;
GRANT EXECUTE ON FUNCTION public.partner_claim_submission(text,integer),public.partner_checkpoint_submission(uuid,uuid,uuid,uuid,bigint,text,text,bigint,integer,text),public.partner_release_submission(uuid,uuid,uuid,uuid,bigint,text,timestamptz),public.partner_finalize_submission(uuid,uuid,uuid,uuid,bigint) TO partner_submission_worker;
GRANT EXECUTE ON FUNCTION public.partner_submission_status(uuid,uuid) TO partner_submission_worker;
REVOKE CREATE ON SCHEMA public FROM partner_submission_owner;
DO $$ BEGIN EXECUTE format('REVOKE partner_submission_owner FROM %I',session_user); END $$;
COMMIT;
