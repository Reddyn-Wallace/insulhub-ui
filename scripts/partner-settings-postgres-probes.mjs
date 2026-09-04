import { readFileSync } from "node:fs";

/** Run only on the explicitly disposable database owned by the migration gate. */
export async function probePartnerSettingsService(pool) {
  const actor = "insulhub-settings-service";
  const migration = direction => readFileSync(new URL(`../migrations/partner/010_partner_settings_service.${direction}.sql`, import.meta.url), "utf8").replace(/^BEGIN;\s*/, "").replace(/COMMIT;\s*$/, "");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT id FROM partner_users WHERE id=$1 AND principal_type='INTERNAL' AND ops_role='ADMIN' AND company_id IS NULL AND disabled_at IS NULL", [actor]);
    if (result.rowCount !== 1) throw new Error("Settings service actor is missing");
    for (const table of ["partner_accounts", "partner_sessions"]) {
      if ((await client.query(`SELECT 1 FROM ${table} WHERE user_id=$1`,[actor])).rowCount !== 0) throw new Error("Settings service must have no login credentials or sessions");
    }
    await client.query(migration("up")); // Exact, non-login reuse is idempotent.
    const collisions = [
      ["UPDATE partner_users SET email='collision@example.test' WHERE id=$1", [actor]],
      ["INSERT INTO partner_accounts(id,account_id,provider_id,user_id,password) VALUES('settings-collision',$1,'credential',$1,'fixture-hash')", [actor]],
      ["INSERT INTO partner_sessions(id,token,user_id,expires_at) VALUES('settings-collision','settings-collision',$1,now()+interval '1 day')", [actor]],
    ];
    for (const [sql, values] of collisions) {
      await client.query("SAVEPOINT settings_collision");
      await client.query(sql, values);
      let rejected = false;
      try { await client.query(migration("up")); } catch (error) { rejected = error.message.includes("Reserved settings service identity collision"); }
      await client.query("ROLLBACK TO SAVEPOINT settings_collision");
      await client.query("RELEASE SAVEPOINT settings_collision");
      if (!rejected) throw new Error("Settings migration must reject identity, credential and session collisions");
    }
    await client.query(migration("down"));
    if ((await client.query("SELECT id FROM partner_users WHERE id=$1 AND disabled_at IS NOT NULL",[actor])).rowCount !== 1) throw new Error("Settings rollback must disable, not delete, its audit identity");
    await client.query(migration("up"));
    if ((await client.query("SELECT id FROM partner_users WHERE id=$1 AND disabled_at IS NULL",[actor])).rowCount !== 1) throw new Error("Settings reapply must restore its service actor");
  } finally { await client.query("ROLLBACK"); client.release(); }
}
