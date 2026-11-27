import { readFile } from "node:fs/promises";
import nextEnv from "@next/env";
import { Pool } from "pg";

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(await readFile(new URL("./campaign-open-tracking-schema.sql", import.meta.url), "utf8"));
  console.log("Campaign open tracking storage ready.");
} finally {
  await pool.end();
}
