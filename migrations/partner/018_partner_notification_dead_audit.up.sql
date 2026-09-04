BEGIN;

SET LOCAL ROLE partner_submission_owner;
CREATE OR REPLACE FUNCTION public.partner_claim_notification_exact(target_event uuid,target_worker text,lease_seconds integer DEFAULT 120)
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
RESET ROLE;

COMMIT;
