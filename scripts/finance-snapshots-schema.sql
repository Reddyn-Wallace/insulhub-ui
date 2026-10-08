-- Short-lived, owner-scoped encrypted source snapshots for serverless instances.
CREATE TABLE IF NOT EXISTS finance_snapshots (
  owner_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('overview', 'bank')),
  version text NOT NULL,
  payload text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, mode)
);
