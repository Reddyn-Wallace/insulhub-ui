BEGIN;

CREATE TABLE partner_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  billing_model text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 0,
  legacy_base_url text,
  legacy_credential_ciphertext bytea,
  legacy_credential_nonce bytea,
  legacy_credential_key_version integer,
  legacy_credential_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_companies_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT partner_companies_billing_model CHECK (billing_model IN ('INSULHUB_BILLED', 'PARTNER_BILLED')),
  CONSTRAINT partner_companies_revision_nonnegative CHECK (revision >= 0),
  CONSTRAINT partner_companies_credential_complete CHECK (
    (legacy_base_url IS NULL AND legacy_credential_ciphertext IS NULL AND legacy_credential_nonce IS NULL AND legacy_credential_key_version IS NULL AND legacy_credential_updated_at IS NULL)
    OR
    (legacy_base_url IS NOT NULL AND legacy_credential_ciphertext IS NOT NULL AND legacy_credential_nonce IS NOT NULL AND legacy_credential_key_version > 0 AND legacy_credential_updated_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX partner_companies_slug_unique ON partner_companies (lower(slug));

CREATE TABLE partner_users (
  id text PRIMARY KEY,
  company_id uuid REFERENCES partner_companies(id) ON DELETE RESTRICT,
  principal_type text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT true,
  image text,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_users_principal_type CHECK (principal_type IN ('PARTNER', 'INTERNAL')),
  CONSTRAINT partner_users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT partner_users_membership CHECK (
    (principal_type = 'PARTNER' AND company_id IS NOT NULL)
    OR (principal_type = 'INTERNAL' AND company_id IS NULL)
  )
);
CREATE UNIQUE INDEX partner_users_email_unique ON partner_users (lower(email));
CREATE UNIQUE INDEX partner_users_company_id_id_unique ON partner_users (company_id, id);
CREATE INDEX partner_users_company_active_idx ON partner_users (company_id, disabled_at) WHERE principal_type = 'PARTNER';

CREATE TABLE partner_sessions (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES partner_users(id) ON DELETE CASCADE
);
CREATE INDEX partner_sessions_user_id_idx ON partner_sessions (user_id);
CREATE INDEX partner_sessions_expiry_idx ON partner_sessions (expires_at);

CREATE TABLE partner_accounts (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES partner_users(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_accounts_provider_account_unique UNIQUE (provider_id, account_id)
);
CREATE INDEX partner_accounts_user_id_idx ON partner_accounts (user_id);

CREATE TABLE partner_verifications (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partner_verifications_identifier_idx ON partner_verifications (identifier);

CREATE TABLE partner_auth_rate_limits (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  count integer NOT NULL,
  last_request bigint NOT NULL,
  CONSTRAINT partner_auth_rate_limits_count_nonnegative CHECK (count >= 0)
);

CREATE TABLE partner_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES partner_companies(id) ON DELETE RESTRICT,
  created_by_user_id text NOT NULL,
  client_reference varchar(120) NOT NULL,
  legacy_job_id varchar(120),
  submission_state text NOT NULL DEFAULT 'DRAFT',
  billing_model_snapshot text NOT NULL,
  customer_name varchar(200) NOT NULL DEFAULT '',
  site_address jsonb NOT NULL DEFAULT '{}'::jsonb,
  quote_total_cents bigint,
  revision integer NOT NULL DEFAULT 0,
  submission_started_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_jobs_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT partner_jobs_company_id_id_billing_unique UNIQUE (company_id, id, billing_model_snapshot),
  CONSTRAINT partner_jobs_company_reference_unique UNIQUE (company_id, client_reference),
  CONSTRAINT partner_jobs_creator_membership_fk FOREIGN KEY (company_id, created_by_user_id) REFERENCES partner_users(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT partner_jobs_submission_state CHECK (submission_state IN ('DRAFT', 'QUEUED', 'CREATING_LEAD', 'UPDATING_QUOTE', 'ATTACHING_PLANS', 'SUBMITTED', 'FAILED_RETRYABLE', 'RECONCILIATION_REQUIRED')),
  CONSTRAINT partner_jobs_billing_model CHECK (billing_model_snapshot IN ('INSULHUB_BILLED', 'PARTNER_BILLED')),
  CONSTRAINT partner_jobs_quote_nonnegative CHECK (quote_total_cents IS NULL OR quote_total_cents >= 0),
  CONSTRAINT partner_jobs_revision_nonnegative CHECK (revision >= 0),
  CONSTRAINT partner_jobs_submission_timestamp CHECK (
    (submission_state = 'DRAFT' AND submission_started_at IS NULL AND submitted_at IS NULL)
    OR (submission_state = 'QUEUED' AND submitted_at IS NULL)
    OR (submission_state IN ('CREATING_LEAD', 'UPDATING_QUOTE', 'ATTACHING_PLANS', 'FAILED_RETRYABLE', 'RECONCILIATION_REQUIRED') AND submission_started_at IS NOT NULL AND submitted_at IS NULL)
    OR (submission_state = 'SUBMITTED' AND submission_started_at IS NOT NULL AND submitted_at IS NOT NULL AND submitted_at >= submission_started_at)
  )
);
CREATE UNIQUE INDEX partner_jobs_company_legacy_job_unique ON partner_jobs (company_id, legacy_job_id) WHERE legacy_job_id IS NOT NULL;
CREATE INDEX partner_jobs_company_submission_state_updated_idx ON partner_jobs (company_id, submission_state, updated_at DESC);

CREATE TABLE partner_site_plan_drawings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid NOT NULL,
  name varchar(120) NOT NULL DEFAULT 'Site plan',
  floor_index integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  drawing_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_snapshot_data jsonb,
  submitted_snapshot_at timestamptz,
  submitted_pdf_storage_key varchar(500),
  submitted_pdf_outbox_event_id uuid,
  revision integer NOT NULL DEFAULT 0,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_site_plan_job_fk FOREIGN KEY (company_id, job_id) REFERENCES partner_jobs(company_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_site_plan_creator_membership_fk FOREIGN KEY (company_id, created_by_user_id) REFERENCES partner_users(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT partner_site_plan_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT partner_site_plan_revision_nonnegative CHECK (revision >= 0),
  CONSTRAINT partner_site_plan_name_trimmed_nonblank CHECK (name::text = btrim(name::text) AND btrim(name::text) <> ''),
  CONSTRAINT partner_site_plan_floor_nonnegative CHECK (floor_index >= 0),
  CONSTRAINT partner_site_plan_sort_nonnegative CHECK (sort_order >= 0),
  CONSTRAINT partner_site_plan_snapshot_complete CHECK ((submitted_snapshot_data IS NULL) = (submitted_snapshot_at IS NULL)),
  CONSTRAINT partner_site_plan_drawing_object CHECK (jsonb_typeof(drawing_data) = 'object'),
  CONSTRAINT partner_site_plan_snapshot_object CHECK (submitted_snapshot_data IS NULL OR jsonb_typeof(submitted_snapshot_data) = 'object')
);
CREATE INDEX partner_site_plan_job_idx ON partner_site_plan_drawings (company_id, job_id, floor_index, sort_order, updated_at DESC);

CREATE TABLE partner_submission_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  phase text NOT NULL,
  outcome text NOT NULL DEFAULT 'IN_PROGRESS',
  legacy_job_id varchar(120),
  response_code varchar(100),
  error_code varchar(100),
  reconciliation_note varchar(1000),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_submission_job_fk FOREIGN KEY (company_id, job_id) REFERENCES partner_jobs(company_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_submission_attempt_unique UNIQUE (company_id, job_id, attempt_number),
  CONSTRAINT partner_submission_idempotency_unique UNIQUE (company_id, idempotency_key),
  CONSTRAINT partner_submission_attempt_positive CHECK (attempt_number > 0),
  CONSTRAINT partner_submission_phase CHECK (phase IN ('CREATING_LEAD', 'UPDATING_QUOTE', 'ATTACHING_PLANS', 'RECONCILING')),
  CONSTRAINT partner_submission_outcome CHECK (outcome IN ('IN_PROGRESS', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'AMBIGUOUS', 'RECONCILIATION_REQUIRED')),
  CONSTRAINT partner_submission_finished_at CHECK ((outcome = 'IN_PROGRESS' AND finished_at IS NULL) OR (outcome <> 'IN_PROGRESS' AND finished_at IS NOT NULL)),
  CONSTRAINT partner_submission_ambiguous_note CHECK (outcome NOT IN ('AMBIGUOUS', 'RECONCILIATION_REQUIRED') OR reconciliation_note IS NOT NULL)
);
CREATE INDEX partner_submission_processing_idx ON partner_submission_attempts (outcome, created_at) WHERE outcome IN ('IN_PROGRESS', 'FAILED_RETRYABLE', 'AMBIGUOUS', 'RECONCILIATION_REQUIRED');

CREATE TABLE partner_tracking_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid NOT NULL,
  fact_type text NOT NULL,
  value_type text NOT NULL,
  value jsonb,
  source text NOT NULL,
  legacy_claim_verified boolean NOT NULL DEFAULT false,
  note varchar(1000) NOT NULL DEFAULT '',
  effective_at timestamptz,
  install_date date,
  recorded_by_user_id text REFERENCES partner_users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_tracking_job_fk FOREIGN KEY (company_id, job_id) REFERENCES partner_jobs(company_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_tracking_fact_type CHECK (fact_type IN ('EBA_COMPLETED', 'INSTALL_DATE_SET', 'JOB_COMPLETED', 'INVOICE_SENT', 'COMMISSION_PAID', 'REMITTANCE_RECEIVED', 'CANCELLED')),
  CONSTRAINT partner_tracking_value_type CHECK (value_type IN ('BOOLEAN', 'DATE')),
  CONSTRAINT partner_tracking_fact_shape CHECK (
    (
      fact_type = 'INSTALL_DATE_SET'
      AND value_type = 'DATE'
      AND install_date IS NOT NULL
      AND value IS NULL
      AND effective_at IS NULL
    )
    OR
    (
      fact_type IN ('EBA_COMPLETED', 'JOB_COMPLETED', 'INVOICE_SENT', 'COMMISSION_PAID', 'REMITTANCE_RECEIVED', 'CANCELLED')
      AND value_type = 'BOOLEAN'
      AND jsonb_typeof(value) = 'boolean'
      AND value = 'true'::jsonb
      AND install_date IS NULL
      AND effective_at IS NOT NULL
    )
  ),
  CONSTRAINT partner_tracking_source CHECK (source IN ('LOCAL_INTERNAL', 'LEGACY_SYNC'))
);
CREATE INDEX partner_tracking_job_recorded_idx ON partner_tracking_facts (company_id, job_id, recorded_at DESC);
CREATE INDEX partner_tracking_job_type_effective_idx ON partner_tracking_facts (company_id, job_id, fact_type, effective_at DESC);

CREATE TABLE partner_job_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid NOT NULL,
  billing_model_snapshot text NOT NULL,
  gross_cents bigint NOT NULL,
  manual_commission_cents bigint,
  retained_margin_cents bigint,
  net_due_cents bigint NOT NULL,
  settlement_status text NOT NULL DEFAULT 'PENDING',
  settled_at timestamptz,
  revision integer NOT NULL DEFAULT 0,
  created_by_user_id text NOT NULL REFERENCES partner_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_settlement_job_unique UNIQUE (company_id, job_id),
  CONSTRAINT partner_settlement_job_billing_fk FOREIGN KEY (company_id, job_id, billing_model_snapshot) REFERENCES partner_jobs(company_id, id, billing_model_snapshot) ON DELETE RESTRICT,
  CONSTRAINT partner_settlement_billing_model CHECK (billing_model_snapshot IN ('INSULHUB_BILLED', 'PARTNER_BILLED')),
  CONSTRAINT partner_settlement_money_nonnegative CHECK (gross_cents >= 0 AND net_due_cents >= 0 AND (manual_commission_cents IS NULL OR manual_commission_cents >= 0) AND (retained_margin_cents IS NULL OR retained_margin_cents >= 0)),
  CONSTRAINT partner_settlement_calculation CHECK (
    (billing_model_snapshot = 'INSULHUB_BILLED' AND manual_commission_cents IS NOT NULL AND manual_commission_cents <= gross_cents AND retained_margin_cents IS NULL AND net_due_cents = manual_commission_cents)
    OR
    (billing_model_snapshot = 'PARTNER_BILLED' AND manual_commission_cents IS NULL AND retained_margin_cents IS NOT NULL AND retained_margin_cents <= gross_cents AND net_due_cents = gross_cents - retained_margin_cents)
  ),
  CONSTRAINT partner_settlement_status CHECK (
    (billing_model_snapshot = 'INSULHUB_BILLED' AND settlement_status IN ('PENDING', 'PAID'))
    OR (billing_model_snapshot = 'PARTNER_BILLED' AND settlement_status IN ('PENDING', 'RECEIVED'))
  ),
  CONSTRAINT partner_settlement_date CHECK ((settlement_status = 'PENDING' AND settled_at IS NULL) OR (settlement_status IN ('PAID', 'RECEIVED') AND settled_at IS NOT NULL)),
  CONSTRAINT partner_settlement_revision_nonnegative CHECK (revision >= 0)
);
CREATE INDEX partner_settlement_status_idx ON partner_job_settlements (company_id, settlement_status, updated_at DESC);

CREATE TABLE partner_job_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid NOT NULL,
  sequence integer NOT NULL,
  reason varchar(1000) NOT NULL,
  patch jsonb NOT NULL,
  created_by_user_id text NOT NULL REFERENCES partner_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_amendment_job_fk FOREIGN KEY (company_id, job_id) REFERENCES partner_jobs(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT partner_amendment_sequence_unique UNIQUE (company_id, job_id, sequence),
  CONSTRAINT partner_amendment_sequence_positive CHECK (sequence > 0),
  CONSTRAINT partner_amendment_reason_nonblank CHECK (btrim(reason::text) <> ''),
  CONSTRAINT partner_amendment_patch_object CHECK (jsonb_typeof(patch) = 'object')
);
CREATE INDEX partner_amendments_job_idx ON partner_job_amendments (company_id, job_id, sequence);

CREATE OR REPLACE FUNCTION partner_reject_append_only_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only partner record cannot be changed';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER partner_job_amendments_append_only BEFORE UPDATE OR DELETE ON partner_job_amendments FOR EACH ROW EXECUTE FUNCTION partner_reject_append_only_change();
CREATE TRIGGER partner_tracking_facts_append_only BEFORE UPDATE OR DELETE ON partner_tracking_facts FOR EACH ROW EXECUTE FUNCTION partner_reject_append_only_change();

CREATE TABLE partner_outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES partner_companies(id) ON DELETE RESTRICT,
  job_id uuid,
  topic varchar(200) NOT NULL,
  idempotency_key varchar(200) NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error_code varchar(100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_outbox_job_fk FOREIGN KEY (company_id, job_id) REFERENCES partner_jobs(company_id, id) ON DELETE CASCADE,
  CONSTRAINT partner_outbox_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT partner_outbox_state CHECK (state IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD')),
  CONSTRAINT partner_outbox_attempt_nonnegative CHECK (attempt_count >= 0),
  CONSTRAINT partner_outbox_topic_nonblank CHECK (btrim(topic::text) <> ''),
  CONSTRAINT partner_outbox_idempotency_nonblank CHECK (btrim(idempotency_key::text) <> ''),
  CONSTRAINT partner_outbox_job_has_company CHECK (job_id IS NULL OR company_id IS NOT NULL),
  CONSTRAINT partner_outbox_payload_object CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX partner_outbox_available_idx ON partner_outbox_events (state, available_at) WHERE state IN ('PENDING', 'FAILED');
CREATE INDEX partner_outbox_company_job_idx ON partner_outbox_events (company_id, job_id, created_at DESC);

ALTER TABLE partner_site_plan_drawings
  ADD CONSTRAINT partner_site_plan_pdf_outbox_fk
  FOREIGN KEY (company_id, submitted_pdf_outbox_event_id) REFERENCES partner_outbox_events(company_id, id) ON DELETE RESTRICT;

CREATE TABLE partner_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  actor_user_id text REFERENCES partner_users(id) ON DELETE SET NULL,
  subject_user_id text REFERENCES partner_users(id) ON DELETE SET NULL,
  company_id uuid REFERENCES partner_companies(id) ON DELETE SET NULL,
  request_id varchar(200),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_audit_event_type CHECK (event_type IN ('LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'LOGOUT', 'USER_PROVISIONED', 'USER_DISABLED', 'SESSIONS_REVOKED', 'LEGACY_CREDENTIAL_REPLACED')),
  CONSTRAINT partner_audit_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT partner_audit_metadata_size CHECK (pg_column_size(metadata) <= 16384)
);
CREATE INDEX partner_audit_company_occurred_idx ON partner_audit_events (company_id, occurred_at DESC);
CREATE INDEX partner_audit_actor_occurred_idx ON partner_audit_events (actor_user_id, occurred_at DESC);
CREATE TRIGGER partner_audit_events_append_only BEFORE UPDATE OR DELETE ON partner_audit_events FOR EACH ROW EXECUTE FUNCTION partner_reject_append_only_change();

COMMIT;
