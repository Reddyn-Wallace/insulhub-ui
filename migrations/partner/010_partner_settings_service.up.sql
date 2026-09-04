BEGIN;
-- Fail closed rather than adopting an existing login or a mismatched identity.
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.partner_users WHERE id='insulhub-settings-service'
    AND (email IS DISTINCT FROM 'insulhub-settings-service@internal.invalid'
      OR principal_type IS DISTINCT FROM 'INTERNAL' OR company_id IS NOT NULL OR ops_role IS DISTINCT FROM 'ADMIN'))
    OR EXISTS(SELECT 1 FROM public.partner_accounts WHERE user_id='insulhub-settings-service')
    OR EXISTS(SELECT 1 FROM public.partner_sessions WHERE user_id='insulhub-settings-service')
  THEN RAISE EXCEPTION 'Reserved settings service identity collision'; END IF;
END $$;
-- Non-login audit actor for the management-only, InsulHub-token gateway.
-- No partner_accounts or partner_sessions are created for this actor.
INSERT INTO partner_users(id,company_id,principal_type,name,email,ops_role)
VALUES('insulhub-settings-service',NULL,'INTERNAL','InsulHub Settings service','insulhub-settings-service@internal.invalid','ADMIN')
ON CONFLICT(id) DO UPDATE SET disabled_at=NULL
WHERE partner_users.email='insulhub-settings-service@internal.invalid'
  AND partner_users.principal_type='INTERNAL' AND partner_users.company_id IS NULL
  AND partner_users.ops_role='ADMIN';
COMMIT;
