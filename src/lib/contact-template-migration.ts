import 'server-only';
import { overlaySql } from './overlay-db';
import { defaultTemplates, validateTemplates, ordinaryTemplate } from './dead-followups/templates';

const migrationKey = 'quote_followup_contact_templates_imported';

// Import once into the ordinary library. The marker and rows commit in the same
// statement, so concurrent reads cannot duplicate templates or resurrect deletions.
export async function migrateFollowupTemplates(sql = overlaySql) {
  const done = await sql`SELECT key FROM overlay_settings WHERE key = ${migrationKey}`;
  if (done.length) return;
  const table = await sql`SELECT to_regclass('dead_quote_followup_templates') AS name`;
  const saved = table[0]?.name ? await sql`SELECT templates FROM dead_quote_followup_templates WHERE singleton = true` : [];
  const templates = (saved.length ? validateTemplates(saved[0].templates) : defaultTemplates()).map(template => ({ ...ordinaryTemplate(template), sort_order: 100 + template.approach }));
  await sql`
    WITH claimed AS (
      INSERT INTO overlay_settings (key, value) VALUES (${migrationKey}, 'true')
      ON CONFLICT (key) DO NOTHING RETURNING key
    )
    INSERT INTO contact_templates (title, channel, description, subject, body, sort_order)
    SELECT t.title, t.channel, t.description, t.subject, t.body, t.sort_order
    FROM jsonb_to_recordset(${JSON.stringify(templates)}::jsonb)
      AS t(title text, channel text, description text, subject text, body text, sort_order integer)
    CROSS JOIN claimed
  `;
}
