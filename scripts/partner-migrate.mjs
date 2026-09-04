#!/usr/bin/env node
import { Pool } from "pg";
import { migratePartnerOne } from "./partner-migrations.mjs";

const direction = process.argv[2] ?? "up";
if (!new Set(["up", "down"]).has(direction)) throw new Error("Usage: npm run partner:migrate -- [up|down]");
if (!process.env.PARTNER_MIGRATION_DATABASE_URL) throw new Error("PARTNER_MIGRATION_DATABASE_URL is required");
if (process.env.PARTNER_MIGRATION_DATABASE_URL === process.env.PARTNER_DATABASE_URL) throw new Error("Migration and runtime database URLs must use separate roles");
if (process.env.PARTNER_DATABASE_URL) {
  let migrationUser;
  let runtimeUser;
  try {
    migrationUser = decodeURIComponent(new URL(process.env.PARTNER_MIGRATION_DATABASE_URL).username);
    runtimeUser = decodeURIComponent(new URL(process.env.PARTNER_DATABASE_URL).username);
  } catch {
    throw new Error("Partner database URLs must be valid PostgreSQL URLs");
  }
  if (!migrationUser || migrationUser === runtimeUser) throw new Error("Migration and runtime database URLs must authenticate as distinct roles");
}

const pool = new Pool({ connectionString: process.env.PARTNER_MIGRATION_DATABASE_URL, max: 1 });
try {
  const result = await migratePartnerOne(pool, direction);
  console.log(result.changed ? `Partner migration ${result.version} ${direction} complete` : `No partner migration to ${direction}`);
} finally {
  await pool.end();
}
