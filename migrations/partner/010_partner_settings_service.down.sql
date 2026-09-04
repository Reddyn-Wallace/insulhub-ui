BEGIN;
-- Preserve audit references rather than deleting the actor or its history.
UPDATE partner_users SET disabled_at=now() WHERE id='insulhub-settings-service';
DELETE FROM partner_sessions WHERE user_id='insulhub-settings-service';
COMMIT;
