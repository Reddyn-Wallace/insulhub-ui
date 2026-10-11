BEGIN;
CREATE TABLE IF NOT EXISTS dead_quote_followup_templates (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 revision integer NOT NULL CHECK(revision>0),
 templates jsonb NOT NULL CHECK(jsonb_typeof(templates)='array'),
 actor_name text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dead_quote_followup_template_events (
 revision integer PRIMARY KEY,
 templates jsonb NOT NULL,
 actor_id text NOT NULL,
 actor_name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION dead_quote_template_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Template audit history is immutable'; END;
$$;
DROP TRIGGER IF EXISTS dead_quote_template_event_immutable ON dead_quote_followup_template_events;
CREATE TRIGGER dead_quote_template_event_immutable BEFORE UPDATE OR DELETE ON dead_quote_followup_template_events FOR EACH ROW EXECUTE FUNCTION dead_quote_template_event_immutable();
COMMIT;
