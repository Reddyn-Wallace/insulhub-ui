BEGIN;
ALTER TABLE dead_quote_followup_events DROP CONSTRAINT IF EXISTS dead_quote_followup_events_action_check;
ALTER TABLE dead_quote_followup_events ADD CONSTRAINT dead_quote_followup_events_action_check CHECK(action IN ('discount','snooze','unsnooze','exclude','restore','review','record_offer','remove_latest_offer','send_confirm'));
CREATE TABLE IF NOT EXISTS dead_quote_followup_attempts (
 id uuid PRIMARY KEY,
 request_id uuid NOT NULL UNIQUE,
 insulhub_job_id text NOT NULL REFERENCES dead_quote_followup_controls(insulhub_job_id),
 approach integer NOT NULL CHECK(approach IN (1,2)),
 snapshot jsonb NOT NULL,
 actor_id text NOT NULL,
 actor_name text NOT NULL,
 status text NOT NULL DEFAULT 'sending' CHECK(status IN ('sending','accepted','unknown','failed','sent')),
 sent_at timestamptz,
 note_status text NOT NULL DEFAULT 'pending' CHECK(note_status IN ('pending','saved')),
 failure_reason text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dead_quote_followup_one_active_approach ON dead_quote_followup_attempts(insulhub_job_id,approach) WHERE status<>'failed';
CREATE OR REPLACE FUNCTION dead_quote_followup_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id<>OLD.id OR NEW.request_id<>OLD.request_id OR NEW.insulhub_job_id<>OLD.insulhub_job_id OR NEW.approach<>OLD.approach OR NEW.snapshot<>OLD.snapshot OR NEW.actor_id<>OLD.actor_id OR NEW.actor_name<>OLD.actor_name OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Send snapshot is immutable'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS dead_quote_followup_snapshot_immutable ON dead_quote_followup_attempts;
CREATE TRIGGER dead_quote_followup_snapshot_immutable BEFORE UPDATE ON dead_quote_followup_attempts FOR EACH ROW EXECUTE FUNCTION dead_quote_followup_snapshot_immutable();
COMMIT;
