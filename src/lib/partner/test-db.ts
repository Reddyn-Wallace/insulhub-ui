import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DataType, newDb } from "pg-mem";
import { parseSitePlanDocument } from "../site-plan-drawings";

function migrationSql(direction: "up" | "down"): string {
  const directory = resolve("migrations/partner");
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(`.${direction}.sql`))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  if (direction === "down") files.reverse();
  return files.map((file) => readFileSync(resolve(directory, file), "utf8")).join("\n");
}

function stripDollarQuotedFunctions(sql: string, qualifiedNamePrefix: string): string {
  let result = sql;
  const markers = [`CREATE OR REPLACE FUNCTION ${qualifiedNamePrefix}`,`CREATE FUNCTION ${qualifiedNamePrefix}`];
  for (;;) {
    const starts=markers.map(marker=>result.indexOf(marker)).filter(index=>index>=0);const start=starts.length?Math.min(...starts):-1;
    if (start < 0) return result;
    const bodyStart = result.indexOf("AS $$", start);
    const end = bodyStart < 0 ? -1 : result.indexOf("$$;", bodyStart + 5);
    if (bodyStart < 0 || end < 0) throw new Error(`Could not strip test-only PostgreSQL function ${qualifiedNamePrefix}`);
    result = `${result.slice(0, start)}${result.slice(end + 3)}`;
  }
}

function testableUpMigration(): string {
  let sql = migrationSql("up");
  // Migration 005 schema-qualifies every PostgreSQL-only definer/helper. Keep
  // its tables and CHECK constraints in pg-mem, but emulate its functions
  // below; real PostgreSQL always executes the untouched migration files.
  sql = stripDollarQuotedFunctions(sql, "public.partner_");
  return sql
    .replace(/-- PG_MEM_UNSUPPORTED_UPDATE_FROM_BEGIN:[\s\S]*?-- PG_MEM_UNSUPPORTED_UPDATE_FROM_END/g, "")
    .replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;/g, "")
    .replace(/CREATE OR REPLACE FUNCTION partner_reject_append_only_change\(\)[\s\S]*?LANGUAGE plpgsql;/, "")
    .replace(/CREATE OR REPLACE FUNCTION partner_quote_extras_valid\(value jsonb\)[\s\S]*?\$\$;/, "")
    .replace(/CREATE OR REPLACE FUNCTION partner_site_plan_document_valid\(value jsonb\)[\s\S]*?\$\$;/, "")
    .replace(/CREATE OR REPLACE FUNCTION partner_site_plan_max_twenty\(\)[\s\S]*?\$\$;/, "")
    .replace(/CREATE OR REPLACE FUNCTION partner_reject_pdf_artifact_change\(\)[\s\S]*?\$\$;/, "")
    .replace(/CREATE OR REPLACE FUNCTION partner_prune_site_plan_pdf_artifacts\(target_company uuid\)[\s\S]*?\$\$;/, "")
    .replace(/CREATE OR REPLACE FUNCTION partner_publish_site_plan_pdf_artifact\([\s\S]*?\$\$;/, "")
    .replace(/CREATE OR REPLACE FUNCTION partner_purge_draft_site_plan_drawing\([\s\S]*?\$\$;/, "")
    .replace(/DO \$\$[\s\S]*?END \$\$;/g, "")
    .replace(/SET LOCAL ROLE partner_(?:submission_owner|ops_owner);\s*/g, "")
    .replace(/RESET ROLE;\s*/g, "")
    .replace(/ALTER FUNCTION (?:public\.)?partner_[^;]+;/g, "")
    .replace(/DROP FUNCTION (?:public\.)?partner_[^;]+;/g, "")
    .replace(/(?:GRANT|REVOKE) [^;]+;/g, "")
    .replace(/ DEFERRABLE INITIALLY IMMEDIATE/g, "")
    // pg-mem mis-parses jsonb `value - text[]` as numeric subtraction. The
    // untouched migration keeps the exact allowlist constraint for PostgreSQL;
    // portable tests retain the remaining event/scope/type checks.
    .replace(/metadata - ARRAY\['phase','errorCode','contractVersion','attemptNumber'\] = '\{\}'::jsonb/g, "TRUE")
    .replace(/patch - ARRAY\['version','description','contractDeltaCents'\] = '\{\}'::jsonb/g, "TRUE")
    .replace(/patch\s*-\s*ARRAY\[[^\]]+\]\s*=\s*'\{\}'::jsonb/g, "TRUE")
    .replace(/\s*ADD CONSTRAINT partner_site_plan_name_nfc CHECK \(name=normalize\(name,NFC\)\),?/, "")
    .replace(/CREATE TRIGGER partner_(?:site_plan_max_twenty_before_write|pdf_artifact_immutable|submission_guard_job|submission_guard_drawing|submission_guard_audit)[^;]+;/g, "")
    .replace(/CREATE TRIGGER partner_deleted_draft(?:_plan)?_guard[^;]+;/g, "")
    .replace(/CREATE TRIGGER partner_access_[^;]+;/g, "")
    .replace(/CREATE TRIGGER partner_link_[^;]+;/g, "")
    .replace(/CREATE TRIGGER partner_live_[^;]+;/g, "")
    .replace(/CREATE TRIGGER partner_notification_prepare[^;]+;/g, "")
    .replace(/CREATE TRIGGER partner_ops_[^;]+;/g, "")
    .replace(/CREATE TRIGGER partner_[a-z_]+_append_only[^;]+;/g, "");
}

function testableDownMigration(): string {
  let sql = migrationSql("down");
  sql = stripDollarQuotedFunctions(sql, "public.partner_");
  return sql
    .replace(/DO \$\$[\s\S]*?END \$\$;/g, "")
    .replace(/SET LOCAL ROLE partner_(?:submission_owner|ops_owner);\s*/g, "")
    .replace(/RESET ROLE;\s*/g, "")
    .replace(/ALTER FUNCTION (?:public\.)?partner_[^;]+;/g, "")
    .replace(/(?:GRANT|REVOKE) [^;]+;/g, "")
    .replace(/DROP OWNED BY partner_submission_(?:worker|owner);/g, "")
    .replace(/DROP ROLE partner_submission_(?:worker|owner);/g, "")
    .replace(/DROP ROLE partner_ops_(?:runtime|owner);/g, "")
    .replace(/UPDATE partner_site_plan_drawings d SET floor_index=b\.floor_index,[\s\S]*?WHERE d\.id=b\.drawing_id;/, "")
    .replace(/DROP TRIGGER[^;]+;/g, "")
    .replace(/DROP FUNCTION[^;]+;/g, "");
}

export function createPartnerTestDatabase() {
  const db = newDb();
  db.public.registerFunction({ name: "to_char", args: [DataType.date, DataType.text], returns: DataType.text, implementation: (value: Date | string, pattern: string) => {
    if (pattern !== "YYYY-MM-DD") throw new Error("Unsupported date format in test");
    return new Date(value).toISOString().slice(0, 10);
  } });
  db.public.registerFunction({ name: "gen_random_uuid", returns: DataType.uuid, implementation: randomUUID, impure: true });
  db.public.registerFunction({ name: "jsonb_typeof", args: [DataType.jsonb], returns: DataType.text, implementation: (value: unknown) => Array.isArray(value) ? "array" : value === null ? "null" : typeof value });
  db.public.registerFunction({ name: "btrim", args: [DataType.text], returns: DataType.text, implementation: (value: string) => value.trim() });
  db.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
  db.public.registerFunction({ name: "pg_column_size", args: [DataType.jsonb], returns: DataType.integer, implementation: (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8") });
  db.public.registerFunction({ name: "octet_length", args: [DataType.bytea], returns: DataType.integer, implementation: (value: Buffer) => value.byteLength });
  db.public.registerFunction({ name: "convert_to", args: [DataType.text, DataType.text], returns: DataType.bytea, implementation: (value: string) => Buffer.from(value, "utf8") });
  db.public.registerFunction({ name: "digest", args: [DataType.bytea, DataType.text], returns: DataType.bytea, implementation: (value: Buffer) => createHash("sha256").update(value).digest() });
  db.public.registerFunction({ name: "encode", args: [DataType.bytea, DataType.text], returns: DataType.text, implementation: (value: Buffer) => value.toString("hex") });
  db.public.registerFunction({ name: "partner_submission_outbox_payload_valid", args: [DataType.text, DataType.uuid, DataType.uuid, DataType.uuid, DataType.jsonb], returns: DataType.bool, implementation: () => true });
  db.public.registerFunction({ name: "partner_submission_safe_error_code", args: [DataType.text], returns: DataType.bool, implementation: (value: string) => new Set(["LEASE_EXPIRED","NETWORK_ERROR","PROVIDER_TIMEOUT","PROVIDER_UNAVAILABLE","PROVIDER_REJECTED","UPLOAD_FAILED","ATTACH_FAILED","CREDENTIAL_ROTATED","AMBIGUOUS_LEGACY_RESULT","SUBMISSION_LEASE_LOST","MALFORMED_FROZEN_STATE","NOTIFICATION_REJECTED"]).has(value) });
  db.public.registerFunction({ name: "partner_quote_extras_valid", args: [DataType.jsonb], returns: DataType.bool, implementation: (value: unknown) => {
    if (!Array.isArray(value) || value.length > 50 || Buffer.byteLength(JSON.stringify(value), "utf8") > 7000) return false;
    const ids = new Set<string>();
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const extra = item as Record<string, unknown>;
      if (Object.keys(extra).sort().join(",") !== "id,name,priceCents") return false;
      if (typeof extra.id !== "string" || !extra.id || extra.id.length > 80 || ids.has(extra.id)) return false;
      if (typeof extra.name !== "string" || !extra.name.trim() || extra.name.length > 120) return false;
      if (!Number.isInteger(extra.priceCents) || Number(extra.priceCents) < 0 || Number(extra.priceCents) > 1_000_000_000) return false;
      ids.add(extra.id);
    }
    return true;
  } });
  db.public.registerFunction({ name: "partner_site_plan_document_valid", args: [DataType.jsonb], returns: DataType.bool, implementation: (value: unknown) => {
    const parsed = parseSitePlanDocument(value);
    return parsed !== null && JSON.stringify(parsed) === JSON.stringify(value);
  } });
  db.public.registerFunction({ name: "partner_prune_site_plan_pdf_artifacts", args: [DataType.uuid], returns: DataType.integer, implementation: () => 0 });
  db.public.registerOperator({ operator: "~", left: DataType.text, right: DataType.text, returns: DataType.bool, implementation: (value: string, pattern: string) => new RegExp(pattern).test(value) });
  db.public.registerOperator({ operator: "?", left: DataType.jsonb, right: DataType.text, returns: DataType.bool, implementation: (value: unknown, key: string) => Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, key)) });
  db.public.none(testableUpMigration());
  const adapter = db.adapters.createPg();
  return { db, Pool: adapter.Pool, rollback: () => db.public.none(testableDownMigration()) };
}
