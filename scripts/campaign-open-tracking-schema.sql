ALTER TABLE campaign_recipients
  ADD COLUMN IF NOT EXISTS open_tracking_token uuid,
  ADD COLUMN IF NOT EXISTS likely_open_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_likely_open_at timestamptz,
  ADD COLUMN IF NOT EXISTS ambiguous_open_seen boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS campaign_recipients_open_tracking_token_idx
  ON campaign_recipients (open_tracking_token)
  WHERE open_tracking_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS campaign_recipient_open_events (
  recipient_id uuid NOT NULL REFERENCES campaign_recipients (id) ON DELETE CASCADE,
  open_tracking_token uuid NOT NULL,
  opened_at timestamptz NOT NULL,
  PRIMARY KEY (recipient_id, open_tracking_token, opened_at)
);

-- Older messages only stored the latest likely open.
INSERT INTO campaign_recipient_open_events (recipient_id, open_tracking_token, opened_at)
SELECT id, open_tracking_token, last_likely_open_at
FROM campaign_recipients
WHERE selected = true AND status IN ('pending', 'sent')
  AND open_tracking_token IS NOT NULL AND likely_open_count > 0 AND last_likely_open_at IS NOT NULL
ON CONFLICT DO NOTHING;
