BEGIN;

-- Notification functions execute as this non-login owner. Grant only the
-- single read capability they need; the worker login retains no table access.
GRANT SELECT ON TABLE public.partner_notification_settings TO partner_submission_owner;

COMMIT;
