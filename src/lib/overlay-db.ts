import "server-only";
import { neon } from "@neondatabase/serverless";

type OverlaySql = ReturnType<typeof neon>;
type OverlayRows = Record<string, unknown>[];

let cachedSql: OverlaySql | null = null;
let schemaPromise: Promise<void> | null = null;

function getOverlaySql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for overlay storage");
  }
  cachedSql ||= neon(databaseUrl);
  return cachedSql;
}

export function overlaySql(strings: TemplateStringsArray, ...values: unknown[]): Promise<OverlayRows> {
  return getOverlaySql()(strings, ...values) as Promise<OverlayRows>;
}

export function ensureOverlaySchema() {
  schemaPromise ||= ensureOverlaySchemaInternal().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

async function ensureOverlaySchemaInternal() {
  await overlaySql`
    CREATE TABLE IF NOT EXISTS calendar_placeholders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      starts_at timestamptz NOT NULL,
      ends_at timestamptz,
      title text NOT NULL,
      status text NOT NULL DEFAULT 'pencilled',
      scope text NOT NULL DEFAULT '',
      estimated_sqm numeric,
      estimated_value numeric,
      note text,
      linked_job_id text,
      resolved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT calendar_placeholders_status_check
        CHECK (status IN ('pencilled', 'confirmed')),
      CONSTRAINT calendar_placeholders_scope_check
        CHECK (scope IN ('', 'internal', 'external', 'both'))
    )
  `;

  await overlaySql`
    CREATE INDEX IF NOT EXISTS calendar_placeholders_starts_at_idx
      ON calendar_placeholders (starts_at)
  `;

  await overlaySql`
    CREATE TABLE IF NOT EXISTS job_install_planning (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      insulhub_job_id text NOT NULL UNIQUE,
      status text NOT NULL DEFAULT 'confirmed',
      install_scope text NOT NULL DEFAULT '',
      planning_note text NOT NULL DEFAULT '',
      council_approval_na boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT job_install_planning_status_check
        CHECK (status IN ('pencilled', 'confirmed')),
      CONSTRAINT job_install_planning_scope_check
        CHECK (install_scope IN ('', 'internal', 'external', 'both'))
    )
  `;

  await overlaySql`
    CREATE INDEX IF NOT EXISTS job_install_planning_job_id_idx
      ON job_install_planning (insulhub_job_id)
  `;

  await overlaySql`
    CREATE TABLE IF NOT EXISTS contact_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL,
      channel text NOT NULL,
      description text NOT NULL DEFAULT '',
      subject text NOT NULL DEFAULT '',
      body text NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT contact_templates_channel_check
        CHECK (channel IN ('sms', 'email', 'calendar'))
    )
  `;

  await overlaySql`
    DO $$
    DECLARE
      channel_check text;
    BEGIN
      LOCK TABLE contact_templates IN ACCESS EXCLUSIVE MODE;
      SELECT pg_get_constraintdef(oid)
      INTO channel_check
      FROM pg_constraint
      WHERE conname = 'contact_templates_channel_check';

      IF channel_check IS NOT NULL AND channel_check LIKE '%calendar%' THEN
        RETURN;
      END IF;

      ALTER TABLE contact_templates
      DROP CONSTRAINT IF EXISTS contact_templates_channel_check;

      ALTER TABLE contact_templates
      ADD CONSTRAINT contact_templates_channel_check
      CHECK (channel IN ('sms', 'email', 'calendar'));
    END
    $$;
  `;

  await overlaySql`
    CREATE INDEX IF NOT EXISTS contact_templates_channel_sort_idx
      ON contact_templates (channel, sort_order, title)
  `;

  await overlaySql`
    CREATE TABLE IF NOT EXISTS overlay_settings (
      key text PRIMARY KEY,
      value text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await overlaySql`
    CREATE UNIQUE INDEX IF NOT EXISTS overlay_settings_key_unique_idx
      ON overlay_settings (key)
  `;

  await overlaySql`
    CREATE TABLE IF NOT EXISTS campaigns (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      channel text NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      sender_id uuid,
      sender_label text NOT NULL DEFAULT '',
      template_id uuid,
      message_subject text NOT NULL DEFAULT '',
      message_body text NOT NULL DEFAULT '',
      test_sent_at timestamptz,
      recipient_count integer NOT NULL DEFAULT 0,
      created_by text NOT NULL DEFAULT '',
      sent_by text NOT NULL DEFAULT '',
      sent_at timestamptz,
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT campaigns_channel_check
        CHECK (channel IN ('email', 'sms')),
      CONSTRAINT campaigns_status_check
        CHECK (status IN ('draft', 'pending', 'sending', 'sent', 'failed', 'halted'))
    )
  `;

  await overlaySql`
    CREATE INDEX IF NOT EXISTS campaigns_status_created_idx
      ON campaigns (status, created_at DESC)
  `;

  await overlaySql`
    ALTER TABLE campaigns
    ADD COLUMN IF NOT EXISTS sender_id uuid
  `;

  await overlaySql`
    ALTER TABLE campaigns
    ADD COLUMN IF NOT EXISTS template_id uuid
  `;

  await overlaySql`
    ALTER TABLE campaigns
    ADD COLUMN IF NOT EXISTS message_subject text NOT NULL DEFAULT ''
  `;

  await overlaySql`
    ALTER TABLE campaigns
    ADD COLUMN IF NOT EXISTS message_body text NOT NULL DEFAULT ''
  `;

  await overlaySql`
    ALTER TABLE campaigns
    ADD COLUMN IF NOT EXISTS archived_at timestamptz
  `;

  await overlaySql`
    ALTER TABLE campaigns
    ADD COLUMN IF NOT EXISTS test_sent_at timestamptz
  `;

  await overlaySql`
    CREATE TABLE IF NOT EXISTS communication_senders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      channel text NOT NULL,
      label text NOT NULL,
      sender_value text NOT NULL,
      provider text NOT NULL DEFAULT 'stub',
      provider_config jsonb NOT NULL DEFAULT '{}'::jsonb,
      provider_access_token text NOT NULL DEFAULT '',
      provider_refresh_token text NOT NULL DEFAULT '',
      provider_token_expires_at timestamptz,
      connected_at timestamptz,
      connection_status text NOT NULL DEFAULT 'disconnected',
      is_default boolean NOT NULL DEFAULT false,
      is_active boolean NOT NULL DEFAULT true,
      last_tested_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT communication_senders_channel_check
        CHECK (channel IN ('email', 'sms')),
      CONSTRAINT communication_senders_provider_check
        CHECK (provider IN ('stub', 'gmail', 'smsgate'))
    )
  `;

  await overlaySql`
    CREATE INDEX IF NOT EXISTS communication_senders_channel_active_idx
      ON communication_senders (channel, is_active, is_default DESC, label)
  `;

  await overlaySql`
    ALTER TABLE communication_senders
    ADD COLUMN IF NOT EXISTS provider_config jsonb NOT NULL DEFAULT '{}'::jsonb
  `;

  await overlaySql`
    ALTER TABLE communication_senders
    ADD COLUMN IF NOT EXISTS provider_access_token text NOT NULL DEFAULT ''
  `;

  await overlaySql`
    ALTER TABLE communication_senders
    ADD COLUMN IF NOT EXISTS provider_refresh_token text NOT NULL DEFAULT ''
  `;

  await overlaySql`
    ALTER TABLE communication_senders
    ADD COLUMN IF NOT EXISTS provider_token_expires_at timestamptz
  `;

  await overlaySql`
    ALTER TABLE communication_senders
    ADD COLUMN IF NOT EXISTS connected_at timestamptz
  `;

  await overlaySql`
    ALTER TABLE communication_senders
    ADD COLUMN IF NOT EXISTS connection_status text NOT NULL DEFAULT 'disconnected'
  `;

  await overlaySql`
    CREATE TABLE IF NOT EXISTS campaign_recipients (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      insulhub_job_id text NOT NULL,
      job_number integer,
      contact_name text NOT NULL DEFAULT '',
      destination text NOT NULL,
      address text NOT NULL DEFAULT '',
      salesperson_name text NOT NULL DEFAULT '',
      job_stage text NOT NULL DEFAULT '',
      quote_date timestamptz,
      selected boolean NOT NULL DEFAULT true,
      status text NOT NULL DEFAULT 'pending',
      rendered_subject text NOT NULL DEFAULT '',
      rendered_body text NOT NULL DEFAULT '',
      scheduled_at timestamptz,
      sent_at timestamptz,
      provider_message_id text NOT NULL DEFAULT '',
      failure_reason text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT campaign_recipients_status_check
        CHECK (status IN ('pending', 'sent', 'failed', 'skipped'))
    )
  `;

  await overlaySql`
    CREATE INDEX IF NOT EXISTS campaign_recipients_campaign_idx
      ON campaign_recipients (campaign_id, selected)
  `;

  await overlaySql`
    CREATE UNIQUE INDEX IF NOT EXISTS campaign_recipients_campaign_job_unique_idx
      ON campaign_recipients (campaign_id, insulhub_job_id)
  `;

  await overlaySql`
    ALTER TABLE campaign_recipients
    ADD COLUMN IF NOT EXISTS rendered_subject text NOT NULL DEFAULT ''
  `;

  await overlaySql`
    ALTER TABLE campaign_recipients
    ADD COLUMN IF NOT EXISTS rendered_body text NOT NULL DEFAULT ''
  `;

  await overlaySql`
    ALTER TABLE campaign_recipients
    ADD COLUMN IF NOT EXISTS scheduled_at timestamptz
  `;

  await overlaySql`
    ALTER TABLE campaign_recipients
    ADD COLUMN IF NOT EXISTS sent_at timestamptz
  `;

  await overlaySql`
    ALTER TABLE campaign_recipients
    ADD COLUMN IF NOT EXISTS failure_reason text NOT NULL DEFAULT ''
  `;

  await overlaySql`
    ALTER TABLE campaign_recipients
    ADD COLUMN IF NOT EXISTS provider_message_id text NOT NULL DEFAULT ''
  `;

  await overlaySql`
    CREATE TABLE IF NOT EXISTS job_communication_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      insulhub_job_id text NOT NULL,
      job_number integer,
      channel text NOT NULL,
      destination text NOT NULL DEFAULT '',
      contact_name text NOT NULL DEFAULT '',
      template_id uuid,
      template_title text NOT NULL DEFAULT '',
      rendered_subject text NOT NULL DEFAULT '',
      rendered_body text NOT NULL DEFAULT '',
      launched_by text NOT NULL DEFAULT '',
      launched_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT job_communication_logs_channel_check
        CHECK (channel IN ('email', 'sms'))
    )
  `;

  await overlaySql`
    CREATE INDEX IF NOT EXISTS job_communication_logs_job_launched_idx
      ON job_communication_logs (insulhub_job_id, launched_at DESC)
  `;
}
