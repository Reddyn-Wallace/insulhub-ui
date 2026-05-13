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
}
