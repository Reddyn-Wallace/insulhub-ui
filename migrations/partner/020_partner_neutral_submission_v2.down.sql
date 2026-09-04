BEGIN;

-- Refuse rollback while v2 immutable submissions exist; they cannot be
-- rewritten as v1 without changing their hashes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.partner_submission_snapshots WHERE schema_version = 2) THEN
    RAISE EXCEPTION 'PARTNER_V2_SNAPSHOTS_EXIST';
  END IF;
  IF EXISTS (SELECT 1 FROM public.partner_job_amendments WHERE patch ? 'requestKey') THEN
    RAISE EXCEPTION 'PARTNER_IDEMPOTENT_AMENDMENTS_EXIST';
  END IF;
END $$;

DO $$ BEGIN EXECUTE format('GRANT partner_submission_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user); END $$;
GRANT CREATE ON SCHEMA public TO partner_submission_owner;
GRANT EXECUTE ON FUNCTION
  public.partner_ops_dashboard(text),
  public.partner_ops_fact_append(text,uuid,uuid,text,timestamptz),
  public.partner_ops_invoice_upsert(text,uuid,uuid,integer,text,bigint,timestamptz),
  public.partner_ops_settlement_upsert(text,uuid,uuid,integer,bigint,bigint,text,timestamptz)
TO partner_ops_runtime;

DO $$
DECLARE definition text; changed text;
BEGIN
  definition:=pg_get_functiondef('public.partner_claim_submission_bounded(text,integer)'::regprocedure);
  changed:=replace(definition,
    'AND s.schema_version IN (1, 2) AND public.partner_worker_snapshot_matches(s.canonical_document, s.snapshot_data)',
    'AND s.schema_version = 1 AND public.partner_worker_snapshot_matches(s.canonical_document, s.snapshot_data)');
  IF changed=definition THEN
    changed:=replace(definition,
      'AND s.schema_version IN(1,2) AND public.partner_worker_snapshot_matches(s.canonical_document,s.snapshot_data)',
      'AND s.schema_version=1 AND public.partner_worker_snapshot_matches(s.canonical_document,s.snapshot_data)');
  END IF;
  IF changed=definition THEN RAISE EXCEPTION 'PARTNER_V2_WORKER_ROLLBACK_FAILED'; END IF;
  EXECUTE changed;
END $$;
ALTER FUNCTION public.partner_claim_submission_bounded(text,integer) OWNER TO partner_submission_owner;

ALTER TABLE public.partner_job_amendments DROP CONSTRAINT partner_amendment_v1_patch;
ALTER TABLE public.partner_job_amendments ADD CONSTRAINT partner_amendment_v1_patch CHECK (
  jsonb_typeof(patch)='object' AND patch ? 'version' AND patch ? 'description'
  AND jsonb_typeof(patch->'version')='number' AND patch->>'version'='1'
  AND patch - ARRAY['version','description','contractDeltaCents']='{}'::jsonb
  AND jsonb_typeof(patch->'description')='string' AND patch->>'description'=btrim(patch->>'description') AND length(patch->>'description') BETWEEN 1 AND 1000
  AND (NOT patch ? 'contractDeltaCents' OR (jsonb_typeof(patch->'contractDeltaCents')='number' AND (patch->>'contractDeltaCents') ~ '^-?[0-9]{1,12}$' AND (patch->>'contractDeltaCents')::bigint BETWEEN -999999999999 AND 999999999999))
);

CREATE OR REPLACE FUNCTION public.partner_ops_amendment_append(actor text,target_company uuid,target_job uuid,target_patch jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE next_sequence integer; job_state text; BEGIN PERFORM public.partner_ops_authorize(actor,'OPERATIONS'); SELECT submission_state INTO job_state FROM public.partner_jobs WHERE company_id=target_company AND id=target_job FOR UPDATE; IF job_state IS NULL OR job_state NOT IN('SUBMITTED','RECONCILIATION_REQUIRED') THEN RAISE EXCEPTION 'OPS_JOB_NOT_ACTIONABLE'; END IF; SELECT COALESCE(max(sequence),0)+1 INTO next_sequence FROM public.partner_job_amendments WHERE company_id=target_company AND job_id=target_job; INSERT INTO public.partner_job_amendments(company_id,job_id,sequence,reason,patch,created_by_user_id) VALUES(target_company,target_job,next_sequence,target_patch->>'description',target_patch,actor); INSERT INTO public.partner_audit_events(event_type,actor_user_id,company_id,job_id,metadata) VALUES('OPS_AMENDMENT_RECORDED',actor,target_company,target_job,'{}'::jsonb); RETURN true; END $$;
ALTER FUNCTION public.partner_ops_amendment_append(text,uuid,uuid,jsonb) OWNER TO partner_ops_owner;

DO $$
DECLARE definition text; changed text;
BEGIN
  definition:=pg_get_functiondef('public.partner_freeze_submission(uuid,uuid,text,integer,integer,uuid,uuid,text,text,jsonb)'::regprocedure);
  changed:=replace(definition,
    'IF NOT (CASE WHEN snapshot_value->>''schemaVersion''=''1'' THEN public.partner_submission_snapshot_shape_valid(snapshot_value) WHEN snapshot_value->>''schemaVersion''=''2'' THEN public.partner_submission_snapshot_shape_valid_v2(snapshot_value) ELSE false END) THEN',
    'IF NOT public.partner_submission_snapshot_shape_valid(snapshot_value) THEN');
  changed:=replace(changed,
    ',"schemaVersion":''||(snapshot_value->>''schemaVersion'')||'',"snapshotSha256":"''||calculated_snapshot_sha',
    ',"schemaVersion":1,"snapshotSha256":"''||calculated_snapshot_sha');
  changed:=replace(changed,
    'OR ((snapshot_value->>''schemaVersion'')::integer=1 AND snapshot_value#>>''{job,billingModel}'' IS DISTINCT FROM job_row.billing_model_snapshot)',
    'OR snapshot_value#>>''{job,billingModel}'' IS DISTINCT FROM job_row.billing_model_snapshot');
  changed:=replace(changed,
    'INSERT INTO public.partner_submission_snapshots(company_id,job_id,id,schema_version,job_revision,',
    'INSERT INTO public.partner_submission_snapshots(company_id,job_id,id,job_revision,');
  changed:=replace(changed,
    'VALUES(target_company,target_job,target_snapshot_id,(snapshot_value->>''schemaVersion'')::integer,job_row.revision,',
    'VALUES(target_company,target_job,target_snapshot_id,job_row.revision,');
  IF changed=definition THEN RAISE EXCEPTION 'PARTNER_V2_FREEZE_ROLLBACK_FAILED'; END IF;
  EXECUTE changed;
END $$;

DROP FUNCTION public.partner_submission_snapshot_shape_valid_v2(jsonb);
REVOKE CREATE ON SCHEMA public FROM partner_submission_owner;
DO $$ BEGIN EXECUTE format('REVOKE partner_submission_owner FROM %I',session_user); END $$;

ALTER TABLE public.partner_submission_snapshots
  DROP CONSTRAINT partner_submission_snapshots_schema;
ALTER TABLE public.partner_submission_snapshots
  ADD CONSTRAINT partner_submission_snapshots_schema
  CHECK (schema_version = 1 AND jsonb_typeof(snapshot_data) = 'object');

COMMIT;
