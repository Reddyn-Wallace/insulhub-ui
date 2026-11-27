ALTER TABLE campaign_recipients
  ADD COLUMN IF NOT EXISTS open_tracking_token uuid,
  ADD COLUMN IF NOT EXISTS likely_open_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_likely_open_at timestamptz,
  ADD COLUMN IF NOT EXISTS ambiguous_open_seen boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS campaign_recipients_open_tracking_token_idx
  ON campaign_recipients (open_tracking_token)
  WHERE open_tracking_token IS NOT NULL;
