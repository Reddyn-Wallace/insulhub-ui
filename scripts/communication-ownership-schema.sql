-- Owner IDs reference canonical Insulhub users; no duplicate user table.
ALTER TABLE communication_senders ADD COLUMN IF NOT EXISTS owner_user_id text;
CREATE INDEX IF NOT EXISTS communication_senders_owner_channel_idx
  ON communication_senders(owner_user_id, channel, is_active, is_default DESC);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS send_authorized_user_id text;
CREATE TABLE IF NOT EXISTS communication_oauth_states (
  state_hash text PRIMARY KEY,
  sender_id uuid NOT NULL REFERENCES communication_senders(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS communication_oauth_states_expiry_idx ON communication_oauth_states(expires_at);
