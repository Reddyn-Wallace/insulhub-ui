import "server-only";
import { financePool } from "./connection-store";
export async function trackedUninvoicedJobs(owner: string): Promise<string[]> {
  const result = await financePool().query(
    "SELECT job_id FROM finance_uninvoiced_jobs WHERE owner_id=$1",
    [owner],
  );
  return result.rows.map((r) => r.job_id);
}
export async function trackUninvoicedJobs(owner: string, ids: string[]) {
  if (!ids.length) return;
  await financePool().query(
    "INSERT INTO finance_uninvoiced_jobs(owner_id,job_id) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING",
    [owner, ids],
  );
}
