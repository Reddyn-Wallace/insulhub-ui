BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.partner_notification_settings WHERE recipient_email IS NOT NULL OR revision<>0)
    OR EXISTS(SELECT 1 FROM public.partner_outbox_events WHERE notification_dispatch_started_at IS NOT NULL OR notification_receipt LIKE 'gmail:%')
  THEN RAISE EXCEPTION 'Partner notification rollback refused: clear configured recipient and delivery history first'; END IF;
  EXECUTE format('GRANT partner_ops_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user);
  EXECUTE format('GRANT partner_submission_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user);
END $$;

DROP FUNCTION public.partner_claim_notification_exact(uuid,text,integer);
DROP FUNCTION public.partner_notification_test_status(uuid);
DROP FUNCTION public.partner_begin_notification_dispatch(uuid,uuid,bigint,text,text,text,bigint,text);
DROP FUNCTION public.partner_notification_delivery_context(uuid,uuid,bigint);
DROP FUNCTION public.partner_settings_notification_set(text,integer,text);
DROP FUNCTION public.partner_settings_notification_get(text);

SET LOCAL ROLE partner_submission_owner;
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
      OR(item.topic='PARTNER_SUBMISSION_RECONCILIATION_ALERT' AND r.state='RECONCILIATION_REQUIRED' AND j.submission_state='RECONCILIATION_REQUIRED' AND j.submission_checkpoint='RECONCILIATION' AND execute_event.state='DEAD')))
  THEN
    UPDATE public.partner_outbox_events SET state='DEAD',last_error_code=CASE WHEN item.attempt_count>=5 THEN 'PROVIDER_UNAVAILABLE' ELSE 'NOTIFICATION_REJECTED' END,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=item.id;
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
CREATE OR REPLACE FUNCTION public.partner_checkpoint_notification_accepted(target_event uuid,target_lease uuid,target_fence bigint,target_receipt text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  IF target_receipt IS NULL OR target_receipt!~'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' OR NOT public.partner_notification_lock_lease(target_event,target_lease,target_fence) THEN RETURN false; END IF;
  UPDATE public.partner_outbox_events SET notification_phase='ACCEPTED_PENDING',notification_receipt=target_receipt,notification_accepted_at=COALESCE(notification_accepted_at,now()),updated_at=now()
    WHERE id=target_event AND state='PROCESSING' AND lease_token=target_lease AND fence_token=target_fence AND notification_phase IN('READY','ACCEPTED_PENDING')
      AND (notification_receipt IS NULL OR notification_receipt=target_receipt);RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION public.partner_release_notification(target_event uuid,target_lease uuid,target_fence bigint,target_error_code text,retry_delay_seconds integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  IF retry_delay_seconds IS NULL OR retry_delay_seconds NOT BETWEEN 1 AND 604800 OR public.partner_submission_safe_error_code(target_error_code) IS NOT TRUE OR NOT public.partner_notification_lock_lease(target_event,target_lease,target_fence) THEN RETURN 'DENIED'; END IF;
  UPDATE public.partner_outbox_events SET state=CASE WHEN attempt_count>=5 THEN 'DEAD' ELSE 'FAILED' END,available_at=now()+make_interval(secs=>retry_delay_seconds),last_error_code=target_error_code,
    lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=target_event AND state='PROCESSING' AND lease_token=target_lease AND fence_token=target_fence;
  IF NOT FOUND THEN RETURN 'DENIED'; END IF;
  INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata)
    SELECT CASE WHEN state='DEAD' THEN 'SUBMISSION_NOTIFICATION_DEAD' ELSE 'SUBMISSION_NOTIFICATION_RELEASED' END,company_id,job_id,request_id,jsonb_build_object('errorCode',target_error_code) FROM public.partner_outbox_events WHERE id=target_event;
  RETURN CASE WHEN (SELECT state FROM public.partner_outbox_events WHERE id=target_event)='DEAD' THEN 'DEAD' ELSE 'RELEASED' END;
END $$;
RESET ROLE;

ALTER TABLE public.partner_audit_events DROP CONSTRAINT partner_audit_event_type;
ALTER TABLE public.partner_audit_events ADD CONSTRAINT partner_audit_event_type CHECK(event_type IN('ACCOUNT_LINK_ISSUED','ACCOUNT_EMAIL_ACCEPTED','ACCOUNT_EMAIL_UNCONFIRMED','ACCOUNT_PASSWORD_CHANGED','DRAFT_DELETED',
 'LOGIN_SUCCEEDED','LOGIN_FAILED','LOGOUT','USER_PROVISIONED','USER_DISABLED','SESSIONS_REVOKED','LEGACY_CREDENTIAL_REPLACED',
 'SUBMISSION_FROZEN','SUBMISSION_CLAIMED','SUBMISSION_PHASE_CHECKPOINTED','SUBMISSION_FINALIZED','SUBMISSION_FAILED_RETRYABLE','SUBMISSION_RECONCILIATION_REQUIRED',
 'SUBMISSION_EXECUTE_DISCARDED','SUBMISSION_NOTIFICATION_CLAIMED','SUBMISSION_NOTIFICATION_RELEASED','SUBMISSION_NOTIFICATION_DELIVERED','SUBMISSION_NOTIFICATION_DEAD',
 'OPS_COMPANY_CREATED','OPS_COMPANY_UPDATED','OPS_PARTNER_USER_PROVISIONED','OPS_FACT_RECORDED','OPS_AMENDMENT_RECORDED','OPS_INVOICE_RECORDED','OPS_SETTLEMENT_RECORDED'));

ALTER TABLE public.partner_outbox_events DROP CONSTRAINT partner_outbox_notification_receipt;
ALTER TABLE public.partner_outbox_events DROP CONSTRAINT partner_outbox_notification_phase;
ALTER TABLE public.partner_outbox_events
  DROP COLUMN notification_dispatch_started_at,
  DROP COLUMN notification_to_email,
  DROP COLUMN notification_company_name,
  DROP COLUMN notification_legacy_job_id,
  DROP COLUMN notification_legacy_job_number,
  DROP COLUMN notification_job_url,
  ADD CONSTRAINT partner_outbox_notification_phase CHECK(notification_phase IS NULL OR notification_phase IN('READY','ACCEPTED_PENDING')),
  ADD CONSTRAINT partner_outbox_notification_receipt CHECK(
    (notification_phase IS NULL AND notification_receipt IS NULL AND notification_accepted_at IS NULL)
    OR (notification_phase='READY' AND notification_receipt IS NULL AND notification_accepted_at IS NULL)
    OR (notification_phase='ACCEPTED_PENDING' AND notification_receipt~'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' AND notification_accepted_at IS NOT NULL));

DROP TABLE public.partner_notification_settings;
DO $$ BEGIN
  EXECUTE format('REVOKE partner_ops_owner FROM %I',session_user);
  EXECUTE format('REVOKE partner_submission_owner FROM %I',session_user);
END $$;
COMMIT;
