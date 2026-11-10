import { NextRequest, NextResponse } from "next/server";
import { requireReportActor } from "./access";
import { ReportError, weekKey } from "./model";
import { loadSnapshot } from "./source";
import * as store from "./store";
function response(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function handle(
  request: NextRequest,
  week?: string,
  settings = false,
) {
  try {
    const actor = await requireReportActor(request);
    if (week && (!/^\d{4}-\d{2}-\d{2}$/.test(week) || weekKey(week) !== week))
      throw new ReportError("Choose a valid Monday.");
    if (request.method === "GET") {
      if (settings) return response(await store.readSettings());
      return response(
        week
          ? { report: await store.getReport(week) }
          : { reports: await store.listReports() },
      );
    }
    const raw = await request.text();
    if (raw.length > 70000) throw new ReportError("Request is too large.", 413);
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      throw new ReportError("Invalid request.");
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new ReportError("Invalid request.");
    if (settings) {
      if (!Number.isInteger(input.revision) || input.revision < 0)
        throw new ReportError("Invalid settings revision.");
      return response(
        await store.saveSettings(input.settings, input.revision, actor.id),
      );
    }
    if (!week) throw new ReportError("Select a report week.");
    if (input.action === "refresh") {
      const current = await store.readSettings();
      if (!current)
        throw new ReportError(
          "Set report costs and targets before building a report.",
          422,
        );
      const r = await store.createReport(week, actor.id);
      if (r.status === "finalised")
        throw new ReportError("Finalised reports cannot be refreshed.", 409);
      const lease = await store.startRefresh(week, actor.id);
      try {
        return response({
          report: await store.publishRefresh(
            week,
            lease,
            await loadSnapshot(actor.token, week, current.settings),
            actor.id,
          ),
        });
      } catch (e) {
        await store.cancelRefresh(week, lease);
        throw e;
      }
    }
    if (!Number.isInteger(input.revision) || input.revision < 1)
      throw new ReportError("Invalid report revision.");
    if (input.action === "commentary")
      return response({
        report: await store.saveCommentary(
          week,
          input.commentary,
          input.revision,
          actor.id,
        ),
      });
    if (input.action === "finalise")
      return response({
        report: await store.finaliseReport(week, input.revision, actor.id),
      });
    throw new ReportError("Choose a valid report action.");
  } catch (error) {
    return response(
      {
        error:
          error instanceof ReportError
            ? error.message
            : "The report could not be loaded or saved. Please retry.",
      },
      error instanceof ReportError ? error.status : 503,
    );
  }
}
