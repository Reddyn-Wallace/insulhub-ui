BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.partner_outbox_events WHERE topic='PARTNER_SUBMISSION_COMPLETED' AND (state='PROCESSING' OR notification_phase='SEND_STARTED'))
  THEN RAISE EXCEPTION 'Partner notification detail rollback refused: delivery in progress'; END IF;
  EXECUTE format('GRANT partner_submission_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user);
END $$;
GRANT CREATE ON SCHEMA public TO partner_submission_owner;

DROP FUNCTION public.partner_begin_notification_dispatch(uuid,uuid,bigint,text,text,text,text,text,text,text,bigint,text,bigint,text);
DROP FUNCTION public.partner_notification_delivery_context(uuid,uuid,bigint);

ALTER TABLE public.partner_outbox_events DROP CONSTRAINT partner_outbox_notification_receipt;
ALTER TABLE public.partner_outbox_events
  DROP COLUMN notification_customer_name,
  DROP COLUMN notification_property_street,
  DROP COLUMN notification_property_suburb,
  DROP COLUMN notification_property_city,
  DROP COLUMN notification_property_postcode,
  DROP COLUMN notification_quote_total_cents,
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
  JOIN public.partner_outbox_events execute_event ON(execute_event.company_id,execute_event.job_id,execute_event.request_id)=(r.company_id,r.job_id,r.id) AND execute_event.topic='PARTNER_SUBMISSION_EXECUTE'
  WHERE o.id=target_event AND o.topic='PARTNER_SUBMISSION_COMPLETED' AND o.state='PROCESSING' AND o.notification_phase='READY'
    AND r.state='SUCCEEDED' AND j.submission_state='SUBMITTED' AND j.submission_checkpoint='FINALIZED'
    AND j.legacy_job_id~'^[a-f0-9]{24}$' AND j.legacy_job_number>0 AND execute_event.state='DELIVERED' AND s.singleton=true AND s.recipient_email IS NOT NULL;
END $$;
CREATE FUNCTION public.partner_begin_notification_dispatch(target_event uuid,target_lease uuid,target_fence bigint,target_email text,target_company_name text,target_legacy_id text,target_legacy_number bigint,target_job_url text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE expected record;
BEGIN
  IF target_job_url IS NULL OR target_job_url!~'^https?://[^/[:space:]]+/jobs/[a-f0-9]{24}$' OR NOT public.partner_notification_lock_lease(target_event,target_lease,target_fence) THEN RETURN false; END IF;
  SELECT * INTO expected FROM public.partner_notification_delivery_context(target_event,target_lease,target_fence);
  IF NOT FOUND OR (expected.recipient_email,expected.company_name,expected.legacy_job_id,expected.legacy_job_number) IS DISTINCT FROM (target_email,target_company_name,target_legacy_id,target_legacy_number)
    OR target_job_url NOT LIKE '%/jobs/'||target_legacy_id THEN RETURN false; END IF;
  UPDATE public.partner_outbox_events SET notification_phase='SEND_STARTED',notification_dispatch_started_at=now(),notification_to_email=target_email,
    notification_company_name=target_company_name,notification_legacy_job_id=target_legacy_id,notification_legacy_job_number=target_legacy_number,notification_job_url=target_job_url,updated_at=now()
  WHERE id=target_event AND state='PROCESSING' AND lease_token=target_lease AND fence_token=target_fence AND notification_phase='READY';
  RETURN FOUND;
END $$;
RESET ROLE;

ALTER FUNCTION public.partner_notification_delivery_context(uuid,uuid,bigint) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_begin_notification_dispatch(uuid,uuid,bigint,text,text,text,bigint,text) OWNER TO partner_submission_owner;
REVOKE ALL ON FUNCTION public.partner_notification_delivery_context(uuid,uuid,bigint),public.partner_begin_notification_dispatch(uuid,uuid,bigint,text,text,text,bigint,text) FROM PUBLIC,partner_portal_runtime,partner_submission_worker,partner_ops_runtime;
GRANT EXECUTE ON FUNCTION public.partner_notification_delivery_context(uuid,uuid,bigint),public.partner_begin_notification_dispatch(uuid,uuid,bigint,text,text,text,bigint,text) TO partner_submission_worker;
REVOKE CREATE ON SCHEMA public FROM partner_submission_owner;
DO $$ BEGIN EXECUTE format('REVOKE partner_submission_owner FROM %I',session_user); END $$;
COMMIT;
