BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

DO $$
DECLARE
  active_jobs integer;
  existing_attempts integer;
  existing_submission_outbox integer;
  existing_submission_snapshots integer;
BEGIN
  SELECT count(*) INTO active_jobs
  FROM public.partner_jobs
  WHERE submission_state <> 'DRAFT'
     OR legacy_job_id IS NOT NULL
     OR submission_started_at IS NOT NULL
     OR submitted_at IS NOT NULL;

  SELECT count(*) INTO existing_attempts FROM public.partner_submission_attempts;
  SELECT count(*) INTO existing_submission_outbox
  FROM public.partner_outbox_events
  WHERE topic LIKE 'PARTNER_SUBMISSION%';
  SELECT count(*) INTO existing_submission_snapshots
  FROM public.partner_site_plan_drawings
  WHERE submitted_snapshot_data IS NOT NULL
     OR submitted_snapshot_at IS NOT NULL
     OR submitted_pdf_storage_key IS NOT NULL
     OR submitted_pdf_outbox_event_id IS NOT NULL;

  IF active_jobs > 0 OR existing_attempts > 0 OR existing_submission_outbox > 0 OR existing_submission_snapshots > 0 THEN
    RAISE EXCEPTION 'partner submission saga preflight failed: active_jobs=%, existing_attempts=%, submission_outbox=%, drawing_snapshots=%',
      active_jobs, existing_attempts, existing_submission_outbox, existing_submission_snapshots;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.partner_submission_safe_error_code(value text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT value IN ('LEASE_EXPIRED','NETWORK_ERROR','PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE','PROVIDER_REJECTED','UPLOAD_FAILED','ATTACH_FAILED','CREDENTIAL_ROTATED','AMBIGUOUS_LEGACY_RESULT','SUBMISSION_LEASE_LOST')
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('partner_submission_owner','partner_submission_worker')) THEN
    RAISE EXCEPTION 'partner submission role preflight failed: reserved role already exists';
  END IF;
  CREATE ROLE partner_submission_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  CREATE ROLE partner_submission_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  IF NOT pg_has_role(session_user, 'partner_submission_owner', 'USAGE') THEN
    EXECUTE format('GRANT partner_submission_owner TO %I WITH INHERIT TRUE, SET TRUE', session_user);
  END IF;
  IF NOT pg_has_role(session_user, 'partner_artifact_owner', 'USAGE') THEN
    EXECUTE format('GRANT partner_artifact_owner TO %I WITH INHERIT TRUE, SET TRUE', session_user);
  END IF;
  GRANT CREATE ON SCHEMA public TO partner_submission_owner,partner_artifact_owner;
  REVOKE partner_submission_owner FROM partner_portal_runtime;
  REVOKE partner_submission_worker FROM partner_portal_runtime;
  REVOKE partner_submission_owner FROM partner_submission_worker;
  REVOKE partner_artifact_owner FROM partner_submission_worker;
END $$;

ALTER TABLE public.partner_companies
  ADD COLUMN submission_adapter_mode varchar(20) NOT NULL DEFAULT 'DISABLED',
  ADD COLUMN submission_contract_version varchar(80),
  ADD COLUMN legacy_job_prefix varchar(40),
  ADD CONSTRAINT partner_company_submission_adapter_mode CHECK (submission_adapter_mode IN ('DISABLED', 'FICTIONAL', 'LIVE')),
  ADD CONSTRAINT partner_company_submission_contract_complete CHECK (
    (submission_adapter_mode = 'DISABLED' AND submission_contract_version IS NULL AND legacy_job_prefix IS NULL)
    OR
    (submission_adapter_mode IN ('FICTIONAL', 'LIVE')
      AND submission_contract_version = btrim(submission_contract_version)
      AND submission_contract_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
      AND legacy_job_prefix = btrim(legacy_job_prefix)
      AND legacy_job_prefix ~ '^[A-Z0-9][A-Z0-9-]{0,39}$')
  );

ALTER TABLE public.partner_jobs
  ADD COLUMN legacy_job_number bigint,
  ADD COLUMN final_quote_number varchar(120),
  ADD COLUMN submission_adapter_mode_snapshot varchar(20),
  ADD COLUMN submission_contract_version_snapshot varchar(80),
  ADD COLUMN legacy_job_prefix_snapshot varchar(40),
  ADD COLUMN submission_checkpoint varchar(40) NOT NULL DEFAULT 'NONE',
  ADD CONSTRAINT partner_jobs_legacy_job_number_positive CHECK (legacy_job_number IS NULL OR legacy_job_number > 0),
  ADD CONSTRAINT partner_jobs_final_quote_number_safe CHECK (final_quote_number IS NULL OR (final_quote_number = btrim(final_quote_number) AND final_quote_number ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$')),
  ADD CONSTRAINT partner_jobs_submission_checkpoint CHECK (submission_checkpoint IN ('NONE','FROZEN','CREATE_STARTED','LEAD_CREATED','QUOTE_UPDATED','PLANS_ATTACHED','FINALIZED','RECONCILIATION')),
  ADD CONSTRAINT partner_jobs_submission_contract_snapshot CHECK (
    (submission_checkpoint = 'NONE' AND submission_adapter_mode_snapshot IS NULL AND submission_contract_version_snapshot IS NULL AND legacy_job_prefix_snapshot IS NULL)
    OR
    (submission_checkpoint <> 'NONE'
      AND submission_adapter_mode_snapshot IN ('FICTIONAL','LIVE')
      AND submission_contract_version_snapshot IS NOT NULL
      AND legacy_job_prefix_snapshot IS NOT NULL)
  );
CREATE UNIQUE INDEX partner_jobs_company_legacy_number_unique ON public.partner_jobs(company_id,legacy_job_number) WHERE legacy_job_number IS NOT NULL;
CREATE UNIQUE INDEX partner_jobs_company_final_quote_unique ON public.partner_jobs(company_id,final_quote_number) WHERE final_quote_number IS NOT NULL;

CREATE TABLE public.partner_submission_snapshots (
  company_id uuid NOT NULL,
  job_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  schema_version integer NOT NULL DEFAULT 1,
  job_revision integer NOT NULL,
  floor_plan_revision integer NOT NULL,
  adapter_mode varchar(20) NOT NULL,
  contract_version varchar(80) NOT NULL,
  legacy_job_prefix varchar(40) NOT NULL,
  legacy_base_url_snapshot text,
  legacy_credential_fingerprint char(64),
  legacy_credential_key_version_snapshot integer,
  legacy_credential_updated_at_snapshot timestamptz,
  canonical_document text NOT NULL,
  snapshot_data jsonb NOT NULL,
  snapshot_sha256 char(64) NOT NULL,
  byte_size integer NOT NULL,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_submission_snapshots_pk PRIMARY KEY (company_id, job_id, id),
  CONSTRAINT partner_submission_snapshots_job_fk FOREIGN KEY (company_id, job_id) REFERENCES public.partner_jobs(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT partner_submission_snapshots_user_fk FOREIGN KEY (company_id, created_by_user_id) REFERENCES public.partner_users(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT partner_submission_snapshots_schema CHECK (schema_version = 1 AND jsonb_typeof(snapshot_data) = 'object'),
  CONSTRAINT partner_submission_snapshots_revision CHECK (job_revision >= 0 AND floor_plan_revision >= 0),
  CONSTRAINT partner_submission_snapshots_mode CHECK (adapter_mode IN ('FICTIONAL','LIVE')),
  CONSTRAINT partner_submission_snapshots_credential_provenance CHECK (
    (adapter_mode='FICTIONAL' AND legacy_base_url_snapshot IS NULL AND legacy_credential_fingerprint IS NULL AND legacy_credential_key_version_snapshot IS NULL AND legacy_credential_updated_at_snapshot IS NULL)
    OR (adapter_mode='LIVE' AND legacy_base_url_snapshot IS NOT NULL AND legacy_credential_fingerprint IS NOT NULL AND legacy_credential_fingerprint~'^[0-9a-f]{64}$' AND legacy_credential_key_version_snapshot IS NOT NULL AND legacy_credential_key_version_snapshot>0 AND legacy_credential_updated_at_snapshot IS NOT NULL)
  ),
  CONSTRAINT partner_submission_snapshots_hash CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$' AND snapshot_sha256 = encode(public.digest(convert_to(canonical_document, 'UTF8'), 'sha256'), 'hex')),
  CONSTRAINT partner_submission_snapshots_canonical_shape CHECK (canonical_document::jsonb = snapshot_data),
  CONSTRAINT partner_submission_snapshots_size CHECK (byte_size = octet_length(convert_to(canonical_document, 'UTF8')) AND byte_size BETWEEN 2 AND 6291456)
);
CREATE INDEX partner_submission_snapshots_job_idx ON public.partner_submission_snapshots(company_id, job_id, created_at DESC, id DESC);

CREATE TABLE public.partner_submission_plan_manifest (
  company_id uuid NOT NULL,
  job_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  ordinal smallint NOT NULL,
  drawing_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  drawing_revision integer NOT NULL,
  drawing_name varchar(120) NOT NULL,
  document_sha256 char(64) NOT NULL,
  render_hash char(64) NOT NULL,
  content_sha256 char(64) NOT NULL,
  byte_size integer NOT NULL,
  renderer_version varchar(80) NOT NULL,
  template_version varchar(80) NOT NULL,
  template_sha256 char(64) NOT NULL,
  local_file_name varchar(240) NOT NULL,
  remote_file_name varchar(240) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_submission_plan_manifest_pk PRIMARY KEY (company_id, job_id, snapshot_id, ordinal),
  CONSTRAINT partner_submission_plan_manifest_snapshot_fk FOREIGN KEY (company_id, job_id, snapshot_id) REFERENCES public.partner_submission_snapshots(company_id, job_id, id) ON DELETE RESTRICT,
  CONSTRAINT partner_submission_plan_manifest_drawing_fk FOREIGN KEY (company_id, job_id, drawing_id) REFERENCES public.partner_site_plan_drawings(company_id, job_id, id) ON DELETE RESTRICT,
  CONSTRAINT partner_submission_plan_manifest_artifact_fk FOREIGN KEY (company_id, job_id, drawing_id, artifact_id) REFERENCES public.partner_site_plan_pdf_artifacts(company_id, job_id, drawing_id, id) ON DELETE RESTRICT,
  CONSTRAINT partner_submission_plan_manifest_ordinal CHECK (ordinal BETWEEN 0 AND 19),
  CONSTRAINT partner_submission_plan_manifest_revision CHECK (drawing_revision >= 0),
  CONSTRAINT partner_submission_plan_manifest_hashes CHECK (document_sha256 ~ '^[0-9a-f]{64}$' AND render_hash ~ '^[0-9a-f]{64}$' AND content_sha256 ~ '^[0-9a-f]{64}$' AND template_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT partner_submission_plan_manifest_size CHECK (byte_size BETWEEN 1 AND 5242880),
  CONSTRAINT partner_submission_plan_manifest_names CHECK (drawing_name = btrim(drawing_name) AND drawing_name <> '' AND local_file_name = btrim(local_file_name) AND local_file_name <> '' AND remote_file_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$'),
  CONSTRAINT partner_submission_plan_manifest_drawing_unique UNIQUE (company_id, job_id, snapshot_id, drawing_id),
  CONSTRAINT partner_submission_plan_manifest_ordinal_drawing_unique UNIQUE (company_id, job_id, snapshot_id, ordinal, drawing_id),
  CONSTRAINT partner_submission_plan_manifest_remote_unique UNIQUE (company_id, job_id, snapshot_id, remote_file_name)
);
CREATE INDEX partner_submission_manifest_artifact_idx ON public.partner_submission_plan_manifest(company_id, job_id, drawing_id, artifact_id);

CREATE TABLE public.partner_submission_requests (
  company_id uuid NOT NULL,
  job_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL,
  idempotency_key_hash char(64) NOT NULL,
  request_hash char(64) NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'QUEUED',
  safe_error_code varchar(80),
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT partner_submission_requests_pk PRIMARY KEY (company_id, job_id, id),
  CONSTRAINT partner_submission_requests_job_fk FOREIGN KEY (company_id, job_id) REFERENCES public.partner_jobs(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT partner_submission_requests_snapshot_fk FOREIGN KEY (company_id, job_id, snapshot_id) REFERENCES public.partner_submission_snapshots(company_id, job_id, id) ON DELETE RESTRICT,
  CONSTRAINT partner_submission_requests_user_fk FOREIGN KEY (company_id, created_by_user_id) REFERENCES public.partner_users(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT partner_submission_requests_idempotency_unique UNIQUE (company_id, idempotency_key_hash),
  CONSTRAINT partner_submission_requests_job_unique UNIQUE (company_id, job_id),
  CONSTRAINT partner_submission_requests_snapshot_identity UNIQUE (company_id, job_id, id, snapshot_id),
  CONSTRAINT partner_submission_requests_hashes CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$' AND request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT partner_submission_requests_state CHECK (state IN ('QUEUED','PROCESSING','FAILED_RETRYABLE','SUCCEEDED','RECONCILIATION_REQUIRED')),
  CONSTRAINT partner_submission_requests_error CHECK (safe_error_code IS NULL OR public.partner_submission_safe_error_code(safe_error_code)),
  CONSTRAINT partner_submission_requests_completion CHECK ((state = 'SUCCEEDED' AND completed_at IS NOT NULL) OR (state <> 'SUCCEEDED' AND completed_at IS NULL))
);
CREATE INDEX partner_submission_requests_claim_idx ON public.partner_submission_requests(state, updated_at, id) WHERE state IN ('QUEUED','FAILED_RETRYABLE','PROCESSING');

CREATE TABLE public.partner_submission_plan_deliveries (
  company_id uuid NOT NULL,
  job_id uuid NOT NULL,
  request_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  ordinal smallint NOT NULL,
  drawing_id uuid NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'PENDING',
  remote_storage_key varchar(500),
  safe_error_code varchar(80),
  attempt_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  CONSTRAINT partner_submission_plan_deliveries_pk PRIMARY KEY (company_id, job_id, request_id, ordinal),
  CONSTRAINT partner_submission_plan_deliveries_request_fk FOREIGN KEY (company_id, job_id, request_id, snapshot_id) REFERENCES public.partner_submission_requests(company_id, job_id, id, snapshot_id) ON DELETE RESTRICT,
  CONSTRAINT partner_submission_plan_deliveries_manifest_fk FOREIGN KEY (company_id, job_id, snapshot_id, ordinal, drawing_id) REFERENCES public.partner_submission_plan_manifest(company_id, job_id, snapshot_id, ordinal, drawing_id) ON DELETE RESTRICT,
  CONSTRAINT partner_submission_plan_deliveries_state CHECK (state IN ('PENDING','UPLOADING','UPLOADED','ATTACHED','FAILED','RECONCILIATION_REQUIRED')),
  CONSTRAINT partner_submission_plan_deliveries_attempt CHECK (attempt_count >= 0),
  CONSTRAINT partner_submission_plan_deliveries_error CHECK (safe_error_code IS NULL OR public.partner_submission_safe_error_code(safe_error_code)),
  CONSTRAINT partner_submission_plan_deliveries_storage CHECK (remote_storage_key IS NULL OR (remote_storage_key = btrim(remote_storage_key) AND remote_storage_key ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,249}[A-Za-z0-9._/-]{0,250}$')),
  CONSTRAINT partner_submission_plan_deliveries_complete CHECK ((state = 'ATTACHED' AND delivered_at IS NOT NULL AND remote_storage_key IS NOT NULL) OR (state <> 'ATTACHED' AND delivered_at IS NULL))
);

CREATE TABLE public.partner_submission_rate_limits (
  company_id uuid NOT NULL REFERENCES public.partner_companies(id) ON DELETE CASCADE,
  scope_kind varchar(16) NOT NULL,
  scope_hash char(64) NOT NULL,
  window_seconds integer NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_submission_rate_limits_pk PRIMARY KEY(company_id,scope_kind,scope_hash,window_seconds),
  CONSTRAINT partner_submission_rate_limits_scope CHECK(scope_kind IN('USER','COMPANY','IP_HASH') AND scope_hash~'^[0-9a-f]{64}$'),
  CONSTRAINT partner_submission_rate_limits_window CHECK(window_seconds BETWEEN 60 AND 86400 AND attempt_count BETWEEN 1 AND 1000000)
);
CREATE INDEX partner_submission_rate_limits_expiry_idx ON public.partner_submission_rate_limits(updated_at);

ALTER TABLE public.partner_submission_attempts
  DROP CONSTRAINT partner_submission_idempotency_unique,
  DROP COLUMN idempotency_key,
  ADD COLUMN request_id uuid NOT NULL,
  ADD COLUMN lease_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN fence_token bigint NOT NULL DEFAULT 1,
  ADD COLUMN lease_owner varchar(120) NOT NULL,
  ADD COLUMN lease_expires_at timestamptz NOT NULL,
  ADD COLUMN heartbeat_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT partner_submission_attempt_request_fk FOREIGN KEY (company_id, job_id, request_id) REFERENCES public.partner_submission_requests(company_id, job_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT partner_submission_attempt_fence_positive CHECK (fence_token > 0),
  ADD CONSTRAINT partner_submission_attempt_lease_owner CHECK (lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'),
  ADD CONSTRAINT partner_submission_attempt_lease_time CHECK (lease_expires_at > created_at),
  ADD CONSTRAINT partner_submission_attempt_safe_error CHECK(error_code IS NULL OR public.partner_submission_safe_error_code(error_code)),
  ADD CONSTRAINT partner_submission_attempt_request_number_unique UNIQUE (company_id, job_id, request_id, attempt_number);
CREATE UNIQUE INDEX partner_submission_attempt_active_lease_unique ON public.partner_submission_attempts(company_id, job_id, request_id) WHERE outcome = 'IN_PROGRESS';
CREATE UNIQUE INDEX partner_submission_attempt_fence_unique ON public.partner_submission_attempts(company_id, job_id, request_id, fence_token);

CREATE OR REPLACE FUNCTION public.partner_submission_outbox_payload_valid(target_topic text, target_company uuid, target_job uuid, target_request uuid, target_payload jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT CASE WHEN target_topic = 'PARTNER_SUBMISSION_EXECUTE' THEN (
      target_company IS NOT NULL AND target_job IS NOT NULL AND target_request IS NOT NULL
      AND jsonb_typeof(target_payload) = 'object'
      AND (SELECT count(*) FROM jsonb_object_keys(target_payload)) = 3
      AND target_payload ?& ARRAY['schemaVersion','requestId','snapshotId']
      AND target_payload->'schemaVersion' = '1'::jsonb
      AND jsonb_typeof(target_payload->'requestId') = 'string'
      AND jsonb_typeof(target_payload->'snapshotId') = 'string'
      AND pg_column_size(target_payload) <= 16384
    )
    WHEN target_topic IN ('PARTNER_SUBMISSION_COMPLETED','PARTNER_SUBMISSION_RECONCILIATION_ALERT') THEN (
      target_company IS NOT NULL AND target_job IS NOT NULL AND target_request IS NOT NULL
      AND jsonb_typeof(target_payload)='object' AND (SELECT count(*) FROM jsonb_object_keys(target_payload))=3
      AND target_payload?&ARRAY['schemaVersion','requestId','jobId'] AND target_payload->'schemaVersion'='1'::jsonb
      AND jsonb_typeof(target_payload->'requestId')='string' AND jsonb_typeof(target_payload->'jobId')='string'
      AND pg_column_size(target_payload)<=16384
    ) ELSE target_request IS NULL END
$$;

ALTER TABLE public.partner_outbox_events
  DROP CONSTRAINT partner_outbox_events_idempotency_key_key,
  ADD COLUMN request_id uuid,
  ADD COLUMN lease_token uuid,
  ADD COLUMN fence_token bigint NOT NULL DEFAULT 0,
  ADD COLUMN lease_owner varchar(120),
  ADD COLUMN lease_expires_at timestamptz,
  ADD CONSTRAINT partner_outbox_submission_request_fk FOREIGN KEY (company_id, job_id, request_id) REFERENCES public.partner_submission_requests(company_id, job_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT partner_outbox_fence_nonnegative CHECK (fence_token >= 0),
  ADD CONSTRAINT partner_outbox_submission_safe_error CHECK(last_error_code IS NULL OR request_id IS NULL OR public.partner_submission_safe_error_code(last_error_code)),
  ADD CONSTRAINT partner_outbox_lease_complete CHECK (
    (request_id IS NULL AND ((lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL) OR (lease_token IS NOT NULL AND lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' AND lease_expires_at IS NOT NULL)))
    OR (request_id IS NOT NULL AND ((state='PROCESSING' AND lease_token IS NOT NULL AND lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' AND lease_expires_at IS NOT NULL) OR (state<>'PROCESSING' AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL)))
  ),
  ADD CONSTRAINT partner_outbox_submission_payload CHECK (public.partner_submission_outbox_payload_valid(topic,company_id,job_id,request_id,payload));
CREATE UNIQUE INDEX partner_outbox_company_idempotency_unique ON public.partner_outbox_events(company_id, idempotency_key) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX partner_outbox_global_idempotency_unique ON public.partner_outbox_events(idempotency_key) WHERE company_id IS NULL;
CREATE INDEX partner_outbox_submission_claim_idx ON public.partner_outbox_events(state, available_at, created_at, id) WHERE topic = 'PARTNER_SUBMISSION_EXECUTE' AND state IN ('PENDING','FAILED','PROCESSING');
CREATE UNIQUE INDEX partner_outbox_submission_request_unique ON public.partner_outbox_events(company_id,job_id,request_id) WHERE topic='PARTNER_SUBMISSION_EXECUTE';

ALTER TABLE public.partner_audit_events DROP CONSTRAINT partner_audit_event_type;
ALTER TABLE public.partner_audit_events
  ADD COLUMN job_id uuid,
  ADD COLUMN submission_request_id uuid,
  ADD CONSTRAINT partner_audit_event_type CHECK (event_type IN ('LOGIN_SUCCEEDED','LOGIN_FAILED','LOGOUT','USER_PROVISIONED','USER_DISABLED','SESSIONS_REVOKED','LEGACY_CREDENTIAL_REPLACED','SUBMISSION_FROZEN','SUBMISSION_CLAIMED','SUBMISSION_PHASE_CHECKPOINTED','SUBMISSION_FINALIZED','SUBMISSION_FAILED_RETRYABLE','SUBMISSION_RECONCILIATION_REQUIRED')),
  ADD CONSTRAINT partner_audit_job_fk FOREIGN KEY (company_id, job_id) REFERENCES public.partner_jobs(company_id, id) ON DELETE SET NULL,
  ADD CONSTRAINT partner_audit_submission_request_fk FOREIGN KEY (company_id, job_id, submission_request_id) REFERENCES public.partner_submission_requests(company_id, job_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT partner_audit_submission_metadata CHECK (
    event_type NOT LIKE 'SUBMISSION_%'
    OR (
      company_id IS NOT NULL AND job_id IS NOT NULL AND submission_request_id IS NOT NULL
      AND jsonb_typeof(metadata) = 'object'
      AND metadata - ARRAY['phase','errorCode','contractVersion','attemptNumber'] = '{}'::jsonb
      AND (NOT metadata ? 'phase' OR metadata->>'phase' ~ '^[A-Z0-9_]{1,40}$')
      AND (NOT metadata ? 'errorCode' OR metadata->>'errorCode' ~ '^[A-Z0-9_]{1,80}$')
      AND (NOT metadata ? 'contractVersion' OR metadata->>'contractVersion' ~ '^[A-Za-z0-9._-]{1,80}$')
      AND (NOT metadata ? 'attemptNumber' OR (metadata->>'attemptNumber') ~ '^[1-9][0-9]{0,8}$')
    )
  );

CREATE OR REPLACE FUNCTION public.partner_submission_guard_audit_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.event_type LIKE 'SUBMISSION_%' AND current_user <> 'partner_submission_owner' THEN
    RAISE EXCEPTION 'submission audit events are owner-authored';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_submission_guard_audit BEFORE INSERT ON public.partner_audit_events FOR EACH ROW EXECUTE FUNCTION public.partner_submission_guard_audit_insert();

CREATE TRIGGER partner_submission_snapshots_append_only BEFORE UPDATE OR DELETE ON public.partner_submission_snapshots FOR EACH ROW EXECUTE FUNCTION public.partner_reject_append_only_change();
CREATE TRIGGER partner_submission_manifest_append_only BEFORE UPDATE OR DELETE ON public.partner_submission_plan_manifest FOR EACH ROW EXECUTE FUNCTION public.partner_reject_append_only_change();

CREATE OR REPLACE FUNCTION public.partner_submission_guard_job_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF current_user <> 'partner_submission_owner' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
      OR NEW.billing_model_snapshot IS DISTINCT FROM OLD.billing_model_snapshot
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN RAISE EXCEPTION 'partner job identity and business provenance cannot be changed directly'; END IF;
    IF OLD.submission_state <> 'DRAFT' AND (
      NEW.client_reference IS DISTINCT FROM OLD.client_reference OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
      OR NEW.customer_mobile IS DISTINCT FROM OLD.customer_mobile OR NEW.customer_email IS DISTINCT FROM OLD.customer_email
      OR NEW.site_address IS DISTINCT FROM OLD.site_address OR NEW.lead_sources IS DISTINCT FROM OLD.lead_sources
      OR NEW.notes IS DISTINCT FROM OLD.notes OR NEW.quote_data IS DISTINCT FROM OLD.quote_data
      OR NEW.quote_total_cents IS DISTINCT FROM OLD.quote_total_cents OR NEW.quote_initialized_at IS DISTINCT FROM OLD.quote_initialized_at
      OR NEW.quote_defaults_revision IS DISTINCT FROM OLD.quote_defaults_revision OR NEW.quote_defaults_snapshot IS DISTINCT FROM OLD.quote_defaults_snapshot
      OR NEW.revision IS DISTINCT FROM OLD.revision OR NEW.floor_plan_revision IS DISTINCT FROM OLD.floor_plan_revision
    ) THEN RAISE EXCEPTION 'non-draft partner jobs are immutable'; END IF;
    IF NEW.submission_state IS DISTINCT FROM OLD.submission_state OR NEW.legacy_job_id IS DISTINCT FROM OLD.legacy_job_id
      OR NEW.legacy_job_number IS DISTINCT FROM OLD.legacy_job_number OR NEW.final_quote_number IS DISTINCT FROM OLD.final_quote_number
      OR NEW.submission_started_at IS DISTINCT FROM OLD.submission_started_at OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
      OR NEW.submission_checkpoint IS DISTINCT FROM OLD.submission_checkpoint
      OR NEW.submission_adapter_mode_snapshot IS DISTINCT FROM OLD.submission_adapter_mode_snapshot
      OR NEW.submission_contract_version_snapshot IS DISTINCT FROM OLD.submission_contract_version_snapshot
      OR NEW.legacy_job_prefix_snapshot IS DISTINCT FROM OLD.legacy_job_prefix_snapshot
    THEN RAISE EXCEPTION 'submission-owned partner job columns cannot be changed directly'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_submission_guard_job BEFORE UPDATE ON public.partner_jobs FOR EACH ROW EXECUTE FUNCTION public.partner_submission_guard_job_change();

CREATE OR REPLACE FUNCTION public.partner_submission_guard_drawing_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE target_company uuid; target_job uuid;
BEGIN
  IF current_user = 'partner_submission_owner' OR current_user = 'partner_artifact_owner' THEN RETURN COALESCE(NEW, OLD); END IF;
  target_company := COALESCE(NEW.company_id, OLD.company_id); target_job := COALESCE(NEW.job_id, OLD.job_id);
  IF NOT EXISTS (SELECT 1 FROM public.partner_jobs WHERE company_id = target_company AND id = target_job AND submission_state = 'DRAFT') THEN
    RAISE EXCEPTION 'non-draft partner site plans are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER partner_submission_guard_drawing BEFORE INSERT OR UPDATE OR DELETE ON public.partner_site_plan_drawings FOR EACH ROW EXECUTE FUNCTION public.partner_submission_guard_drawing_change();

CREATE OR REPLACE FUNCTION public.partner_submission_job_ready(value public.partner_jobs)
RETURNS boolean LANGUAGE plpgsql STABLE STRICT SET search_path=pg_catalog AS $$
DECLARE quote jsonb:=value.quote_data;address jsonb:=value.site_address;wall jsonb;ceiling jsonb;defaults_value jsonb;contract_total numeric;calculated_total numeric;
BEGIN
  IF value.customer_name IS NULL OR btrim(value.customer_name)='' OR length(value.customer_name)>200
    OR value.customer_mobile IS NULL OR length(value.customer_mobile)>40 OR value.customer_email IS NULL OR length(value.customer_email)>254
    OR value.notes IS NULL OR length(value.notes)>4000
    OR ((value.customer_mobile IS NULL OR btrim(value.customer_mobile)='') AND (value.customer_email IS NULL OR btrim(value.customer_email)=''))
    OR (COALESCE(btrim(value.customer_mobile),'')<>'' AND value.customer_mobile!~'^[+0-9() .-]+$')
    OR (COALESCE(btrim(value.customer_email),'')<>'' AND value.customer_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    OR jsonb_typeof(address) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(address))<>4 OR NOT(address?&ARRAY['street','suburb','city','postcode'])
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['street','suburb','city','postcode']) key WHERE jsonb_typeof(address->key) IS DISTINCT FROM 'string' OR COALESCE(btrim(address->>key),'')='')
    OR length(address->>'street')>200 OR length(address->>'suburb')>100 OR length(address->>'city')>100 OR length(address->>'postcode')>20
    OR jsonb_typeof(value.lead_sources) IS DISTINCT FROM 'array' OR jsonb_array_length(value.lead_sources)>6
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(value.lead_sources) source WHERE source NOT IN('CONTACT_FORM','SOCIAL_MEDIA','PHONE_CALL','REFERRAL','HOMESHOW'))
    OR (SELECT count(DISTINCT source) FROM jsonb_array_elements_text(value.lead_sources) source)<>jsonb_array_length(value.lead_sources)
  THEN RETURN false; END IF;
  IF jsonb_typeof(quote) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(quote))<>11
    OR NOT(quote?&ARRAY['schema','quoteNumber','quoteDate','numberSource','wall','ceiling','consentFeeCents','depositBasisPoints','extras','comments','defaultsSnapshot'])
    OR quote->'schema' IS DISTINCT FROM '1'::jsonb OR quote->>'numberSource' IS DISTINCT FROM 'LOCAL_DRAFT' OR jsonb_typeof(quote->'numberSource') IS DISTINCT FROM 'string'
    OR jsonb_typeof(quote->'quoteNumber') IS DISTINCT FROM 'string' OR COALESCE(btrim(quote->>'quoteNumber'),'')='' OR length(quote->>'quoteNumber')>120
    OR jsonb_typeof(quote->'quoteDate') IS DISTINCT FROM 'string' OR COALESCE(btrim(quote->>'quoteDate'),'')='' OR length(quote->>'quoteDate')>40
    OR (quote->>'quoteDate')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$'
    OR jsonb_typeof(quote->'comments') IS DISTINCT FROM 'string' OR length(quote->>'comments')>4000 OR NOT public.partner_quote_extras_valid(quote->'extras')
    OR jsonb_typeof(quote->'defaultsSnapshot') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF (quote->>'quoteDate')::timestamptz IN ('infinity'::timestamptz,'-infinity'::timestamptz) THEN RETURN false; END IF;
  wall:=quote->'wall';ceiling:=quote->'ceiling';defaults_value:=quote->'defaultsSnapshot';
  IF jsonb_typeof(wall) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(wall))<>4 OR NOT(wall?&ARRAY['enabled','areaSqm','rateCentsPerSqm','cavityDepthCm'])
    OR jsonb_typeof(ceiling) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(ceiling))<>5 OR NOT(ceiling?&ARRAY['enabled','areaSqm','rateCentsPerSqm','rValue','downlights'])
    OR jsonb_typeof(wall->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(ceiling->'enabled') IS DISTINCT FROM 'boolean'
    OR ((wall->>'enabled')::boolean=false AND (ceiling->>'enabled')::boolean=false)
    OR jsonb_typeof(quote->'consentFeeCents') IS DISTINCT FROM 'number' OR (quote->>'consentFeeCents')!~'^\d+$' OR (quote->>'consentFeeCents')::numeric NOT BETWEEN 0 AND 1000000000
    OR jsonb_typeof(quote->'depositBasisPoints') IS DISTINCT FROM 'number' OR (quote->>'depositBasisPoints')!~'^\d+$' OR (quote->>'depositBasisPoints')::numeric NOT BETWEEN 0 AND 10000
    OR jsonb_typeof(defaults_value) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(defaults_value))<>7
    OR NOT(defaults_value?&ARRAY['wallRateCents','ceilingRateCents','depositBasisPoints','consentFeeCents','extras','revision','source'])
    OR defaults_value->>'source' IS DISTINCT FROM 'COMPANY_DEFAULTS' OR jsonb_typeof(defaults_value->'source') IS DISTINCT FROM 'string'
    OR NOT public.partner_quote_extras_valid(defaults_value->'extras')
    OR jsonb_typeof(defaults_value->'depositBasisPoints') IS DISTINCT FROM 'number' OR (defaults_value->>'depositBasisPoints')!~'^\d+$' OR (defaults_value->>'depositBasisPoints')::numeric NOT BETWEEN 0 AND 10000
    OR jsonb_typeof(defaults_value->'consentFeeCents') IS DISTINCT FROM 'number' OR (defaults_value->>'consentFeeCents')!~'^\d+$' OR (defaults_value->>'consentFeeCents')::numeric NOT BETWEEN 0 AND 1000000000
    OR jsonb_typeof(defaults_value->'revision') IS DISTINCT FROM 'number' OR (defaults_value->>'revision')!~'^\d+$' OR (defaults_value->>'revision')::numeric>2147483647
    OR (jsonb_typeof(defaults_value->'wallRateCents') IS DISTINCT FROM 'null' AND (jsonb_typeof(defaults_value->'wallRateCents') IS DISTINCT FROM 'number' OR (defaults_value->>'wallRateCents')!~'^\d+$' OR (defaults_value->>'wallRateCents')::numeric NOT BETWEEN 1 AND 10000000))
    OR (jsonb_typeof(defaults_value->'ceilingRateCents') IS DISTINCT FROM 'null' AND (jsonb_typeof(defaults_value->'ceilingRateCents') IS DISTINCT FROM 'number' OR (defaults_value->>'ceilingRateCents')!~'^\d+$' OR (defaults_value->>'ceilingRateCents')::numeric NOT BETWEEN 1 AND 10000000))
    OR defaults_value IS DISTINCT FROM value.quote_defaults_snapshot OR (defaults_value->>'revision')::integer IS DISTINCT FROM value.quote_defaults_revision
  THEN RETURN false; END IF;
  IF ((wall->>'enabled')::boolean=false AND (wall->'areaSqm'<>'null'::jsonb OR wall->'rateCentsPerSqm'<>'null'::jsonb OR wall->'cavityDepthCm'<>'null'::jsonb))
    OR ((ceiling->>'enabled')::boolean=false AND (ceiling->'areaSqm'<>'null'::jsonb OR ceiling->'rateCentsPerSqm'<>'null'::jsonb OR ceiling->'rValue'<>'null'::jsonb OR ceiling->'downlights'<>'null'::jsonb))
  THEN RETURN false; END IF;
  IF (wall->>'enabled')::boolean AND (jsonb_typeof(wall->'areaSqm') IS DISTINCT FROM 'number' OR (wall->>'areaSqm')::numeric NOT BETWEEN 0.000000001 AND 100000 OR jsonb_typeof(wall->'rateCentsPerSqm') IS DISTINCT FROM 'number' OR (wall->>'rateCentsPerSqm')!~'^\d+$' OR (wall->>'rateCentsPerSqm')::numeric NOT BETWEEN 1 AND 10000000 OR wall->>'cavityDepthCm' NOT IN('10','15')) THEN RETURN false; END IF;
  IF (ceiling->>'enabled')::boolean AND (jsonb_typeof(ceiling->'areaSqm') IS DISTINCT FROM 'number' OR (ceiling->>'areaSqm')::numeric NOT BETWEEN 0.000000001 AND 100000 OR jsonb_typeof(ceiling->'rateCentsPerSqm') IS DISTINCT FROM 'number' OR (ceiling->>'rateCentsPerSqm')!~'^\d+$' OR (ceiling->>'rateCentsPerSqm')::numeric NOT BETWEEN 1 AND 10000000 OR jsonb_typeof(ceiling->'rValue') IS DISTINCT FROM 'number' OR (ceiling->>'rValue')::numeric NOT BETWEEN 0.000000001 AND 20 OR jsonb_typeof(ceiling->'downlights') IS DISTINCT FROM 'number' OR (ceiling->>'downlights')!~'^\d+$' OR (ceiling->>'downlights')::numeric NOT BETWEEN 0 AND 10000) THEN RETURN false; END IF;
  contract_total:=CASE WHEN (wall->>'enabled')::boolean THEN round((wall->>'areaSqm')::numeric*(wall->>'rateCentsPerSqm')::numeric) ELSE 0 END+CASE WHEN (ceiling->>'enabled')::boolean THEN round((ceiling->>'areaSqm')::numeric*(ceiling->>'rateCentsPerSqm')::numeric) ELSE 0 END+(SELECT COALESCE(sum((extra->>'priceCents')::numeric),0) FROM jsonb_array_elements(quote->'extras') extra);
  calculated_total:=contract_total+round(contract_total*0.15)+(quote->>'consentFeeCents')::numeric;
  RETURN value.quote_total_cents IS NOT NULL AND value.quote_total_cents=calculated_total;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.partner_submission_jsonb_nfc(value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'string' THEN RETURN to_jsonb(normalize(value#>>'{}',NFC));
    WHEN 'array' THEN RETURN (SELECT COALESCE(jsonb_agg(public.partner_submission_jsonb_nfc(item) ORDER BY ordinal),'[]'::jsonb) FROM jsonb_array_elements(value) WITH ORDINALITY entry(item,ordinal));
    WHEN 'object' THEN RETURN (SELECT COALESCE(jsonb_object_agg(normalize(key,NFC),public.partner_submission_jsonb_nfc(item)),'{}'::jsonb) FROM jsonb_each(value) entry(key,item));
    ELSE RETURN value;
  END CASE;
END $$;

CREATE OR REPLACE FUNCTION public.partner_submission_snapshot_shape_valid(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE plan jsonb;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(value))<>4 OR NOT(value?&ARRAY['schemaVersion','contract','job','plans'])
    OR value->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(value->'contract') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(value->'contract'))<>3
    OR NOT(value->'contract'?&ARRAY['adapterMode','version','legacyJobPrefix'])
    OR jsonb_typeof(value#>'{contract,adapterMode}') IS DISTINCT FROM 'string' OR jsonb_typeof(value#>'{contract,version}') IS DISTINCT FROM 'string' OR jsonb_typeof(value#>'{contract,legacyJobPrefix}') IS DISTINCT FROM 'string'
    OR jsonb_typeof(value->'job') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(value->'job'))<>11
    OR NOT(value->'job'?&ARRAY['id','companyId','revision','floorPlanRevision','clientReference','billingModel','customer','siteAddress','leadSources','notes','quote'])
    OR jsonb_typeof(value#>'{job,id}') IS DISTINCT FROM 'string' OR jsonb_typeof(value#>'{job,companyId}') IS DISTINCT FROM 'string'
    OR jsonb_typeof(value#>'{job,clientReference}') IS DISTINCT FROM 'string' OR jsonb_typeof(value#>'{job,billingModel}') IS DISTINCT FROM 'string'
    OR jsonb_typeof(value#>'{job,notes}') IS DISTINCT FROM 'string'
    OR jsonb_typeof(value#>'{job,revision}') IS DISTINCT FROM 'number' OR (value#>>'{job,revision}')!~'^\d+$' OR (value#>>'{job,revision}')::numeric>2147483647
    OR jsonb_typeof(value#>'{job,floorPlanRevision}') IS DISTINCT FROM 'number' OR (value#>>'{job,floorPlanRevision}')!~'^\d+$' OR (value#>>'{job,floorPlanRevision}')::numeric>2147483647
    OR jsonb_typeof(value#>'{job,customer}') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(value#>'{job,customer}'))<>3 OR NOT(value#>'{job,customer}'?&ARRAY['name','mobile','email'])
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['name','mobile','email']) key WHERE jsonb_typeof(value#>ARRAY['job','customer',key]) IS DISTINCT FROM 'string')
    OR jsonb_typeof(value#>'{job,siteAddress}') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(value#>'{job,siteAddress}'))<>4 OR NOT(value#>'{job,siteAddress}'?&ARRAY['street','suburb','city','postcode'])
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['street','suburb','city','postcode']) key WHERE jsonb_typeof(value#>ARRAY['job','siteAddress',key]) IS DISTINCT FROM 'string')
    OR jsonb_typeof(value#>'{job,leadSources}') IS DISTINCT FROM 'array' OR jsonb_typeof(value#>'{job,quote}') IS DISTINCT FROM 'object'
    OR jsonb_typeof(value->'plans') IS DISTINCT FROM 'array' OR jsonb_array_length(value->'plans') NOT BETWEEN 1 AND 20 THEN RETURN false; END IF;
  FOR plan IN SELECT jsonb_array_elements(value->'plans') LOOP
    IF jsonb_typeof(plan) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(plan))<>8
      OR NOT(plan?&ARRAY['ordinal','drawingId','name','drawingRevision','document','documentSha256','artifact','remoteFileName'])
      OR jsonb_typeof(plan->'ordinal') IS DISTINCT FROM 'number' OR (plan->>'ordinal')!~'^\d+$' OR (plan->>'ordinal')::integer NOT BETWEEN 0 AND 19
      OR jsonb_typeof(plan->'drawingId') IS DISTINCT FROM 'string' OR jsonb_typeof(plan->'name') IS DISTINCT FROM 'string'
      OR jsonb_typeof(plan->'drawingRevision') IS DISTINCT FROM 'number' OR (plan->>'drawingRevision')!~'^\d+$' OR (plan->>'drawingRevision')::numeric>2147483647
      OR jsonb_typeof(plan->'document') IS DISTINCT FROM 'object' OR jsonb_typeof(plan->'documentSha256') IS DISTINCT FROM 'string'
      OR (plan->>'documentSha256')!~'^[0-9a-f]{64}$' OR jsonb_typeof(plan->'remoteFileName') IS DISTINCT FROM 'string'
      OR jsonb_typeof(plan->'artifact') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(plan->'artifact'))<>8
      OR NOT(plan->'artifact'?&ARRAY['id','renderHash','contentSha256','byteSize','rendererVersion','templateVersion','templateSha256','localFileName'])
      OR EXISTS(SELECT 1 FROM unnest(ARRAY['id','renderHash','contentSha256','rendererVersion','templateVersion','templateSha256','localFileName']) key WHERE jsonb_typeof(plan#>ARRAY['artifact',key]) IS DISTINCT FROM 'string')
      OR (plan#>>'{artifact,renderHash}')!~'^[0-9a-f]{64}$' OR (plan#>>'{artifact,contentSha256}')!~'^[0-9a-f]{64}$' OR (plan#>>'{artifact,templateSha256}')!~'^[0-9a-f]{64}$'
      OR jsonb_typeof(plan#>'{artifact,byteSize}') IS DISTINCT FROM 'number' OR (plan#>>'{artifact,byteSize}')!~'^\d+$' OR (plan#>>'{artifact,byteSize}')::integer NOT BETWEEN 1 AND 5242880
    THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.partner_submission_render_text(value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT CASE WHEN value IS NULL THEN NULL ELSE btrim(regexp_replace(normalize(replace(replace(value,E'\r\n',E'\n'),E'\r',E'\n'),NFC),E'\n+',' ','g')) END
$$;

CREATE OR REPLACE FUNCTION public.partner_submission_request_id(target_company uuid,target_job uuid,target_idempotency_hash text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE value text;
BEGIN
  IF target_idempotency_hash!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'SUBMISSION_INVALID_IDEMPOTENCY'; END IF;
  value:=encode(public.digest(convert_to('partner-submission-request-v1|'||lower(target_company::text)||'|'||lower(target_job::text)||'|'||target_idempotency_hash,'UTF8'),'sha256'),'hex');
  RETURN (substr(value,1,8)||'-'||substr(value,9,4)||'-5'||substr(value,14,3)||'-8'||substr(value,18,3)||'-'||substr(value,21,12))::uuid;
END $$;

CREATE OR REPLACE FUNCTION public.partner_submission_remote_file_name(target_prefix text,target_request uuid,target_ordinal integer,target_artifact uuid,target_content_sha text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$ BEGIN
  IF target_prefix!~'^[A-Z0-9][A-Z0-9-]{0,39}$' OR target_ordinal NOT BETWEEN 0 AND 19 OR target_content_sha!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'SUBMISSION_INVALID_REMOTE_FILE'; END IF;
  RETURN target_prefix||'-'||replace(target_request::text,'-','')||'-'||lpad((target_ordinal+1)::text,2,'0')||'-'||replace(target_artifact::text,'-','')||'-'||target_content_sha||'.pdf';
END $$;

CREATE OR REPLACE FUNCTION public.partner_freeze_submission(
  target_company uuid, target_job uuid, target_user text,
  expected_job_revision integer, expected_floor_plan_revision integer,
  target_request_id uuid, target_snapshot_id uuid,
  target_idempotency_hash text, target_canonical_document text, target_manifest jsonb
) RETURNS TABLE(request_id uuid, snapshot_id uuid, authoritative_snapshot_sha256 text, authoritative_request_hash text, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  job_row public.partner_jobs%ROWTYPE;
  company_row public.partner_companies%ROWTYPE;
  existing_request public.partner_submission_requests%ROWTYPE;
  manifest_item jsonb; drawing_row public.partner_site_plan_drawings%ROWTYPE; artifact_row public.partner_site_plan_pdf_artifacts%ROWTYPE;
  expected_ordinal integer := 0; manifest_count integer; calculated_snapshot_sha text; calculated_request_hash text;
  snapshot_value jsonb; plan_value jsonb; render_value jsonb; calculated_remote_name text;
BEGIN
  IF target_idempotency_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'SUBMISSION_INVALID_HASH';
  END IF;
  IF target_request_id IS DISTINCT FROM public.partner_submission_request_id(target_company,target_job,target_idempotency_hash) THEN
    RAISE EXCEPTION 'SUBMISSION_INVALID_REQUEST_ID';
  END IF;

  SELECT * INTO company_row FROM public.partner_companies WHERE id = target_company FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO job_row FROM public.partner_jobs WHERE company_id = target_company AND id = target_job FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF jsonb_typeof(target_manifest) <> 'array' OR jsonb_array_length(target_manifest) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'SUBMISSION_INVALID_MANIFEST'; END IF;
  snapshot_value := target_canonical_document::jsonb;
  IF NOT public.partner_submission_snapshot_shape_valid(snapshot_value) THEN RAISE EXCEPTION 'SUBMISSION_SNAPSHOT_HASH_MISMATCH'; END IF;
  -- PostgreSQL owns the immutable submission identity. Never retain caller raw
  -- JSON: jsonb collapses duplicate keys and canonicalizes whitespace/order,
  -- preventing hidden unvalidated values while avoiding a second JS/SQL number
  -- rendering algorithm at this authority boundary.
  target_canonical_document := snapshot_value::text;
  calculated_snapshot_sha := encode(public.digest(convert_to(target_canonical_document, 'UTF8'), 'sha256'), 'hex');
  IF (snapshot_value#>>'{job,revision}')::integer IS DISTINCT FROM expected_job_revision OR (snapshot_value#>>'{job,floorPlanRevision}')::integer IS DISTINCT FROM expected_floor_plan_revision THEN
    RAISE EXCEPTION 'SUBMISSION_REQUEST_BODY_MISMATCH';
  END IF;
  calculated_request_hash := encode(public.digest(convert_to('{"floorPlanRevision":'||expected_floor_plan_revision::text||',"jobRevision":'||expected_job_revision::text||',"schemaVersion":1,"snapshotSha256":"'||calculated_snapshot_sha||'"}','UTF8'),'sha256'),'hex');

  SELECT * INTO existing_request FROM public.partner_submission_requests WHERE company_id = target_company AND idempotency_key_hash = target_idempotency_hash;
  IF FOUND THEN
    IF existing_request.job_id IS DISTINCT FROM target_job OR existing_request.request_hash IS DISTINCT FROM calculated_request_hash THEN RAISE EXCEPTION 'SUBMISSION_IDEMPOTENCY_CONFLICT'; END IF;
    SELECT snapshot_sha256::text INTO calculated_snapshot_sha FROM public.partner_submission_snapshots WHERE (company_id,job_id,id)=(existing_request.company_id,existing_request.job_id,existing_request.snapshot_id);
    request_id := existing_request.id; snapshot_id := existing_request.snapshot_id; authoritative_snapshot_sha256:=calculated_snapshot_sha; authoritative_request_hash:=existing_request.request_hash; replayed := true; RETURN NEXT; RETURN;
  END IF;

  IF company_row.submission_adapter_mode NOT IN ('FICTIONAL','LIVE') OR company_row.submission_contract_version IS NULL OR company_row.legacy_job_prefix IS NULL THEN RAISE EXCEPTION 'SUBMISSION_CONTRACT_DISABLED'; END IF;
  IF job_row.submission_state <> 'DRAFT' THEN RAISE EXCEPTION 'SUBMISSION_NOT_DRAFT'; END IF;
  IF job_row.revision <> expected_job_revision OR job_row.floor_plan_revision <> expected_floor_plan_revision THEN RAISE EXCEPTION 'SUBMISSION_STALE'; END IF;
  IF public.partner_submission_job_ready(job_row) IS NOT TRUE THEN RAISE EXCEPTION 'SUBMISSION_NOT_READY'; END IF;
  IF company_row.submission_adapter_mode='LIVE' AND (company_row.legacy_base_url IS NULL OR company_row.legacy_credential_ciphertext IS NULL OR company_row.legacy_credential_nonce IS NULL OR company_row.legacy_credential_key_version IS NULL OR company_row.legacy_credential_updated_at IS NULL) THEN RAISE EXCEPTION 'SUBMISSION_LIVE_CREDENTIALS_REQUIRED'; END IF;
  IF snapshot_value#>>'{contract,adapterMode}' IS DISTINCT FROM company_row.submission_adapter_mode
    OR snapshot_value#>>'{contract,version}' IS DISTINCT FROM company_row.submission_contract_version
    OR snapshot_value#>>'{contract,legacyJobPrefix}' IS DISTINCT FROM company_row.legacy_job_prefix
    OR snapshot_value#>>'{job,id}' IS DISTINCT FROM job_row.id::text OR snapshot_value#>>'{job,companyId}' IS DISTINCT FROM job_row.company_id::text
    OR (snapshot_value#>>'{job,revision}')::integer IS DISTINCT FROM job_row.revision OR (snapshot_value#>>'{job,floorPlanRevision}')::integer IS DISTINCT FROM job_row.floor_plan_revision
    OR snapshot_value#>>'{job,clientReference}' IS DISTINCT FROM normalize(job_row.client_reference,NFC) OR snapshot_value#>>'{job,billingModel}' IS DISTINCT FROM job_row.billing_model_snapshot
    OR snapshot_value#>>'{job,customer,name}' IS DISTINCT FROM normalize(job_row.customer_name,NFC) OR snapshot_value#>>'{job,customer,mobile}' IS DISTINCT FROM normalize(job_row.customer_mobile,NFC)
    OR snapshot_value#>>'{job,customer,email}' IS DISTINCT FROM normalize(job_row.customer_email,NFC) OR snapshot_value#>'{job,siteAddress}' IS DISTINCT FROM public.partner_submission_jsonb_nfc(job_row.site_address)
    OR snapshot_value#>'{job,leadSources}' IS DISTINCT FROM public.partner_submission_jsonb_nfc(job_row.lead_sources) OR snapshot_value#>>'{job,notes}' IS DISTINCT FROM normalize(job_row.notes,NFC)
    OR snapshot_value#>'{job,quote}' IS DISTINCT FROM public.partner_submission_jsonb_nfc(job_row.quote_data)
  THEN RAISE EXCEPTION 'SUBMISSION_SNAPSHOT_SOURCE_MISMATCH'; END IF;

  PERFORM id FROM public.partner_site_plan_drawings WHERE company_id = target_company AND job_id = target_job ORDER BY id FOR UPDATE;
  PERFORM id FROM public.partner_site_plan_pdf_artifacts WHERE company_id = target_company AND job_id = target_job ORDER BY drawing_id,id FOR UPDATE;
  SELECT count(*) INTO manifest_count FROM public.partner_site_plan_drawings WHERE company_id = target_company AND job_id = target_job;
  IF manifest_count <> jsonb_array_length(target_manifest) OR manifest_count <> jsonb_array_length(snapshot_value->'plans') OR manifest_count = 0 THEN RAISE EXCEPTION 'SUBMISSION_PLAN_SET_MISMATCH'; END IF;

  INSERT INTO public.partner_submission_snapshots(company_id,job_id,id,job_revision,floor_plan_revision,adapter_mode,contract_version,legacy_job_prefix,legacy_base_url_snapshot,legacy_credential_fingerprint,legacy_credential_key_version_snapshot,legacy_credential_updated_at_snapshot,canonical_document,snapshot_data,snapshot_sha256,byte_size,created_by_user_id)
  VALUES(target_company,target_job,target_snapshot_id,job_row.revision,job_row.floor_plan_revision,company_row.submission_adapter_mode,company_row.submission_contract_version,company_row.legacy_job_prefix,
    CASE WHEN company_row.submission_adapter_mode='LIVE' THEN company_row.legacy_base_url ELSE NULL END,
    CASE WHEN company_row.submission_adapter_mode='LIVE' THEN encode(public.digest(company_row.legacy_credential_ciphertext||company_row.legacy_credential_nonce,'sha256'),'hex') ELSE NULL END,
    CASE WHEN company_row.submission_adapter_mode='LIVE' THEN company_row.legacy_credential_key_version ELSE NULL END,
    CASE WHEN company_row.submission_adapter_mode='LIVE' THEN company_row.legacy_credential_updated_at ELSE NULL END,
    target_canonical_document,target_canonical_document::jsonb,calculated_snapshot_sha,octet_length(convert_to(target_canonical_document,'UTF8')),target_user);

  FOR manifest_item IN SELECT value FROM jsonb_array_elements(target_manifest) LOOP
    IF jsonb_typeof(manifest_item) <> 'object' OR (manifest_item->>'ordinal') !~ '^[0-9]+$' OR (manifest_item->>'ordinal')::integer <> expected_ordinal THEN RAISE EXCEPTION 'SUBMISSION_MANIFEST_ORDER_INVALID'; END IF;
    plan_value := snapshot_value->'plans'->expected_ordinal;
    SELECT * INTO drawing_row FROM public.partner_site_plan_drawings
      WHERE company_id=target_company AND job_id=target_job AND id=(manifest_item->>'drawingId')::uuid AND sort_order=expected_ordinal;
    IF NOT FOUND OR jsonb_array_length(drawing_row.drawing_data->'walls') = 0 OR drawing_row.revision <> (manifest_item->>'drawingRevision')::integer THEN RAISE EXCEPTION 'SUBMISSION_PLAN_NOT_READY'; END IF;
    SELECT * INTO artifact_row FROM public.partner_site_plan_pdf_artifacts
      WHERE company_id=target_company AND job_id=target_job AND drawing_id=drawing_row.id AND id=(manifest_item->>'artifactId')::uuid;
    IF NOT FOUND OR drawing_row.current_pdf_artifact_id IS DISTINCT FROM artifact_row.id
      OR artifact_row.drawing_revision <> drawing_row.revision OR artifact_row.render_hash <> manifest_item->>'renderHash'
      OR artifact_row.content_sha256 <> manifest_item->>'contentSha256' OR artifact_row.byte_size <> (manifest_item->>'byteSize')::integer
      OR artifact_row.byte_size <> octet_length(artifact_row.pdf_bytes)
      OR artifact_row.content_sha256 <> encode(public.digest(artifact_row.pdf_bytes,'sha256'),'hex')
      OR substring(artifact_row.pdf_bytes FROM 1 FOR 5) <> convert_to('%PDF-','UTF8')
      OR artifact_row.renderer_version <> 'partner-site-plan-renderer-v1' OR artifact_row.template_version <> 'site-plan-template-v2'
      OR artifact_row.template_sha256 <> 'b82dc68276806628e2574a6a51a6299d1a23df56f4ba8a5a4a06226d3ebd904b'
    THEN RAISE EXCEPTION 'SUBMISSION_PDF_INTEGRITY_FAILED'; END IF;
    IF (manifest_item->>'documentCanonical')::jsonb IS DISTINCT FROM drawing_row.drawing_data
      OR manifest_item->>'documentSha256' IS DISTINCT FROM encode(public.digest(convert_to(manifest_item->>'documentCanonical','UTF8'),'sha256'),'hex')
    THEN RAISE EXCEPTION 'SUBMISSION_DOCUMENT_INTEGRITY_FAILED'; END IF;
    render_value := (manifest_item->>'renderInputCanonical')::jsonb;
    IF render_value->>'drawingName' IS DISTINCT FROM public.partner_submission_render_text(drawing_row.name)
      OR render_value#>>'{siteAddress,street}' IS DISTINCT FROM public.partner_submission_render_text(job_row.site_address->>'street')
      OR render_value#>>'{siteAddress,suburb}' IS DISTINCT FROM public.partner_submission_render_text(job_row.site_address->>'suburb')
      OR render_value#>>'{siteAddress,city}' IS DISTINCT FROM public.partner_submission_render_text(job_row.site_address->>'city')
      OR render_value#>>'{siteAddress,postcode}' IS DISTINCT FROM public.partner_submission_render_text(job_row.site_address->>'postcode')
      OR render_value->'document' IS DISTINCT FROM drawing_row.drawing_data
      OR render_value->>'templateVersion' IS DISTINCT FROM artifact_row.template_version OR render_value->>'templateSha256' IS DISTINCT FROM artifact_row.template_sha256
      OR render_value->>'rendererVersion' IS DISTINCT FROM artifact_row.renderer_version OR render_value->>'fontSha256' IS DISTINCT FROM '478c558ea716033cd60c03438f628dfa75694dcf6b5f6d505a2f05fd2b4f3823'
      OR encode(public.digest(convert_to(manifest_item->>'renderInputCanonical','UTF8'),'sha256'),'hex') IS DISTINCT FROM artifact_row.render_hash
    THEN RAISE EXCEPTION 'SUBMISSION_RENDER_INPUT_MISMATCH'; END IF;
    calculated_remote_name := public.partner_submission_remote_file_name(company_row.legacy_job_prefix,target_request_id,expected_ordinal,artifact_row.id,artifact_row.content_sha256);
    IF manifest_item->>'remoteFileName' IS DISTINCT FROM calculated_remote_name
      OR plan_value->>'ordinal' IS DISTINCT FROM expected_ordinal::text OR plan_value->>'drawingId' IS DISTINCT FROM drawing_row.id::text
      OR plan_value->>'name' IS DISTINCT FROM drawing_row.name OR plan_value->>'drawingRevision' IS DISTINCT FROM drawing_row.revision::text
      OR plan_value->'document' IS DISTINCT FROM drawing_row.drawing_data OR plan_value->>'documentSha256' IS DISTINCT FROM manifest_item->>'documentSha256'
      OR plan_value#>>'{artifact,id}' IS DISTINCT FROM artifact_row.id::text OR plan_value#>>'{artifact,renderHash}' IS DISTINCT FROM artifact_row.render_hash
      OR plan_value#>>'{artifact,contentSha256}' IS DISTINCT FROM artifact_row.content_sha256 OR plan_value#>>'{artifact,byteSize}' IS DISTINCT FROM artifact_row.byte_size::text
      OR plan_value#>>'{artifact,rendererVersion}' IS DISTINCT FROM artifact_row.renderer_version OR plan_value#>>'{artifact,templateVersion}' IS DISTINCT FROM artifact_row.template_version
      OR plan_value#>>'{artifact,templateSha256}' IS DISTINCT FROM artifact_row.template_sha256 OR plan_value#>>'{artifact,localFileName}' IS DISTINCT FROM artifact_row.file_name
      OR plan_value->>'remoteFileName' IS DISTINCT FROM calculated_remote_name
    THEN RAISE EXCEPTION 'SUBMISSION_PLAN_SNAPSHOT_MISMATCH'; END IF;
    INSERT INTO public.partner_submission_plan_manifest(company_id,job_id,snapshot_id,ordinal,drawing_id,artifact_id,drawing_revision,drawing_name,document_sha256,render_hash,content_sha256,byte_size,renderer_version,template_version,template_sha256,local_file_name,remote_file_name)
    VALUES(target_company,target_job,target_snapshot_id,expected_ordinal,drawing_row.id,artifact_row.id,drawing_row.revision,drawing_row.name,manifest_item->>'documentSha256',artifact_row.render_hash,artifact_row.content_sha256,artifact_row.byte_size,artifact_row.renderer_version,artifact_row.template_version,artifact_row.template_sha256,artifact_row.file_name,calculated_remote_name);
    expected_ordinal := expected_ordinal + 1;
  END LOOP;

  INSERT INTO public.partner_submission_requests(company_id,job_id,id,snapshot_id,idempotency_key_hash,request_hash,created_by_user_id)
  VALUES(target_company,target_job,target_request_id,target_snapshot_id,target_idempotency_hash,calculated_request_hash,target_user);
  INSERT INTO public.partner_submission_plan_deliveries(company_id,job_id,request_id,snapshot_id,ordinal,drawing_id)
    SELECT m.company_id,m.job_id,target_request_id,m.snapshot_id,m.ordinal,m.drawing_id FROM public.partner_submission_plan_manifest m
    WHERE m.company_id=target_company AND m.job_id=target_job AND m.snapshot_id=target_snapshot_id ORDER BY m.ordinal;
  INSERT INTO public.partner_outbox_events(company_id,job_id,request_id,topic,idempotency_key,payload)
  VALUES(target_company,target_job,target_request_id,'PARTNER_SUBMISSION_EXECUTE','submission-execute:'||target_company::text||':'||target_job::text||':'||target_idempotency_hash,
    jsonb_build_object('schemaVersion',1,'requestId',target_request_id::text,'snapshotId',target_snapshot_id::text));
  UPDATE public.partner_site_plan_drawings d SET submitted_snapshot_data=d.drawing_data,submitted_snapshot_at=now(),submitted_pdf_storage_key=NULL,
    submitted_pdf_outbox_event_id=(SELECT o.id FROM public.partner_outbox_events o WHERE o.company_id=target_company AND o.request_id=target_request_id)
    FROM public.partner_submission_plan_manifest m WHERE (d.company_id,d.job_id,d.id)=(m.company_id,m.job_id,m.drawing_id) AND m.snapshot_id=target_snapshot_id;
  UPDATE public.partner_jobs SET submission_state='QUEUED',submission_checkpoint='FROZEN',submission_adapter_mode_snapshot=company_row.submission_adapter_mode,
    submission_contract_version_snapshot=company_row.submission_contract_version,legacy_job_prefix_snapshot=company_row.legacy_job_prefix,updated_at=now()
    WHERE company_id=target_company AND id=target_job;
  INSERT INTO public.partner_audit_events(event_type,actor_user_id,company_id,job_id,submission_request_id,metadata)
    VALUES('SUBMISSION_FROZEN',target_user,target_company,target_job,target_request_id,jsonb_build_object('phase','FROZEN','contractVersion',company_row.submission_contract_version));
  request_id:=target_request_id;snapshot_id:=target_snapshot_id;authoritative_snapshot_sha256:=calculated_snapshot_sha;authoritative_request_hash:=calculated_request_hash;replayed:=false;RETURN NEXT;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR data_exception THEN
  RAISE EXCEPTION 'SUBMISSION_INVALID_INPUT';
END $$;

CREATE OR REPLACE FUNCTION public.partner_claim_submission(target_worker text, lease_seconds integer DEFAULT 120)
RETURNS TABLE(company_id uuid,job_id uuid,request_id uuid,snapshot_id uuid,lease_token uuid,fence_token bigint,attempt_number integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE outbox_row public.partner_outbox_events%ROWTYPE; request_row public.partner_submission_requests%ROWTYPE; job_row public.partner_jobs%ROWTYPE; next_attempt integer; attempt_phase text;
BEGIN
  IF target_worker !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' OR lease_seconds NOT BETWEEN 30 AND 900 THEN RAISE EXCEPTION 'SUBMISSION_INVALID_LEASE'; END IF;
  SELECT * INTO outbox_row FROM public.partner_outbox_events
    WHERE topic='PARTNER_SUBMISSION_EXECUTE' AND available_at<=now()
      AND (state IN ('PENDING','FAILED') OR (state='PROCESSING' AND lease_expires_at<now()))
    ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM 1 FROM public.partner_companies WHERE id=outbox_row.company_id FOR UPDATE;
  SELECT j.* INTO job_row FROM public.partner_jobs j WHERE j.company_id=outbox_row.company_id AND j.id=outbox_row.job_id FOR UPDATE;
  SELECT r.* INTO request_row FROM public.partner_submission_requests r WHERE r.company_id=outbox_row.company_id AND r.job_id=outbox_row.job_id AND r.id=outbox_row.request_id FOR UPDATE;
  UPDATE public.partner_submission_attempts a SET outcome='FAILED_RETRYABLE',error_code='LEASE_EXPIRED',finished_at=now()
    WHERE a.company_id=outbox_row.company_id AND a.job_id=outbox_row.job_id AND a.request_id=outbox_row.request_id AND a.outcome='IN_PROGRESS';
  SELECT COALESCE(max(a.attempt_number),0)+1 INTO next_attempt FROM public.partner_submission_attempts a WHERE a.company_id=outbox_row.company_id AND a.job_id=outbox_row.job_id AND a.request_id=outbox_row.request_id;
  attempt_phase:=CASE WHEN job_row.submission_checkpoint IN('FROZEN','CREATE_STARTED') THEN 'CREATING_LEAD' WHEN job_row.submission_checkpoint='LEAD_CREATED' THEN 'UPDATING_QUOTE' ELSE 'ATTACHING_PLANS' END;
  outbox_row.lease_token:=gen_random_uuid();outbox_row.fence_token:=outbox_row.fence_token+1;
  UPDATE public.partner_outbox_events o SET state='PROCESSING',attempt_count=o.attempt_count+1,locked_at=now(),lease_token=outbox_row.lease_token,
    fence_token=outbox_row.fence_token,lease_owner=target_worker,lease_expires_at=now()+make_interval(secs=>lease_seconds),updated_at=now()
    WHERE o.company_id=outbox_row.company_id AND o.id=outbox_row.id;
  UPDATE public.partner_submission_requests r SET state='PROCESSING',safe_error_code=NULL,updated_at=now() WHERE r.company_id=outbox_row.company_id AND r.job_id=outbox_row.job_id AND r.id=outbox_row.request_id;
  UPDATE public.partner_jobs j SET submission_state=CASE WHEN j.submission_checkpoint='FROZEN' THEN 'QUEUED' WHEN j.submission_checkpoint='CREATE_STARTED' THEN 'CREATING_LEAD' WHEN j.submission_checkpoint='LEAD_CREATED' THEN 'UPDATING_QUOTE' ELSE 'ATTACHING_PLANS' END,updated_at=now()
    WHERE j.company_id=outbox_row.company_id AND j.id=outbox_row.job_id AND j.submission_state IN('QUEUED','FAILED_RETRYABLE','CREATING_LEAD','UPDATING_QUOTE','ATTACHING_PLANS');
  INSERT INTO public.partner_submission_attempts(company_id,job_id,request_id,attempt_number,phase,outcome,lease_token,fence_token,lease_owner,lease_expires_at,started_at)
    VALUES(outbox_row.company_id,outbox_row.job_id,outbox_row.request_id,next_attempt,attempt_phase,'IN_PROGRESS',outbox_row.lease_token,outbox_row.fence_token,target_worker,now()+make_interval(secs=>lease_seconds),now());
  INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata)
    VALUES('SUBMISSION_CLAIMED',outbox_row.company_id,outbox_row.job_id,outbox_row.request_id,jsonb_build_object('phase','CLAIMED','attemptNumber',next_attempt::text));
  company_id:=outbox_row.company_id;job_id:=outbox_row.job_id;request_id:=outbox_row.request_id;snapshot_id:=request_row.snapshot_id;lease_token:=outbox_row.lease_token;fence_token:=outbox_row.fence_token;attempt_number:=next_attempt;RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.partner_submission_lock_lease(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE locked_id uuid;
BEGIN
  SELECT id INTO locked_id FROM public.partner_outbox_events WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND topic='PARTNER_SUBMISSION_EXECUTE' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN EXISTS(SELECT 1 FROM public.partner_outbox_events WHERE id=locked_id AND company_id=target_company AND state='PROCESSING' AND lease_token=target_lease AND fence_token=target_fence AND lease_expires_at>=now());
END $$;

CREATE OR REPLACE FUNCTION public.partner_heartbeat_submission(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint,lease_seconds integer DEFAULT 120)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF lease_seconds NOT BETWEEN 30 AND 900 OR NOT public.partner_submission_lock_lease(target_company,target_job,target_request,target_lease,target_fence) THEN RETURN false; END IF;
  UPDATE public.partner_outbox_events SET lease_expires_at=now()+make_interval(secs=>lease_seconds),updated_at=now() WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND state='PROCESSING' AND lease_token=target_lease AND fence_token=target_fence;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.partner_submission_attempts SET lease_expires_at=now()+make_interval(secs=>lease_seconds),heartbeat_at=now() WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND outcome='IN_PROGRESS' AND lease_token=target_lease AND fence_token=target_fence;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.partner_checkpoint_submission(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint,target_phase text,target_legacy_id text DEFAULT NULL,target_legacy_number bigint DEFAULT NULL,target_ordinal integer DEFAULT NULL,target_remote_key text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attached_count integer; total_count integer; affected integer; existing_state text; existing_key text; drawing_for_delivery uuid; calculated_quote_number text; job_checkpoint text; stored_legacy_id text; stored_legacy_number bigint; stored_quote_number text;
BEGIN
  IF NOT public.partner_submission_lock_lease(target_company,target_job,target_request,target_lease,target_fence) THEN RETURN false; END IF;
  PERFORM 1 FROM public.partner_companies WHERE id=target_company FOR UPDATE;
  SELECT submission_checkpoint,legacy_job_id,legacy_job_number,final_quote_number INTO job_checkpoint,stored_legacy_id,stored_legacy_number,stored_quote_number FROM public.partner_jobs WHERE company_id=target_company AND id=target_job FOR UPDATE;
  IF target_phase='CREATE_STARTED' THEN
    IF job_checkpoint='CREATE_STARTED' THEN RETURN true; ELSIF job_checkpoint<>'FROZEN' THEN RAISE EXCEPTION 'SUBMISSION_ILLEGAL_TRANSITION'; END IF;
    UPDATE public.partner_jobs SET submission_state='CREATING_LEAD',submission_checkpoint='CREATE_STARTED',submission_started_at=COALESCE(submission_started_at,now()),updated_at=now() WHERE company_id=target_company AND id=target_job AND submission_checkpoint='FROZEN';
  ELSIF target_phase='LEAD_CREATED' AND target_legacy_id=btrim(target_legacy_id) AND target_legacy_id~'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$' AND target_legacy_number>0 THEN
    IF job_checkpoint='LEAD_CREATED' THEN IF stored_legacy_id=target_legacy_id AND stored_legacy_number=target_legacy_number THEN RETURN true; ELSE RAISE EXCEPTION 'SUBMISSION_LEGACY_ID_CONFLICT'; END IF; ELSIF job_checkpoint<>'CREATE_STARTED' THEN RAISE EXCEPTION 'SUBMISSION_ILLEGAL_TRANSITION'; END IF;
    UPDATE public.partner_jobs SET submission_state='UPDATING_QUOTE',submission_checkpoint='LEAD_CREATED',legacy_job_id=target_legacy_id,legacy_job_number=target_legacy_number,updated_at=now() WHERE company_id=target_company AND id=target_job AND submission_checkpoint='CREATE_STARTED';
    GET DIAGNOSTICS affected=ROW_COUNT;
  ELSIF target_phase='QUOTE_UPDATED' THEN
    IF job_checkpoint IN('QUOTE_UPDATED','PLANS_ATTACHED') THEN IF stored_quote_number=(SELECT legacy_job_prefix_snapshot||'-'||legacy_job_number::text FROM public.partner_jobs WHERE company_id=target_company AND id=target_job) THEN RETURN true; ELSE RAISE EXCEPTION 'SUBMISSION_QUOTE_ID_CONFLICT'; END IF; ELSIF job_checkpoint<>'LEAD_CREATED' THEN RAISE EXCEPTION 'SUBMISSION_ILLEGAL_TRANSITION'; END IF;
    SELECT legacy_job_prefix_snapshot||'-'||legacy_job_number::text INTO calculated_quote_number FROM public.partner_jobs WHERE company_id=target_company AND id=target_job AND submission_checkpoint='LEAD_CREATED' AND legacy_job_number IS NOT NULL;
    UPDATE public.partner_jobs SET submission_state='ATTACHING_PLANS',submission_checkpoint='QUOTE_UPDATED',final_quote_number=calculated_quote_number,updated_at=now() WHERE company_id=target_company AND id=target_job AND submission_checkpoint='LEAD_CREATED' AND calculated_quote_number IS NOT NULL;
  ELSIF target_phase IN('PLAN_UPLOAD_STARTED','PLAN_UPLOADED','PLAN_ATTACHED') AND target_ordinal BETWEEN 0 AND 19 THEN
    IF job_checkpoint NOT IN('QUOTE_UPDATED','PLANS_ATTACHED') THEN RAISE EXCEPTION 'SUBMISSION_ILLEGAL_TRANSITION'; END IF;
    SELECT state,remote_storage_key,drawing_id INTO existing_state,existing_key,drawing_for_delivery FROM public.partner_submission_plan_deliveries WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND ordinal=target_ordinal FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'SUBMISSION_PLAN_CHECKPOINT_NOT_FOUND'; END IF;
    IF target_phase='PLAN_UPLOAD_STARTED' THEN
      IF existing_state='UPLOADING' THEN RETURN true; END IF;
      UPDATE public.partner_submission_plan_deliveries SET state='UPLOADING',safe_error_code=NULL,attempt_count=attempt_count+1,updated_at=now() WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND ordinal=target_ordinal AND state IN('PENDING','FAILED');
    ELSIF target_phase='PLAN_UPLOADED' THEN
      IF target_remote_key IS NULL OR target_remote_key LIKE '%..%' OR target_remote_key!~'^[A-Za-z0-9][A-Za-z0-9._/-]{0,249}[A-Za-z0-9._/-]{0,250}$' THEN RAISE EXCEPTION 'SUBMISSION_REMOTE_KEY_INVALID'; END IF;
      IF existing_state IN('UPLOADED','ATTACHED') THEN IF existing_key=target_remote_key THEN RETURN true; ELSE RAISE EXCEPTION 'SUBMISSION_REMOTE_KEY_CONFLICT'; END IF; END IF;
      UPDATE public.partner_submission_plan_deliveries SET state='UPLOADED',remote_storage_key=target_remote_key,safe_error_code=NULL,updated_at=now() WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND ordinal=target_ordinal AND state='UPLOADING';
    ELSE
      IF target_remote_key IS NULL OR existing_key IS DISTINCT FROM target_remote_key THEN RAISE EXCEPTION 'SUBMISSION_REMOTE_KEY_CONFLICT'; END IF;
      IF existing_state='ATTACHED' THEN RETURN true; END IF;
      UPDATE public.partner_submission_plan_deliveries SET state='ATTACHED',safe_error_code=NULL,delivered_at=now(),updated_at=now() WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND ordinal=target_ordinal AND state='UPLOADED' AND remote_storage_key=target_remote_key;
      GET DIAGNOSTICS affected=ROW_COUNT;
      IF affected=1 THEN UPDATE public.partner_site_plan_drawings SET submitted_pdf_storage_key=target_remote_key WHERE company_id=target_company AND job_id=target_job AND id=drawing_for_delivery; END IF;
    END IF;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>1 THEN RAISE EXCEPTION 'SUBMISSION_ILLEGAL_PLAN_TRANSITION'; END IF;
    SELECT count(*),count(*) FILTER(WHERE state='ATTACHED') INTO total_count,attached_count FROM public.partner_submission_plan_deliveries WHERE company_id=target_company AND job_id=target_job AND request_id=target_request;
    IF total_count>0 AND attached_count=total_count THEN UPDATE public.partner_jobs SET submission_checkpoint='PLANS_ATTACHED',updated_at=now() WHERE company_id=target_company AND id=target_job AND submission_checkpoint IN ('QUOTE_UPDATED','PLANS_ATTACHED'); END IF;
  ELSE RAISE EXCEPTION 'SUBMISSION_ILLEGAL_CHECKPOINT'; END IF;
  IF target_phase NOT LIKE 'PLAN_%' THEN GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'SUBMISSION_ILLEGAL_TRANSITION'; END IF; END IF;
  UPDATE public.partner_submission_attempts SET phase=CASE WHEN target_phase IN ('CREATE_STARTED','LEAD_CREATED') THEN 'CREATING_LEAD' WHEN target_phase='QUOTE_UPDATED' THEN 'UPDATING_QUOTE' ELSE 'ATTACHING_PLANS' END,heartbeat_at=now(),lease_expires_at=now()+interval '120 seconds'
    WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND lease_token=target_lease AND fence_token=target_fence AND outcome='IN_PROGRESS';
  UPDATE public.partner_outbox_events SET lease_expires_at=now()+interval '120 seconds',updated_at=now() WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND lease_token=target_lease AND fence_token=target_fence AND state='PROCESSING';
  INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata) VALUES('SUBMISSION_PHASE_CHECKPOINTED',target_company,target_job,target_request,jsonb_build_object('phase',target_phase));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.partner_release_submission(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint,target_error_code text,retry_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  IF public.partner_submission_safe_error_code(target_error_code) IS NOT TRUE OR retry_at<now() OR retry_at>now()+interval '7 days' OR retry_at IN ('infinity'::timestamptz,'-infinity'::timestamptz) OR NOT public.partner_submission_lock_lease(target_company,target_job,target_request,target_lease,target_fence) THEN RETURN false; END IF;
  PERFORM 1 FROM public.partner_companies WHERE id=target_company FOR UPDATE; PERFORM 1 FROM public.partner_jobs WHERE company_id=target_company AND id=target_job FOR UPDATE;
  UPDATE public.partner_outbox_events SET state='FAILED',available_at=retry_at,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,last_error_code=target_error_code,updated_at=now() WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND state='PROCESSING' AND lease_token=target_lease AND fence_token=target_fence;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.partner_submission_attempts SET outcome='FAILED_RETRYABLE',error_code=target_error_code,finished_at=now() WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND lease_token=target_lease AND fence_token=target_fence AND outcome='IN_PROGRESS';
  UPDATE public.partner_submission_requests SET state='FAILED_RETRYABLE',safe_error_code=target_error_code,updated_at=now() WHERE company_id=target_company AND job_id=target_job AND id=target_request;
  UPDATE public.partner_jobs SET submission_state=CASE WHEN submission_started_at IS NULL THEN 'QUEUED' ELSE 'FAILED_RETRYABLE' END,updated_at=now() WHERE company_id=target_company AND id=target_job;
  INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata) VALUES('SUBMISSION_FAILED_RETRYABLE',target_company,target_job,target_request,jsonb_build_object('errorCode',target_error_code)); RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.partner_finalize_submission(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  IF NOT public.partner_submission_lock_lease(target_company,target_job,target_request,target_lease,target_fence) THEN RETURN false; END IF;
  PERFORM 1 FROM public.partner_companies WHERE id=target_company FOR UPDATE; PERFORM 1 FROM public.partner_jobs WHERE company_id=target_company AND id=target_job FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.partner_jobs WHERE company_id=target_company AND id=target_job AND submission_checkpoint='PLANS_ATTACHED' AND legacy_job_id IS NOT NULL AND legacy_job_number IS NOT NULL AND final_quote_number IS NOT NULL) OR EXISTS(SELECT 1 FROM public.partner_submission_plan_deliveries WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND state<>'ATTACHED') THEN RAISE EXCEPTION 'SUBMISSION_NOT_FINALIZABLE'; END IF;
  UPDATE public.partner_outbox_events SET state='DELIVERED',delivered_at=now(),lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=now() WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND state='PROCESSING' AND lease_token=target_lease AND fence_token=target_fence;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.partner_jobs SET submission_state='SUBMITTED',submission_checkpoint='FINALIZED',submitted_at=now(),updated_at=now() WHERE company_id=target_company AND id=target_job;
  UPDATE public.partner_submission_attempts SET outcome='SUCCEEDED',finished_at=now() WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND lease_token=target_lease AND fence_token=target_fence AND outcome='IN_PROGRESS';
  UPDATE public.partner_submission_requests SET state='SUCCEEDED',safe_error_code=NULL,completed_at=now(),updated_at=now() WHERE company_id=target_company AND job_id=target_job AND id=target_request;
  INSERT INTO public.partner_outbox_events(company_id,job_id,request_id,topic,idempotency_key,payload) VALUES(target_company,target_job,target_request,'PARTNER_SUBMISSION_COMPLETED','submission-completed:'||target_company::text||':'||target_job::text||':'||target_request::text,jsonb_build_object('schemaVersion',1,'requestId',target_request::text,'jobId',target_job::text));
  INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata) VALUES('SUBMISSION_FINALIZED',target_company,target_job,target_request,jsonb_build_object('phase','FINALIZED')); RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.partner_reconcile_submission(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint,target_error_code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  IF public.partner_submission_safe_error_code(target_error_code) IS NOT TRUE OR NOT public.partner_submission_lock_lease(target_company,target_job,target_request,target_lease,target_fence) THEN RETURN false; END IF;
  PERFORM 1 FROM public.partner_companies WHERE id=target_company FOR UPDATE; PERFORM 1 FROM public.partner_jobs WHERE company_id=target_company AND id=target_job FOR UPDATE;
  UPDATE public.partner_outbox_events SET state='DEAD',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,last_error_code=target_error_code,updated_at=now() WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND state='PROCESSING' AND lease_token=target_lease AND fence_token=target_fence;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.partner_jobs SET submission_state='RECONCILIATION_REQUIRED',submission_checkpoint='RECONCILIATION',submission_started_at=COALESCE(submission_started_at,now()),updated_at=now() WHERE company_id=target_company AND id=target_job;
  UPDATE public.partner_submission_attempts SET outcome='RECONCILIATION_REQUIRED',error_code=target_error_code,reconciliation_note='manual-review-required',finished_at=now() WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND lease_token=target_lease AND fence_token=target_fence AND outcome='IN_PROGRESS';
  UPDATE public.partner_submission_requests SET state='RECONCILIATION_REQUIRED',safe_error_code=target_error_code,updated_at=now() WHERE company_id=target_company AND job_id=target_job AND id=target_request;
  UPDATE public.partner_submission_plan_deliveries SET state='RECONCILIATION_REQUIRED',safe_error_code=target_error_code,updated_at=now() WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND state<>'ATTACHED';
  INSERT INTO public.partner_outbox_events(company_id,job_id,request_id,topic,idempotency_key,payload) VALUES(target_company,target_job,target_request,'PARTNER_SUBMISSION_RECONCILIATION_ALERT','submission-reconcile:'||target_company::text||':'||target_job::text||':'||target_request::text,jsonb_build_object('schemaVersion',1,'requestId',target_request::text,'jobId',target_job::text));
  INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata) VALUES('SUBMISSION_RECONCILIATION_REQUIRED',target_company,target_job,target_request,jsonb_build_object('errorCode',target_error_code)); RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.partner_submission_status(target_company uuid,target_job uuid)
RETURNS TABLE(state text,checkpoint text,safe_error_code text,created_at timestamptz,updated_at timestamptz,completed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT r.state,j.submission_checkpoint,r.safe_error_code,r.created_at,r.updated_at,r.completed_at FROM public.partner_submission_requests r JOIN public.partner_jobs j ON (j.company_id,j.id)=(r.company_id,r.job_id) WHERE r.company_id=target_company AND r.job_id=target_job
$$;

CREATE OR REPLACE FUNCTION public.partner_consume_submission_rate_limit(target_company uuid,target_scope_kind text,target_scope_hash text,target_window_seconds integer,target_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE used integer;
BEGIN
  IF target_scope_kind NOT IN('USER','COMPANY','IP_HASH') OR target_scope_hash!~'^[0-9a-f]{64}$'
    OR target_window_seconds NOT BETWEEN 60 AND 86400 OR target_limit NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'SUBMISSION_INVALID_RATE_LIMIT';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.partner_companies WHERE id=target_company) THEN RETURN false; END IF;
  INSERT INTO public.partner_submission_rate_limits(company_id,scope_kind,scope_hash,window_seconds,window_started_at,attempt_count,updated_at)
  VALUES(target_company,target_scope_kind,target_scope_hash,target_window_seconds,now(),1,now())
  ON CONFLICT(company_id,scope_kind,scope_hash,window_seconds) DO UPDATE SET
    attempt_count=CASE WHEN partner_submission_rate_limits.window_started_at<=now()-make_interval(secs=>target_window_seconds) THEN 1 ELSE partner_submission_rate_limits.attempt_count+1 END,
    window_started_at=CASE WHEN partner_submission_rate_limits.window_started_at<=now()-make_interval(secs=>target_window_seconds) THEN now() ELSE partner_submission_rate_limits.window_started_at END,
    updated_at=now()
  RETURNING attempt_count INTO used;
  RETURN used<=target_limit;
END $$;

CREATE OR REPLACE FUNCTION public.partner_submission_claimed_snapshot(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint)
RETURNS TABLE(canonical_document text,snapshot_sha256 text,adapter_mode text,contract_version text,legacy_job_prefix text,checkpoint text,legacy_job_id text,legacy_job_number bigint,final_quote_number text,legacy_base_url text,legacy_credential_ciphertext bytea,legacy_credential_nonce bytea,legacy_credential_key_version integer,legacy_credential_fingerprint text,legacy_credential_updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT public.partner_submission_lock_lease(target_company,target_job,target_request,target_lease,target_fence) THEN RETURN; END IF;
  RETURN QUERY SELECT s.canonical_document,s.snapshot_sha256::text,s.adapter_mode::text,s.contract_version::text,s.legacy_job_prefix::text,j.submission_checkpoint::text,j.legacy_job_id::text,j.legacy_job_number,j.final_quote_number::text,
    CASE WHEN s.adapter_mode='LIVE' THEN c.legacy_base_url ELSE NULL END,
    CASE WHEN s.adapter_mode='LIVE' THEN c.legacy_credential_ciphertext ELSE NULL END,
    CASE WHEN s.adapter_mode='LIVE' THEN c.legacy_credential_nonce ELSE NULL END,
    CASE WHEN s.adapter_mode='LIVE' THEN c.legacy_credential_key_version ELSE NULL END,
    CASE WHEN s.adapter_mode='LIVE' THEN s.legacy_credential_fingerprint::text ELSE NULL END,
    CASE WHEN s.adapter_mode='LIVE' THEN s.legacy_credential_updated_at_snapshot ELSE NULL END
  FROM public.partner_submission_requests r JOIN public.partner_submission_snapshots s ON(s.company_id,s.job_id,s.id)=(r.company_id,r.job_id,r.snapshot_id)
  JOIN public.partner_companies c ON c.id=r.company_id JOIN public.partner_jobs j ON(j.company_id,j.id)=(r.company_id,r.job_id)
  WHERE r.company_id=target_company AND r.job_id=target_job AND r.id=target_request
    AND c.submission_adapter_mode=s.adapter_mode AND c.submission_contract_version=s.contract_version AND c.legacy_job_prefix=s.legacy_job_prefix
    AND (s.adapter_mode='FICTIONAL' OR (c.legacy_base_url IS NOT DISTINCT FROM s.legacy_base_url_snapshot AND c.legacy_credential_key_version IS NOT DISTINCT FROM s.legacy_credential_key_version_snapshot AND c.legacy_credential_updated_at IS NOT DISTINCT FROM s.legacy_credential_updated_at_snapshot AND encode(public.digest(c.legacy_credential_ciphertext||c.legacy_credential_nonce,'sha256'),'hex') IS NOT DISTINCT FROM s.legacy_credential_fingerprint));
END $$;

CREATE OR REPLACE FUNCTION public.partner_submission_claimed_plans(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint)
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

CREATE OR REPLACE FUNCTION public.partner_prune_site_plan_pdf_artifacts(target_company uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE deleted_count integer:=0;quota_bytes bigint;
BEGIN
  PERFORM 1 FROM public.partner_companies WHERE id=target_company FOR UPDATE; IF NOT FOUND THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_company::text,914));
  PERFORM id FROM public.partner_jobs WHERE company_id=target_company ORDER BY id FOR UPDATE;
  PERFORM id FROM public.partner_site_plan_drawings WHERE company_id=target_company ORDER BY job_id,id FOR UPDATE;
  PERFORM id FROM public.partner_site_plan_pdf_artifacts WHERE company_id=target_company ORDER BY job_id,drawing_id,id FOR UPDATE;
  WITH ranked AS(SELECT a.company_id,a.job_id,a.drawing_id,a.id,row_number() OVER(PARTITION BY a.company_id,a.drawing_id ORDER BY a.generated_at DESC,a.id DESC) history_rank FROM public.partner_site_plan_pdf_artifacts a JOIN public.partner_site_plan_drawings d ON(d.company_id,d.job_id,d.id)=(a.company_id,a.job_id,a.drawing_id) WHERE a.company_id=target_company AND a.id IS DISTINCT FROM d.current_pdf_artifact_id AND NOT EXISTS(SELECT 1 FROM public.partner_submission_plan_manifest m WHERE (m.company_id,m.job_id,m.drawing_id,m.artifact_id)=(a.company_id,a.job_id,a.drawing_id,a.id))),removed AS(DELETE FROM public.partner_site_plan_pdf_artifacts a USING ranked r WHERE(a.company_id,a.job_id,a.drawing_id,a.id)=(r.company_id,r.job_id,r.drawing_id,r.id) AND r.history_rank>2 RETURNING 1) SELECT count(*) INTO deleted_count FROM removed;
  SELECT COALESCE(sum(byte_size),0) INTO quota_bytes FROM public.partner_site_plan_pdf_artifacts WHERE company_id=target_company;
  IF quota_bytes>1073741824 THEN WITH candidates AS(SELECT a.company_id,a.job_id,a.drawing_id,a.id,a.byte_size,sum(a.byte_size) OVER(ORDER BY a.generated_at,a.id) running_bytes FROM public.partner_site_plan_pdf_artifacts a JOIN public.partner_site_plan_drawings d ON(d.company_id,d.job_id,d.id)=(a.company_id,a.job_id,a.drawing_id) WHERE a.company_id=target_company AND a.id IS DISTINCT FROM d.current_pdf_artifact_id AND NOT EXISTS(SELECT 1 FROM public.partner_submission_plan_manifest m WHERE(m.company_id,m.job_id,m.drawing_id,m.artifact_id)=(a.company_id,a.job_id,a.drawing_id,a.id))),removed AS(DELETE FROM public.partner_site_plan_pdf_artifacts a USING candidates c WHERE(a.company_id,a.job_id,a.drawing_id,a.id)=(c.company_id,c.job_id,c.drawing_id,c.id) AND c.running_bytes-c.byte_size<quota_bytes-1073741824 RETURNING 1) SELECT deleted_count+count(*) INTO deleted_count FROM removed; END IF;
  IF(SELECT COALESCE(sum(byte_size),0) FROM public.partner_site_plan_pdf_artifacts WHERE company_id=target_company)>1073741824 THEN RAISE EXCEPTION 'site plan PDF company quota exceeded'; END IF; RETURN deleted_count;
END $$;

ALTER FUNCTION public.partner_freeze_submission(uuid,uuid,text,integer,integer,uuid,uuid,text,text,jsonb) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_claim_submission(text,integer) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_submission_lock_lease(uuid,uuid,uuid,uuid,bigint) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_heartbeat_submission(uuid,uuid,uuid,uuid,bigint,integer) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_checkpoint_submission(uuid,uuid,uuid,uuid,bigint,text,text,bigint,integer,text) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_release_submission(uuid,uuid,uuid,uuid,bigint,text,timestamptz) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_finalize_submission(uuid,uuid,uuid,uuid,bigint) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_reconcile_submission(uuid,uuid,uuid,uuid,bigint,text) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_submission_status(uuid,uuid) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_consume_submission_rate_limit(uuid,text,text,integer,integer) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_submission_claimed_snapshot(uuid,uuid,uuid,uuid,bigint) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_submission_claimed_plans(uuid,uuid,uuid,uuid,bigint) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_prune_site_plan_pdf_artifacts(uuid) OWNER TO partner_artifact_owner;
ALTER FUNCTION public.partner_submission_outbox_payload_valid(text,uuid,uuid,uuid,jsonb) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_submission_safe_error_code(text) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_submission_guard_job_change() OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_submission_guard_drawing_change() OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_submission_guard_audit_insert() OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_submission_job_ready(public.partner_jobs) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_submission_jsonb_nfc(jsonb) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_submission_snapshot_shape_valid(jsonb) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_submission_render_text(text) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_submission_request_id(uuid,uuid,text) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_submission_remote_file_name(text,uuid,integer,uuid,text) OWNER TO partner_submission_owner;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM partner_submission_worker;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM partner_submission_worker;
REVOKE ALL ON public.partner_submission_snapshots,public.partner_submission_plan_manifest,public.partner_submission_requests,public.partner_submission_plan_deliveries,public.partner_submission_rate_limits,public.partner_submission_attempts,public.partner_outbox_events FROM PUBLIC,partner_portal_runtime,partner_submission_worker;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM partner_submission_worker;
REVOKE ALL ON FUNCTION public.partner_freeze_submission(uuid,uuid,text,integer,integer,uuid,uuid,text,text,jsonb),public.partner_claim_submission(text,integer),public.partner_submission_lock_lease(uuid,uuid,uuid,uuid,bigint),public.partner_heartbeat_submission(uuid,uuid,uuid,uuid,bigint,integer),public.partner_checkpoint_submission(uuid,uuid,uuid,uuid,bigint,text,text,bigint,integer,text),public.partner_release_submission(uuid,uuid,uuid,uuid,bigint,text,timestamptz),public.partner_finalize_submission(uuid,uuid,uuid,uuid,bigint),public.partner_reconcile_submission(uuid,uuid,uuid,uuid,bigint,text),public.partner_submission_status(uuid,uuid),public.partner_consume_submission_rate_limit(uuid,text,text,integer,integer),public.partner_submission_claimed_snapshot(uuid,uuid,uuid,uuid,bigint),public.partner_submission_claimed_plans(uuid,uuid,uuid,uuid,bigint) FROM PUBLIC,partner_portal_runtime,partner_submission_worker;
REVOKE ALL ON FUNCTION public.partner_submission_outbox_payload_valid(text,uuid,uuid,uuid,jsonb),public.partner_submission_safe_error_code(text),public.partner_submission_guard_job_change(),public.partner_submission_guard_drawing_change(),public.partner_submission_guard_audit_insert(),public.partner_submission_job_ready(public.partner_jobs),public.partner_submission_jsonb_nfc(jsonb),public.partner_submission_snapshot_shape_valid(jsonb),public.partner_submission_render_text(text),public.partner_submission_request_id(uuid,uuid,text),public.partner_submission_remote_file_name(text,uuid,integer,uuid,text) FROM PUBLIC,partner_portal_runtime,partner_submission_worker;
GRANT USAGE ON SCHEMA public TO partner_submission_owner,partner_submission_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.partner_submission_snapshots,public.partner_submission_plan_manifest,public.partner_submission_requests,public.partner_submission_plan_deliveries,public.partner_submission_rate_limits,public.partner_submission_attempts,public.partner_outbox_events,public.partner_audit_events TO partner_submission_owner;
GRANT SELECT,UPDATE ON public.partner_companies,public.partner_jobs,public.partner_site_plan_drawings TO partner_submission_owner;
GRANT SELECT ON public.partner_users,public.partner_site_plan_pdf_artifacts TO partner_submission_owner;
GRANT UPDATE(id) ON public.partner_site_plan_pdf_artifacts TO partner_submission_owner;
GRANT SELECT ON public.partner_submission_plan_manifest TO partner_artifact_owner;
GRANT EXECUTE ON FUNCTION public.digest(bytea,text) TO partner_submission_owner;
GRANT EXECUTE ON FUNCTION public.partner_freeze_submission(uuid,uuid,text,integer,integer,uuid,uuid,text,text,jsonb),public.partner_submission_status(uuid,uuid),public.partner_consume_submission_rate_limit(uuid,text,text,integer,integer) TO partner_portal_runtime;
GRANT EXECUTE ON FUNCTION public.partner_claim_submission(text,integer),public.partner_heartbeat_submission(uuid,uuid,uuid,uuid,bigint,integer),public.partner_checkpoint_submission(uuid,uuid,uuid,uuid,bigint,text,text,bigint,integer,text),public.partner_release_submission(uuid,uuid,uuid,uuid,bigint,text,timestamptz),public.partner_finalize_submission(uuid,uuid,uuid,uuid,bigint),public.partner_reconcile_submission(uuid,uuid,uuid,uuid,bigint,text),public.partner_submission_status(uuid,uuid),public.partner_submission_claimed_snapshot(uuid,uuid,uuid,uuid,bigint),public.partner_submission_claimed_plans(uuid,uuid,uuid,uuid,bigint) TO partner_submission_worker;

REVOKE ALL ON public.partner_jobs FROM partner_portal_runtime;
GRANT SELECT ON public.partner_jobs TO partner_portal_runtime;
GRANT INSERT(company_id,created_by_user_id,client_reference,billing_model_snapshot,customer_name,customer_mobile,customer_email,site_address,lead_sources,notes,quote_data,quote_initialized_at,quote_defaults_revision,quote_defaults_snapshot,quote_total_cents) ON public.partner_jobs TO partner_portal_runtime;
GRANT UPDATE(client_reference,customer_name,customer_mobile,customer_email,site_address,lead_sources,notes,quote_data,quote_initialized_at,quote_defaults_revision,quote_defaults_snapshot,quote_total_cents,revision,floor_plan_revision,updated_at) ON public.partner_jobs TO partner_portal_runtime;

DO $$ BEGIN
  IF session_user <> 'partner_submission_owner' AND pg_has_role(session_user,'partner_submission_owner','MEMBER') THEN EXECUTE format('REVOKE partner_submission_owner FROM %I',session_user); END IF;
  IF session_user <> 'partner_artifact_owner' AND pg_has_role(session_user,'partner_artifact_owner','MEMBER') THEN EXECUTE format('REVOKE partner_artifact_owner FROM %I',session_user); END IF;
END $$;

REVOKE CREATE ON SCHEMA public FROM partner_submission_owner,partner_artifact_owner;
COMMIT;
