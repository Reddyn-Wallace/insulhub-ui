import "server-only";
import { financePool } from "./connection-store";
import { decryptTokens, encryptTokens } from "./crypto";
import type { FinanceInputs } from "./model";
const version = "three-figures-recent-v4";
export async function readSnapshot(
  owner: string,
  mode: string,
): Promise<FinanceInputs | null> {
  const r = await financePool().query(
    `SELECT payload FROM finance_snapshots WHERE owner_id=$1 AND mode=$2 AND version=$3 AND expires_at>now()`,
    [owner, mode, version],
  );
  return r.rows[0]
    ? decryptTokens<FinanceInputs>(
        `${owner}:${mode}:${version}`,
        r.rows[0].payload,
      )
    : null;
}
export async function writeSnapshot(
  owner: string,
  mode: string,
  input: FinanceInputs,
) {
  await financePool().query(
    `INSERT INTO finance_snapshots(owner_id,mode,version,payload,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes')
     ON CONFLICT(owner_id,mode) DO UPDATE SET version=excluded.version,payload=excluded.payload,expires_at=excluded.expires_at`,
    [owner, mode, version, encryptTokens(`${owner}:${mode}:${version}`, input)],
  );
}
