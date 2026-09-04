BEGIN;

DO $$ BEGIN
  EXECUTE format('GRANT partner_ops_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user);
  EXECUTE format('GRANT partner_submission_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user);
END $$;
GRANT CREATE ON SCHEMA public TO partner_ops_owner,partner_submission_owner;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.partner_outbox_events
    WHERE topic IN('PARTNER_SUBMISSION_COMPLETED','PARTNER_SUBMISSION_RECONCILIATION_ALERT')
      AND (state='PROCESSING' OR notification_phase='ACCEPTED_PENDING'))
  THEN RAISE EXCEPTION 'Partner notification migration refused: active or accepted notification'; END IF;
END $$;

CREATE TABLE public.partner_notification_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  recipient_email varchar(254),
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  updated_by_user_id text REFERENCES public.partner_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(recipient_email IS NULL OR (recipient_email=lower(btrim(recipient_email))
    AND recipient_email~'^[^\s@]+@[^\s@]+\.[^\s@]+$'))
);
ALTER TABLE public.partner_notification_settings OWNER TO partner_ops_owner;
INSERT INTO public.partner_notification_settings(singleton) VALUES(true);

ALTER TABLE public.partner_outbox_events DROP CONSTRAINT partner_outbox_notification_phase;
ALTER TABLE public.partner_outbox_events DROP CONSTRAINT partner_outbox_notification_receipt;
ALTER TABLE public.partner_outbox_events
  ADD COLUMN notification_dispatch_started_at timestamptz,
  ADD COLUMN notification_to_email varchar(254),
  ADD COLUMN notification_company_name varchar(160),
  ADD COLUMN notification_legacy_job_id varchar(24),
  ADD COLUMN notification_legacy_job_number bigint,
  ADD COLUMN notification_job_url varchar(2048),
  ADD CONSTRAINT partner_outbox_notification_phase CHECK(notification_phase IS NULL OR notification_phase IN('READY','SEND_STARTED','ACCEPTED_PENDING')),
  ADD CONSTRAINT partner_outbox_notification_receipt CHECK(
    (notification_phase IS NULL AND notification_receipt IS NULL AND notification_accepted_at IS NULL AND notification_dispatch_started_at IS NULL
      AND notification_to_email IS NULL AND notification_company_name IS NULL AND notification_legacy_job_id IS NULL AND notification_legacy_job_number IS NULL AND notification_job_url IS NULL)
    OR (notification_phase='READY' AND notification_receipt IS NULL AND notification_accepted_at IS NULL AND notification_dispatch_started_at IS NULL
      AND notification_to_email IS NULL AND notification_company_name IS NULL AND notification_legacy_job_id IS NULL AND notification_legacy_job_number IS NULL AND notification_job_url IS NULL)
    OR (notification_phase IN('SEND_STARTED','ACCEPTED_PENDING') AND notification_dispatch_started_at IS NOT NULL
      AND notification_to_email=lower(btrim(notification_to_email)) AND notification_to_email~'^[^\s@]+@[^\s@]+\.[^\s@]+$'
      AND notification_company_name IS NOT NULL AND length(btrim(notification_company_name)) BETWEEN 1 AND 160
      AND notification_legacy_job_id~'^[a-f0-9]{24}$' AND notification_legacy_job_number>0
      AND notification_job_url~'^https?://[^/[:space:]]+/jobs/[a-f0-9]{24}$'
      AND ((notification_phase='SEND_STARTED' AND notification_receipt IS NULL AND notification_accepted_at IS NULL)
        OR (notification_phase='ACCEPTED_PENDING' AND notification_receipt~'^gmail:[A-Za-z0-9_-]{1,160}$' AND notification_accepted_at IS NOT NULL)))
    OR (notification_phase='ACCEPTED_PENDING' AND notification_receipt~'^fictional:[A-Za-z0-9._:/-]{1,180}$' AND notification_accepted_at IS NOT NULL
      AND notification_dispatch_started_at IS NULL AND notification_to_email IS NULL AND notification_company_name IS NULL
      AND notification_legacy_job_id IS NULL AND notification_legacy_job_number IS NULL AND notification_job_url IS NULL)
  );

ALTER TABLE public.partner_audit_events DROP CONSTRAINT partner_audit_event_type;
ALTER TABLE public.partner_audit_events ADD CONSTRAINT partner_audit_event_type CHECK(event_type IN('PARTNER_NOTIFICATION_SETTINGS_UPDATED','ACCOUNT_LINK_ISSUED','ACCOUNT_EMAIL_ACCEPTED','ACCOUNT_EMAIL_UNCONFIRMED','ACCOUNT_PASSWORD_CHANGED','DRAFT_DELETED',
 'LOGIN_SUCCEEDED','LOGIN_FAILED','LOGOUT','USER_PROVISIONED','USER_DISABLED','SESSIONS_REVOKED','LEGACY_CREDENTIAL_REPLACED',
 'SUBMISSION_FROZEN','SUBMISSION_CLAIMED','SUBMISSION_PHASE_CHECKPOINTED','SUBMISSION_FINALIZED','SUBMISSION_FAILED_RETRYABLE','SUBMISSION_RECONCILIATION_REQUIRED',
 'SUBMISSION_EXECUTE_DISCARDED','SUBMISSION_NOTIFICATION_CLAIMED','SUBMISSION_NOTIFICATION_RELEASED','SUBMISSION_NOTIFICATION_DELIVERED','SUBMISSION_NOTIFICATION_DEAD',
 'OPS_COMPANY_CREATED','OPS_COMPANY_UPDATED','OPS_PARTNER_USER_PROVISIONED','OPS_FACT_RECORDED','OPS_AMENDMENT_RECORDED','OPS_INVOICE_RECORDED','OPS_SETTLEMENT_RECORDED'));

SET LOCAL ROLE partner_ops_owner;
CREATE FUNCTION public.partner_settings_notification_get(actor text)
RETURNS TABLE(recipient_email text,revision integer,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  PERFORM public.partner_ops_authorize(actor,'ADMIN');
  RETURN QUERY SELECT s.recipient_email::text,s.revision,s.updated_at FROM public.partner_notification_settings s WHERE s.singleton=true;
END $$;
CREATE FUNCTION public.partner_settings_notification_set(actor text,expected_revision integer,target_email text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE canonical text:=lower(btrim(target_email));
BEGIN
  PERFORM public.partner_ops_authorize(actor,'ADMIN');
  IF expected_revision<0 OR canonical IS NULL OR length(canonical)>254 OR canonical!~'^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN RAISE EXCEPTION 'NOTIFICATION_SETTINGS_INVALID'; END IF;
  UPDATE public.partner_notification_settings SET recipient_email=canonical,revision=revision+1,updated_by_user_id=actor,updated_at=now()
    WHERE singleton=true AND revision=expected_revision;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.partner_audit_events(event_type,actor_user_id,metadata) VALUES('PARTNER_NOTIFICATION_SETTINGS_UPDATED',actor,'{}'::jsonb);
  RETURN true;
END $$;
RESET ROLE;

SET LOCAL ROLE partner_submission_owner;
CREATE FUNCTION public.partner_notification_delivery_context(target_event uuid,target_lease uuid,target_fence bigint)
RETURNS TABLE(recipient_email text,company_name text,legacy_job_id text,legacy_job_number bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  IF NOT public.partner_notification_lock_lease(target_event,target_lease,target_fence) THEN RETURN; END IF;
  RETURN QUERY SELECT s.recipient_email::text,c.name::text,j.legacy_job_id::text,j.legacy_job_number
  FROM public.partner_outbox_events o
  JOIN public.partner_submission_requests r ON(r.company_id,r.job_id,r.id)=(o.company_id,o.job_id,o.request_id)
  JOIN public.partner_jobs j ON(j.company_id,j.id)=(r.company_id,r.job_id)
  JOIN public.partner_companies c ON c.id=j.company_id AND c.is_active=true
  CROSS JOIN public.partner_notification_settings s
  JOIN public.partner_outbox_events execute_event ON(execute_event.company_id,execute_event.job_id,execute_event.request_id)=(r.company_id,r.job_id,r.id)
    AND execute_event.topic='PARTNER_SUBMISSION_EXECUTE'
  WHERE o.id=target_event AND o.topic='PARTNER_SUBMISSION_COMPLETED' AND o.state='PROCESSING' AND o.notification_phase='READY'
    AND r.state='SUCCEEDED' AND j.submission_state='SUBMITTED' AND j.submission_checkpoint='FINALIZED'
    AND j.legacy_job_id~'^[a-f0-9]{24}$' AND j.legacy_job_number>0 AND execute_event.state='DELIVERED'
    AND s.singleton=true AND s.recipient_email IS NOT NULL;
END $$;

CREATE FUNCTION public.partner_begin_notification_dispatch(target_event uuid,target_lease uuid,target_fence bigint,target_email text,target_company_name text,target_legacy_id text,target_legacy_number bigint,target_job_url text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE expected record;
BEGIN
  IF target_job_url IS NULL OR target_job_url!~'^https?://[^/[:space:]]+/jobs/[a-f0-9]{24}$' OR NOT public.partner_notification_lock_lease(target_event,target_lease,target_fence) THEN RETURN false; END IF;
  SELECT * INTO expected FROM public.partner_notification_delivery_context(target_event,target_lease,target_fence);
  IF NOT FOUND OR (expected.recipient_email,expected.company_name,expected.legacy_job_id,expected.legacy_job_number)
    IS DISTINCT FROM (target_email,target_company_name,target_legacy_id,target_legacy_number) OR target_job_url NOT LIKE '%/jobs/'||target_legacy_id THEN RETURN false; END IF;
  UPDATE public.partner_outbox_events SET notification_phase='SEND_STARTED',notification_dispatch_started_at=now(),notification_to_email=target_email,
    notification_company_name=target_company_name,notification_legacy_job_id=target_legacy_id,notification_legacy_job_number=target_legacy_number,
    notification_job_url=target_job_url,updated_at=now()
  WHERE id=target_event AND state='PROCESSING' AND lease_token=target_lease AND fence_token=target_fence AND notification_phase='READY';
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.partner_checkpoint_notification_accepted(target_event uuid,target_lease uuid,target_fence bigint,target_receipt text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  IF target_receipt IS NULL OR target_receipt!~'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' OR NOT public.partner_notification_lock_lease(target_event,target_lease,target_fence) THEN RETURN false; END IF;
  UPDATE public.partner_outbox_events SET notification_phase='ACCEPTED_PENDING',notification_receipt=target_receipt,notification_accepted_at=COALESCE(notification_accepted_at,now()),updated_at=now()
    WHERE id=target_event AND state='PROCESSING' AND lease_token=target_lease AND fence_token=target_fence AND notification_phase IN('SEND_STARTED','ACCEPTED_PENDING')
      AND notification_dispatch_started_at IS NOT NULL AND (notification_receipt IS NULL OR notification_receipt=target_receipt);
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.partner_release_notification(target_event uuid,target_lease uuid,target_fence bigint,target_error_code text,retry_delay_seconds integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE started boolean;
BEGIN
  IF retry_delay_seconds IS NULL OR retry_delay_seconds NOT BETWEEN 1 AND 604800 OR public.partner_submission_safe_error_code(target_error_code) IS NOT TRUE OR NOT public.partner_notification_lock_lease(target_event,target_lease,target_fence) THEN RETURN 'DENIED'; END IF;
  SELECT notification_phase='SEND_STARTED' INTO started FROM public.partner_outbox_events WHERE id=target_event FOR UPDATE;
  UPDATE public.partner_outbox_events SET state=CASE WHEN started OR attempt_count>=5 THEN 'DEAD' ELSE 'FAILED' END,available_at=now()+make_interval(secs=>retry_delay_seconds),last_error_code=target_error_code,
    lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=target_event AND state='PROCESSING' AND lease_token=target_lease AND fence_token=target_fence;
  IF NOT FOUND THEN RETURN 'DENIED'; END IF;
  INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata)
    SELECT CASE WHEN state='DEAD' THEN 'SUBMISSION_NOTIFICATION_DEAD' ELSE 'SUBMISSION_NOTIFICATION_RELEASED' END,company_id,job_id,request_id,jsonb_build_object('errorCode',target_error_code) FROM public.partner_outbox_events WHERE id=target_event;
  RETURN CASE WHEN (SELECT state FROM public.partner_outbox_events WHERE id=target_event)='DEAD' THEN 'DEAD' ELSE 'RELEASED' END;
END $$;

CREATE FUNCTION public.partner_claim_notification_exact(target_event uuid,target_worker text,lease_seconds integer DEFAULT 120)
RETURNS TABLE(event_id uuid,company_id uuid,job_id uuid,request_id uuid,topic text,notification_phase text,notification_receipt text,lease_token uuid,fence_token bigint,attempt_number integer,claim_status text,queue_age_bucket text,reclaimed_lease boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
DECLARE item public.partner_outbox_events%ROWTYPE;
BEGIN
  IF target_worker!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' OR lease_seconds NOT BETWEEN 30 AND 900 THEN RAISE EXCEPTION 'SUBMISSION_INVALID_LEASE'; END IF;
  SELECT * INTO item FROM public.partner_outbox_events WHERE id=target_event AND topic='PARTNER_SUBMISSION_COMPLETED'
    AND available_at<=now() AND (state IN('PENDING','FAILED') OR(state='PROCESSING' AND lease_expires_at<now())) FOR UPDATE SKIP LOCKED;
  IF FOUND AND item.notification_phase='READY' AND NOT EXISTS(SELECT 1 FROM public.partner_notification_settings s WHERE s.singleton=true AND s.recipient_email IS NOT NULL) THEN RETURN; END IF;
  IF NOT FOUND THEN RETURN; END IF;
  IF item.notification_phase='SEND_STARTED' OR item.notification_phase IS NULL OR item.attempt_count>=5 OR NOT EXISTS(
    SELECT 1 FROM public.partner_submission_requests r JOIN public.partner_jobs j ON(j.company_id,j.id)=(r.company_id,r.job_id)
    JOIN public.partner_outbox_events execute_event ON(execute_event.company_id,execute_event.job_id,execute_event.request_id)=(r.company_id,r.job_id,r.id) AND execute_event.topic='PARTNER_SUBMISSION_EXECUTE'
    WHERE (r.company_id,r.job_id,r.id)=(item.company_id,item.job_id,item.request_id) AND r.state='SUCCEEDED' AND j.submission_state='SUBMITTED'
      AND j.submission_checkpoint='FINALIZED' AND j.legacy_job_id~'^[a-f0-9]{24}$' AND j.legacy_job_number>0 AND execute_event.state='DELIVERED'
      AND ((item.notification_phase='READY' AND EXISTS(SELECT 1 FROM public.partner_notification_settings s WHERE s.singleton=true AND s.recipient_email IS NOT NULL))
        OR (item.notification_phase='ACCEPTED_PENDING' AND item.notification_receipt~'^gmail:[A-Za-z0-9_-]{1,160}$'
          AND item.notification_to_email IS NOT NULL AND item.notification_company_name IS NOT NULL
          AND item.notification_legacy_job_id=j.legacy_job_id AND item.notification_legacy_job_number=j.legacy_job_number AND item.notification_job_url LIKE '%/jobs/'||j.legacy_job_id)))
  THEN
    UPDATE public.partner_outbox_events SET state='DEAD',last_error_code=CASE WHEN item.notification_phase='SEND_STARTED' THEN 'AMBIGUOUS_LEGACY_RESULT' ELSE 'NOTIFICATION_REJECTED' END,
      lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=item.id;
    INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata)
      VALUES('SUBMISSION_NOTIFICATION_DEAD',item.company_id,item.job_id,item.request_id,
        jsonb_build_object('errorCode',CASE WHEN item.notification_phase='SEND_STARTED' THEN 'AMBIGUOUS_LEGACY_RESULT' ELSE 'NOTIFICATION_REJECTED' END));
    event_id:=item.id;company_id:=item.company_id;job_id:=item.job_id;request_id:=item.request_id;topic:=item.topic;notification_phase:=item.notification_phase;
    notification_receipt:=item.notification_receipt;lease_token:=NULL;fence_token:=item.fence_token;attempt_number:=item.attempt_count;claim_status:='DEAD';
    queue_age_bucket:=CASE WHEN now()-item.created_at<interval '1 minute' THEN 'LT_1M' WHEN now()-item.created_at<interval '5 minutes' THEN 'LT_5M' WHEN now()-item.created_at<interval '1 hour' THEN 'LT_1H' ELSE 'GTE_1H' END;reclaimed_lease:=item.state='PROCESSING';RETURN NEXT;RETURN;
  END IF;
  item.lease_token:=gen_random_uuid();item.fence_token:=item.fence_token+1;
  UPDATE public.partner_outbox_events SET state='PROCESSING',attempt_count=attempt_count+1,locked_at=now(),lease_token=item.lease_token,fence_token=item.fence_token,
    lease_owner=target_worker,lease_expires_at=now()+make_interval(secs=>lease_seconds),updated_at=now() WHERE id=item.id;
  INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata) VALUES('SUBMISSION_NOTIFICATION_CLAIMED',item.company_id,item.job_id,item.request_id,jsonb_build_object('phase',item.notification_phase,'attemptNumber',(item.attempt_count+1)::text));
  event_id:=item.id;company_id:=item.company_id;job_id:=item.job_id;request_id:=item.request_id;topic:=item.topic;notification_phase:=item.notification_phase;
  notification_receipt:=item.notification_receipt;lease_token:=item.lease_token;fence_token:=item.fence_token;attempt_number:=item.attempt_count+1;claim_status:='CLAIMED';
  queue_age_bucket:=CASE WHEN now()-item.created_at<interval '1 minute' THEN 'LT_1M' WHEN now()-item.created_at<interval '5 minutes' THEN 'LT_5M' WHEN now()-item.created_at<interval '1 hour' THEN 'LT_1H' ELSE 'GTE_1H' END;reclaimed_lease:=item.state='PROCESSING';RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.partner_claim_notification(target_worker text,lease_seconds integer DEFAULT 120)
RETURNS TABLE(event_id uuid,company_id uuid,job_id uuid,request_id uuid,topic text,notification_phase text,notification_receipt text,lease_token uuid,fence_token bigint,attempt_number integer,claim_status text,queue_age_bucket text,reclaimed_lease boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target uuid;
BEGIN
  IF target_worker!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' OR lease_seconds NOT BETWEEN 30 AND 900 THEN RAISE EXCEPTION 'SUBMISSION_INVALID_LEASE'; END IF;
  SELECT o.id INTO target FROM public.partner_outbox_events o
  WHERE o.topic='PARTNER_SUBMISSION_COMPLETED' AND o.available_at<=now()
    AND (o.state IN('PENDING','FAILED') OR(o.state='PROCESSING' AND o.lease_expires_at<now()))
    AND (o.notification_phase IN('SEND_STARTED','ACCEPTED_PENDING') OR (o.notification_phase='READY'
      AND EXISTS(SELECT 1 FROM public.partner_notification_settings s WHERE s.singleton=true AND s.recipient_email IS NOT NULL)))
  ORDER BY o.available_at,o.created_at,o.id LIMIT 1;
  IF target IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM public.partner_claim_notification_exact(target,target_worker,lease_seconds);
END $$;

CREATE FUNCTION public.partner_notification_test_status(target_event uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('eventId',o.id,'state',o.state,'phase',o.notification_phase,'attemptCount',o.attempt_count,
    'recipientConfigured',s.recipient_email IS NOT NULL,'legacyJobNumber',j.legacy_job_number,'companyName',c.name)
  FROM public.partner_outbox_events o
  JOIN public.partner_jobs j ON(j.company_id,j.id)=(o.company_id,o.job_id)
  JOIN public.partner_companies c ON c.id=o.company_id
  CROSS JOIN public.partner_notification_settings s
  JOIN public.partner_outbox_events execute_event ON(execute_event.company_id,execute_event.job_id,execute_event.request_id)=(o.company_id,o.job_id,o.request_id) AND execute_event.topic='PARTNER_SUBMISSION_EXECUTE'
  WHERE o.id=target_event AND o.topic='PARTNER_SUBMISSION_COMPLETED' AND j.submission_state='SUBMITTED' AND j.submission_checkpoint='FINALIZED'
    AND j.legacy_job_id~'^[a-f0-9]{24}$' AND j.legacy_job_number>0 AND execute_event.state='DELIVERED' AND s.singleton=true
$$;
RESET ROLE;

ALTER FUNCTION public.partner_settings_notification_get(text) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_settings_notification_set(text,integer,text) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_notification_delivery_context(uuid,uuid,bigint) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_begin_notification_dispatch(uuid,uuid,bigint,text,text,text,bigint,text) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_checkpoint_notification_accepted(uuid,uuid,bigint,text) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_release_notification(uuid,uuid,bigint,text,integer) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_claim_notification_exact(uuid,text,integer) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_claim_notification(text,integer) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_notification_test_status(uuid) OWNER TO partner_submission_owner;

REVOKE ALL ON TABLE public.partner_notification_settings FROM PUBLIC,partner_portal_runtime,partner_submission_worker,partner_ops_runtime;
REVOKE ALL ON FUNCTION public.partner_settings_notification_get(text),public.partner_settings_notification_set(text,integer,text) FROM PUBLIC,partner_portal_runtime,partner_submission_worker,partner_ops_runtime;
GRANT EXECUTE ON FUNCTION public.partner_settings_notification_get(text),public.partner_settings_notification_set(text,integer,text) TO partner_ops_runtime;
REVOKE ALL ON FUNCTION public.partner_notification_delivery_context(uuid,uuid,bigint),public.partner_begin_notification_dispatch(uuid,uuid,bigint,text,text,text,bigint,text),public.partner_claim_notification_exact(uuid,text,integer),public.partner_notification_test_status(uuid) FROM PUBLIC,partner_portal_runtime,partner_submission_worker,partner_ops_runtime;
GRANT EXECUTE ON FUNCTION public.partner_notification_delivery_context(uuid,uuid,bigint),public.partner_begin_notification_dispatch(uuid,uuid,bigint,text,text,text,bigint,text),public.partner_claim_notification_exact(uuid,text,integer),public.partner_notification_test_status(uuid) TO partner_submission_worker;

REVOKE CREATE ON SCHEMA public FROM partner_ops_owner,partner_submission_owner;
DO $$ BEGIN
  EXECUTE format('REVOKE partner_ops_owner FROM %I',session_user);
  EXECUTE format('REVOKE partner_submission_owner FROM %I',session_user);
END $$;
COMMIT;
