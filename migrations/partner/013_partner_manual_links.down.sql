BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.partner_manual_job_links) THEN RAISE EXCEPTION 'Manual link rollback refused: preserve existing links and provenance'; END IF;
END $$;
DROP FUNCTION public.partner_ops_job_status(text,text,jsonb,timestamptz);
DROP FUNCTION public.partner_ops_link_lookup(text,text);
DROP FUNCTION public.partner_ops_job_link(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz);
DROP FUNCTION public.partner_ops_job_links(text,uuid);
DROP FUNCTION public.partner_link_commit(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz);
DROP TRIGGER partner_link_job_guard ON public.partner_jobs;
DROP FUNCTION public.partner_link_job_guard();
DROP TRIGGER partner_link_identity_guard ON public.partner_manual_job_links;
DROP FUNCTION public.partner_link_identity_guard();
DROP FUNCTION public.partner_link_status_valid(jsonb);
DROP TABLE public.partner_manual_job_links;
DROP INDEX public.partner_jobs_global_legacy_identity;
COMMIT;
