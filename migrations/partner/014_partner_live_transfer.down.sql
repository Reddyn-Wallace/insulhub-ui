BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.partner_legacy_create_dispatches)
    OR EXISTS(SELECT 1 FROM public.partner_companies WHERE submission_contract_version='insulhub-one-shot-v1')
  THEN RAISE EXCEPTION 'Live transfer rollback refused: preserve connection and dispatch evidence'; END IF;
END $$;
DROP TRIGGER IF EXISTS partner_live_finalized_link ON public.partner_jobs;
DROP FUNCTION IF EXISTS public.partner_live_finalized_link();
DROP FUNCTION IF EXISTS public.partner_ops_job_link_investigated(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz);
DROP FUNCTION IF EXISTS public.partner_link_commit_investigated(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz);
DROP FUNCTION IF EXISTS public.partner_ops_job_link_investigation_required(text,uuid,uuid);
DROP FUNCTION public.partner_ops_legacy_connection_set(text,uuid,integer,text,bytea,bytea,integer,text,text);
DROP FUNCTION public.partner_ops_legacy_connection_status(text,uuid);
DROP FUNCTION public.partner_legacy_create_receipt(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.partner_live_test_status(uuid);
DROP FUNCTION IF EXISTS public.partner_claim_live_test_request(uuid,text,integer);
DROP FUNCTION IF EXISTS public.partner_live_test_queue_guard(uuid);
DROP FUNCTION public.partner_record_legacy_create_result(uuid,uuid,uuid,uuid,text,bigint);
DROP FUNCTION public.partner_begin_legacy_create_dispatch(uuid,uuid,uuid,uuid,bigint);
DROP TABLE IF EXISTS public.partner_live_manual_resolutions;
SET LOCAL ROLE partner_submission_owner;
DROP TABLE public.partner_legacy_create_dispatches;
RESET ROLE;
REVOKE SELECT ON public.partner_submission_requests,public.partner_submission_snapshots FROM partner_ops_owner;
REVOKE SELECT ON public.partner_outbox_events,public.partner_submission_attempts FROM partner_ops_owner;
CREATE OR REPLACE FUNCTION public.partner_link_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF TG_OP='DELETE' OR (OLD.company_id,OLD.job_id,OLD.legacy_job_id,OLD.legacy_job_number,OLD.linked_by,OLD.linked_at)
    IS DISTINCT FROM (NEW.company_id,NEW.job_id,NEW.legacy_job_id,NEW.legacy_job_number,NEW.linked_by,NEW.linked_at)
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
    'linkedJobNumber',l.legacy_job_number,'linkedStatus',CASE WHEN l.job_id IS NULL THEN NULL ELSE jsonb_build_object(
      'ebaCompleted',l.eba_completed,'installDate',l.install_date,'jobCompleted',l.job_completed,'invoiceRecorded',l.invoice_recorded,'checkedAt',l.checked_at) END) ORDER BY j.updated_at DESC,j.id)
    FROM public.partner_jobs j LEFT JOIN public.partner_manual_job_links l ON(l.company_id,l.job_id)=(j.company_id,j.id)
    WHERE j.company_id=target_company AND j.deleted_at IS NULL AND j.submission_state<>'DRAFT'),'[]'::jsonb);
END $$;
CREATE OR REPLACE FUNCTION public.partner_ops_job_link(actor text,target_company uuid,target_job uuid,target_revision integer,target_legacy text,target_number bigint,target_status jsonb,target_checked timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
  PERFORM public.partner_ops_authorize(actor,'ADMIN');
  RETURN public.partner_link_commit(actor,target_company,target_job,target_revision,target_legacy,target_number,target_status,target_checked);
END $$;
RESET ROLE;
ALTER TABLE public.partner_manual_job_links DROP COLUMN IF EXISTS link_method;
COMMIT;
