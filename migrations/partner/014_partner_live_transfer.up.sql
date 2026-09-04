BEGIN;
DO $$ BEGIN
  -- PostgreSQL can retain a role membership whose SET option is false. Add a
  -- migration-owned, temporary SET-capable grant unconditionally; the runner
  -- restores the exact pre-migration grants before commit.
  EXECUTE format('GRANT partner_ops_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user);
  EXECUTE format('GRANT partner_submission_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user);
END $$;
GRANT CREATE ON SCHEMA public TO partner_ops_owner,partner_submission_owner;

-- A LIVE create has no provider idempotency key.  This durable permit means a
-- request can dispatch createJob at most once.  A returned identity is retained
-- independently of the worker lease so a late response is not discarded.
CREATE TABLE public.partner_legacy_create_dispatches (
  company_id uuid NOT NULL,
  job_id uuid NOT NULL,
  request_id uuid NOT NULL,
  permit_id uuid NOT NULL UNIQUE,
  armed_at timestamptz NOT NULL DEFAULT now(),
  legacy_job_id varchar(24),
  legacy_job_number bigint,
  response_recorded_at timestamptz,
  CHECK ((legacy_job_id IS NULL AND legacy_job_number IS NULL AND response_recorded_at IS NULL)
    OR (legacy_job_id ~ '^[a-f0-9]{24}$' AND legacy_job_number > 0 AND response_recorded_at IS NOT NULL)),
  PRIMARY KEY(company_id,job_id,request_id),
  FOREIGN KEY(company_id,job_id,request_id) REFERENCES public.partner_submission_requests(company_id,job_id,id) ON DELETE RESTRICT
);
ALTER TABLE public.partner_legacy_create_dispatches OWNER TO partner_submission_owner;

CREATE TABLE public.partner_live_manual_resolutions (
  company_id uuid NOT NULL,
  job_id uuid NOT NULL,
  request_id uuid NOT NULL,
  confirmed_by text NOT NULL REFERENCES public.partner_users(id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  resolution_kind varchar(24) NOT NULL CHECK(resolution_kind IN('NO_EFFECT_CONFIRMED','RETURNED_IDENTITY')),
  resolved_legacy_job_id varchar(24) NOT NULL CHECK(resolved_legacy_job_id~'^[a-f0-9]{24}$'),
  resolved_legacy_job_number bigint NOT NULL CHECK(resolved_legacy_job_number>0),
  PRIMARY KEY(company_id,job_id,request_id),
  FOREIGN KEY(company_id,job_id,request_id) REFERENCES public.partner_submission_requests(company_id,job_id,id) ON DELETE RESTRICT
);
GRANT SELECT,INSERT ON public.partner_live_manual_resolutions TO partner_ops_owner,partner_submission_owner;
GRANT SELECT ON public.partner_submission_requests,public.partner_submission_snapshots TO partner_ops_owner;
GRANT SELECT ON public.partner_outbox_events,public.partner_submission_attempts,public.partner_legacy_create_dispatches TO partner_ops_owner;
REVOKE ALL ON public.partner_live_manual_resolutions FROM PUBLIC,partner_portal_runtime,partner_submission_worker,partner_ops_runtime;

ALTER TABLE public.partner_manual_job_links ADD COLUMN link_method varchar(20) NOT NULL DEFAULT 'MANUAL'
  CHECK(link_method IN('MANUAL','AUTOMATIC','MANUAL_FALLBACK'));
CREATE OR REPLACE FUNCTION public.partner_link_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF TG_OP='DELETE' OR (OLD.company_id,OLD.job_id,OLD.legacy_job_id,OLD.legacy_job_number,OLD.linked_by,OLD.linked_at,OLD.link_method)
    IS DISTINCT FROM (NEW.company_id,NEW.job_id,NEW.legacy_job_id,NEW.legacy_job_number,NEW.linked_by,NEW.linked_at,NEW.link_method)
  THEN RAISE EXCEPTION 'LINK_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
SET LOCAL ROLE partner_ops_owner;
CREATE OR REPLACE FUNCTION public.partner_ops_job_links(actor text,target_company uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  PERFORM public.partner_ops_authorize(actor,'ADMIN');
  IF NOT EXISTS(SELECT 1 FROM public.partner_companies WHERE id=target_company AND is_active=true) THEN RAISE EXCEPTION 'LINK_NOT_FOUND'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',j.id,'revision',j.revision,'clientReference',j.client_reference,
    'customerName',j.customer_name,'siteAddress',j.site_address,'submissionState',j.submission_state,'legacyId',j.legacy_job_id,
    'linkedJobNumber',l.legacy_job_number,'linkMethod',l.link_method,'linkedStatus',CASE WHEN l.job_id IS NULL THEN NULL ELSE jsonb_build_object(
      'ebaCompleted',l.eba_completed,'installDate',l.install_date,'jobCompleted',l.job_completed,'invoiceRecorded',l.invoice_recorded,'checkedAt',l.checked_at) END) ORDER BY j.updated_at DESC,j.id)
    FROM public.partner_jobs j LEFT JOIN public.partner_manual_job_links l ON(l.company_id,l.job_id)=(j.company_id,j.id)
    WHERE j.company_id=target_company AND j.deleted_at IS NULL AND j.submission_state<>'DRAFT'
      AND EXISTS(SELECT 1 FROM public.partner_submission_requests r JOIN public.partner_submission_snapshots s
        ON(s.company_id,s.job_id,s.id)=(r.company_id,r.job_id,r.snapshot_id)
        WHERE r.company_id=j.company_id AND r.job_id=j.id)),'[]'::jsonb);
END $$;
CREATE OR REPLACE FUNCTION public.partner_ops_job_link(actor text,target_company uuid,target_job uuid,target_revision integer,target_legacy text,target_number bigint,target_status jsonb,target_checked timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  PERFORM public.partner_ops_authorize(actor,'ADMIN');
  IF NOT EXISTS(SELECT 1 FROM public.partner_submission_requests r JOIN public.partner_submission_snapshots s
    ON(s.company_id,s.job_id,s.id)=(r.company_id,r.job_id,r.snapshot_id)
    WHERE r.company_id=target_company AND r.job_id=target_job) THEN RAISE EXCEPTION 'LINK_CONFLICT'; END IF;
  RETURN public.partner_link_commit(actor,target_company,target_job,target_revision,target_legacy,target_number,target_status,target_checked);
END $$;
RESET ROLE;
GRANT SELECT,INSERT,UPDATE(legacy_job_id,legacy_job_number,response_recorded_at) ON public.partner_legacy_create_dispatches TO partner_submission_owner;

CREATE FUNCTION public.partner_begin_legacy_create_dispatch(target_company uuid,target_job uuid,target_request uuid,target_lease uuid,target_fence bigint)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE permit uuid;
BEGIN
  IF NOT public.partner_submission_lock_lease(target_company,target_job,target_request,target_lease,target_fence) THEN RETURN NULL; END IF;
  SELECT permit_id INTO permit FROM public.partner_legacy_create_dispatches
    WHERE (company_id,job_id,request_id)=(target_company,target_job,target_request) FOR UPDATE;
  IF FOUND THEN RETURN permit; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.partner_jobs WHERE company_id=target_company AND id=target_job
      AND submission_adapter_mode_snapshot='LIVE' AND submission_contract_version_snapshot='insulhub-one-shot-v1'
      AND submission_checkpoint='FROZEN' AND legacy_job_id IS NULL AND legacy_job_number IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.partner_submission_attempts WHERE company_id=target_company AND job_id=target_job
      AND request_id=target_request AND lease_token=target_lease AND fence_token=target_fence AND outcome='IN_PROGRESS')
  THEN RETURN NULL; END IF;
  permit:=public.gen_random_uuid();
  INSERT INTO public.partner_legacy_create_dispatches(company_id,job_id,request_id,permit_id)
    VALUES(target_company,target_job,target_request,permit);
  IF NOT public.partner_checkpoint_submission(target_company,target_job,target_request,target_lease,target_fence,'CREATE_STARTED',NULL,NULL,NULL,NULL)
  THEN RAISE EXCEPTION 'LIVE_CREATE_PERMIT_CHECKPOINT_FAILED'; END IF;
  INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata)
    VALUES('SUBMISSION_PHASE_CHECKPOINTED',target_company,target_job,target_request,jsonb_build_object('phase','LIVE_CREATE_ARMED'));
  RETURN permit;
END $$;

CREATE FUNCTION public.partner_record_legacy_create_result(target_company uuid,target_job uuid,target_request uuid,target_permit uuid,target_legacy text,target_number bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing_id text; existing_number bigint;
BEGIN
  IF target_legacy!~'^[a-f0-9]{24}$' OR target_number<=0 THEN RETURN false; END IF;
  SELECT legacy_job_id,legacy_job_number INTO existing_id,existing_number FROM public.partner_legacy_create_dispatches
    WHERE (company_id,job_id,request_id,permit_id)=(target_company,target_job,target_request,target_permit) FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF existing_id IS NOT NULL THEN RETURN existing_id=target_legacy AND existing_number=target_number; END IF;
  IF EXISTS(SELECT 1 FROM public.partner_jobs WHERE legacy_job_id IS NOT NULL AND lower(legacy_job_id)=target_legacy
    AND (company_id,id)<>(target_company,target_job)) THEN RETURN false; END IF;
  UPDATE public.partner_legacy_create_dispatches SET legacy_job_id=target_legacy,legacy_job_number=target_number,response_recorded_at=now()
    WHERE (company_id,job_id,request_id,permit_id)=(target_company,target_job,target_request,target_permit) AND legacy_job_id IS NULL;
  UPDATE public.partner_jobs SET legacy_job_id=target_legacy,legacy_job_number=target_number,
    submission_state='UPDATING_QUOTE',submission_checkpoint='LEAD_CREATED',updated_at=now()
    WHERE company_id=target_company AND id=target_job AND submission_checkpoint='CREATE_STARTED'
      AND legacy_job_id IS NULL AND legacy_job_number IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.partner_submission_attempts SET legacy_job_id=target_legacy,phase='UPDATING_QUOTE'
    WHERE company_id=target_company AND job_id=target_job AND request_id=target_request AND outcome='IN_PROGRESS';
  INSERT INTO public.partner_audit_events(event_type,company_id,job_id,submission_request_id,metadata)
    VALUES('SUBMISSION_PHASE_CHECKPOINTED',target_company,target_job,target_request,jsonb_build_object('phase','LIVE_IDENTITY_RECORDED'));
  RETURN true;
END $$;

CREATE FUNCTION public.partner_legacy_create_receipt(target_company uuid,target_job uuid,target_request uuid)
RETURNS TABLE(permit_id uuid,legacy_job_id text,legacy_job_number bigint,response_recorded_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT d.permit_id,d.legacy_job_id::text,d.legacy_job_number,d.response_recorded_at
  FROM public.partner_legacy_create_dispatches d
  WHERE (d.company_id,d.job_id,d.request_id)=($1,$2,$3)
$$;

CREATE FUNCTION public.partner_live_test_queue_guard(target_request uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object(
    'actionableCount',(SELECT count(*) FROM public.partner_outbox_events o WHERE o.topic='PARTNER_SUBMISSION_EXECUTE' AND o.available_at<=now() AND (o.state IN('PENDING','FAILED') OR(o.state='PROCESSING' AND o.lease_expires_at<now()))),
    'targetActionable',EXISTS(SELECT 1 FROM public.partner_outbox_events o JOIN public.partner_submission_requests r ON(r.company_id,r.job_id,r.id)=(o.company_id,o.job_id,o.request_id) JOIN public.partner_jobs j ON(j.company_id,j.id)=(r.company_id,r.job_id) WHERE r.id=target_request AND o.topic='PARTNER_SUBMISSION_EXECUTE' AND o.available_at<=now() AND (o.state IN('PENDING','FAILED') OR(o.state='PROCESSING' AND o.lease_expires_at<now())) AND j.submission_adapter_mode_snapshot='LIVE' AND j.submission_contract_version_snapshot='insulhub-one-shot-v1'),
    'otherArmedCount',(SELECT count(*) FROM public.partner_legacy_create_dispatches d WHERE d.request_id<>target_request AND d.legacy_job_id IS NULL),
    'targetPermitArmed',EXISTS(SELECT 1 FROM public.partner_legacy_create_dispatches d WHERE d.request_id=target_request),
    'targetIdentityRecorded',EXISTS(SELECT 1 FROM public.partner_legacy_create_dispatches d WHERE d.request_id=target_request AND d.legacy_job_id IS NOT NULL))
$$;

-- The deliberately destructive production test must claim one exact request,
-- never whichever request happens to sort first. The table locks serialize
-- queue producers/claimers while the function proves that this is the only
-- open execute event and atomically delegates to the fully validated worker
-- claim path.
CREATE FUNCTION public.partner_claim_live_test_request(target_request uuid,target_worker text,lease_seconds integer DEFAULT 300)
RETURNS TABLE(company_id uuid,job_id uuid,request_id uuid,snapshot_id uuid,lease_token uuid,fence_token bigint,attempt_number integer,claim_status text,queue_age_bucket text,reclaimed_lease boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
DECLARE claimed record; target_event record;
BEGIN
  IF target_request IS NULL OR target_worker!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$' OR lease_seconds NOT BETWEEN 30 AND 900
  THEN RAISE EXCEPTION 'LIVE_TEST_GUARD_REJECTED'; END IF;
  LOCK TABLE public.partner_outbox_events IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.partner_legacy_create_dispatches IN SHARE ROW EXCLUSIVE MODE;
  SELECT o.company_id,o.job_id,o.request_id INTO target_event
    FROM public.partner_outbox_events o
    JOIN public.partner_submission_requests r ON(r.company_id,r.job_id,r.id)=(o.company_id,o.job_id,o.request_id)
    JOIN public.partner_jobs j ON(j.company_id,j.id)=(r.company_id,r.job_id)
    WHERE r.id=target_request AND o.topic='PARTNER_SUBMISSION_EXECUTE' AND o.available_at<=now()
      AND (o.state IN('PENDING','FAILED') OR(o.state='PROCESSING' AND o.lease_expires_at<now()))
      AND j.submission_adapter_mode_snapshot='LIVE' AND j.submission_contract_version_snapshot='insulhub-one-shot-v1'
      AND j.submission_checkpoint='FROZEN' AND j.legacy_job_id IS NULL AND j.legacy_job_number IS NULL
    FOR UPDATE OF o;
  IF NOT FOUND
    OR (SELECT count(*) FROM public.partner_outbox_events WHERE topic='PARTNER_SUBMISSION_EXECUTE' AND state IN('PENDING','FAILED','PROCESSING'))<>1
    OR EXISTS(SELECT 1 FROM public.partner_legacy_create_dispatches)
  THEN RAISE EXCEPTION 'LIVE_TEST_GUARD_REJECTED'; END IF;
  SELECT * INTO claimed FROM public.partner_claim_submission_bounded(target_worker,lease_seconds);
  IF NOT FOUND OR claimed.request_id IS DISTINCT FROM target_request OR claimed.claim_status IS DISTINCT FROM 'CLAIMED'
  THEN RAISE EXCEPTION 'LIVE_TEST_CLAIM_MISMATCH'; END IF;
  company_id:=claimed.company_id;job_id:=claimed.job_id;request_id:=claimed.request_id;snapshot_id:=claimed.snapshot_id;
  lease_token:=claimed.lease_token;fence_token:=claimed.fence_token;attempt_number:=claimed.attempt_number;
  claim_status:=claimed.claim_status;queue_age_bucket:=claimed.queue_age_bucket;reclaimed_lease:=claimed.reclaimed_lease;
  RETURN NEXT;
END $$;

CREATE FUNCTION public.partner_live_test_status(target_request uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('requestState',r.state,'submissionState',j.submission_state,'checkpoint',j.submission_checkpoint,
    'outboxState',o.state,'legacyJobId',j.legacy_job_id,'legacyJobNumber',j.legacy_job_number,
    'permitArmed',d.permit_id IS NOT NULL,'identityRecorded',d.legacy_job_id IS NOT NULL)
  FROM public.partner_submission_requests r JOIN public.partner_jobs j ON(j.company_id,j.id)=(r.company_id,r.job_id)
  JOIN public.partner_outbox_events o ON(o.company_id,o.job_id,o.request_id)=(r.company_id,r.job_id,r.id) AND o.topic='PARTNER_SUBMISSION_EXECUTE'
  LEFT JOIN public.partner_legacy_create_dispatches d ON(d.company_id,d.job_id,d.request_id)=(r.company_id,r.job_id,r.id)
  WHERE r.id=target_request
$$;

CREATE FUNCTION public.partner_ops_legacy_connection_status(actor text,target_company uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM public.partner_ops_authorize(actor,'ADMIN');
  RETURN (SELECT jsonb_build_object('configured',c.submission_adapter_mode='LIVE' AND c.submission_contract_version='insulhub-one-shot-v1'
      AND c.legacy_base_url='https://api.insulhub.nz/graphql' AND c.legacy_credential_ciphertext IS NOT NULL,
      'revision',c.revision,'updatedAt',c.legacy_credential_updated_at,'quotePrefix',c.legacy_job_prefix)
    FROM public.partner_companies c WHERE c.id=target_company AND c.is_active=true);
END $$;

CREATE FUNCTION public.partner_ops_legacy_connection_set(actor text,target_company uuid,target_revision integer,target_endpoint text,
  target_ciphertext bytea,target_nonce bytea,target_key_version integer,target_fingerprint text,target_prefix text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM public.partner_ops_authorize(actor,'ADMIN');
  IF target_endpoint<>'https://api.insulhub.nz/graphql' OR octet_length(target_ciphertext) NOT BETWEEN 17 AND 16384
    OR octet_length(target_nonce)<>12 OR target_key_version<=0 OR target_fingerprint!~'^[0-9a-f]{64}$'
    OR target_prefix!~'^[A-Z0-9][A-Z0-9-]{0,39}$' THEN RAISE EXCEPTION 'OPS_INVALID_INPUT'; END IF;
  UPDATE public.partner_companies SET legacy_base_url=target_endpoint,legacy_credential_ciphertext=target_ciphertext,
    legacy_credential_nonce=target_nonce,legacy_credential_key_version=target_key_version,legacy_credential_updated_at=now(),
    submission_adapter_mode='LIVE',submission_contract_version='insulhub-one-shot-v1',legacy_job_prefix=target_prefix,
    revision=revision+1,updated_at=now()
    WHERE id=target_company AND is_active=true AND revision=target_revision;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.partner_audit_events(event_type,actor_user_id,company_id,metadata)
    VALUES('LEGACY_CREDENTIAL_REPLACED',actor,target_company,jsonb_build_object('keyVersion',target_key_version,'contract','insulhub-one-shot-v1'));
  RETURN true;
END $$;

CREATE FUNCTION public.partner_ops_job_link_investigation_required(actor text,target_company uuid,target_job uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result text;
BEGIN
  PERFORM public.partner_ops_authorize(actor,'ADMIN');
  SELECT CASE WHEN d.legacy_job_id IS NULL THEN 'NO_EFFECT_CONFIRMED' ELSE 'RETURNED_IDENTITY' END INTO result
    FROM public.partner_jobs j JOIN public.partner_submission_requests r
      ON(r.company_id,r.job_id)=(j.company_id,j.id)
    JOIN public.partner_legacy_create_dispatches d ON(d.company_id,d.job_id,d.request_id)=(r.company_id,r.job_id,r.id)
    WHERE j.company_id=target_company AND j.id=target_job AND j.deleted_at IS NULL
      AND j.submission_state IN('FAILED_RETRYABLE','RECONCILIATION_REQUIRED')
      AND j.legacy_job_id IS NULL AND j.legacy_job_number IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.partner_submission_attempts a WHERE a.company_id=j.company_id AND a.job_id=j.id AND a.outcome='IN_PROGRESS')
      AND NOT EXISTS(SELECT 1 FROM public.partner_outbox_events e WHERE e.company_id=j.company_id AND e.job_id=j.id AND e.state='PROCESSING' AND e.lease_expires_at>=now())
    LIMIT 1;
  RETURN result;
END $$;

-- Explicit exception for an armed create whose response never proved an
-- identity. Staff must first check InsulHub, preview the manually created
-- replacement, and attest that no automatic job exists. The ordinary link
-- function and its strict CREATE_STARTED guard remain unchanged.
CREATE FUNCTION public.partner_link_commit_investigated(actor text,target_company uuid,target_job uuid,target_revision integer,target_legacy text,target_number bigint,target_status jsonb,target_checked timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.partner_jobs%ROWTYPE; request uuid; dispatched_id text; dispatched_number bigint; resolution text;
BEGIN
  IF target_legacy!~'^[a-f0-9]{24}$' OR target_number<=0 OR public.partner_link_status_valid(target_status) IS NOT TRUE
    OR target_checked IS NULL OR target_checked<now()-interval '2 minutes' OR target_checked>now()+interval '10 seconds'
  THEN RAISE EXCEPTION 'LINK_INVALID'; END IF;
  PERFORM 1 FROM public.partner_outbox_events WHERE company_id=target_company AND job_id=target_job ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.partner_companies WHERE id=target_company AND is_active=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LINK_NOT_FOUND'; END IF;
  SELECT * INTO job FROM public.partner_jobs WHERE company_id=target_company AND id=target_job AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LINK_NOT_FOUND'; END IF;
  IF job.revision IS DISTINCT FROM target_revision OR job.submission_state NOT IN('FAILED_RETRYABLE','RECONCILIATION_REQUIRED')
    OR job.legacy_job_id IS NOT NULL OR job.legacy_job_number IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.partner_submission_attempts WHERE company_id=target_company AND job_id=target_job AND outcome='IN_PROGRESS')
    OR EXISTS(SELECT 1 FROM public.partner_outbox_events WHERE company_id=target_company AND job_id=target_job AND state='PROCESSING' AND lease_expires_at>=now())
  THEN RAISE EXCEPTION 'LINK_CONFLICT'; END IF;
  SELECT r.id,d.legacy_job_id,d.legacy_job_number INTO request,dispatched_id,dispatched_number FROM public.partner_submission_requests r JOIN public.partner_legacy_create_dispatches d
    ON(d.company_id,d.job_id,d.request_id)=(r.company_id,r.job_id,r.id)
    WHERE r.company_id=target_company AND r.job_id=target_job FOR UPDATE OF d;
  IF NOT FOUND THEN RAISE EXCEPTION 'LINK_CONFLICT'; END IF;
  IF (dispatched_id IS NULL)<>(dispatched_number IS NULL) OR (dispatched_id IS NOT NULL AND (dispatched_id<>target_legacy OR dispatched_number<>target_number)) THEN RAISE EXCEPTION 'LINK_CONFLICT'; END IF;
  resolution:=CASE WHEN dispatched_id IS NULL THEN 'NO_EFFECT_CONFIRMED' ELSE 'RETURNED_IDENTITY' END;
  IF EXISTS(SELECT 1 FROM public.partner_manual_job_links WHERE company_id=target_company AND job_id=target_job AND legacy_job_id=target_legacy) THEN RETURN false; END IF;
  INSERT INTO public.partner_live_manual_resolutions(company_id,job_id,request_id,confirmed_by,resolution_kind,resolved_legacy_job_id,resolved_legacy_job_number)
    VALUES(target_company,target_job,request,actor,resolution,target_legacy,target_number);
  UPDATE public.partner_outbox_events SET state='DEAD',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
    fence_token=fence_token+1,last_error_code='AMBIGUOUS_LEGACY_RESULT',updated_at=now()
    WHERE company_id=target_company AND job_id=target_job AND state<>'DELIVERED';
  UPDATE public.partner_jobs SET legacy_job_id=target_legacy,legacy_job_number=target_number,submission_state='SUBMITTED',
    submission_checkpoint='RECONCILIATION',submission_started_at=COALESCE(submission_started_at,now()),submitted_at=COALESCE(submitted_at,now()),updated_at=now()
    WHERE company_id=target_company AND id=target_job;
  INSERT INTO public.partner_manual_job_links(company_id,job_id,legacy_job_id,legacy_job_number,linked_by,link_method,
    eba_completed,install_date,job_completed,invoice_recorded,checked_at)
  VALUES(target_company,target_job,target_legacy,target_number,actor,'MANUAL_FALLBACK',(target_status->>'ebaCompleted')::boolean,
    (target_status->>'installDate')::date,(target_status->>'jobCompleted')::boolean,(target_status->>'invoiceRecorded')::boolean,target_checked);
  RETURN true;
END $$;

CREATE FUNCTION public.partner_ops_job_link_investigated(actor text,target_company uuid,target_job uuid,target_revision integer,target_legacy text,target_number bigint,target_status jsonb,target_checked timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  PERFORM public.partner_ops_authorize(actor,'ADMIN');
  RETURN public.partner_link_commit_investigated(actor,target_company,target_job,target_revision,target_legacy,target_number,target_status,target_checked);
END $$;

-- A verified LIVE finalisation owns its returned legacy identity already. Add
-- the same immutable status-sync mapping used by a manual link only after the
-- entire quote and plan transfer has reached FINALIZED. Failed/ambiguous work
-- is deliberately excluded so staff can use the explicit manual-link flow.
CREATE FUNCTION public.partner_live_finalized_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.submission_state='SUBMITTED' AND NEW.submission_checkpoint='FINALIZED'
    AND NEW.submission_adapter_mode_snapshot='LIVE'
    AND NEW.submission_contract_version_snapshot='insulhub-one-shot-v1'
    AND NEW.legacy_job_id IS NOT NULL AND NEW.legacy_job_number IS NOT NULL
    AND (OLD.submission_state,OLD.submission_checkpoint) IS DISTINCT FROM (NEW.submission_state,NEW.submission_checkpoint)
  THEN
    INSERT INTO public.partner_manual_job_links(company_id,job_id,legacy_job_id,legacy_job_number,linked_by,link_method,
      eba_completed,install_date,job_completed,invoice_recorded,checked_at)
    VALUES(NEW.company_id,NEW.id,NEW.legacy_job_id,NEW.legacy_job_number,NEW.created_by_user_id,'AUTOMATIC',
      NULL,NULL,NULL,NULL,now())
    ON CONFLICT DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM public.partner_manual_job_links l
      WHERE (l.company_id,l.job_id,l.legacy_job_id,l.legacy_job_number)=(NEW.company_id,NEW.id,NEW.legacy_job_id,NEW.legacy_job_number))
    THEN RAISE EXCEPTION 'LIVE_FINALIZED_LINK_CONFLICT'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_live_finalized_link AFTER UPDATE ON public.partner_jobs
  FOR EACH ROW EXECUTE FUNCTION public.partner_live_finalized_link();

ALTER FUNCTION public.partner_begin_legacy_create_dispatch(uuid,uuid,uuid,uuid,bigint) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_record_legacy_create_result(uuid,uuid,uuid,uuid,text,bigint) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_legacy_create_receipt(uuid,uuid,uuid) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_live_test_queue_guard(uuid) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_claim_live_test_request(uuid,text,integer) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_live_test_status(uuid) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_ops_legacy_connection_status(text,uuid) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_legacy_connection_set(text,uuid,integer,text,bytea,bytea,integer,text,text) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_job_link_investigation_required(text,uuid,uuid) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_link_commit_investigated(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_ops_job_link_investigated(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_live_finalized_link() OWNER TO partner_submission_owner;
REVOKE ALL ON FUNCTION public.partner_begin_legacy_create_dispatch(uuid,uuid,uuid,uuid,bigint),
  public.partner_record_legacy_create_result(uuid,uuid,uuid,uuid,text,bigint),public.partner_legacy_create_receipt(uuid,uuid,uuid),
  public.partner_live_test_queue_guard(uuid),public.partner_claim_live_test_request(uuid,text,integer),public.partner_live_test_status(uuid),
  public.partner_ops_legacy_connection_status(text,uuid),public.partner_ops_legacy_connection_set(text,uuid,integer,text,bytea,bytea,integer,text,text)
  ,public.partner_ops_job_link_investigation_required(text,uuid,uuid),public.partner_ops_job_link_investigated(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz),
  public.partner_link_commit_investigated(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz)
  FROM PUBLIC,partner_portal_runtime,partner_submission_worker,partner_ops_runtime;
REVOKE ALL ON FUNCTION public.partner_live_finalized_link() FROM PUBLIC,partner_portal_runtime,partner_submission_worker,partner_ops_runtime;
GRANT EXECUTE ON FUNCTION public.partner_begin_legacy_create_dispatch(uuid,uuid,uuid,uuid,bigint),
  public.partner_record_legacy_create_result(uuid,uuid,uuid,uuid,text,bigint),public.partner_legacy_create_receipt(uuid,uuid,uuid)
  ,public.partner_live_test_queue_guard(uuid),public.partner_claim_live_test_request(uuid,text,integer),public.partner_live_test_status(uuid)
  TO partner_submission_worker;
GRANT EXECUTE ON FUNCTION public.partner_ops_legacy_connection_status(text,uuid),
  public.partner_ops_legacy_connection_set(text,uuid,integer,text,bytea,bytea,integer,text,text),
  public.partner_ops_job_link_investigation_required(text,uuid,uuid),
  public.partner_ops_job_link_investigated(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz) TO partner_ops_runtime;
GRANT EXECUTE ON FUNCTION public.partner_link_commit_investigated(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz) TO partner_ops_owner;
REVOKE CREATE ON SCHEMA public FROM partner_ops_owner,partner_submission_owner;
COMMIT;
