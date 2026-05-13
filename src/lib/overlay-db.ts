import "server-only";
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for overlay storage");
}

export const overlaySql = neon(process.env.DATABASE_URL);

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
}
