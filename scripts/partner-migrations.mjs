import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

export const PARTNER_MIGRATION_LOCK_ID = 734_617_284_001;
const OWNER_ROLES = ["partner_artifact_owner", "partner_submission_owner", "partner_ops_owner"];
const identifier = value => `"${String(value).replaceAll('"', '""')}"`;

export async function capturePartnerOwnerGrants(client) {
  const result = await client.query(`SELECT r.rolname, m.admin_option, m.inherit_option, m.set_option
    FROM pg_roles r JOIN pg_auth_members m ON m.roleid=r.oid
    JOIN pg_roles actor ON actor.oid=m.member AND actor.rolname=session_user
    JOIN pg_roles grantor ON grantor.oid=m.grantor AND grantor.rolname=session_user
    WHERE r.rolname=ANY($1::text[]) ORDER BY r.rolname`, [OWNER_ROLES]);
  return result.rows;
}

export async function restorePartnerOwnerGrants(client, before) {
  const after = await capturePartnerOwnerGrants(client);
  const actor = (await client.query("SELECT session_user AS role")).rows[0]?.role;
  if (!actor) throw new Error("Migration login identity unavailable");
  const existing = await client.query("SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])", [OWNER_ROLES]);
  for (const { rolname } of existing.rows) {
    const prior=before.find(row=>row.rolname===rolname);
    const current=after.find(row=>row.rolname===rolname);
    if (JSON.stringify(prior)===JSON.stringify(current)) continue;
    if (prior) {
      await client.query(`GRANT ${identifier(rolname)} TO ${identifier(actor)} WITH ADMIN ${Boolean(prior.admin_option)}, INHERIT ${Boolean(prior.inherit_option)}, SET ${Boolean(prior.set_option)} GRANTED BY ${identifier(actor)}`);
    } else if (current) {
      await client.query(`REVOKE ${identifier(rolname)} FROM ${identifier(actor)} GRANTED BY ${identifier(actor)}`);
    }
  }
}

async function capturePartnerOwnerSchemaCreate(client){
  const result=await client.query("SELECT rolname,has_schema_privilege(rolname,'public','CREATE') AS can_create FROM pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname",[OWNER_ROLES]);
  return result.rows;
}

async function restorePartnerOwnerSchemaCreate(client,before){
  const existing=new Set((await client.query("SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])",[before.map(row=>row.rolname)])).rows.map(row=>row.rolname));
  for(const {rolname,can_create} of before){
    if(!existing.has(rolname))continue;
    await client.query(`${can_create?"GRANT":"REVOKE"} CREATE ON SCHEMA public ${can_create?"TO":"FROM"} ${identifier(rolname)}`);
  }
}

export function discoverPartnerMigrations(fileNames) {
  const migrations = new Map();
  for (const fileName of fileNames) {
    const match = /^(\d+_[a-z0-9_]+)\.(up|down)\.sql$/i.exec(fileName);
    if (!match) continue;
    const version = match[1];
    const entry = migrations.get(version) ?? { version };
    entry[match[2]] = fileName;
    migrations.set(version, entry);
  }
  const ordered = [...migrations.values()].sort((left, right) => left.version.localeCompare(right.version, "en", { numeric: true }));
  for (const migration of ordered) {
    if (!migration.up || !migration.down) throw new Error(`Migration ${migration.version} must have both up and down SQL files`);
  }
  return ordered;
}

async function loadPartnerMigrations(root) {
  const directory = resolve(root, "migrations/partner");
  const migrations = discoverPartnerMigrations(await readdir(directory));
  return Promise.all(migrations.map(async (migration) => ({
    ...migration,
    upSql: await readFile(resolve(directory, migration.up), "utf8"),
    downSql: await readFile(resolve(directory, migration.down), "utf8"),
  })));
}

function withoutTransactionWrapper(sql) {
  return sql.replace(/^BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "");
}

export async function migratePartnerOne(pool, direction, root = process.cwd()) {
  if (!new Set(["up", "down"]).has(direction)) throw new Error("Migration direction must be up or down");
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [PARTNER_MIGRATION_LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS partner_schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const migrations = await loadPartnerMigrations(root);
    const appliedResult = await client.query("SELECT version FROM partner_schema_migrations ORDER BY version");
    const applied = new Set(appliedResult.rows.map((row) => row.version));
    const migration = direction === "up"
      ? migrations.find((candidate) => !applied.has(candidate.version))
      : migrations.toReversed().find((candidate) => applied.has(candidate.version));
    if (!migration) return { changed: false, direction, version: null };

    // Owner functions from an earlier version can only be replaced while the
    // migrator has a SET-capable membership. PostgreSQL does not make a GRANT
    // issued inside the same transaction usable by SET ROLE, so establish the
    // temporary grants before BEGIN and restore the exact previous state on
    // both success and failure.
    const ownerGrants = await capturePartnerOwnerGrants(client);
    const ownerSchemaCreate=await capturePartnerOwnerSchemaCreate(client);
    const actor = (await client.query("SELECT session_user AS role")).rows[0]?.role;
    if (!actor) throw new Error("Migration login identity unavailable");
    let transactionOpen=false;
    try {
      const existingOwners = await client.query("SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])",[OWNER_ROLES]);
      for(const {rolname} of existingOwners.rows){
        await client.query(`GRANT ${identifier(rolname)} TO ${identifier(actor)} WITH INHERIT TRUE, SET TRUE GRANTED BY ${identifier(actor)}`);
        await client.query(`GRANT CREATE ON SCHEMA public TO ${identifier(rolname)}`);
      }
      await client.query("BEGIN");transactionOpen=true;
      await client.query(withoutTransactionWrapper(direction === "up" ? migration.upSql : migration.downSql));
      await restorePartnerOwnerSchemaCreate(client,ownerSchemaCreate);
      await restorePartnerOwnerGrants(client, ownerGrants);
      if (direction === "up") {
        await client.query("INSERT INTO partner_schema_migrations (version) VALUES ($1)", [migration.version]);
      } else {
        await client.query("DELETE FROM partner_schema_migrations WHERE version = $1", [migration.version]);
      }
      await client.query("COMMIT");transactionOpen=false;
    } catch (error) {
      if(transactionOpen)await client.query("ROLLBACK").catch(()=>undefined);
      await restorePartnerOwnerSchemaCreate(client,ownerSchemaCreate).catch(()=>undefined);
      await restorePartnerOwnerGrants(client, ownerGrants).catch(()=>undefined);
      throw error;
    }
    return { changed: true, direction, version: migration.version };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [PARTNER_MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}

export async function migratePartnerAll(pool, direction, root = process.cwd()) {
  const versions = [];
  while (true) {
    const result = await migratePartnerOne(pool, direction, root);
    if (!result.changed) return { changed: versions.length > 0, direction, versions };
    versions.push(result.version);
  }
}
