import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw Error('DATABASE_URL required');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(await readFile(new URL('./dead-followups-schema.sql', import.meta.url), 'utf8'));
  console.log('Dead quote follow-up overlay ready. Sending remains unavailable.');
} finally { await pool.end(); }
