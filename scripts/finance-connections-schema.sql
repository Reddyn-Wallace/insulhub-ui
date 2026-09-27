-- Deliberate provisioning only: do not run DDL from request handlers.
BEGIN;
CREATE TABLE IF NOT EXISTS finance_oauth_states (
 state_hash text PRIMARY KEY, owner_id text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_oauth_states_expiry ON finance_oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS finance_connections (
 owner_id text PRIMARY KEY, tokens text NOT NULL, tenant_id text, tenant_name text,
 generation uuid NOT NULL DEFAULT gen_random_uuid(),
 refresh_pending boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE finance_connections ADD COLUMN IF NOT EXISTS generation uuid NOT NULL DEFAULT gen_random_uuid();
REVOKE ALL ON finance_oauth_states,finance_connections FROM PUBLIC;
COMMIT;
