BEGIN;

DROP INDEX IF EXISTS partner_jobs_company_customer_search_idx;

ALTER TABLE partner_jobs
  DROP CONSTRAINT IF EXISTS partner_jobs_lead_sources_size,
  DROP CONSTRAINT IF EXISTS partner_jobs_lead_sources_array,
  DROP CONSTRAINT IF EXISTS partner_jobs_site_address_size,
  DROP CONSTRAINT IF EXISTS partner_jobs_site_address_object,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS lead_sources,
  DROP COLUMN IF EXISTS customer_email,
  DROP COLUMN IF EXISTS customer_mobile;

COMMIT;
