BEGIN;
CREATE TABLE IF NOT EXISTS dead_quote_followup_controls (
  insulhub_job_id text PRIMARY KEY,
  revision integer NOT NULL CHECK (revision >= 0),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  actor_name text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dead_quote_followup_events (
  insulhub_job_id text NOT NULL REFERENCES dead_quote_followup_controls(insulhub_job_id),
  revision integer NOT NULL CHECK (revision > 0),
  action text NOT NULL CHECK (action IN ('discount','snooze','unsnooze','exclude','restore','review','record_offer','remove_latest_offer')),
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  reason text NOT NULL DEFAULT '',
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  quote_version text NOT NULL,
  quote_total numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (insulhub_job_id,revision)
);
CREATE OR REPLACE FUNCTION dead_quote_followup_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Follow-up audit history is immutable'; END;
$$;
DROP TRIGGER IF EXISTS dead_quote_followup_events_immutable ON dead_quote_followup_events;
CREATE TRIGGER dead_quote_followup_events_immutable BEFORE UPDATE OR DELETE ON dead_quote_followup_events
FOR EACH ROW EXECUTE FUNCTION dead_quote_followup_event_immutable();
COMMIT;
