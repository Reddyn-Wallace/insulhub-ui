BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT lower(legacy_job_id) FROM public.partner_jobs WHERE legacy_job_id IS NOT NULL GROUP BY lower(legacy_job_id) HAVING count(*)>1)
  THEN RAISE EXCEPTION 'Manual linking migration refused: duplicate legacy ownership requires review'; END IF;
  IF NOT pg_has_role(session_user,'partner_ops_owner','USAGE') THEN EXECUTE format('GRANT partner_ops_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user); END IF;
  IF NOT pg_has_role(session_user,'partner_submission_owner','USAGE') THEN EXECUTE format('GRANT partner_submission_owner TO %I WITH INHERIT TRUE, SET TRUE',session_user); END IF;
END $$;
GRANT CREATE ON SCHEMA public TO partner_ops_owner,partner_submission_owner;
CREATE UNIQUE INDEX partner_jobs_global_legacy_identity ON public.partner_jobs(lower(legacy_job_id)) WHERE legacy_job_id IS NOT NULL;

-- Link identity/provenance is immutable. Only the narrow refresh function may
-- replace the current status; original quote, drawings and receipts stay intact.
CREATE TABLE public.partner_manual_job_links (
  company_id uuid NOT NULL,
  job_id uuid NOT NULL,
  legacy_job_id varchar(24) NOT NULL UNIQUE CHECK (legacy_job_id ~ '^[a-f0-9]{24}$'),
  legacy_job_number bigint NOT NULL CHECK (legacy_job_number > 0),
  linked_by text NOT NULL REFERENCES public.partner_users(id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  eba_completed boolean,
  install_date date,
  job_completed boolean,
  invoice_recorded boolean,
  checked_at timestamptz NOT NULL CHECK (checked_at > '2000-01-01'::timestamptz AND checked_at < '2100-01-01'::timestamptz),
  PRIMARY KEY(company_id,job_id),
  FOREIGN KEY(company_id,job_id) REFERENCES public.partner_jobs(company_id,id) ON DELETE RESTRICT
);
GRANT SELECT ON public.partner_manual_job_links TO partner_portal_runtime,partner_ops_owner,partner_submission_owner;
GRANT INSERT ON public.partner_manual_job_links TO partner_submission_owner;
GRANT UPDATE(eba_completed,install_date,job_completed,invoice_recorded,checked_at) ON public.partner_manual_job_links TO partner_ops_owner;

CREATE FUNCTION public.partner_link_status_valid(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_typeof(value)='object' AND value ? 'ebaCompleted' AND value ? 'installDate'
    AND value ? 'jobCompleted' AND value ? 'invoiceRecorded'
    AND value - ARRAY['ebaCompleted','installDate','jobCompleted','invoiceRecorded']='{}'::jsonb
    AND jsonb_typeof(value->'ebaCompleted') IN('boolean','null')
    AND jsonb_typeof(value->'jobCompleted') IN('boolean','null')
    AND jsonb_typeof(value->'invoiceRecorded') IN('boolean','null')
    AND (value->'installDate'='null'::jsonb OR (jsonb_typeof(value->'installDate')='string' AND value->>'installDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
$$;

CREATE FUNCTION public.partner_link_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF TG_OP='DELETE' OR (OLD.company_id,OLD.job_id,OLD.legacy_job_id,OLD.legacy_job_number,OLD.linked_by,OLD.linked_at)
    IS DISTINCT FROM (NEW.company_id,NEW.job_id,NEW.legacy_job_id,NEW.legacy_job_number,NEW.linked_by,NEW.linked_at)
  THEN RAISE EXCEPTION 'LINK_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_link_identity_guard BEFORE UPDATE OR DELETE ON public.partner_manual_job_links FOR EACH ROW EXECUTE FUNCTION public.partner_link_identity_guard();

CREATE FUNCTION public.partner_link_job_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.partner_manual_job_links l WHERE l.company_id=OLD.company_id AND l.job_id=OLD.id
    AND (NEW.legacy_job_id IS DISTINCT FROM l.legacy_job_id OR NEW.legacy_job_number IS DISTINCT FROM l.legacy_job_number OR NEW.submission_state<>'SUBMITTED' OR NEW.deleted_at IS NOT NULL))
  THEN RAISE EXCEPTION 'LINK_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partner_link_job_guard BEFORE UPDATE ON public.partner_jobs FOR EACH ROW EXECUTE FUNCTION public.partner_link_job_guard();

-- Private bridge: only the authorised ops definer may invoke it. Match worker
-- lock order (outbox -> company -> job). Never hold locks across HTTP requests.
CREATE FUNCTION public.partner_link_commit(actor text,target_company uuid,target_job uuid,target_revision integer,target_legacy text,target_number bigint,target_status jsonb,target_checked timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.partner_jobs%ROWTYPE;
BEGIN
  IF target_legacy !~ '^[a-f0-9]{24}$' OR target_number<=0 OR public.partner_link_status_valid(target_status) IS NOT TRUE
    OR target_checked IS NULL OR target_checked<now()-interval '2 minutes' OR target_checked>now()+interval '10 seconds'
    THEN RAISE EXCEPTION 'LINK_INVALID'; END IF;
  PERFORM 1 FROM public.partner_outbox_events WHERE company_id=target_company AND job_id=target_job ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.partner_companies WHERE id=target_company AND is_active=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LINK_NOT_FOUND'; END IF;
  SELECT * INTO job FROM public.partner_jobs WHERE company_id=target_company AND id=target_job AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LINK_NOT_FOUND'; END IF;
  IF EXISTS(SELECT 1 FROM public.partner_manual_job_links WHERE company_id=target_company AND job_id=target_job AND legacy_job_id=target_legacy) THEN RETURN false; END IF;
  IF job.revision IS DISTINCT FROM target_revision THEN RAISE EXCEPTION 'LINK_STALE'; END IF;
  IF job.submission_state NOT IN('FAILED_RETRYABLE','RECONCILIATION_REQUIRED','SUBMITTED')
    OR (job.legacy_job_id IS NOT NULL AND lower(job.legacy_job_id)<>target_legacy)
    OR (job.legacy_job_number IS NOT NULL AND job.legacy_job_number<>target_number)
    OR EXISTS(SELECT 1 FROM public.partner_submission_attempts WHERE company_id=target_company AND job_id=target_job AND outcome='IN_PROGRESS')
    OR EXISTS(SELECT 1 FROM public.partner_outbox_events WHERE company_id=target_company AND job_id=target_job AND state='PROCESSING' AND lease_expires_at>=now())
    -- An unknown create may still have reached InsulHub: no silent adoption.
    OR (job.legacy_job_id IS NULL AND (job.submission_checkpoint NOT IN('NONE','FROZEN','RECONCILIATION')
      OR EXISTS(SELECT 1 FROM public.partner_audit_events WHERE company_id=target_company AND job_id=target_job AND event_type='SUBMISSION_PHASE_CHECKPOINTED' AND metadata->>'phase'='CREATE_STARTED')))
    THEN RAISE EXCEPTION 'LINK_CONFLICT'; END IF;
  UPDATE public.partner_outbox_events SET state='DEAD',lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
    fence_token=fence_token+1,last_error_code='AMBIGUOUS_LEGACY_RESULT',updated_at=now()
    WHERE company_id=target_company AND job_id=target_job AND state<>'DELIVERED';
  -- Historical automatic-transfer failures are NOT rewritten as successes.
  UPDATE public.partner_jobs SET legacy_job_id=target_legacy,legacy_job_number=target_number,submission_state='SUBMITTED',
    submission_started_at=COALESCE(submission_started_at,now()),submitted_at=COALESCE(submitted_at,now()),updated_at=now()
    WHERE company_id=target_company AND id=target_job;
  INSERT INTO public.partner_manual_job_links(company_id,job_id,legacy_job_id,legacy_job_number,linked_by,
    eba_completed,install_date,job_completed,invoice_recorded,checked_at)
  VALUES(target_company,target_job,target_legacy,target_number,actor,(target_status->>'ebaCompleted')::boolean,
    (target_status->>'installDate')::date,(target_status->>'jobCompleted')::boolean,(target_status->>'invoiceRecorded')::boolean,target_checked);
  RETURN true;
END $$;

CREATE FUNCTION public.partner_ops_job_links(actor text,target_company uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  PERFORM public.partner_ops_authorize(actor,'ADMIN');
  IF NOT EXISTS(SELECT 1 FROM public.partner_companies WHERE id=target_company AND is_active=true) THEN RAISE EXCEPTION 'LINK_NOT_FOUND'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',j.id,'revision',j.revision,'clientReference',j.client_reference,
    'customerName',j.customer_name,'siteAddress',j.site_address,'submissionState',j.submission_state,'legacyId',j.legacy_job_id,
    'linkedJobNumber',l.legacy_job_number,'linkedStatus',CASE WHEN l.job_id IS NULL THEN NULL ELSE jsonb_build_object(
      'ebaCompleted',l.eba_completed,'installDate',l.install_date,'jobCompleted',l.job_completed,'invoiceRecorded',l.invoice_recorded,'checkedAt',l.checked_at) END) ORDER BY j.updated_at DESC,j.id)
    FROM public.partner_jobs j LEFT JOIN public.partner_manual_job_links l ON(l.company_id,l.job_id)=(j.company_id,j.id)
    WHERE j.company_id=target_company AND j.deleted_at IS NULL AND j.submission_state<>'DRAFT'),'[]'::jsonb);
END $$;
CREATE FUNCTION public.partner_ops_job_link(actor text,target_company uuid,target_job uuid,target_revision integer,target_legacy text,target_number bigint,target_status jsonb,target_checked timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  PERFORM public.partner_ops_authorize(actor,'ADMIN');
  RETURN public.partner_link_commit(actor,target_company,target_job,target_revision,target_legacy,target_number,target_status,target_checked);
END $$;
CREATE FUNCTION public.partner_ops_link_lookup(actor text,target_legacy text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  PERFORM public.partner_ops_authorize(actor,'ADMIN');
  RETURN (SELECT jsonb_build_object('companyId',l.company_id,'jobId',l.job_id) FROM public.partner_manual_job_links l
    JOIN public.partner_companies c ON c.id=l.company_id AND c.is_active=true WHERE l.legacy_job_id=target_legacy);
END $$;
CREATE FUNCTION public.partner_ops_job_status(actor text,target_legacy text,target_status jsonb,target_checked timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  PERFORM public.partner_ops_authorize(actor,'ADMIN');
  IF public.partner_link_status_valid(target_status) IS NOT TRUE OR target_checked IS NULL
    OR target_checked<now()-interval '2 minutes' OR target_checked>now()+interval '10 seconds' THEN RAISE EXCEPTION 'LINK_INVALID'; END IF;
  UPDATE public.partner_manual_job_links l SET eba_completed=(target_status->>'ebaCompleted')::boolean,
    install_date=(target_status->>'installDate')::date,job_completed=(target_status->>'jobCompleted')::boolean,
    invoice_recorded=(target_status->>'invoiceRecorded')::boolean,checked_at=target_checked
    WHERE l.legacy_job_id=target_legacy AND l.checked_at<target_checked
      AND EXISTS(SELECT 1 FROM public.partner_companies c WHERE c.id=l.company_id AND c.is_active=true);
  RETURN FOUND;
END $$;

ALTER FUNCTION public.partner_link_commit(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz) OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_link_job_guard() OWNER TO partner_submission_owner;
ALTER FUNCTION public.partner_ops_job_links(text,uuid) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_job_link(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_link_lookup(text,text) OWNER TO partner_ops_owner;
ALTER FUNCTION public.partner_ops_job_status(text,text,jsonb,timestamptz) OWNER TO partner_ops_owner;
REVOKE ALL ON FUNCTION public.partner_link_commit(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz),public.partner_link_job_guard(),
  public.partner_ops_job_links(text,uuid),public.partner_ops_job_link(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz),
  public.partner_ops_link_lookup(text,text),public.partner_ops_job_status(text,text,jsonb,timestamptz) FROM PUBLIC,partner_portal_runtime,partner_submission_worker,partner_ops_runtime;
GRANT EXECUTE ON FUNCTION public.partner_link_commit(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz) TO partner_ops_owner;
GRANT EXECUTE ON FUNCTION public.partner_ops_job_links(text,uuid),public.partner_ops_job_link(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz),
  public.partner_ops_link_lookup(text,text),public.partner_ops_job_status(text,text,jsonb,timestamptz) TO partner_ops_runtime;
REVOKE CREATE ON SCHEMA public FROM partner_ops_owner,partner_submission_owner;
COMMIT;
