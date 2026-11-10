import "server-only";
import { randomUUID } from "node:crypto";
import { overlaySql } from "@/lib/overlay-db";
import { ReportError, parseSettings, weekKey } from "./model";
import type { Report, Settings, Snapshot, Commentary } from "./types";
const conflict = () =>
  new ReportError(
    "This report changed or is locked. Reload before trying again; your unsaved text is still shown.",
    409,
  );
function report(row: Record<string, unknown>): Report {
  return {
    week: String(row.week_key),
    revision: Number(row.revision),
    status: row.status as Report["status"],
    commentary: row.commentary as Commentary,
    snapshot: row.snapshot as Snapshot | null,
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    finalisedAt: row.finalised_at
      ? new Date(String(row.finalised_at)).toISOString()
      : null,
    refreshing:
      Boolean(row.refresh_token) &&
      new Date(String(row.refresh_expires_at)).getTime() > Date.now(),
  };
}
function checkWeek(week: string) {
  if (weekKey(week) !== week)
    throw new ReportError("Choose a Monday week start.");
}
export function parseCommentary(input: unknown): Commentary {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ReportError("Invalid commentary.");
  const x = input as Commentary;
  if (
    Object.keys(x).length !== 3 ||
    ["profit", "upcoming", "pipeline"].some(
      (k) =>
        typeof x[k as keyof Commentary] !== "string" ||
        x[k as keyof Commentary].length > 20000,
    )
  )
    throw new ReportError("Each comment must be under 20,000 characters.");
  return { profit: x.profit, upcoming: x.upcoming, pipeline: x.pipeline };
}
export async function readSettings(): Promise<{
  settings: Settings;
  revision: number;
} | null> {
  const rows =
    await overlaySql`SELECT payload,revision FROM gm_report_settings WHERE id=1`;
  return rows[0]
    ? {
        settings: parseSettings(rows[0].payload),
        revision: Number(rows[0].revision),
      }
    : null;
}
export async function saveSettings(
  input: unknown,
  revision: number,
  actor: string,
) {
  const settings = parseSettings(input);
  const rows = await overlaySql`
 WITH inserted AS (INSERT INTO gm_report_settings(id,revision,payload,actor_id) SELECT 1,1,${JSON.stringify(settings)}::jsonb,${actor} WHERE ${revision}=0 ON CONFLICT DO NOTHING RETURNING *),
 updated AS (UPDATE gm_report_settings SET payload=${JSON.stringify(settings)}::jsonb,revision=revision+1,updated_at=now(),actor_id=${actor} WHERE id=1 AND revision=${revision} AND ${revision}>0 RETURNING *)
 SELECT * FROM inserted UNION ALL SELECT * FROM updated`;
  if (!rows[0]) throw conflict();
  return {
    settings: rows[0].payload as Settings,
    revision: Number(rows[0].revision),
  };
}
export async function getReport(week: string): Promise<Report | null> {
  checkWeek(week);
  const rows =
    await overlaySql`SELECT *,to_char(week,'YYYY-MM-DD') week_key FROM gm_reports WHERE week=${week}::date`;
  return rows[0] ? report(rows[0]) : null;
}
export async function listReports() {
  const rows =
    await overlaySql`SELECT to_char(week,'YYYY-MM-DD') week,status,updated_at FROM gm_reports ORDER BY week DESC LIMIT 520`;
  return rows.map((r) => ({ week: String(r.week), status: String(r.status) }));
}
export async function createReport(week: string, actor: string) {
  checkWeek(week);
  await overlaySql`INSERT INTO gm_reports(week,actor_id) VALUES(${week}::date,${actor}) ON CONFLICT DO NOTHING`;
  return (await getReport(week))!;
}
export async function saveCommentary(
  week: string,
  input: unknown,
  revision: number,
  actor: string,
) {
  checkWeek(week);
  const text = parseCommentary(input);
  const rows = await overlaySql`
 WITH changed AS (UPDATE gm_reports SET commentary=${JSON.stringify(text)}::jsonb,revision=revision+1,updated_at=now(),actor_id=${actor} WHERE week=${week}::date AND status='draft' AND revision=${revision} RETURNING *,to_char(week,'YYYY-MM-DD') week_key),
 audit AS (INSERT INTO gm_report_events(week,revision,action,actor_id) SELECT week,revision,'commentary',${actor} FROM changed)
 SELECT * FROM changed`;
  if (!rows[0]) throw conflict();
  return report(rows[0]);
}
export async function startRefresh(week: string, actor: string) {
  checkWeek(week);
  const lease = randomUUID();
  const rows = await overlaySql`
 UPDATE gm_reports SET refresh_token=${lease}::uuid,refresh_expires_at=now()+interval '5 minutes',actor_id=${actor}
 WHERE week=${week}::date AND status='draft' AND (refresh_token IS NULL OR refresh_expires_at<now()) RETURNING week`;
  if (!rows[0])
    throw new ReportError(
      "A refresh is already running, or this report is finalised. Try again shortly.",
      409,
    );
  return lease;
}
export async function cancelRefresh(week: string, lease: string) {
  await overlaySql`UPDATE gm_reports SET refresh_token=NULL,refresh_expires_at=NULL WHERE week=${week}::date AND status='draft' AND refresh_token=${lease}::uuid`;
}
export async function publishRefresh(
  week: string,
  lease: string,
  snapshot: Snapshot,
  actor: string,
) {
  if (snapshot.week !== week) throw new ReportError("Report week mismatch.");
  const rows = await overlaySql`
 WITH changed AS (UPDATE gm_reports SET snapshot=${JSON.stringify(snapshot)}::jsonb,revision=revision+1,updated_at=now(),actor_id=${actor},refresh_token=NULL,refresh_expires_at=NULL WHERE week=${week}::date AND status='draft' AND refresh_token=${lease}::uuid AND refresh_expires_at>now() RETURNING *,to_char(week,'YYYY-MM-DD') week_key),
 audit AS (INSERT INTO gm_report_events(week,revision,action,actor_id) SELECT week,revision,'refresh',${actor} FROM changed) SELECT * FROM changed`;
  if (!rows[0]) throw conflict();
  return report(rows[0]);
}
export async function finaliseReport(
  week: string,
  revision: number,
  actor: string,
) {
  const prior = await getReport(week);
  if (prior?.status === "finalised") return prior;
  if (!prior?.snapshot || prior.snapshot.issues.length)
    throw new ReportError(
      "Refresh the report and resolve missing figures before finalising. Clearly labelled estimates are allowed.",
    );
  const rows = await overlaySql`
 WITH changed AS (UPDATE gm_reports SET status='finalised',finalised_at=now(),updated_at=now(),revision=revision+1,actor_id=${actor},refresh_token=NULL,refresh_expires_at=NULL
 WHERE week=${week}::date AND revision=${revision} AND status='draft' AND (refresh_token IS NULL OR refresh_expires_at<now()) RETURNING *,to_char(week,'YYYY-MM-DD') week_key),
 audit AS (INSERT INTO gm_report_events(week,revision,action,actor_id) SELECT week,revision,'finalise',${actor} FROM changed) SELECT * FROM changed`;
  if (!rows[0]) throw conflict();
  return report(rows[0]);
}
