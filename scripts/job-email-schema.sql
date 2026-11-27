CREATE TABLE IF NOT EXISTS job_email_messages (
  id uuid PRIMARY KEY,
  insulhub_job_id text NOT NULL,
  job_number integer,
  sender_id uuid NOT NULL,
  sender_label text NOT NULL,
  sender_value text NOT NULL,
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  destination text NOT NULL,
  contact_name text NOT NULL DEFAULT '',
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  rendered_body text NOT NULL,
  rendered_html text NOT NULL,
  template_title text NOT NULL DEFAULT '',
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('sending','sent','failed','unknown')),
  rfc_message_id text NOT NULL UNIQUE,
  provider_message_id text NOT NULL DEFAULT '',
  provider_thread_id text NOT NULL DEFAULT '',
  failure_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Sender references intentionally survive account removal; snapshots preserve the record.
CREATE INDEX IF NOT EXISTS job_email_messages_job_created_idx ON job_email_messages(insulhub_job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS job_email_messages_thread_idx ON job_email_messages(sender_id, provider_thread_id) WHERE provider_thread_id <> '';

ALTER TABLE job_email_messages
  ADD COLUMN IF NOT EXISTS open_tracking_token uuid,
  ADD COLUMN IF NOT EXISTS likely_open_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_likely_open_at timestamptz,
  ADD COLUMN IF NOT EXISTS ambiguous_open_seen boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS job_email_messages_open_tracking_token_idx
  ON job_email_messages (open_tracking_token)
  WHERE open_tracking_token IS NOT NULL;
