BEGIN;
-- Owner rights are temporary and restricted to this schema migration.
DO $$ BEGIN EXECUTE format('GRANT partner_submission_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user); END $$;
GRANT CREATE ON SCHEMA public TO partner_submission_owner;
ALTER TABLE public.partner_audit_events DROP CONSTRAINT partner_audit_event_type;
ALTER TABLE public.partner_audit_events ADD CONSTRAINT partner_audit_event_type CHECK(event_type IN('DRAFT_DELETED',
 'LOGIN_SUCCEEDED','LOGIN_FAILED','LOGOUT','USER_PROVISIONED','USER_DISABLED','SESSIONS_REVOKED','LEGACY_CREDENTIAL_REPLACED',
 'SUBMISSION_FROZEN','SUBMISSION_CLAIMED','SUBMISSION_PHASE_CHECKPOINTED','SUBMISSION_FINALIZED','SUBMISSION_FAILED_RETRYABLE','SUBMISSION_RECONCILIATION_REQUIRED',
 'SUBMISSION_EXECUTE_DISCARDED','SUBMISSION_NOTIFICATION_CLAIMED','SUBMISSION_NOTIFICATION_RELEASED','SUBMISSION_NOTIFICATION_DELIVERED','SUBMISSION_NOTIFICATION_DEAD',
 'OPS_COMPANY_CREATED','OPS_COMPANY_UPDATED','OPS_PARTNER_USER_PROVISIONED','OPS_FACT_RECORDED','OPS_AMENDMENT_RECORDED','OPS_INVOICE_RECORDED','OPS_SETTLEMENT_RECORDED'));
-- PostgreSQL row locks require UPDATE on at least one column; this NOLOGIN owner is not the runtime role.
GRANT UPDATE(id) ON public.partner_users TO partner_submission_owner;
ALTER TABLE public.partner_jobs ADD COLUMN deleted_at timestamptz,
  ADD CONSTRAINT partner_deleted_draft_only CHECK (deleted_at IS NULL OR (
    submission_state='DRAFT' AND submission_checkpoint='NONE' AND submission_started_at IS NULL
    AND submitted_at IS NULL AND legacy_job_id IS NULL AND legacy_job_number IS NULL));
CREATE FUNCTION public.partner_guard_deleted_draft() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'DRAFT_DELETED'; END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER partner_deleted_draft_guard BEFORE UPDATE OR DELETE ON public.partner_jobs
  FOR EACH ROW EXECUTE FUNCTION public.partner_guard_deleted_draft();
CREATE FUNCTION public.partner_guard_deleted_draft_plan() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.partner_jobs WHERE company_id=COALESCE(NEW.company_id,OLD.company_id)
    AND id=COALESCE(NEW.job_id,OLD.job_id) AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'DRAFT_DELETED'; END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER partner_deleted_draft_plan_guard BEFORE INSERT OR UPDATE OR DELETE ON public.partner_site_plan_drawings
  FOR EACH ROW EXECUTE FUNCTION public.partner_guard_deleted_draft_plan();
CREATE FUNCTION public.partner_delete_draft(target_company uuid,target_job uuid,target_user text,expected_revision integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.partner_jobs;
BEGIN
  PERFORM id FROM public.partner_companies WHERE id=target_company AND is_active=true FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  PERFORM id FROM public.partner_users WHERE id=target_user AND company_id=target_company
    AND principal_type='PARTNER' AND disabled_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  SELECT * INTO job FROM public.partner_jobs WHERE company_id=target_company AND id=target_job FOR UPDATE;
  IF NOT FOUND OR job.deleted_at IS NOT NULL THEN RETURN 'not_found'; END IF;
  IF job.submission_state<>'DRAFT' OR job.submission_checkpoint<>'NONE'
    OR job.submission_started_at IS NOT NULL OR job.legacy_job_id IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.partner_submission_requests WHERE company_id=target_company AND job_id=target_job)
    OR EXISTS(SELECT 1 FROM public.partner_submission_snapshots WHERE company_id=target_company AND job_id=target_job)
  THEN RETURN 'not_draft'; END IF;
  IF expected_revision IS NULL OR expected_revision<0 OR job.revision<>expected_revision THEN RETURN 'stale'; END IF;
  UPDATE public.partner_jobs SET deleted_at=now(),revision=revision+1,updated_at=now() WHERE company_id=target_company AND id=target_job;
  INSERT INTO public.partner_audit_events(event_type,actor_user_id,company_id,job_id,metadata)
    VALUES('DRAFT_DELETED',target_user,target_company,target_job,'{}'::jsonb);
  RETURN 'deleted';
END $$;
ALTER FUNCTION public.partner_delete_draft(uuid,uuid,text,integer) OWNER TO partner_submission_owner;
REVOKE ALL ON FUNCTION public.partner_delete_draft(uuid,uuid,text,integer),public.partner_guard_deleted_draft(),public.partner_guard_deleted_draft_plan() FROM PUBLIC;
GRANT SELECT(deleted_at) ON public.partner_jobs TO partner_portal_runtime;
GRANT EXECUTE ON FUNCTION public.partner_delete_draft(uuid,uuid,text,integer) TO partner_portal_runtime;
REVOKE CREATE ON SCHEMA public FROM partner_submission_owner;
DO $$ BEGIN EXECUTE format('REVOKE partner_submission_owner FROM %I',session_user); END $$;
COMMIT;
