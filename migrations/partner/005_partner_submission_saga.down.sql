BEGIN;

DO $$
DECLARE
  saga_rows integer;
  configured_companies integer;
  saga_jobs integer;
  saga_audit integer;
  duplicate_outbox_keys integer;
  worker_members integer;
BEGIN
  SELECT
    (SELECT count(*) FROM public.partner_submission_requests)
    + (SELECT count(*) FROM public.partner_submission_snapshots)
    + (SELECT count(*) FROM public.partner_submission_attempts)
    + (SELECT count(*) FROM public.partner_submission_plan_deliveries)
    + (SELECT count(*) FROM public.partner_submission_rate_limits)
    + (SELECT count(*) FROM public.partner_outbox_events WHERE topic = 'PARTNER_SUBMISSION_EXECUTE')
  INTO saga_rows;
  SELECT count(*) INTO configured_companies FROM public.partner_companies WHERE submission_adapter_mode <> 'DISABLED' OR submission_contract_version IS NOT NULL OR legacy_job_prefix IS NOT NULL;
  SELECT count(*) INTO saga_jobs FROM public.partner_jobs WHERE submission_checkpoint <> 'NONE' OR submission_adapter_mode_snapshot IS NOT NULL OR submission_contract_version_snapshot IS NOT NULL OR legacy_job_prefix_snapshot IS NOT NULL OR legacy_job_number IS NOT NULL OR final_quote_number IS NOT NULL;
  SELECT count(*) INTO saga_audit FROM public.partner_audit_events WHERE event_type LIKE 'SUBMISSION_%';
  SELECT count(*) INTO duplicate_outbox_keys FROM (SELECT 1 FROM public.partner_outbox_events GROUP BY idempotency_key HAVING count(*) > 1) duplicates;
  -- PostgreSQL 16+ gives a CREATEROLE migrator an ADMIN-only membership.
  -- Only that migrator is exempt; actual worker logins still block rollback.
  SELECT count(*) INTO worker_members FROM pg_auth_members WHERE roleid = (SELECT oid FROM pg_roles WHERE rolname = 'partner_submission_worker')
    AND member <> (SELECT oid FROM pg_roles WHERE rolname = session_user);
  IF saga_rows > 0 OR configured_companies > 0 OR saga_jobs > 0 OR saga_audit > 0 OR duplicate_outbox_keys > 0 OR worker_members > 0 THEN
    RAISE EXCEPTION 'partner submission saga rollback refused: saga_rows=%, configured_companies=%, saga_jobs=%, saga_audit=%, duplicate_outbox_keys=%, worker_members=%', saga_rows, configured_companies, saga_jobs, saga_audit, duplicate_outbox_keys, worker_members;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT pg_has_role(session_user,'partner_artifact_owner','USAGE') THEN EXECUTE format('GRANT partner_artifact_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user); END IF;
  IF NOT pg_has_role(session_user,'partner_submission_owner','USAGE') THEN EXECUTE format('GRANT partner_submission_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user); END IF;
  IF NOT pg_has_role(session_user,'partner_submission_worker','USAGE') THEN EXECUTE format('GRANT partner_submission_worker TO %I',session_user); END IF;
  GRANT CREATE ON SCHEMA public TO partner_artifact_owner;
END $$;

DROP FUNCTION public.partner_submission_claimed_plans(uuid,uuid,uuid,uuid,bigint);
DROP FUNCTION public.partner_submission_claimed_snapshot(uuid,uuid,uuid,uuid,bigint);
DROP FUNCTION public.partner_consume_submission_rate_limit(uuid,text,text,integer,integer);
DROP FUNCTION public.partner_submission_status(uuid,uuid);
DROP FUNCTION public.partner_reconcile_submission(uuid,uuid,uuid,uuid,bigint,text);
DROP FUNCTION public.partner_finalize_submission(uuid,uuid,uuid,uuid,bigint);
DROP FUNCTION public.partner_release_submission(uuid,uuid,uuid,uuid,bigint,text,timestamptz);
DROP FUNCTION public.partner_checkpoint_submission(uuid,uuid,uuid,uuid,bigint,text,text,bigint,integer,text);
DROP FUNCTION public.partner_heartbeat_submission(uuid,uuid,uuid,uuid,bigint,integer);
DROP FUNCTION public.partner_submission_lock_lease(uuid,uuid,uuid,uuid,bigint);
DROP FUNCTION public.partner_claim_submission(text,integer);
DROP FUNCTION public.partner_freeze_submission(uuid,uuid,text,integer,integer,uuid,uuid,text,text,jsonb);
DROP FUNCTION public.partner_submission_remote_file_name(text,uuid,integer,uuid,text);
DROP FUNCTION public.partner_submission_request_id(uuid,uuid,text);
DROP FUNCTION public.partner_submission_render_text(text);
DROP FUNCTION public.partner_submission_snapshot_shape_valid(jsonb);
DROP FUNCTION public.partner_submission_jsonb_nfc(jsonb);
DROP FUNCTION public.partner_submission_job_ready(public.partner_jobs);

DROP TRIGGER partner_submission_guard_drawing ON public.partner_site_plan_drawings;
DROP FUNCTION public.partner_submission_guard_drawing_change();
DROP TRIGGER partner_submission_guard_job ON public.partner_jobs;
DROP FUNCTION public.partner_submission_guard_job_change();
DROP TRIGGER partner_submission_guard_audit ON public.partner_audit_events;
DROP FUNCTION public.partner_submission_guard_audit_insert();
DROP TRIGGER partner_submission_manifest_append_only ON public.partner_submission_plan_manifest;
DROP TRIGGER partner_submission_snapshots_append_only ON public.partner_submission_snapshots;

DROP FUNCTION public.partner_prune_site_plan_pdf_artifacts(uuid);

ALTER TABLE public.partner_audit_events
  DROP CONSTRAINT partner_audit_submission_metadata,
  DROP CONSTRAINT partner_audit_submission_request_fk,
  DROP CONSTRAINT partner_audit_job_fk,
  DROP CONSTRAINT partner_audit_event_type,
  DROP COLUMN submission_request_id,
  DROP COLUMN job_id,
  ADD CONSTRAINT partner_audit_event_type CHECK (event_type IN ('LOGIN_SUCCEEDED','LOGIN_FAILED','LOGOUT','USER_PROVISIONED','USER_DISABLED','SESSIONS_REVOKED','LEGACY_CREDENTIAL_REPLACED'));

DROP INDEX public.partner_outbox_submission_claim_idx;
DROP INDEX public.partner_outbox_submission_request_unique;
DROP INDEX public.partner_outbox_global_idempotency_unique;
DROP INDEX public.partner_outbox_company_idempotency_unique;
ALTER TABLE public.partner_outbox_events
  DROP CONSTRAINT partner_outbox_submission_payload,
  DROP CONSTRAINT partner_outbox_submission_safe_error,
  DROP CONSTRAINT partner_outbox_lease_complete,
  DROP CONSTRAINT partner_outbox_fence_nonnegative,
  DROP CONSTRAINT partner_outbox_submission_request_fk,
  DROP COLUMN lease_expires_at,
  DROP COLUMN lease_owner,
  DROP COLUMN fence_token,
  DROP COLUMN lease_token,
  DROP COLUMN request_id,
  ADD CONSTRAINT partner_outbox_events_idempotency_key_key UNIQUE (idempotency_key);
DROP FUNCTION public.partner_submission_outbox_payload_valid(text,uuid,uuid,uuid,jsonb);

DROP INDEX public.partner_submission_attempt_fence_unique;
DROP INDEX public.partner_submission_attempt_active_lease_unique;
ALTER TABLE public.partner_submission_attempts
  DROP CONSTRAINT partner_submission_attempt_request_number_unique,
  DROP CONSTRAINT partner_submission_attempt_safe_error,
  DROP CONSTRAINT partner_submission_attempt_lease_time,
  DROP CONSTRAINT partner_submission_attempt_lease_owner,
  DROP CONSTRAINT partner_submission_attempt_fence_positive,
  DROP CONSTRAINT partner_submission_attempt_request_fk,
  DROP COLUMN heartbeat_at,
  DROP COLUMN lease_expires_at,
  DROP COLUMN lease_owner,
  DROP COLUMN fence_token,
  DROP COLUMN lease_token,
  DROP COLUMN request_id,
  ADD COLUMN idempotency_key varchar(200) NOT NULL,
  ADD CONSTRAINT partner_submission_idempotency_unique UNIQUE (company_id, idempotency_key);

DROP TABLE public.partner_submission_plan_deliveries;
DROP TABLE public.partner_submission_rate_limits;
DROP TABLE public.partner_submission_requests;
DROP TABLE public.partner_submission_plan_manifest;
DROP TABLE public.partner_submission_snapshots;
DROP FUNCTION public.partner_submission_safe_error_code(text);

DROP INDEX public.partner_jobs_company_final_quote_unique;
DROP INDEX public.partner_jobs_company_legacy_number_unique;
ALTER TABLE public.partner_jobs
  DROP CONSTRAINT partner_jobs_submission_contract_snapshot,
  DROP CONSTRAINT partner_jobs_submission_checkpoint,
  DROP CONSTRAINT partner_jobs_final_quote_number_safe,
  DROP CONSTRAINT partner_jobs_legacy_job_number_positive,
  DROP COLUMN submission_checkpoint,
  DROP COLUMN legacy_job_prefix_snapshot,
  DROP COLUMN submission_contract_version_snapshot,
  DROP COLUMN submission_adapter_mode_snapshot,
  DROP COLUMN final_quote_number,
  DROP COLUMN legacy_job_number;

ALTER TABLE public.partner_companies
  DROP CONSTRAINT partner_company_submission_contract_complete,
  DROP CONSTRAINT partner_company_submission_adapter_mode,
  DROP COLUMN legacy_job_prefix,
  DROP COLUMN submission_contract_version,
  DROP COLUMN submission_adapter_mode;

CREATE OR REPLACE FUNCTION public.partner_prune_site_plan_pdf_artifacts(target_company uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE deleted_count integer := 0; quota_bytes bigint;
BEGIN
  PERFORM 1 FROM public.partner_companies WHERE id=target_company FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_company::text, 914));
  PERFORM id FROM public.partner_jobs WHERE company_id=target_company ORDER BY id FOR UPDATE;
  PERFORM id FROM public.partner_site_plan_drawings WHERE company_id=target_company ORDER BY job_id,id FOR UPDATE;
  PERFORM id FROM public.partner_site_plan_pdf_artifacts WHERE company_id=target_company ORDER BY job_id,drawing_id,id FOR UPDATE;
  WITH ranked AS (
    SELECT a.company_id, a.job_id, a.drawing_id, a.id,
      row_number() OVER (PARTITION BY a.company_id, a.drawing_id ORDER BY a.generated_at DESC, a.id DESC) AS history_rank
    FROM public.partner_site_plan_pdf_artifacts a
    JOIN public.partner_site_plan_drawings d ON (d.company_id,d.job_id,d.id)=(a.company_id,a.job_id,a.drawing_id)
    WHERE a.company_id = target_company AND a.id IS DISTINCT FROM d.current_pdf_artifact_id
  ), removed AS (
    DELETE FROM public.partner_site_plan_pdf_artifacts a USING ranked r
    WHERE (a.company_id,a.job_id,a.drawing_id,a.id)=(r.company_id,r.job_id,r.drawing_id,r.id) AND r.history_rank > 2 RETURNING 1
  ) SELECT count(*) INTO deleted_count FROM removed;
  SELECT COALESCE(sum(byte_size),0) INTO quota_bytes FROM public.partner_site_plan_pdf_artifacts WHERE company_id=target_company;
  IF quota_bytes > 1073741824 THEN
    WITH candidates AS (
      SELECT a.company_id,a.job_id,a.drawing_id,a.id,a.byte_size,
        sum(a.byte_size) OVER (ORDER BY a.generated_at,a.id) AS running_bytes
      FROM public.partner_site_plan_pdf_artifacts a
      JOIN public.partner_site_plan_drawings d ON (d.company_id,d.job_id,d.id)=(a.company_id,a.job_id,a.drawing_id)
      WHERE a.company_id=target_company AND a.id IS DISTINCT FROM d.current_pdf_artifact_id
    ), removed AS (
      DELETE FROM public.partner_site_plan_pdf_artifacts a USING candidates c
      WHERE (a.company_id,a.job_id,a.drawing_id,a.id)=(c.company_id,c.job_id,c.drawing_id,c.id)
        AND c.running_bytes - c.byte_size < quota_bytes - 1073741824 RETURNING 1
    ) SELECT deleted_count + count(*) INTO deleted_count FROM removed;
  END IF;
  IF (SELECT COALESCE(sum(byte_size),0) FROM public.partner_site_plan_pdf_artifacts WHERE company_id=target_company) > 1073741824 THEN
    RAISE EXCEPTION 'site plan PDF company quota exceeded';
  END IF;
  RETURN deleted_count;
END;
$$;
ALTER FUNCTION public.partner_prune_site_plan_pdf_artifacts(uuid) OWNER TO partner_artifact_owner;
REVOKE ALL ON FUNCTION public.partner_prune_site_plan_pdf_artifacts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_prune_site_plan_pdf_artifacts(uuid) TO partner_portal_runtime;

REVOKE ALL ON public.partner_jobs FROM partner_portal_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.partner_jobs TO partner_portal_runtime;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.partner_site_plan_drawings FROM partner_portal_runtime;
GRANT SELECT ON public.partner_site_plan_drawings TO partner_portal_runtime;
GRANT INSERT(company_id,job_id,name,sort_order,drawing_data,created_by_user_id) ON public.partner_site_plan_drawings TO partner_portal_runtime;
GRANT UPDATE(name,sort_order,drawing_data,revision,updated_at) ON public.partner_site_plan_drawings TO partner_portal_runtime;
REVOKE UPDATE(current_pdf_artifact_id,submitted_snapshot_data,submitted_snapshot_at,submitted_pdf_storage_key,submitted_pdf_outbox_event_id) ON public.partner_site_plan_drawings FROM partner_portal_runtime;

DROP OWNED BY partner_submission_worker;
DROP OWNED BY partner_submission_owner;
DO $$ BEGIN
  IF session_user <> 'partner_submission_owner' AND pg_has_role(session_user,'partner_submission_owner','MEMBER') THEN EXECUTE format('REVOKE partner_submission_owner FROM %I',session_user); END IF;
  IF session_user <> 'partner_submission_worker' AND pg_has_role(session_user,'partner_submission_worker','MEMBER') THEN EXECUTE format('REVOKE partner_submission_worker FROM %I',session_user); END IF;
END $$;
DROP ROLE partner_submission_worker;
DROP ROLE partner_submission_owner;

DO $$ BEGIN
  IF session_user <> 'partner_artifact_owner' AND pg_has_role(session_user,'partner_artifact_owner','MEMBER') THEN EXECUTE format('REVOKE partner_artifact_owner FROM %I',session_user); END IF;
END $$;

REVOKE CREATE ON SCHEMA public FROM partner_artifact_owner;
COMMIT;
