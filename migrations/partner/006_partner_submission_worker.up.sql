BEGIN;
-- Owner rights are temporary and restricted to this schema migration.
DO $$ BEGIN EXECUTE format('GRANT partner_submission_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user); END $$;
GRANT CREATE ON SCHEMA public TO partner_submission_owner;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.partner_outbox_events WHERE state='PROCESSING' AND lease_expires_at>=now()) THEN RAISE EXCEPTION 'partner worker migration refused: active lease'; END IF;
END $$;

ALTER TABLE public.partner_outbox_events
  ADD COLUMN notification_phase varchar(32),
  ADD COLUMN notification_receipt varchar(200),
  ADD COLUMN notification_accepted_at timestamptz,
  ADD COLUMN notification_backfilled boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT partner_outbox_notification_phase CHECK (notification_phase IS NULL OR notification_phase IN ('READY','ACCEPTED_PENDING')),
  ADD CONSTRAINT partner_outbox_notification_receipt CHECK (
    (notification_phase IS NULL AND notification_receipt IS NULL AND notification_accepted_at IS NULL)
    OR (notification_phase='READY' AND notification_receipt IS NULL AND notification_accepted_at IS NULL)
    OR (notification_phase='ACCEPTED_PENDING' AND notification_receipt ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' AND notification_accepted_at IS NOT NULL)
  );

ALTER TABLE public.partner_submission_requests ADD COLUMN attach_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN remote_quote_fingerprint char(64),
  ADD COLUMN worker_v2_started boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT partner_submission_remote_quote_fingerprint CHECK(remote_quote_fingerprint IS NULL OR remote_quote_fingerprint~'^[0-9a-f]{64}$'),
  ADD CONSTRAINT partner_submission_attach_attempt_count CHECK(attach_attempt_count BETWEEN 0 AND 3);

ALTER TABLE public.partner_audit_events DROP CONSTRAINT partner_audit_event_type;
ALTER TABLE public.partner_audit_events ADD CONSTRAINT partner_audit_event_type CHECK(event_type IN('LOGIN_SUCCEEDED','LOGIN_FAILED','LOGOUT','USER_PROVISIONED','USER_DISABLED','SESSIONS_REVOKED','LEGACY_CREDENTIAL_REPLACED','SUBMISSION_FROZEN','SUBMISSION_CLAIMED','SUBMISSION_PHASE_CHECKPOINTED','SUBMISSION_FINALIZED','SUBMISSION_FAILED_RETRYABLE','SUBMISSION_RECONCILIATION_REQUIRED','SUBMISSION_EXECUTE_DISCARDED','SUBMISSION_NOTIFICATION_CLAIMED','SUBMISSION_NOTIFICATION_RELEASED','SUBMISSION_NOTIFICATION_DELIVERED','SUBMISSION_NOTIFICATION_DEAD'));

UPDATE public.partner_outbox_events SET notification_phase='READY'
  ,notification_backfilled=true
  WHERE topic IN('PARTNER_SUBMISSION_COMPLETED','PARTNER_SUBMISSION_RECONCILIATION_ALERT') AND notification_phase IS NULL
    AND state IN('PENDING','FAILED','PROCESSING');
ALTER TABLE public.partner_outbox_events ADD CONSTRAINT partner_outbox_notification_topic_phase CHECK (
  (topic IN('PARTNER_SUBMISSION_COMPLETED','PARTNER_SUBMISSION_RECONCILIATION_ALERT') AND (notification_phase IS NOT NULL OR state IN('DELIVERED','DEAD')))
  OR (topic NOT IN('PARTNER_SUBMISSION_COMPLETED','PARTNER_SUBMISSION_RECONCILIATION_ALERT') AND notification_phase IS NULL)
);

CREATE INDEX partner_outbox_notification_claim_idx ON public.partner_outbox_events(state,available_at,created_at,id)
  WHERE topic IN ('PARTNER_SUBMISSION_COMPLETED','PARTNER_SUBMISSION_RECONCILIATION_ALERT') AND state IN ('PENDING','FAILED','PROCESSING');
CREATE UNIQUE INDEX partner_submission_delivery_remote_key_unique ON public.partner_submission_plan_deliveries(company_id,job_id,request_id,remote_storage_key)
  WHERE remote_storage_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.partner_submission_safe_error_code(value text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT value IN ('LEASE_EXPIRED','NETWORK_ERROR','PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE','PROVIDER_REJECTED','UPLOAD_FAILED','ATTACH_FAILED','CREDENTIAL_ROTATED','AMBIGUOUS_LEGACY_RESULT','SUBMISSION_LEASE_LOST','MALFORMED_FROZEN_STATE','NOTIFICATION_REJECTED')
$$;

CREATE OR REPLACE FUNCTION public.partner_worker_snapshot_matches(target_canonical text,target_snapshot jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
BEGIN
  RETURN target_canonical::jsonb=target_snapshot;
EXCEPTION WHEN invalid_text_representation OR data_exception THEN
  RETURN false;
END $$;

DROP FUNCTION public.partner_submission_claimed_snapshot(uuid,uuid,uuid,uuid,bigint);
CREATE FUNCTION public.partner_submission_claimed_snapshot(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint)
RETURNS TABLE(canonical_document text,snapshot_sha256 text,adapter_mode text,contract_version text,legacy_job_prefix text,checkpoint text,legacy_job_id text,legacy_job_number bigint,final_quote_number text,legacy_base_url text,legacy_credential_ciphertext bytea,legacy_credential_nonce bytea,legacy_credential_key_version integer,legacy_credential_fingerprint text,legacy_credential_updated_at timestamptz,remote_quote_fingerprint text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT public.partner_submission_lock_lease(target_company,target_job,target_request,target_lease,target_fence) THEN RETURN; END IF;
  RETURN QUERY SELECT s.canonical_document,s.snapshot_sha256::text,s.adapter_mode::text,s.contract_version::text,s.legacy_job_prefix::text,j.submission_checkpoint::text,j.legacy_job_id::text,j.legacy_job_number,j.final_quote_number::text,
    CASE WHEN s.adapter_mode='LIVE' THEN c.legacy_base_url ELSE NULL END,CASE WHEN s.adapter_mode='LIVE' THEN c.legacy_credential_ciphertext ELSE NULL END,
    CASE WHEN s.adapter_mode='LIVE' THEN c.legacy_credential_nonce ELSE NULL END,CASE WHEN s.adapter_mode='LIVE' THEN c.legacy_credential_key_version ELSE NULL END,
    CASE WHEN s.adapter_mode='LIVE' THEN s.legacy_credential_fingerprint::text ELSE NULL END,CASE WHEN s.adapter_mode='LIVE' THEN s.legacy_credential_updated_at_snapshot ELSE NULL END,r.remote_quote_fingerprint::text
  FROM public.partner_submission_requests r JOIN public.partner_submission_snapshots s ON(s.company_id,s.job_id,s.id)=(r.company_id,r.job_id,r.snapshot_id)
  JOIN public.partner_companies c ON c.id=r.company_id JOIN public.partner_jobs j ON(j.company_id,j.id)=(r.company_id,r.job_id)
  WHERE r.company_id=target_company AND r.job_id=target_job AND r.id=target_request
    AND c.submission_adapter_mode=s.adapter_mode AND c.submission_contract_version=s.contract_version AND c.legacy_job_prefix=s.legacy_job_prefix
    AND (s.adapter_mode='FICTIONAL' OR (c.legacy_base_url IS NOT DISTINCT FROM s.legacy_base_url_snapshot AND c.legacy_credential_key_version IS NOT DISTINCT FROM s.legacy_credential_key_version_snapshot
      AND c.legacy_credential_updated_at IS NOT DISTINCT FROM s.legacy_credential_updated_at_snapshot AND encode(public.digest(c.legacy_credential_ciphertext||c.legacy_credential_nonce,'sha256'),'hex') IS NOT DISTINCT FROM s.legacy_credential_fingerprint));
END $$;

DROP FUNCTION public.partner_submission_claimed_plans(uuid,uuid,uuid,uuid,bigint);
CREATE FUNCTION public.partner_submission_claimed_plans(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint)
RETURNS TABLE(ordinal smallint,drawing_id uuid,artifact_id uuid,drawing_revision integer,drawing_name text,document_sha256 text,render_hash text,renderer_version text,template_version text,template_sha256 text,local_file_name text,remote_file_name text,content_sha256 text,byte_size integer,pdf_bytes bytea,delivery_state text,remote_storage_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT public.partner_submission_lock_lease(target_company,target_job,target_request,target_lease,target_fence) THEN RETURN; END IF;
  RETURN QUERY SELECT m.ordinal,m.drawing_id,m.artifact_id,m.drawing_revision,m.drawing_name::text,m.document_sha256::text,m.render_hash::text,m.renderer_version::text,m.template_version::text,m.template_sha256::text,m.local_file_name::text,
    m.remote_file_name::text,m.content_sha256::text,m.byte_size,a.pdf_bytes,d.state::text,d.remote_storage_key::text
  FROM public.partner_submission_requests r JOIN public.partner_submission_plan_manifest m ON(m.company_id,m.job_id,m.snapshot_id)=(r.company_id,r.job_id,r.snapshot_id)
  JOIN public.partner_site_plan_pdf_artifacts a ON(a.company_id,a.job_id,a.drawing_id,a.id)=(m.company_id,m.job_id,m.drawing_id,m.artifact_id)
  JOIN public.partner_submission_plan_deliveries d ON(d.company_id,d.job_id,d.request_id,d.snapshot_id,d.ordinal,d.drawing_id)=(r.company_id,r.job_id,r.id,r.snapshot_id,m.ordinal,m.drawing_id)
  WHERE r.company_id=target_company AND r.job_id=target_job AND r.id=target_request ORDER BY m.ordinal;
END $$;

CREATE OR REPLACE FUNCTION public.partner_claim_submission_bounded(target_worker text,lease_seconds integer DEFAULT 120)
RETURNS TABLE(company_id uuid,job_id uuid,request_id uuid,snapshot_id uuid,lease_token uuid,fence_token bigint,attempt_number integer,claim_status text,queue_age_bucket text,reclaimed_lease boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
DECLARE claimed record;exhausted record;terminal_success record;candidate record;claimed_event record;
BEGIN
  IF target_worker !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' OR lease_seconds NOT BETWEEN 30 AND 900 THEN RAISE EXCEPTION 'SUBMISSION_INVALID_LEASE'; END IF;
  SELECT o.company_id,o.job_id,o.request_id,r.snapshot_id,o.fence_token,o.created_at,o.state INTO terminal_success
  FROM public.partner_outbox_events o JOIN public.partner_submission_requests r ON(r.company_id,r.job_id,r.id)=(o.company_id,o.job_id,o.request_id)
  JOIN public.partner_jobs j ON(j.company_id,j.id)=(r.company_id,r.job_id)
  WHERE o.topic='PARTNER_SUBMISSION_EXECUTE' AND o.available_at<=now() AND (o.state IN('PENDING','FAILED') OR(o.state='PROCESSING' AND o.lease_expires_at<now()))
    AND (r.state='SUCCEEDED' OR j.submission_state='SUBMITTED' OR j.submission_checkpoint='FINALIZED')
  ORDER BY o.available_at,o.created_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1;
  IF FOUND THEN
    UPDATE public.partner_outbox_events SET state='DEAD',last_error_code='MALFORMED_FROZEN_STATE',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
      WHERE company_id=terminal_success.company_id AND job_id=terminal_success.job_id AND request_id=terminal_success.request_id AND topic='PARTNER_SUBMISSION_EXECUTE';
    UPDATE public.partner_submission_requests SET worker_v2_started=true WHERE company_id=terminal_success.company_id AND job_id=terminal_success.job_id AND id=terminal_success.request_id;
    INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata)
      VALUES('SUBMISSION_EXECUTE_DISCARDED',terminal_success.company_id,terminal_success.job_id,terminal_success.request_id,jsonb_build_object('phase','TERMINAL_SUCCESS'));
    company_id:=terminal_success.company_id;job_id:=terminal_success.job_id;request_id:=terminal_success.request_id;snapshot_id:=terminal_success.snapshot_id;lease_token:=NULL;fence_token:=terminal_success.fence_token;attempt_number:=0;claim_status:='SUCCEEDED';
    queue_age_bucket:=CASE WHEN now()-terminal_success.created_at<interval '1 minute' THEN 'LT_1M' WHEN now()-terminal_success.created_at<interval '5 minutes' THEN 'LT_5M' WHEN now()-terminal_success.created_at<interval '1 hour' THEN 'LT_1H' ELSE 'GTE_1H' END;reclaimed_lease:=terminal_success.state='PROCESSING';RETURN NEXT;RETURN;
  END IF;
  SELECT o.company_id,o.job_id,o.request_id,r.snapshot_id,o.fence_token,o.created_at,o.state,(SELECT COALESCE(max(a.attempt_number),0) FROM public.partner_submission_attempts a WHERE (a.company_id,a.job_id,a.request_id)=(o.company_id,o.job_id,o.request_id)) attempt_number INTO exhausted
  FROM public.partner_outbox_events o JOIN public.partner_submission_requests r ON(r.company_id,r.job_id,r.id)=(o.company_id,o.job_id,o.request_id)
  WHERE o.topic='PARTNER_SUBMISSION_EXECUTE' AND o.available_at<=now() AND (o.state IN('PENDING','FAILED') OR(o.state='PROCESSING' AND o.lease_expires_at<now()))
    AND (SELECT COALESCE(max(a.attempt_number),0) FROM public.partner_submission_attempts a WHERE (a.company_id,a.job_id,a.request_id)=(o.company_id,o.job_id,o.request_id))>=5
  ORDER BY o.available_at,o.created_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1;
  IF FOUND THEN
    UPDATE public.partner_submission_attempts SET outcome='RECONCILIATION_REQUIRED',error_code='PROVIDER_UNAVAILABLE',reconciliation_note='manual-review-required',finished_at=now() WHERE company_id=exhausted.company_id AND job_id=exhausted.job_id AND request_id=exhausted.request_id AND outcome='IN_PROGRESS';
    UPDATE public.partner_outbox_events SET state='DEAD',last_error_code='PROVIDER_UNAVAILABLE',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE company_id=exhausted.company_id AND id=(SELECT id FROM public.partner_outbox_events WHERE company_id=exhausted.company_id AND job_id=exhausted.job_id AND request_id=exhausted.request_id AND topic='PARTNER_SUBMISSION_EXECUTE');
    UPDATE public.partner_submission_requests SET state='RECONCILIATION_REQUIRED',safe_error_code='PROVIDER_UNAVAILABLE',updated_at=now() WHERE company_id=exhausted.company_id AND job_id=exhausted.job_id AND id=exhausted.request_id;
    UPDATE public.partner_submission_requests SET worker_v2_started=true WHERE company_id=exhausted.company_id AND job_id=exhausted.job_id AND id=exhausted.request_id;
    UPDATE public.partner_jobs SET submission_state='RECONCILIATION_REQUIRED',submission_checkpoint='RECONCILIATION',submission_started_at=COALESCE(submission_started_at,now()),updated_at=now() WHERE company_id=exhausted.company_id AND id=exhausted.job_id;
    UPDATE public.partner_submission_plan_deliveries SET state='RECONCILIATION_REQUIRED',safe_error_code='PROVIDER_UNAVAILABLE',updated_at=now() WHERE company_id=exhausted.company_id AND job_id=exhausted.job_id AND request_id=exhausted.request_id AND state<>'ATTACHED';
    INSERT INTO public.partner_outbox_events(company_id,job_id,request_id,topic,idempotency_key,payload) VALUES(exhausted.company_id,exhausted.job_id,exhausted.request_id,'PARTNER_SUBMISSION_RECONCILIATION_ALERT','submission-reconcile:'||exhausted.company_id::text||':'||exhausted.job_id::text||':'||exhausted.request_id::text,jsonb_build_object('schemaVersion',1,'requestId',exhausted.request_id::text,'jobId',exhausted.job_id::text))
      ON CONFLICT(company_id,idempotency_key) WHERE company_id IS NOT NULL DO NOTHING;
    INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata) VALUES('SUBMISSION_RECONCILIATION_REQUIRED',exhausted.company_id,exhausted.job_id,exhausted.request_id,jsonb_build_object('errorCode','PROVIDER_UNAVAILABLE','phase','ATTEMPT_CAP'));
    company_id:=exhausted.company_id;job_id:=exhausted.job_id;request_id:=exhausted.request_id;snapshot_id:=exhausted.snapshot_id;lease_token:=NULL;fence_token:=exhausted.fence_token;attempt_number:=exhausted.attempt_number;claim_status:='RECONCILED';
    queue_age_bucket:=CASE WHEN now()-exhausted.created_at<interval '1 minute' THEN 'LT_1M' WHEN now()-exhausted.created_at<interval '5 minutes' THEN 'LT_5M' WHEN now()-exhausted.created_at<interval '1 hour' THEN 'LT_1H' ELSE 'GTE_1H' END;reclaimed_lease:=exhausted.state='PROCESSING';RETURN NEXT;RETURN;
  END IF;
  SELECT id,created_at,state INTO candidate FROM public.partner_outbox_events
    WHERE topic='PARTNER_SUBMISSION_EXECUTE' AND available_at<=now() AND (state IN('PENDING','FAILED') OR(state='PROCESSING' AND lease_expires_at<now()))
    ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO claimed FROM public.partner_claim_submission(target_worker,lease_seconds);
  IF NOT FOUND THEN RETURN; END IF;
  SELECT id,created_at INTO claimed_event FROM public.partner_outbox_events
    WHERE company_id=claimed.company_id AND job_id=claimed.job_id AND request_id=claimed.request_id AND topic='PARTNER_SUBMISSION_EXECUTE' FOR UPDATE;
  IF claimed_event.id IS DISTINCT FROM candidate.id THEN RAISE EXCEPTION 'SUBMISSION_CLAIM_ORDER_CONFLICT'; END IF;
  UPDATE public.partner_submission_requests SET worker_v2_started=true WHERE company_id=claimed.company_id AND job_id=claimed.job_id AND id=claimed.request_id;
  IF claimed.attempt_number>5 THEN
    IF public.partner_reconcile_submission(claimed.company_id,claimed.job_id,claimed.request_id,claimed.lease_token,claimed.fence_token,'PROVIDER_UNAVAILABLE') THEN
      company_id:=claimed.company_id;job_id:=claimed.job_id;request_id:=claimed.request_id;snapshot_id:=claimed.snapshot_id;
      lease_token:=NULL;fence_token:=claimed.fence_token;attempt_number:=claimed.attempt_number;claim_status:='RECONCILED';
      queue_age_bucket:=CASE WHEN now()-candidate.created_at<interval '1 minute' THEN 'LT_1M' WHEN now()-candidate.created_at<interval '5 minutes' THEN 'LT_5M' WHEN now()-candidate.created_at<interval '1 hour' THEN 'LT_1H' ELSE 'GTE_1H' END;reclaimed_lease:=candidate.state='PROCESSING';RETURN NEXT;
    END IF;
    RETURN;
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.partner_submission_requests r
    JOIN public.partner_jobs j ON(j.company_id,j.id)=(r.company_id,r.job_id)
    JOIN public.partner_outbox_events o ON(o.company_id,o.job_id,o.request_id)=(r.company_id,r.job_id,r.id) AND o.topic='PARTNER_SUBMISSION_EXECUTE'
    WHERE r.company_id=claimed.company_id AND r.job_id=claimed.job_id AND r.id=claimed.request_id AND r.snapshot_id=claimed.snapshot_id AND r.state='PROCESSING'
      AND o.state='PROCESSING' AND o.lease_token=claimed.lease_token AND o.fence_token=claimed.fence_token
      AND EXISTS(SELECT 1 FROM public.partner_submission_attempts a WHERE (a.company_id,a.job_id,a.request_id,a.lease_token,a.fence_token,a.outcome)=(r.company_id,r.job_id,r.id,claimed.lease_token,claimed.fence_token,'IN_PROGRESS'))
      AND (
        (j.submission_checkpoint='FROZEN' AND j.submission_state='QUEUED' AND j.legacy_job_id IS NULL AND j.legacy_job_number IS NULL AND j.final_quote_number IS NULL AND r.remote_quote_fingerprint IS NULL)
        OR (j.submission_checkpoint='CREATE_STARTED' AND j.submission_state='CREATING_LEAD' AND j.legacy_job_id IS NULL AND j.legacy_job_number IS NULL AND j.final_quote_number IS NULL AND r.remote_quote_fingerprint IS NULL)
        OR (j.submission_checkpoint='LEAD_CREATED' AND j.submission_state='UPDATING_QUOTE' AND j.legacy_job_id IS NOT NULL AND j.legacy_job_number IS NOT NULL AND j.final_quote_number IS NULL AND r.remote_quote_fingerprint IS NULL)
        OR (j.submission_checkpoint IN('QUOTE_UPDATED','PLANS_ATTACHED') AND j.submission_state='ATTACHING_PLANS' AND j.legacy_job_id IS NOT NULL AND j.legacy_job_number IS NOT NULL
          AND j.final_quote_number=j.legacy_job_prefix_snapshot||'-'||j.legacy_job_number::text AND r.remote_quote_fingerprint IS NOT NULL)
      )
      AND NOT EXISTS(SELECT 1 FROM public.partner_submission_plan_deliveries d WHERE d.company_id=r.company_id AND d.job_id=r.job_id AND d.request_id=r.id AND d.state='RECONCILIATION_REQUIRED')
      AND NOT EXISTS(SELECT 1 FROM public.partner_submission_plan_deliveries d WHERE d.company_id=r.company_id AND d.job_id=r.job_id AND d.request_id=r.id
        AND ((d.state IN('PENDING','FAILED','UPLOADING') AND d.remote_storage_key IS NOT NULL) OR (d.state IN('UPLOADED','ATTACHED') AND d.remote_storage_key IS NULL)))
      AND (j.submission_checkpoint NOT IN('FROZEN','CREATE_STARTED','LEAD_CREATED') OR NOT EXISTS(SELECT 1 FROM public.partner_submission_plan_deliveries d WHERE d.company_id=r.company_id AND d.job_id=r.job_id AND d.request_id=r.id AND (d.state<>'PENDING' OR d.attempt_count<>0 OR d.remote_storage_key IS NOT NULL)))
      AND (j.submission_checkpoint<>'PLANS_ATTACHED' OR NOT EXISTS(SELECT 1 FROM public.partner_submission_plan_deliveries d WHERE d.company_id=r.company_id AND d.job_id=r.job_id AND d.request_id=r.id AND d.state<>'ATTACHED'))
  ) OR NOT EXISTS(
    SELECT 1 FROM public.partner_submission_requests r JOIN public.partner_submission_snapshots s ON(s.company_id,s.job_id,s.id)=(r.company_id,r.job_id,r.snapshot_id)
    WHERE r.company_id=claimed.company_id AND r.job_id=claimed.job_id AND r.id=claimed.request_id AND r.snapshot_id=claimed.snapshot_id
      AND r.state='PROCESSING' AND s.schema_version=1 AND public.partner_worker_snapshot_matches(s.canonical_document,s.snapshot_data)
      AND s.byte_size=octet_length(convert_to(s.canonical_document,'UTF8')) AND s.snapshot_sha256=encode(public.digest(convert_to(s.canonical_document,'UTF8'),'sha256'),'hex')
  ) OR NOT EXISTS(
    SELECT 1 FROM (
      SELECT count(*) manifest_count,count(DISTINCT m.ordinal) ordinals,min(m.ordinal) first_ordinal,max(m.ordinal) last_ordinal,
        count(d.ordinal) delivery_count,count(a.id) artifact_count,
        count(*) FILTER(WHERE d.ordinal IS NOT NULL AND a.id IS NOT NULL
          AND d.snapshot_id=m.snapshot_id AND d.drawing_id=m.drawing_id
          AND a.drawing_revision=m.drawing_revision AND a.render_hash=m.render_hash
          AND a.content_sha256=m.content_sha256 AND a.byte_size=m.byte_size
          AND a.renderer_version=m.renderer_version AND a.template_version=m.template_version
          AND a.template_sha256=m.template_sha256 AND a.file_name=m.local_file_name
          AND octet_length(a.pdf_bytes)=m.byte_size
          AND encode(public.digest(a.pdf_bytes,'sha256'),'hex')=m.content_sha256
          AND substring(a.pdf_bytes from 1 for 5)=convert_to('%PDF-','UTF8')
          AND jsonb_typeof(s.snapshot_data->'plans'->m.ordinal)='object'
          AND (s.snapshot_data->'plans'->m.ordinal)->>'ordinal'=m.ordinal::text
          AND (s.snapshot_data->'plans'->m.ordinal)->>'drawingId'=m.drawing_id::text
          AND (s.snapshot_data->'plans'->m.ordinal)->>'name'=m.drawing_name
          AND (s.snapshot_data->'plans'->m.ordinal)->>'drawingRevision'=m.drawing_revision::text
          AND (s.snapshot_data->'plans'->m.ordinal)->>'documentSha256'=m.document_sha256
          AND (s.snapshot_data->'plans'->m.ordinal)#>>'{artifact,id}'=m.artifact_id::text
          AND (s.snapshot_data->'plans'->m.ordinal)#>>'{artifact,renderHash}'=m.render_hash
          AND (s.snapshot_data->'plans'->m.ordinal)#>>'{artifact,contentSha256}'=m.content_sha256
          AND (s.snapshot_data->'plans'->m.ordinal)#>>'{artifact,byteSize}'=m.byte_size::text
          AND (s.snapshot_data->'plans'->m.ordinal)#>>'{artifact,rendererVersion}'=m.renderer_version
          AND (s.snapshot_data->'plans'->m.ordinal)#>>'{artifact,templateVersion}'=m.template_version
          AND (s.snapshot_data->'plans'->m.ordinal)#>>'{artifact,templateSha256}'=m.template_sha256
          AND (s.snapshot_data->'plans'->m.ordinal)#>>'{artifact,localFileName}'=m.local_file_name
          AND (s.snapshot_data->'plans'->m.ordinal)->>'remoteFileName'=m.remote_file_name
          AND m.remote_file_name=public.partner_submission_remote_file_name(s.legacy_job_prefix,claimed.request_id,m.ordinal,m.artifact_id,m.content_sha256)) valid_count
      FROM public.partner_submission_plan_manifest m
      JOIN public.partner_submission_snapshots s ON(s.company_id,s.job_id,s.id)=(m.company_id,m.job_id,m.snapshot_id)
      LEFT JOIN public.partner_submission_plan_deliveries d ON(d.company_id,d.job_id,d.request_id,d.snapshot_id,d.ordinal,d.drawing_id)=(claimed.company_id,claimed.job_id,claimed.request_id,m.snapshot_id,m.ordinal,m.drawing_id)
      LEFT JOIN public.partner_site_plan_pdf_artifacts a ON(a.company_id,a.job_id,a.drawing_id,a.id)=(m.company_id,m.job_id,m.drawing_id,m.artifact_id)
      WHERE m.company_id=claimed.company_id AND m.job_id=claimed.job_id AND m.snapshot_id=claimed.snapshot_id
    ) parity WHERE manifest_count BETWEEN 1 AND 20 AND ordinals=manifest_count AND first_ordinal=0 AND last_ordinal=manifest_count-1
      AND delivery_count=manifest_count AND artifact_count=manifest_count AND valid_count=manifest_count
  ) OR EXISTS(
    SELECT 1 FROM public.partner_submission_plan_deliveries d WHERE d.company_id=claimed.company_id AND d.job_id=claimed.job_id AND d.request_id=claimed.request_id
      AND NOT EXISTS(SELECT 1 FROM public.partner_submission_plan_manifest m WHERE (m.company_id,m.job_id,m.snapshot_id,m.ordinal,m.drawing_id)=(d.company_id,d.job_id,d.snapshot_id,d.ordinal,d.drawing_id))
  ) THEN
    IF public.partner_reconcile_submission(claimed.company_id,claimed.job_id,claimed.request_id,claimed.lease_token,claimed.fence_token,'MALFORMED_FROZEN_STATE') THEN
      company_id:=claimed.company_id;job_id:=claimed.job_id;request_id:=claimed.request_id;snapshot_id:=claimed.snapshot_id;
      lease_token:=NULL;fence_token:=claimed.fence_token;attempt_number:=claimed.attempt_number;claim_status:='RECONCILED';
      queue_age_bucket:=CASE WHEN now()-candidate.created_at<interval '1 minute' THEN 'LT_1M' WHEN now()-candidate.created_at<interval '5 minutes' THEN 'LT_5M' WHEN now()-candidate.created_at<interval '1 hour' THEN 'LT_1H' ELSE 'GTE_1H' END;reclaimed_lease:=candidate.state='PROCESSING';RETURN NEXT;
    END IF;
    RETURN;
  END IF;
  company_id:=claimed.company_id;job_id:=claimed.job_id;request_id:=claimed.request_id;snapshot_id:=claimed.snapshot_id;
  lease_token:=claimed.lease_token;fence_token:=claimed.fence_token;attempt_number:=claimed.attempt_number;claim_status:='CLAIMED';
  queue_age_bucket:=CASE WHEN now()-candidate.created_at<interval '1 minute' THEN 'LT_1M' WHEN now()-candidate.created_at<interval '5 minutes' THEN 'LT_5M' WHEN now()-candidate.created_at<interval '1 hour' THEN 'LT_1H' ELSE 'GTE_1H' END;reclaimed_lease:=candidate.state='PROCESSING';RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.partner_begin_plan_upload(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint,target_ordinal integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE delivery public.partner_submission_plan_deliveries%ROWTYPE;
BEGIN
  IF target_ordinal NOT BETWEEN 0 AND 19 OR NOT public.partner_submission_lock_lease(target_company,target_job,target_request,target_lease,target_fence) THEN RETURN 'DENIED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.partner_jobs WHERE company_id=target_company AND id=target_job AND submission_checkpoint='QUOTE_UPDATED')
    OR NOT EXISTS(SELECT 1 FROM public.partner_submission_requests WHERE company_id=target_company AND job_id=target_job AND id=target_request AND state='PROCESSING')
    OR NOT EXISTS(SELECT 1 FROM public.partner_submission_attempts WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND lease_token=target_lease AND fence_token=target_fence AND outcome='IN_PROGRESS')
  THEN RETURN 'DENIED'; END IF;
  SELECT * INTO delivery FROM public.partner_submission_plan_deliveries
    WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND ordinal=target_ordinal FOR UPDATE;
  IF NOT FOUND OR delivery.state NOT IN('PENDING','FAILED','UPLOADING') THEN RETURN 'DENIED'; END IF;
  IF delivery.attempt_count>=3 THEN
    RETURN CASE WHEN public.partner_reconcile_submission(target_company,target_job,target_request,target_lease,target_fence,'UPLOAD_FAILED') THEN 'RECONCILED' ELSE 'DENIED' END;
  END IF;
  UPDATE public.partner_submission_plan_deliveries SET state='UPLOADING',attempt_count=attempt_count+1,safe_error_code=NULL,updated_at=now()
    WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND ordinal=target_ordinal;
  RETURN 'STARTED';
END $$;

CREATE OR REPLACE FUNCTION public.partner_checkpoint_quote_verified(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint,target_fingerprint text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE stored text;
BEGIN
  IF target_fingerprint IS NULL OR target_fingerprint!~'^[0-9a-f]{64}$' OR NOT public.partner_submission_lock_lease(target_company,target_job,target_request,target_lease,target_fence) THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.partner_submission_attempts WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND lease_token=target_lease AND fence_token=target_fence AND outcome='IN_PROGRESS') THEN RETURN false; END IF;
  SELECT remote_quote_fingerprint::text INTO stored FROM public.partner_submission_requests WHERE company_id=target_company AND job_id=target_job AND id=target_request FOR UPDATE;
  IF stored IS NOT NULL AND stored<>target_fingerprint THEN PERFORM public.partner_reconcile_submission(target_company,target_job,target_request,target_lease,target_fence,'PROVIDER_REJECTED');RETURN false;END IF;
  IF NOT public.partner_checkpoint_submission(target_company,target_job,target_request,target_lease,target_fence,'QUOTE_UPDATED',NULL,NULL,NULL,NULL) THEN RETURN false; END IF;
  UPDATE public.partner_submission_requests SET remote_quote_fingerprint=target_fingerprint,updated_at=now() WHERE company_id=target_company AND job_id=target_job AND id=target_request AND (remote_quote_fingerprint IS NULL OR remote_quote_fingerprint=target_fingerprint);
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.partner_adopt_attached_plan(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint,target_ordinal integer,target_remote_key text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE drawing_for_delivery uuid;existing_key text;existing_state text;total_count integer;attached_count integer;
BEGIN
  IF target_ordinal NOT BETWEEN 0 AND 19 OR target_remote_key IS NULL OR target_remote_key LIKE '%..%' OR target_remote_key!~'^[A-Za-z0-9][A-Za-z0-9._/-]{0,249}[A-Za-z0-9._/-]{0,250}$'
    OR NOT public.partner_submission_lock_lease(target_company,target_job,target_request,target_lease,target_fence) THEN RETURN false; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.partner_jobs WHERE company_id=target_company AND id=target_job AND submission_checkpoint IN('QUOTE_UPDATED','PLANS_ATTACHED'))
    OR NOT EXISTS(SELECT 1 FROM public.partner_submission_requests WHERE company_id=target_company AND job_id=target_job AND id=target_request AND state='PROCESSING')
    OR NOT EXISTS(SELECT 1 FROM public.partner_submission_attempts WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND lease_token=target_lease AND fence_token=target_fence AND outcome='IN_PROGRESS') THEN RETURN false; END IF;
  SELECT state,remote_storage_key,drawing_id INTO existing_state,existing_key,drawing_for_delivery FROM public.partner_submission_plan_deliveries
    WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND ordinal=target_ordinal FOR UPDATE;
  IF NOT FOUND OR existing_state='RECONCILIATION_REQUIRED' OR (existing_key IS NOT NULL AND existing_key<>target_remote_key) THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.partner_submission_plan_deliveries WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND ordinal<>target_ordinal AND remote_storage_key=target_remote_key) THEN
    PERFORM public.partner_reconcile_submission(target_company,target_job,target_request,target_lease,target_fence,'PROVIDER_REJECTED');RETURN false;
  END IF;
  IF existing_state<>'ATTACHED' THEN
    UPDATE public.partner_submission_plan_deliveries SET state='ATTACHED',remote_storage_key=target_remote_key,safe_error_code=NULL,delivered_at=now(),updated_at=now()
      WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND ordinal=target_ordinal;
    UPDATE public.partner_site_plan_drawings SET submitted_pdf_storage_key=target_remote_key WHERE company_id=target_company AND job_id=target_job AND id=drawing_for_delivery;
  END IF;
  SELECT count(*),count(*) FILTER(WHERE state='ATTACHED') INTO total_count,attached_count FROM public.partner_submission_plan_deliveries
    WHERE company_id=target_company AND job_id=target_job AND request_id=target_request;
  IF total_count>0 AND attached_count=total_count THEN UPDATE public.partner_jobs SET submission_checkpoint='PLANS_ATTACHED',updated_at=now() WHERE company_id=target_company AND id=target_job AND submission_checkpoint IN('QUOTE_UPDATED','PLANS_ATTACHED'); END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.partner_begin_attachment(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attempts integer;
BEGIN
  IF NOT public.partner_submission_lock_lease(target_company,target_job,target_request,target_lease,target_fence) THEN RETURN 'DENIED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.partner_jobs WHERE company_id=target_company AND id=target_job AND submission_checkpoint='QUOTE_UPDATED')
    OR NOT EXISTS(SELECT 1 FROM public.partner_submission_requests WHERE company_id=target_company AND job_id=target_job AND id=target_request AND state='PROCESSING')
    OR NOT EXISTS(SELECT 1 FROM public.partner_submission_attempts WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND lease_token=target_lease AND fence_token=target_fence AND outcome='IN_PROGRESS')
  THEN RETURN 'DENIED'; END IF;
  SELECT attach_attempt_count INTO attempts FROM public.partner_submission_requests WHERE company_id=target_company AND job_id=target_job AND id=target_request FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.partner_submission_plan_deliveries WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND state NOT IN('UPLOADED','ATTACHED')) THEN RETURN 'DENIED'; END IF;
  IF attempts>=3 THEN RETURN CASE WHEN public.partner_reconcile_submission(target_company,target_job,target_request,target_lease,target_fence,'ATTACH_FAILED') THEN 'RECONCILED' ELSE 'DENIED' END;END IF;
  UPDATE public.partner_submission_requests SET attach_attempt_count=attach_attempt_count+1,updated_at=now() WHERE company_id=target_company AND job_id=target_job AND id=target_request;RETURN 'STARTED';
END $$;

CREATE OR REPLACE FUNCTION public.partner_checkpoint_submission_bounded(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint,target_phase text,target_legacy_id text DEFAULT NULL,target_legacy_number bigint DEFAULT NULL,target_ordinal integer DEFAULT NULL,target_remote_key text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF target_phase NOT IN('CREATE_STARTED','LEAD_CREATED','PLAN_UPLOADED') THEN RETURN false; END IF;
  RETURN public.partner_checkpoint_submission(target_company,target_job,target_request,target_lease,target_fence,target_phase,target_legacy_id,target_legacy_number,target_ordinal,target_remote_key);
END $$;

CREATE OR REPLACE FUNCTION public.partner_release_submission_bounded(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint,target_error_code text,retry_delay_seconds integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attempts integer;
BEGIN
  IF retry_delay_seconds IS NULL OR retry_delay_seconds NOT BETWEEN 1 AND 604800 THEN RETURN 'DENIED'; END IF;
  SELECT count(*) INTO attempts FROM public.partner_submission_attempts WHERE company_id=target_company AND job_id=target_job AND request_id=target_request;
  IF attempts>=5 THEN RETURN CASE WHEN public.partner_reconcile_submission(target_company,target_job,target_request,target_lease,target_fence,target_error_code) THEN 'RECONCILED' ELSE 'DENIED' END; END IF;
  RETURN CASE WHEN public.partner_release_submission(target_company,target_job,target_request,target_lease,target_fence,target_error_code,now()+make_interval(secs=>retry_delay_seconds)) THEN 'RELEASED' ELSE 'DENIED' END;
END $$;

CREATE OR REPLACE FUNCTION public.partner_finalize_submission_verified(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint,target_plan_count integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE manifest_count integer;delivery_count integer;
BEGIN
  IF target_plan_count IS NULL OR target_plan_count NOT BETWEEN 1 AND 20 OR NOT public.partner_submission_lock_lease(target_company,target_job,target_request,target_lease,target_fence) THEN RETURN false; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.partner_submission_requests r JOIN public.partner_jobs j ON(j.company_id,j.id)=(r.company_id,r.job_id)
    WHERE r.company_id=target_company AND r.job_id=target_job AND r.id=target_request AND r.state='PROCESSING'
      AND r.remote_quote_fingerprint IS NOT NULL AND j.submission_checkpoint='PLANS_ATTACHED'
      AND j.legacy_job_id IS NOT NULL AND j.legacy_job_number IS NOT NULL
      AND j.final_quote_number=j.legacy_job_prefix_snapshot||'-'||j.legacy_job_number::text
      AND EXISTS(SELECT 1 FROM public.partner_submission_attempts a WHERE (a.company_id,a.job_id,a.request_id,a.lease_token,a.fence_token,a.outcome)=(r.company_id,r.job_id,r.id,target_lease,target_fence,'IN_PROGRESS'))
  ) THEN RETURN false; END IF;
  SELECT count(*) INTO manifest_count FROM public.partner_submission_plan_manifest m JOIN public.partner_submission_requests r
    ON (r.company_id,r.job_id,r.snapshot_id)=(m.company_id,m.job_id,m.snapshot_id)
    WHERE r.company_id=target_company AND r.job_id=target_job AND r.id=target_request;
  SELECT count(*) INTO delivery_count FROM public.partner_submission_plan_deliveries
    WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND state='ATTACHED';
  IF manifest_count<>target_plan_count OR delivery_count<>target_plan_count
    OR (SELECT count(DISTINCT remote_storage_key) FROM public.partner_submission_plan_deliveries WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND state='ATTACHED')<>target_plan_count
    OR EXISTS(
    SELECT 1 FROM (SELECT ordinal,drawing_id,state,remote_storage_key FROM public.partner_submission_plan_deliveries WHERE company_id=target_company AND job_id=target_job AND request_id=target_request) d FULL JOIN (
      SELECT m.ordinal,m.drawing_id FROM public.partner_submission_plan_manifest m JOIN public.partner_submission_requests r
        ON (r.company_id,r.job_id,r.snapshot_id)=(m.company_id,m.job_id,m.snapshot_id)
      WHERE r.company_id=target_company AND r.job_id=target_job AND r.id=target_request
    ) m USING(ordinal,drawing_id)
    WHERE d.ordinal IS NULL OR m.ordinal IS NULL OR d.state IS DISTINCT FROM 'ATTACHED' OR d.remote_storage_key IS NULL
  ) OR EXISTS(
    SELECT 1 FROM public.partner_submission_requests r
    JOIN public.partner_submission_plan_manifest m ON(m.company_id,m.job_id,m.snapshot_id)=(r.company_id,r.job_id,r.snapshot_id)
    JOIN public.partner_submission_plan_deliveries d ON(d.company_id,d.job_id,d.request_id,d.snapshot_id,d.ordinal,d.drawing_id)=(r.company_id,r.job_id,r.id,r.snapshot_id,m.ordinal,m.drawing_id)
    JOIN public.partner_site_plan_drawings drawing ON(drawing.company_id,drawing.job_id,drawing.id)=(m.company_id,m.job_id,m.drawing_id)
    JOIN public.partner_outbox_events execute_event ON(execute_event.company_id,execute_event.job_id,execute_event.request_id)=(r.company_id,r.job_id,r.id) AND execute_event.topic='PARTNER_SUBMISSION_EXECUTE'
    JOIN public.partner_submission_snapshots s ON(s.company_id,s.job_id,s.id)=(r.company_id,r.job_id,r.snapshot_id)
    WHERE r.company_id=target_company AND r.job_id=target_job AND r.id=target_request
      AND (drawing.submitted_pdf_storage_key IS DISTINCT FROM d.remote_storage_key OR drawing.submitted_pdf_outbox_event_id IS DISTINCT FROM execute_event.id
        OR drawing.submitted_snapshot_data IS DISTINCT FROM s.snapshot_data->'plans'->m.ordinal->'document' OR drawing.submitted_snapshot_at IS NULL)
  ) THEN RAISE EXCEPTION 'SUBMISSION_NOT_FINALIZABLE'; END IF;
  RETURN public.partner_finalize_submission(target_company,target_job,target_request,target_lease,target_fence);
END $$;

CREATE OR REPLACE FUNCTION public.partner_claim_notification(target_worker text,lease_seconds integer DEFAULT 120)
RETURNS TABLE(event_id uuid,company_id uuid,job_id uuid,request_id uuid,topic text,notification_phase text,notification_receipt text,lease_token uuid,fence_token bigint,attempt_number integer,claim_status text,queue_age_bucket text,reclaimed_lease boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
DECLARE item public.partner_outbox_events%ROWTYPE;
BEGIN
  IF target_worker !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' OR lease_seconds NOT BETWEEN 30 AND 900 THEN RAISE EXCEPTION 'SUBMISSION_INVALID_LEASE'; END IF;
  SELECT * INTO item FROM public.partner_outbox_events WHERE topic IN('PARTNER_SUBMISSION_COMPLETED','PARTNER_SUBMISSION_RECONCILIATION_ALERT')
    AND available_at<=now() AND (state IN('PENDING','FAILED') OR (state='PROCESSING' AND lease_expires_at<now()))
    ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  IF item.notification_phase IS NULL OR item.attempt_count>=5 OR NOT EXISTS(
    SELECT 1 FROM public.partner_submission_requests r JOIN public.partner_jobs j ON(j.company_id,j.id)=(r.company_id,r.job_id)
    JOIN public.partner_outbox_events execute_event ON(execute_event.company_id,execute_event.job_id,execute_event.request_id)=(r.company_id,r.job_id,r.id) AND execute_event.topic='PARTNER_SUBMISSION_EXECUTE'
    WHERE (r.company_id,r.job_id,r.id)=(item.company_id,item.job_id,item.request_id) AND (
      (item.topic='PARTNER_SUBMISSION_COMPLETED' AND r.state='SUCCEEDED' AND j.submission_state='SUBMITTED' AND j.submission_checkpoint='FINALIZED' AND execute_event.state='DELIVERED')
      OR(item.topic='PARTNER_SUBMISSION_RECONCILIATION_ALERT' AND r.state='RECONCILIATION_REQUIRED' AND j.submission_state='RECONCILIATION_REQUIRED' AND j.submission_checkpoint='RECONCILIATION' AND execute_event.state='DEAD')
    )
  ) THEN
    UPDATE public.partner_outbox_events SET state='DEAD',last_error_code=CASE WHEN item.attempt_count>=5 THEN 'PROVIDER_UNAVAILABLE' ELSE 'NOTIFICATION_REJECTED' END,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=item.id;
    INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata) VALUES('SUBMISSION_NOTIFICATION_DEAD',item.company_id,item.job_id,item.request_id,jsonb_build_object('phase',CASE WHEN item.attempt_count>=5 THEN 'ATTEMPT_CAP' ELSE 'MALFORMED_STATE' END));
    event_id:=item.id;company_id:=item.company_id;job_id:=item.job_id;request_id:=item.request_id;topic:=item.topic;notification_phase:=item.notification_phase;
    notification_receipt:=item.notification_receipt;lease_token:=NULL;fence_token:=item.fence_token;attempt_number:=item.attempt_count;claim_status:='DEAD';queue_age_bucket:=CASE WHEN now()-item.created_at<interval '1 minute' THEN 'LT_1M' WHEN now()-item.created_at<interval '5 minutes' THEN 'LT_5M' WHEN now()-item.created_at<interval '1 hour' THEN 'LT_1H' ELSE 'GTE_1H' END;reclaimed_lease:=item.state='PROCESSING';RETURN NEXT;RETURN;
  END IF;
  item.lease_token:=gen_random_uuid();item.fence_token:=item.fence_token+1;
  UPDATE public.partner_outbox_events SET state='PROCESSING',attempt_count=attempt_count+1,locked_at=now(),lease_token=item.lease_token,
    fence_token=item.fence_token,lease_owner=target_worker,lease_expires_at=now()+make_interval(secs=>lease_seconds),notification_backfilled=false,updated_at=now() WHERE id=item.id;
  INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata) VALUES('SUBMISSION_NOTIFICATION_CLAIMED',item.company_id,item.job_id,item.request_id,jsonb_build_object('phase',item.notification_phase,'attemptNumber',(item.attempt_count+1)::text));
  event_id:=item.id;company_id:=item.company_id;job_id:=item.job_id;request_id:=item.request_id;topic:=item.topic;
  notification_phase:=item.notification_phase;notification_receipt:=item.notification_receipt;lease_token:=item.lease_token;fence_token:=item.fence_token;attempt_number:=item.attempt_count+1;claim_status:='CLAIMED';queue_age_bucket:=CASE WHEN now()-item.created_at<interval '1 minute' THEN 'LT_1M' WHEN now()-item.created_at<interval '5 minutes' THEN 'LT_5M' WHEN now()-item.created_at<interval '1 hour' THEN 'LT_1H' ELSE 'GTE_1H' END;reclaimed_lease:=item.state='PROCESSING';RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.partner_notification_lock_lease(target_event uuid,target_lease uuid,target_fence bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM 1 FROM public.partner_outbox_events WHERE id=target_event FOR UPDATE;
  RETURN FOUND AND EXISTS(SELECT 1 FROM public.partner_outbox_events WHERE id=target_event AND topic IN('PARTNER_SUBMISSION_COMPLETED','PARTNER_SUBMISSION_RECONCILIATION_ALERT') AND state='PROCESSING' AND lease_token=target_lease AND fence_token=target_fence AND lease_expires_at>=now());
END $$;

CREATE OR REPLACE FUNCTION public.partner_heartbeat_notification(target_event uuid,target_lease uuid,target_fence bigint,lease_seconds integer DEFAULT 120)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF lease_seconds NOT BETWEEN 30 AND 900 OR NOT public.partner_notification_lock_lease(target_event,target_lease,target_fence) THEN RETURN false; END IF;
  UPDATE public.partner_outbox_events SET lease_expires_at=now()+make_interval(secs=>lease_seconds),updated_at=now() WHERE id=target_event AND state='PROCESSING' AND lease_token=target_lease AND fence_token=target_fence;RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.partner_checkpoint_notification_accepted(target_event uuid,target_lease uuid,target_fence bigint,target_receipt text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF target_receipt IS NULL OR target_receipt!~'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' OR NOT public.partner_notification_lock_lease(target_event,target_lease,target_fence) THEN RETURN false; END IF;
  UPDATE public.partner_outbox_events SET notification_phase='ACCEPTED_PENDING',notification_receipt=target_receipt,notification_accepted_at=COALESCE(notification_accepted_at,now()),updated_at=now()
    WHERE id=target_event AND state='PROCESSING' AND lease_token=target_lease AND fence_token=target_fence AND notification_phase IN('READY','ACCEPTED_PENDING')
      AND (notification_receipt IS NULL OR notification_receipt=target_receipt);RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.partner_release_notification(target_event uuid,target_lease uuid,target_fence bigint,target_error_code text,retry_delay_seconds integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF retry_delay_seconds IS NULL OR retry_delay_seconds NOT BETWEEN 1 AND 604800 OR public.partner_submission_safe_error_code(target_error_code) IS NOT TRUE OR NOT public.partner_notification_lock_lease(target_event,target_lease,target_fence) THEN RETURN 'DENIED'; END IF;
  UPDATE public.partner_outbox_events SET state=CASE WHEN attempt_count>=5 THEN 'DEAD' ELSE 'FAILED' END,available_at=now()+make_interval(secs=>retry_delay_seconds),last_error_code=target_error_code,
    lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=target_event AND state='PROCESSING' AND lease_token=target_lease AND fence_token=target_fence;
  IF NOT FOUND THEN RETURN 'DENIED'; END IF;
  INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata)
    SELECT CASE WHEN state='DEAD' THEN 'SUBMISSION_NOTIFICATION_DEAD' ELSE 'SUBMISSION_NOTIFICATION_RELEASED' END,company_id,job_id,request_id,jsonb_build_object('errorCode',target_error_code) FROM public.partner_outbox_events WHERE id=target_event;
  RETURN CASE WHEN (SELECT state FROM public.partner_outbox_events WHERE id=target_event)='DEAD' THEN 'DEAD' ELSE 'RELEASED' END;
END $$;

CREATE OR REPLACE FUNCTION public.partner_finalize_notification(target_event uuid,target_lease uuid,target_fence bigint,target_receipt text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT public.partner_notification_lock_lease(target_event,target_lease,target_fence) THEN RETURN false; END IF;
  UPDATE public.partner_outbox_events SET state='DELIVERED',delivered_at=now(),
    lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=now()
    WHERE id=target_event AND state='PROCESSING' AND lease_token=target_lease AND fence_token=target_fence AND notification_phase='ACCEPTED_PENDING'
      AND notification_accepted_at IS NOT NULL AND notification_receipt=target_receipt AND target_receipt~'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$';
  IF NOT FOUND THEN RETURN false;END IF;INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata) SELECT 'SUBMISSION_NOTIFICATION_DELIVERED',company_id,job_id,request_id,jsonb_build_object('phase','DELIVERED') FROM public.partner_outbox_events WHERE id=target_event;RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.partner_reconcile_notification(target_event uuid,target_lease uuid,target_fence bigint,target_error_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF public.partner_submission_safe_error_code(target_error_code) IS NOT TRUE OR NOT public.partner_notification_lock_lease(target_event,target_lease,target_fence) THEN RETURN false; END IF;
  UPDATE public.partner_outbox_events SET state='DEAD',last_error_code=target_error_code,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
    WHERE id=target_event AND state='PROCESSING' AND lease_token=target_lease AND fence_token=target_fence;
  IF NOT FOUND THEN RETURN false;END IF;INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata) SELECT 'SUBMISSION_NOTIFICATION_DEAD',company_id,job_id,request_id,jsonb_build_object('errorCode',target_error_code) FROM public.partner_outbox_events WHERE id=target_event;RETURN true;
END $$;

-- Existing E1 finalize/reconcile inserts are made notification-ready inside
-- the same transaction without changing their reviewed function signatures.
CREATE OR REPLACE FUNCTION public.partner_notification_prepare_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF NEW.topic IN('PARTNER_SUBMISSION_COMPLETED','PARTNER_SUBMISSION_RECONCILIATION_ALERT') THEN NEW.notification_phase:='READY'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_notification_prepare BEFORE INSERT ON public.partner_outbox_events FOR EACH ROW EXECUTE FUNCTION public.partner_notification_prepare_insert();

ALTER FUNCTION public.partner_claim_submission_bounded(text,integer) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_worker_snapshot_matches(text,jsonb) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_submission_claimed_snapshot(uuid,uuid,uuid,uuid,bigint) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_submission_claimed_plans(uuid,uuid,uuid,uuid,bigint) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_begin_plan_upload(uuid,uuid,uuid,uuid,bigint,integer) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_checkpoint_quote_verified(uuid,uuid,uuid,uuid,bigint,text) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_adopt_attached_plan(uuid,uuid,uuid,uuid,bigint,integer,text) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_checkpoint_submission_bounded(uuid,uuid,uuid,uuid,bigint,text,text,bigint,integer,text) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_begin_attachment(uuid,uuid,uuid,uuid,bigint) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_release_submission_bounded(uuid,uuid,uuid,uuid,bigint,text,integer) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_finalize_submission_verified(uuid,uuid,uuid,uuid,bigint,integer) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_claim_notification(text,integer) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_notification_lock_lease(uuid,uuid,bigint) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_heartbeat_notification(uuid,uuid,bigint,integer) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_checkpoint_notification_accepted(uuid,uuid,bigint,text) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_release_notification(uuid,uuid,bigint,text,integer) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_finalize_notification(uuid,uuid,bigint,text) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_reconcile_notification(uuid,uuid,bigint,text) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_notification_prepare_insert() OWNER TO partner_submission_owner;
REVOKE ALL ON FUNCTION public.partner_notification_prepare_insert() FROM PUBLIC,partner_portal_runtime,partner_submission_worker;
REVOKE ALL ON FUNCTION public.partner_worker_snapshot_matches(text,jsonb) FROM PUBLIC,partner_portal_runtime,partner_submission_worker;

REVOKE ALL ON FUNCTION public.partner_claim_submission(text,integer),public.partner_checkpoint_submission(uuid,uuid,uuid,uuid,bigint,text,text,bigint,integer,text),public.partner_release_submission(uuid,uuid,uuid,uuid,bigint,text,timestamptz),public.partner_finalize_submission(uuid,uuid,uuid,uuid,bigint) FROM partner_submission_worker;
REVOKE ALL ON FUNCTION public.partner_submission_status(uuid,uuid) FROM partner_submission_worker;
REVOKE ALL ON FUNCTION public.partner_submission_claimed_snapshot(uuid,uuid,uuid,uuid,bigint),public.partner_submission_claimed_plans(uuid,uuid,uuid,uuid,bigint),public.partner_claim_submission_bounded(text,integer),public.partner_begin_plan_upload(uuid,uuid,uuid,uuid,bigint,integer),public.partner_checkpoint_quote_verified(uuid,uuid,uuid,uuid,bigint,text),public.partner_adopt_attached_plan(uuid,uuid,uuid,uuid,bigint,integer,text),public.partner_checkpoint_submission_bounded(uuid,uuid,uuid,uuid,bigint,text,text,bigint,integer,text),public.partner_begin_attachment(uuid,uuid,uuid,uuid,bigint),public.partner_release_submission_bounded(uuid,uuid,uuid,uuid,bigint,text,integer),public.partner_finalize_submission_verified(uuid,uuid,uuid,uuid,bigint,integer),public.partner_claim_notification(text,integer),public.partner_notification_lock_lease(uuid,uuid,bigint),public.partner_heartbeat_notification(uuid,uuid,bigint,integer),public.partner_checkpoint_notification_accepted(uuid,uuid,bigint,text),public.partner_release_notification(uuid,uuid,bigint,text,integer),public.partner_finalize_notification(uuid,uuid,bigint,text),public.partner_reconcile_notification(uuid,uuid,bigint,text) FROM PUBLIC,partner_portal_runtime,partner_submission_worker;
GRANT EXECUTE ON FUNCTION public.partner_submission_claimed_snapshot(uuid,uuid,uuid,uuid,bigint),public.partner_submission_claimed_plans(uuid,uuid,uuid,uuid,bigint),public.partner_claim_submission_bounded(text,integer),public.partner_begin_plan_upload(uuid,uuid,uuid,uuid,bigint,integer),public.partner_checkpoint_quote_verified(uuid,uuid,uuid,uuid,bigint,text),public.partner_adopt_attached_plan(uuid,uuid,uuid,uuid,bigint,integer,text),public.partner_checkpoint_submission_bounded(uuid,uuid,uuid,uuid,bigint,text,text,bigint,integer,text),public.partner_begin_attachment(uuid,uuid,uuid,uuid,bigint),public.partner_release_submission_bounded(uuid,uuid,uuid,uuid,bigint,text,integer),public.partner_finalize_submission_verified(uuid,uuid,uuid,uuid,bigint,integer),public.partner_claim_notification(text,integer),public.partner_heartbeat_notification(uuid,uuid,bigint,integer),public.partner_checkpoint_notification_accepted(uuid,uuid,bigint,text),public.partner_release_notification(uuid,uuid,bigint,text,integer),public.partner_finalize_notification(uuid,uuid,bigint,text),public.partner_reconcile_notification(uuid,uuid,bigint,text) TO partner_submission_worker;

REVOKE CREATE ON SCHEMA public FROM partner_submission_owner;
DO $$ BEGIN EXECUTE format('REVOKE partner_submission_owner FROM %I',session_user); END $$;
COMMIT;
