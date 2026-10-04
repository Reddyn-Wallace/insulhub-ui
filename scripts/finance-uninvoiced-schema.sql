-- Durable discovery only; amounts and completion are always recalculated from sources.
CREATE TABLE IF NOT EXISTS finance_uninvoiced_jobs (
  owner_id text NOT NULL,
  job_id text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, job_id)
);
