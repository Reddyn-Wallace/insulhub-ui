BEGIN;

-- New submissions use immutable snapshot schema v2, which removes the
-- deferred billing decision. Schema-v1 snapshots remain valid and untouched.
ALTER TABLE public.partner_submission_snapshots
  DROP CONSTRAINT partner_submission_snapshots_schema;
ALTER TABLE public.partner_submission_snapshots
  ADD CONSTRAINT partner_submission_snapshots_schema
  CHECK (schema_version IN (1,2) AND jsonb_typeof(snapshot_data) = 'object');

DO $$ BEGIN EXECUTE format('GRANT partner_submission_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user); END $$;
GRANT CREATE ON SCHEMA public TO partner_submission_owner;

CREATE OR REPLACE FUNCTION public.partner_submission_snapshot_shape_valid_v2(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE plan jsonb;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(value))<>4 OR NOT(value?&ARRAY['schemaVersion','contract','job','plans'])
    OR value->'schemaVersion' IS DISTINCT FROM '2'::jsonb OR jsonb_typeof(value->'contract') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(value->'contract'))<>3
    OR NOT(value->'contract'?&ARRAY['adapterMode','version','legacyJobPrefix'])
    OR jsonb_typeof(value#>'{contract,adapterMode}') IS DISTINCT FROM 'string' OR jsonb_typeof(value#>'{contract,version}') IS DISTINCT FROM 'string' OR jsonb_typeof(value#>'{contract,legacyJobPrefix}') IS DISTINCT FROM 'string'
    OR jsonb_typeof(value->'job') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(value->'job'))<>10
    OR NOT(value->'job'?&ARRAY['id','companyId','revision','floorPlanRevision','clientReference','customer','siteAddress','leadSources','notes','quote']) OR value->'job'?'billingModel'
    OR jsonb_typeof(value#>'{job,id}') IS DISTINCT FROM 'string' OR jsonb_typeof(value#>'{job,companyId}') IS DISTINCT FROM 'string' OR jsonb_typeof(value#>'{job,clientReference}') IS DISTINCT FROM 'string'
    OR jsonb_typeof(value#>'{job,notes}') IS DISTINCT FROM 'string'
    OR jsonb_typeof(value#>'{job,revision}') IS DISTINCT FROM 'number' OR (value#>>'{job,revision}')!~'^\d+$' OR (value#>>'{job,revision}')::numeric>2147483647
    OR jsonb_typeof(value#>'{job,floorPlanRevision}') IS DISTINCT FROM 'number' OR (value#>>'{job,floorPlanRevision}')!~'^\d+$' OR (value#>>'{job,floorPlanRevision}')::numeric>2147483647
    OR jsonb_typeof(value#>'{job,customer}') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(value#>'{job,customer}'))<>3 OR NOT(value#>'{job,customer}'?&ARRAY['name','mobile','email'])
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['name','mobile','email']) key WHERE jsonb_typeof(value#>ARRAY['job','customer',key]) IS DISTINCT FROM 'string')
    OR jsonb_typeof(value#>'{job,siteAddress}') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(value#>'{job,siteAddress}'))<>4 OR NOT(value#>'{job,siteAddress}'?&ARRAY['street','suburb','city','postcode'])
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['street','suburb','city','postcode']) key WHERE jsonb_typeof(value#>ARRAY['job','siteAddress',key]) IS DISTINCT FROM 'string')
    OR jsonb_typeof(value#>'{job,leadSources}') IS DISTINCT FROM 'array' OR jsonb_typeof(value#>'{job,quote}') IS DISTINCT FROM 'object'
    OR jsonb_typeof(value->'plans') IS DISTINCT FROM 'array' OR jsonb_array_length(value->'plans') NOT BETWEEN 1 AND 20 THEN RETURN false; END IF;
  FOR plan IN SELECT item FROM jsonb_array_elements(value->'plans') AS items(item) LOOP
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

-- Patch the already-reviewed freeze function in place so its full locking and
-- idempotency implementation remains byte-for-byte unchanged apart from the
-- versioned snapshot checks and stored schema version.
DO $$
DECLARE definition text; changed text;
BEGIN
  definition:=pg_get_functiondef('public.partner_freeze_submission(uuid,uuid,text,integer,integer,uuid,uuid,text,text,jsonb)'::regprocedure);
  changed:=replace(definition,
    'IF NOT public.partner_submission_snapshot_shape_valid(snapshot_value) THEN',
    'IF NOT (CASE WHEN snapshot_value->>''schemaVersion''=''1'' THEN public.partner_submission_snapshot_shape_valid(snapshot_value) WHEN snapshot_value->>''schemaVersion''=''2'' THEN public.partner_submission_snapshot_shape_valid_v2(snapshot_value) ELSE false END) THEN');
  changed:=replace(changed,
    ',"schemaVersion":1,"snapshotSha256":"''||calculated_snapshot_sha',
    ',"schemaVersion":''||(snapshot_value->>''schemaVersion'')||'',"snapshotSha256":"''||calculated_snapshot_sha');
  changed:=replace(changed,
    'OR snapshot_value#>>''{job,billingModel}'' IS DISTINCT FROM job_row.billing_model_snapshot',
    'OR ((snapshot_value->>''schemaVersion'')::integer=1 AND snapshot_value#>>''{job,billingModel}'' IS DISTINCT FROM job_row.billing_model_snapshot)');
  changed:=replace(changed,
    'INSERT INTO public.partner_submission_snapshots(company_id,job_id,id,job_revision,',
    'INSERT INTO public.partner_submission_snapshots(company_id,job_id,id,schema_version,job_revision,');
  changed:=replace(changed,
    'VALUES(target_company,target_job,target_snapshot_id,job_row.revision,',
    'VALUES(target_company,target_job,target_snapshot_id,(snapshot_value->>''schemaVersion'')::integer,job_row.revision,');
  IF changed=definition OR changed LIKE '%schemaVersion":1,"snapshotSha256%' OR changed LIKE '%id,job_revision,%' THEN RAISE EXCEPTION 'PARTNER_V2_FREEZE_PATCH_FAILED'; END IF;
  EXECUTE changed;
END $$;

-- The bounded worker keeps reading immutable v1 snapshots while accepting v2.
DO $$
DECLARE definition text; changed text;
BEGIN
  definition:=pg_get_functiondef('public.partner_claim_submission_bounded(text,integer)'::regprocedure);
  changed:=replace(definition,
    'AND s.schema_version=1 AND public.partner_worker_snapshot_matches(s.canonical_document,s.snapshot_data)',
    'AND s.schema_version IN(1,2) AND public.partner_worker_snapshot_matches(s.canonical_document,s.snapshot_data)');
  IF changed=definition THEN RAISE EXCEPTION 'PARTNER_V2_WORKER_PATCH_FAILED'; END IF;
  EXECUTE changed;
END $$;

-- Normal InsulHub job updates use the amendment UUID as their idempotency key.
-- Retrying the same request is a no-op, while cross-job/key substitution fails.
ALTER TABLE public.partner_job_amendments DROP CONSTRAINT partner_amendment_v1_patch;
ALTER TABLE public.partner_job_amendments ADD CONSTRAINT partner_amendment_v1_patch CHECK (
  jsonb_typeof(patch)='object' AND patch ? 'version' AND patch ? 'description'
  AND jsonb_typeof(patch->'version')='number' AND patch->>'version'='1'
  AND patch - ARRAY['version','description','contractDeltaCents','requestKey']='{}'::jsonb
  AND jsonb_typeof(patch->'description')='string' AND patch->>'description'=btrim(patch->>'description') AND length(patch->>'description') BETWEEN 1 AND 1000
  AND (NOT patch ? 'contractDeltaCents' OR (jsonb_typeof(patch->'contractDeltaCents')='number' AND (patch->>'contractDeltaCents') ~ '^-?[0-9]{1,12}$' AND (patch->>'contractDeltaCents')::bigint BETWEEN -999999999999 AND 999999999999))
  AND (NOT patch ? 'requestKey' OR (jsonb_typeof(patch->'requestKey')='string' AND (patch->>'requestKey') ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$'))
);

CREATE OR REPLACE FUNCTION public.partner_ops_amendment_append(actor text,target_company uuid,target_job uuid,target_patch jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE next_sequence integer; job_state text; request_id uuid; existing_company uuid; existing_job uuid; existing_patch jsonb;
BEGIN
  PERFORM public.partner_ops_authorize(actor,'OPERATIONS');
  request_id:=COALESCE((target_patch->>'requestKey')::uuid,gen_random_uuid());
  SELECT company_id,job_id,patch INTO existing_company,existing_job,existing_patch FROM public.partner_job_amendments WHERE id=request_id;
  IF FOUND THEN
    IF existing_company=target_company AND existing_job=target_job AND existing_patch=target_patch THEN RETURN true; END IF;
    RAISE EXCEPTION 'OPS_JOB_NOT_ACTIONABLE';
  END IF;
  SELECT submission_state INTO job_state FROM public.partner_jobs WHERE company_id=target_company AND id=target_job FOR UPDATE;
  IF job_state IS NULL OR job_state NOT IN('SUBMITTED','RECONCILIATION_REQUIRED') THEN RAISE EXCEPTION 'OPS_JOB_NOT_ACTIONABLE'; END IF;
  SELECT COALESCE(max(sequence),0)+1 INTO next_sequence FROM public.partner_job_amendments WHERE company_id=target_company AND job_id=target_job;
  INSERT INTO public.partner_job_amendments(id,company_id,job_id,sequence,reason,patch,created_by_user_id) VALUES(request_id,target_company,target_job,next_sequence,target_patch->>'description',target_patch,actor);
  INSERT INTO public.partner_audit_events(event_type,actor_user_id,company_id,job_id,metadata) VALUES('OPS_AMENDMENT_RECORDED',actor,target_company,target_job,'{}'::jsonb);
  RETURN true;
END $$;

ALTER FUNCTION public.partner_submission_snapshot_shape_valid_v2(jsonb) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_claim_submission_bounded(text,integer) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_ops_amendment_append(text,uuid,uuid,jsonb) OWNER TO partner_ops_owner;
REVOKE ALL ON FUNCTION public.partner_submission_snapshot_shape_valid_v2(jsonb) FROM PUBLIC,partner_portal_runtime,partner_submission_worker;
REVOKE EXECUTE ON FUNCTION
  public.partner_ops_dashboard(text),
  public.partner_ops_fact_append(text,uuid,uuid,text,timestamptz),
  public.partner_ops_invoice_upsert(text,uuid,uuid,integer,text,bigint,timestamptz),
  public.partner_ops_settlement_upsert(text,uuid,uuid,integer,bigint,bigint,text,timestamptz)
FROM partner_ops_runtime;
REVOKE CREATE ON SCHEMA public FROM partner_submission_owner;
DO $$ BEGIN EXECUTE format('REVOKE partner_submission_owner FROM %I',session_user); END $$;

COMMIT;
