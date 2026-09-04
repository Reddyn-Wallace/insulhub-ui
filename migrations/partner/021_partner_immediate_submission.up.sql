BEGIN;

DO $$ BEGIN EXECUTE format('GRANT partner_submission_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user); END $$;
GRANT CREATE ON SCHEMA public TO partner_submission_owner;
SET LOCAL ROLE partner_submission_owner;

CREATE FUNCTION public.partner_submission_request_id(target_company uuid,target_job uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT r.id FROM public.partner_submission_requests r
  WHERE r.company_id=target_company AND r.job_id=target_job
$$;

CREATE FUNCTION public.partner_claim_submission_exact(target_company uuid,target_job uuid,target_request uuid,target_worker text,lease_seconds integer DEFAULT 300)
RETURNS TABLE(company_id uuid,job_id uuid,request_id uuid,snapshot_id uuid,lease_token uuid,fence_token bigint,attempt_number integer,claim_status text,queue_age_bucket text,reclaimed_lease boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
DECLARE item public.partner_outbox_events%ROWTYPE; request_row public.partner_submission_requests%ROWTYPE;
BEGIN
  IF target_company IS NULL OR target_job IS NULL OR target_request IS NULL OR target_worker!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' OR lease_seconds NOT BETWEEN 30 AND 900
  THEN RAISE EXCEPTION 'SUBMISSION_INVALID_LEASE'; END IF;
  SELECT o.* INTO item FROM public.partner_outbox_events o
    JOIN public.partner_submission_requests r ON(r.company_id,r.job_id,r.id)=(o.company_id,o.job_id,o.request_id)
    JOIN public.partner_jobs j ON(j.company_id,j.id)=(r.company_id,r.job_id)
    WHERE (o.company_id,o.job_id,o.request_id)=(target_company,target_job,target_request)
      AND o.topic='PARTNER_SUBMISSION_EXECUTE' AND o.available_at<=now() AND o.state='PENDING' AND o.attempt_count=0
      AND r.state='QUEUED' AND j.submission_state='QUEUED' AND j.submission_checkpoint='FROZEN'
      AND j.legacy_job_id IS NULL AND j.legacy_job_number IS NULL AND j.final_quote_number IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.partner_submission_attempts a WHERE (a.company_id,a.job_id,a.request_id)=(target_company,target_job,target_request))
    FOR UPDATE OF o SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM 1 FROM public.partner_companies WHERE id=target_company FOR UPDATE;
  PERFORM 1 FROM public.partner_jobs WHERE company_id=target_company AND id=target_job FOR UPDATE;
  SELECT * INTO request_row FROM public.partner_submission_requests WHERE company_id=target_company AND job_id=target_job AND id=target_request FOR UPDATE;
  item.lease_token:=gen_random_uuid();item.fence_token:=item.fence_token+1;
  UPDATE public.partner_outbox_events SET state='PROCESSING',attempt_count=1,locked_at=now(),lease_token=item.lease_token,fence_token=item.fence_token,
    lease_owner=target_worker,lease_expires_at=now()+make_interval(secs=>lease_seconds),updated_at=now()
    WHERE id=item.id AND company_id=target_company AND state='PENDING' AND attempt_count=0;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.partner_submission_requests SET state='PROCESSING',worker_v2_started=true,safe_error_code=NULL,updated_at=now()
    WHERE company_id=target_company AND job_id=target_job AND id=target_request AND state='QUEUED';
  IF NOT FOUND THEN RAISE EXCEPTION 'SUBMISSION_EXACT_CLAIM_CONFLICT'; END IF;
  INSERT INTO public.partner_submission_attempts(company_id,job_id,request_id,attempt_number,phase,outcome,lease_token,fence_token,lease_owner,lease_expires_at,started_at)
    VALUES(target_company,target_job,target_request,1,'CREATING_LEAD','IN_PROGRESS',item.lease_token,item.fence_token,target_worker,now()+make_interval(secs=>lease_seconds),now());
  INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata)
    VALUES('SUBMISSION_CLAIMED',target_company,target_job,target_request,jsonb_build_object('phase','IMMEDIATE','attemptNumber','1'));
  company_id:=target_company;job_id:=target_job;request_id:=target_request;snapshot_id:=request_row.snapshot_id;lease_token:=item.lease_token;
  fence_token:=item.fence_token;attempt_number:=1;claim_status:='CLAIMED';
  queue_age_bucket:=CASE WHEN now()-item.created_at<interval '1 minute' THEN 'LT_1M' WHEN now()-item.created_at<interval '5 minutes' THEN 'LT_5M' WHEN now()-item.created_at<interval '1 hour' THEN 'LT_1H' ELSE 'GTE_1H' END;
  reclaimed_lease:=false;RETURN NEXT;
END $$;

CREATE FUNCTION public.partner_claim_submission_notification_exact(target_company uuid,target_job uuid,target_request uuid,target_worker text,lease_seconds integer DEFAULT 300)
RETURNS TABLE(event_id uuid,company_id uuid,job_id uuid,request_id uuid,topic text,notification_phase text,notification_receipt text,lease_token uuid,fence_token bigint,attempt_number integer,claim_status text,queue_age_bucket text,reclaimed_lease boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
DECLARE target_event uuid;item public.partner_outbox_events%ROWTYPE;
BEGIN
  SELECT o.* INTO item FROM public.partner_outbox_events o
    WHERE (o.company_id,o.job_id,o.request_id)=(target_company,target_job,target_request)
      AND o.topic='PARTNER_SUBMISSION_COMPLETED' AND o.state='PENDING' AND o.attempt_count=0 AND o.available_at<=now();
  target_event:=item.id;
  IF target_event IS NULL THEN RETURN; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.partner_notification_settings s WHERE s.singleton=true AND s.recipient_email IS NOT NULL) THEN
    UPDATE public.partner_outbox_events SET state='DEAD',last_error_code='NOTIFICATION_REJECTED',updated_at=now() WHERE id=target_event AND state='PENDING' AND attempt_count=0;
    IF NOT FOUND THEN RETURN; END IF;
    INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata)
      VALUES('SUBMISSION_NOTIFICATION_DEAD',item.company_id,item.job_id,item.request_id,jsonb_build_object('errorCode','NOTIFICATION_REJECTED','phase','NO_RECIPIENT'));
    event_id:=item.id;company_id:=item.company_id;job_id:=item.job_id;request_id:=item.request_id;topic:=item.topic;notification_phase:=item.notification_phase;
    notification_receipt:=NULL;lease_token:=NULL;fence_token:=item.fence_token;attempt_number:=0;claim_status:='DEAD';
    queue_age_bucket:=CASE WHEN now()-item.created_at<interval '1 minute' THEN 'LT_1M' WHEN now()-item.created_at<interval '5 minutes' THEN 'LT_5M' WHEN now()-item.created_at<interval '1 hour' THEN 'LT_1H' ELSE 'GTE_1H' END;
    reclaimed_lease:=false;RETURN NEXT;RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public.partner_claim_notification_exact(target_event,target_worker,lease_seconds);
END $$;

RESET ROLE;
ALTER FUNCTION public.partner_submission_request_id(uuid,uuid) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_claim_submission_exact(uuid,uuid,uuid,text,integer) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_claim_submission_notification_exact(uuid,uuid,uuid,text,integer) OWNER TO partner_submission_owner;
REVOKE ALL ON FUNCTION public.partner_submission_request_id(uuid,uuid),public.partner_claim_submission_exact(uuid,uuid,uuid,text,integer),public.partner_claim_submission_notification_exact(uuid,uuid,uuid,text,integer) FROM PUBLIC,partner_portal_runtime,partner_submission_worker,partner_ops_runtime;
GRANT EXECUTE ON FUNCTION public.partner_submission_request_id(uuid,uuid) TO partner_portal_runtime;
GRANT EXECUTE ON FUNCTION public.partner_claim_submission_exact(uuid,uuid,uuid,text,integer),public.partner_claim_submission_notification_exact(uuid,uuid,uuid,text,integer) TO partner_submission_worker;

REVOKE CREATE ON SCHEMA public FROM partner_submission_owner;
DO $$ BEGIN EXECUTE format('REVOKE partner_submission_owner FROM %I',session_user); END $$;

COMMIT;
