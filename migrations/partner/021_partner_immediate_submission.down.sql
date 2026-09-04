BEGIN;

DROP FUNCTION IF EXISTS public.partner_claim_submission_notification_exact(uuid,uuid,uuid,text,integer);
DROP FUNCTION IF EXISTS public.partner_claim_submission_exact(uuid,uuid,uuid,text,integer);
DROP FUNCTION IF EXISTS public.partner_submission_request_id(uuid,uuid);

COMMIT;
