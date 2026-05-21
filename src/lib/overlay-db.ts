import "server-only";
import { neon } from "@neondatabase/serverless";

type OverlaySql = ReturnType<typeof neon>;
type OverlayRows = Record<string, unknown>[];

let cachedSql: OverlaySql | null = null;

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

export async function ensureOverlaySchema() {
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
        CHECK (channel IN ('sms', 'email'))
    )
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
}
