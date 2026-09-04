BEGIN;

REVOKE ALL ON FUNCTION public.partner_lock_site_plan_company(uuid) FROM partner_portal_runtime;
DROP FUNCTION public.partner_lock_site_plan_company(uuid);

COMMIT;
