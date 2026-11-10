CREATE TABLE IF NOT EXISTS gm_report_settings (
 id integer PRIMARY KEY CHECK (id=1), revision integer NOT NULL CHECK(revision>0),
 payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), actor_id text NOT NULL
);
CREATE TABLE IF NOT EXISTS gm_reports (
 week date PRIMARY KEY CHECK(extract(isodow from week)=1), revision integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','finalised')),
 commentary jsonb NOT NULL DEFAULT '{"profit":"","upcoming":"","pipeline":""}', snapshot jsonb,
 refresh_token uuid, refresh_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 finalised_at timestamptz, actor_id text NOT NULL,
 CHECK(status<>'finalised' OR (snapshot IS NOT NULL AND finalised_at IS NOT NULL AND refresh_token IS NULL))
);
CREATE TABLE IF NOT EXISTS gm_report_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, week date NOT NULL REFERENCES gm_reports(week),
 revision integer NOT NULL, action text NOT NULL, actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
-- Defence in depth: even a future endpoint must not mutate locked history.
CREATE OR REPLACE FUNCTION gm_report_prevent_finalised_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='finalised' THEN RAISE EXCEPTION 'Finalised GM reports are immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS gm_report_finalised_lock ON gm_reports;
CREATE TRIGGER gm_report_finalised_lock BEFORE UPDATE OR DELETE ON gm_reports
FOR EACH ROW EXECUTE FUNCTION gm_report_prevent_finalised_change();

-- Private acceptance-date cache: older reports use different lookup timestamps.
CREATE TABLE IF NOT EXISTS gm_report_accepted_dates (
 insulhub_job_id text PRIMARY KEY, accepted_at timestamptz,
 accepted_at_missing boolean NOT NULL DEFAULT false,
 last_checked_at timestamptz NOT NULL, last_error text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now()
);
