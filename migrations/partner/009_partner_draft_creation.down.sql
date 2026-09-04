BEGIN;
ALTER TABLE public.partner_jobs
  DROP CONSTRAINT partner_draft_create_unique,
  DROP CONSTRAINT partner_draft_create_binding,
  DROP COLUMN draft_create_key_hash,
  DROP COLUMN draft_create_payload_hash;
COMMIT;
