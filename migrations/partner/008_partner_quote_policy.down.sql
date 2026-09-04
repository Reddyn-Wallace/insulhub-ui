BEGIN;
-- Owner rights are temporary and restricted to this schema migration.
DO $$ BEGIN EXECUTE format('GRANT partner_submission_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user); END $$;
GRANT CREATE ON SCHEMA public TO partner_submission_owner;
-- Company attribution and fixed portal terms; immutable old snapshots remain untouched.
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
REVOKE CREATE ON SCHEMA public FROM partner_submission_owner;
DO $$ BEGIN EXECUTE format('REVOKE partner_submission_owner FROM %I',session_user); END $$;
COMMIT;
