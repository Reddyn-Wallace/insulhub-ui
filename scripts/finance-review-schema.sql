BEGIN;
CREATE TABLE IF NOT EXISTS finance_review_decisions (
 owner_id text NOT NULL, decision_key text NOT NULL, revision integer NOT NULL,
 fingerprint text NOT NULL, value jsonb, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,decision_key)
);
CREATE TABLE IF NOT EXISTS finance_review_events (
 id bigserial PRIMARY KEY, owner_id text NOT NULL, decision_key text NOT NULL,
 revision integer NOT NULL, fingerprint text NOT NULL, value jsonb,
 recorded_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,decision_key,revision)
);
REVOKE ALL ON finance_review_decisions,finance_review_events FROM PUBLIC;
COMMIT;
