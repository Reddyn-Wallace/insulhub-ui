BEGIN;

ALTER TABLE partner_jobs
  ADD COLUMN customer_mobile varchar(40) NOT NULL DEFAULT '',
  ADD COLUMN customer_email varchar(254) NOT NULL DEFAULT '',
  ADD COLUMN lead_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN notes varchar(4000) NOT NULL DEFAULT '',
  ADD CONSTRAINT partner_jobs_site_address_object CHECK (jsonb_typeof(site_address) = 'object'),
  ADD CONSTRAINT partner_jobs_site_address_size CHECK (pg_column_size(site_address) <= 4096),
  ADD CONSTRAINT partner_jobs_lead_sources_array CHECK (jsonb_typeof(lead_sources) = 'array'),
  ADD CONSTRAINT partner_jobs_lead_sources_size CHECK (pg_column_size(lead_sources) <= 2048);

CREATE INDEX partner_jobs_company_customer_search_idx
  ON partner_jobs (company_id, lower(customer_name), updated_at DESC);

COMMIT;
