CREATE TABLE IF NOT EXISTS job_installation_splits (
  insulhub_job_id text PRIMARY KEY,
  version integer NOT NULL CHECK (version > 0),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS job_installation_split_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  insulhub_job_id text NOT NULL REFERENCES job_installation_splits(insulhub_job_id),
  version integer NOT NULL,
  actor_id text NOT NULL,
  action jsonb NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(insulhub_job_id, version)
);
