import "server-only";
import { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { decryptTokens, encryptTokens } from "./crypto";
import { FinanceError, required } from "./errors";
import { exchangeXeroTokens, type XeroTokens } from "./xero-tokens";
let pool: Pool | undefined;
export function validateFinanceDatabaseUrl(value: string) {
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname.includes("-pooler.")
  )
    throw new FinanceError(
      503,
      "Finance requires a direct PostgreSQL connection for refresh locking.",
    );
  return value;
}
export function financePool() {
  return (pool ??= new Pool({
    connectionString: validateFinanceDatabaseUrl(
      required("FINANCE_DATABASE_URL"),
    ),
    max: 3,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
  }));
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function saveState(state: string, owner: string) {
  await financePool().query(
    "INSERT INTO finance_oauth_states(state_hash,owner_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')",
    [hash(state), owner],
  );
}
export async function consumeState(state: string): Promise<string | null> {
  const r = await financePool().query(
    "DELETE FROM finance_oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING owner_id",
    [hash(state)],
  );
  return r.rows[0]?.owner_id || null;
}
export async function saveTokens(owner: string, tokens: XeroTokens) {
  const client = await financePool().connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
      "finance:" + owner,
    ]);
    await client.query(
      `INSERT INTO finance_connections(owner_id,tokens,refresh_pending,generation) VALUES($1,$2,false,$3) ON CONFLICT(owner_id) DO UPDATE SET tokens=excluded.tokens,generation=excluded.generation,refresh_pending=false,tenant_id=NULL,tenant_name=NULL,updated_at=now()`,
      [owner, encryptTokens(owner, tokens), randomUUID()],
    );
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
        "finance:" + owner,
      ]);
    } finally {
      client.release();
    }
  }
}
export async function readConnection(owner: string) {
  const r = await financePool().query(
    "SELECT tenant_id,tenant_name,refresh_pending,updated_at FROM finance_connections WHERE owner_id=$1",
    [owner],
  );
  return r.rows[0] as
    | {
        tenant_id: string | null;
        tenant_name: string | null;
        refresh_pending: boolean;
        updated_at: Date;
      }
    | undefined;
}
export async function pinTenant(
  owner: string,
  id: string,
  name: string,
  generation: string,
) {
  const r = await financePool().query(
    "UPDATE finance_connections SET tenant_id=$2,tenant_name=$3,updated_at=now() WHERE owner_id=$1 AND generation=$4 RETURNING owner_id",
    [owner, id, name, generation],
  );
  if (r.rowCount !== 1)
    throw new FinanceError(
      409,
      "Xero was reconnected during selection. Select the organisation again.",
    );
}
export async function withTokens<T>(
  owner: string,
  operation: (
    value: XeroTokens & { tenantId: string | null; generation: string },
  ) => Promise<T>,
): Promise<T> {
  const client = await financePool().connect();
  let tokens: XeroTokens;
  let tenantId: string | null;
  let generation: string;
  try {
    // A session advisory lock serialises all refreshers, including across server instances.
    await client.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
      "finance:" + owner,
    ]);
    const r = await client.query(
      "SELECT tokens,tenant_id,refresh_pending,generation FROM finance_connections WHERE owner_id=$1",
      [owner],
    );
    const row = r.rows[0];
    if (!row) throw new FinanceError(409, "Connect Xero first.");
    if (row.refresh_pending)
      throw new FinanceError(
        409,
        "Xero refresh was interrupted. Reconnect to recover safely.",
      );
    tokens = decryptTokens<XeroTokens>(owner, row.tokens);
    tenantId = row.tenant_id;
    generation = row.generation;
    if (tokens.expiresAt < Date.now() + 60000) {
      // Commit the marker BEFORE the external exchange. A crash must never replay an old token.
      await client.query("BEGIN");
      await client.query(
        "SELECT owner_id FROM finance_connections WHERE owner_id=$1 FOR UPDATE",
        [owner],
      );
      await client.query(
        "UPDATE finance_connections SET refresh_pending=true WHERE owner_id=$1",
        [owner],
      );
      await client.query("COMMIT");
      tokens = await exchangeXeroTokens(
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
        }),
      );
      await client.query(
        "UPDATE finance_connections SET tokens=$2,refresh_pending=false,updated_at=now() WHERE owner_id=$1",
        [owner, encryptTokens(owner, tokens)],
      );
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
        "finance:" + owner,
      ]);
    } finally {
      client.release();
    }
  }
  return operation({ ...tokens, tenantId, generation });
}
