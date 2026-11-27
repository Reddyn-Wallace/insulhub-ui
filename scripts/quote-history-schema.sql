BEGIN;
CREATE TABLE IF NOT EXISTS crm_quote_history_state (
  job_id text PRIMARY KEY,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  quote_fields jsonb,
  pending_at timestamptz,
  last_send_hash text
);
CREATE TABLE IF NOT EXISTS crm_quote_history_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id text NOT NULL REFERENCES crm_quote_history_state(job_id),
  revision integer NOT NULL CHECK (revision >= 0),
  kind text NOT NULL CHECK (kind IN ('baseline','edit','status','accepted','send','pdf','files','external','recovered','unconfirmed')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id text,
  actor_name text,
  total numeric(16,2),
  changes jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS crm_quote_history_events_job_id ON crm_quote_history_events(job_id, id DESC);
CREATE INDEX IF NOT EXISTS crm_quote_history_events_last_send ON crm_quote_history_events(job_id, id DESC) WHERE kind = 'send';
COMMIT;
