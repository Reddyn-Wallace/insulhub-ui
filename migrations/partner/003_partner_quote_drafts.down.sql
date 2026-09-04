BEGIN;

DROP INDEX IF EXISTS partner_jobs_company_quote_initialized_idx;

ALTER TABLE partner_jobs
  DROP CONSTRAINT IF EXISTS partner_jobs_quote_initialization_complete,
  DROP CONSTRAINT IF EXISTS partner_jobs_quote_defaults_revision_nonnegative,
  DROP CONSTRAINT IF EXISTS partner_jobs_quote_snapshot_size,
  DROP CONSTRAINT IF EXISTS partner_jobs_quote_snapshot_object,
  DROP CONSTRAINT IF EXISTS partner_jobs_quote_data_size,
  DROP CONSTRAINT IF EXISTS partner_jobs_quote_data_object,
  DROP COLUMN IF EXISTS quote_defaults_snapshot,
  DROP COLUMN IF EXISTS quote_defaults_revision,
  DROP COLUMN IF EXISTS quote_initialized_at,
  DROP COLUMN IF EXISTS quote_data;

ALTER TABLE partner_companies
  DROP CONSTRAINT IF EXISTS partner_company_quote_extras_size,
  DROP CONSTRAINT IF EXISTS partner_company_quote_extras_array,
  DROP CONSTRAINT IF EXISTS partner_company_quote_revision_nonnegative,
  DROP CONSTRAINT IF EXISTS partner_company_consent_nonnegative,
  DROP CONSTRAINT IF EXISTS partner_company_deposit_range,
  DROP CONSTRAINT IF EXISTS partner_company_ceiling_rate_positive,
  DROP CONSTRAINT IF EXISTS partner_company_wall_rate_positive,
  DROP COLUMN IF EXISTS quote_defaults_revision,
  DROP COLUMN IF EXISTS quote_default_extras,
  DROP COLUMN IF EXISTS quote_default_consent_fee_cents,
  DROP COLUMN IF EXISTS quote_default_deposit_basis_points,
  DROP COLUMN IF EXISTS quote_default_ceiling_rate_cents,
  DROP COLUMN IF EXISTS quote_default_wall_rate_cents;

DROP FUNCTION IF EXISTS partner_quote_extras_valid(jsonb);

COMMIT;
