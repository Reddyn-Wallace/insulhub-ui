BEGIN;
CREATE TABLE IF NOT EXISTS dead_quote_dates (
 insulhub_job_id text PRIMARY KEY,
 entry jsonb,
 pending jsonb,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dead_quote_date_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 insulhub_job_id text NOT NULL REFERENCES dead_quote_dates(insulhub_job_id),
 kind text NOT NULL CHECK(kind IN ('assumed','entered','left','recovered')),
 entry jsonb,
 actor_id text NOT NULL,
 actor_name text NOT NULL,
 before_version text,
 after_version text,
 observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dead_quote_date_events_job ON dead_quote_date_events(insulhub_job_id,id);
DROP TRIGGER IF EXISTS dead_quote_date_events_immutable ON dead_quote_date_events;
CREATE TRIGGER dead_quote_date_events_immutable BEFORE UPDATE OR DELETE ON dead_quote_date_events
FOR EACH ROW EXECUTE FUNCTION dead_quote_followup_event_immutable();
COMMIT;
