BEGIN;

CREATE OR REPLACE FUNCTION partner_quote_extras_valid(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(value) = 'array'
    AND jsonb_array_length(value) <= 50
    AND pg_column_size(value) <= 7000
    AND (SELECT count(DISTINCT item->>'id') FROM jsonb_array_elements(value) AS item) = jsonb_array_length(value)
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(value) AS item
      WHERE jsonb_typeof(item) <> 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 3
        OR NOT (item ?& ARRAY['id', 'name', 'priceCents'])
        OR jsonb_typeof(item->'id') <> 'string'
        OR length(item->>'id') NOT BETWEEN 1 AND 80
        OR jsonb_typeof(item->'name') <> 'string'
        OR btrim(item->>'name') = ''
        OR length(item->>'name') > 120
        OR jsonb_typeof(item->'priceCents') <> 'number'
        OR NOT CASE WHEN item->>'priceCents' ~ '^\d+$'
          THEN (item->>'priceCents')::numeric BETWEEN 0 AND 1000000000
          ELSE false END
    );
$$;

ALTER TABLE partner_companies
  ADD COLUMN quote_default_wall_rate_cents integer,
  ADD COLUMN quote_default_ceiling_rate_cents integer,
  ADD COLUMN quote_default_deposit_basis_points integer NOT NULL DEFAULT 2500,
  ADD COLUMN quote_default_consent_fee_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN quote_default_extras jsonb NOT NULL DEFAULT '[{"id":"council-fee","name":"Council Fee","priceCents":33000}]'::jsonb,
  ADD COLUMN quote_defaults_revision integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT partner_company_wall_rate_positive CHECK (quote_default_wall_rate_cents IS NULL OR quote_default_wall_rate_cents BETWEEN 1 AND 10000000),
  ADD CONSTRAINT partner_company_ceiling_rate_positive CHECK (quote_default_ceiling_rate_cents IS NULL OR quote_default_ceiling_rate_cents BETWEEN 1 AND 10000000),
  ADD CONSTRAINT partner_company_deposit_range CHECK (quote_default_deposit_basis_points BETWEEN 0 AND 10000),
  ADD CONSTRAINT partner_company_consent_nonnegative CHECK (quote_default_consent_fee_cents BETWEEN 0 AND 1000000000),
  ADD CONSTRAINT partner_company_quote_revision_nonnegative CHECK (quote_defaults_revision >= 0),
  ADD CONSTRAINT partner_company_quote_extras_array CHECK (jsonb_typeof(quote_default_extras) = 'array'),
  ADD CONSTRAINT partner_company_quote_extras_size CHECK (partner_quote_extras_valid(quote_default_extras));

ALTER TABLE partner_jobs
  ADD COLUMN quote_data jsonb,
  ADD COLUMN quote_initialized_at timestamptz,
  ADD COLUMN quote_defaults_revision integer,
  ADD COLUMN quote_defaults_snapshot jsonb,
  ADD CONSTRAINT partner_jobs_quote_data_object CHECK (quote_data IS NULL OR jsonb_typeof(quote_data) = 'object'),
  ADD CONSTRAINT partner_jobs_quote_data_size CHECK (quote_data IS NULL OR pg_column_size(quote_data) <= 32768),
  ADD CONSTRAINT partner_jobs_quote_snapshot_object CHECK (quote_defaults_snapshot IS NULL OR jsonb_typeof(quote_defaults_snapshot) = 'object'),
  ADD CONSTRAINT partner_jobs_quote_snapshot_size CHECK (quote_defaults_snapshot IS NULL OR pg_column_size(quote_defaults_snapshot) <= 8192),
  ADD CONSTRAINT partner_jobs_quote_defaults_revision_nonnegative CHECK (quote_defaults_revision IS NULL OR quote_defaults_revision >= 0),
  ADD CONSTRAINT partner_jobs_quote_initialization_complete CHECK (
    (quote_data IS NULL AND quote_initialized_at IS NULL AND quote_defaults_revision IS NULL AND quote_defaults_snapshot IS NULL)
    OR
    (quote_data IS NOT NULL AND quote_initialized_at IS NOT NULL AND quote_defaults_revision IS NOT NULL AND quote_defaults_snapshot IS NOT NULL)
  );

CREATE INDEX partner_jobs_company_quote_initialized_idx
  ON partner_jobs (company_id, quote_initialized_at)
  WHERE quote_data IS NOT NULL;

COMMIT;
