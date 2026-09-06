CREATE TABLE IF NOT EXISTS job_sms_messages (
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
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 1600),
  template_title text NOT NULL DEFAULT '',
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('sending','accepted','sent','delivered','failed','unknown')),
  provider_message_id text NOT NULL,
  failure_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_sms_messages_job_created_idx ON job_sms_messages(insulhub_job_id, created_at DESC);

-- Retain the original connection reference and snapshots when a sender is removed.
ALTER TABLE job_sms_messages DROP CONSTRAINT IF EXISTS job_sms_messages_sender_id_fkey;
