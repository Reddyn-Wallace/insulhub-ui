BEGIN;
ALTER TABLE public.partner_jobs
  ADD COLUMN draft_create_key_hash text,
  ADD COLUMN draft_create_payload_hash text,
  ADD CONSTRAINT partner_draft_create_binding CHECK (
    (draft_create_key_hash IS NULL AND draft_create_payload_hash IS NULL) OR
    (length(draft_create_key_hash)=64 AND length(draft_create_payload_hash)=64
      AND draft_create_key_hash IS NOT NULL AND draft_create_payload_hash IS NOT NULL)
  ),
  ADD CONSTRAINT partner_draft_create_unique UNIQUE(company_id,draft_create_key_hash);
-- Creation bindings cannot be changed using the runtime's column-level UPDATE grant.
GRANT INSERT(draft_create_key_hash,draft_create_payload_hash) ON public.partner_jobs TO partner_portal_runtime;
GRANT SELECT(draft_create_key_hash,draft_create_payload_hash) ON public.partner_jobs TO partner_portal_runtime;
COMMIT;
