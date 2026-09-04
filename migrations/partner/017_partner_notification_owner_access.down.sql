BEGIN;

REVOKE SELECT ON TABLE public.partner_notification_settings FROM partner_submission_owner;

COMMIT;
