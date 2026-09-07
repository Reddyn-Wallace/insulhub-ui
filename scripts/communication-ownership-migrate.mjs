import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw Error('DATABASE_URL required');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
// Canonical account IDs verified via the staff job filters on 7 September 2026.
// Deliberately map only the three reviewed records; future unknown records stay unavailable.
const assignments = [
  ['9c037351-71d2-4382-b1e5-7c193f89028b', 'email', 'reddyn@insulmax.co.nz', '6965831ea5185b0a06b94bf4'],
  ['def701df-a3d5-4946-857f-8d1a119db813', 'sms', '+64273623220', '6965831ea5185b0a06b94bf4'],
  ['58be52b3-c151-4251-8e73-90d220fbf56b', 'email', 'andrew@insulmax.co.nz', '6a88b869e193712a0118eff5'],
];
try {
  await client.query('BEGIN');
  await client.query(await readFile(new URL('./communication-ownership-schema.sql', import.meta.url), 'utf8'));
  for (const [id,channel,value,owner] of assignments) {
    const result = await client.query(`UPDATE communication_senders SET owner_user_id=$4, updated_at=now()
      WHERE id=$1 AND channel=$2 AND lower(sender_value)=$3 AND (owner_user_id IS NULL OR owner_user_id=$4)
      RETURNING id`, [id,channel,value,owner]);
    if (result.rowCount !== 1) throw Error(`Sender ${id} did not match the reviewed migration; no changes applied.`);
  }
  // Legacy queued campaigns cannot safely be assigned from client-supplied author names.
  const pending = await client.query("SELECT id FROM campaigns WHERE status IN ('pending','sending') AND send_authorized_user_id IS NULL");
  if (pending.rowCount) throw Error('Unowned queued campaigns need review before migration; no changes applied.');
  const dryRun = process.argv.includes('--dry-run');
  await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
  console.log(dryRun ? 'Migration verified against the database and rolled back; no changes saved.' : 'Sender ownership schema ready; three verified connections assigned.');
} catch (error) {
  await client.query('ROLLBACK'); throw error;
} finally { client.release(); await pool.end(); }
