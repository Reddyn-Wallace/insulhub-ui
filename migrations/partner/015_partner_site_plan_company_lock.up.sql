BEGIN;

CREATE OR REPLACE FUNCTION public.partner_lock_site_plan_company(target_company uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
BEGIN
  PERFORM id
  FROM public.partner_companies
  WHERE id=target_company AND is_active=true
  FOR UPDATE;
  RETURN FOUND;
END;
$$;

ALTER FUNCTION public.partner_lock_site_plan_company(uuid) OWNER TO partner_artifact_owner;
REVOKE ALL ON FUNCTION public.partner_lock_site_plan_company(uuid)
  FROM PUBLIC,partner_portal_runtime,partner_submission_worker,partner_ops_runtime;
GRANT EXECUTE ON FUNCTION public.partner_lock_site_plan_company(uuid) TO partner_portal_runtime;

COMMIT;
