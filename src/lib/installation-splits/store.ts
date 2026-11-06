import "server-only";
import { overlaySql } from "@/lib/overlay-db";
import type { SavedSplit } from "./projection";
export class SplitError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function readSplits(
  ids?: string[],
): Promise<Record<string, SavedSplit>> {
  const rows = ids
    ? await overlaySql`SELECT insulhub_job_id, version, payload FROM job_installation_splits WHERE insulhub_job_id = ANY(${ids}::text[])`
    : await overlaySql`SELECT insulhub_job_id, version, payload FROM job_installation_splits`;
  return Object.fromEntries(
    rows.map((r) => [
      String(r.insulhub_job_id),
      { ...(r.payload as SavedSplit), version: Number(r.version) },
    ]),
  );
}
export async function saveSplit(
  split: SavedSplit,
  expectedVersion: number,
  actor: string,
  action: unknown,
) {
  const payload = JSON.stringify({ ...split, version: expectedVersion + 1 });
  // Single statement: compare-and-swap and audit either both commit or neither does.
  const rows = await overlaySql`
 WITH saved AS (
  INSERT INTO job_installation_splits (insulhub_job_id,version,payload)
  SELECT ${split.id},1,${payload}::jsonb WHERE ${expectedVersion}=0
  ON CONFLICT (insulhub_job_id) DO NOTHING RETURNING *
 ), updated AS (
  UPDATE job_installation_splits SET version=version+1,payload=${payload}::jsonb,updated_at=now()
  WHERE insulhub_job_id=${split.id} AND version=${expectedVersion} AND ${expectedVersion}>0 RETURNING *
 ), changed AS (SELECT * FROM saved UNION ALL SELECT * FROM updated), audited AS (
  INSERT INTO job_installation_split_events(insulhub_job_id,version,actor_id,action,payload)
  SELECT insulhub_job_id,version,${actor},${JSON.stringify(action)}::jsonb,payload FROM changed RETURNING insulhub_job_id
 ) SELECT changed.* FROM changed JOIN audited USING(insulhub_job_id)`;
  if (!rows.length)
    throw new SplitError(
      "This job changed in another window. Reload the visits before trying again.",
      409,
    );
  return {
    ...(rows[0].payload as SavedSplit),
    version: Number(rows[0].version),
  };
}
