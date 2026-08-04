import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";
import {
  cleanSitePlanDrawingName,
  EMPTY_SITE_PLAN_DOCUMENT,
  parseSitePlanDocument,
} from "@/lib/site-plan-drawings";

function toSummary(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    source: "overlay" as const,
    jobId: String(row.insulhub_job_id),
    name: String(row.name),
    revision: Number(row.revision),
    wallCount: Number(row.wall_count || 0),
    textNoteCount: Number(row.text_note_count || 0),
    lastPdfFileName: row.last_pdf_file_name ? String(row.last_pdf_file_name) : null,
    lastExportedAt: row.last_exported_at ? String(row.last_exported_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function GET(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();
    const jobId = new URL(request.url).searchParams.get("jobId")?.trim() || "";
    if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });

    const rows = await overlaySql`
      SELECT
        id,
        insulhub_job_id,
        name,
        revision,
        last_pdf_file_name,
        last_exported_at,
        created_at,
        updated_at,
        jsonb_array_length(drawing_document->'walls') AS wall_count,
        jsonb_array_length(drawing_document->'textNotes') AS text_note_count
      FROM site_plan_drawings
      WHERE insulhub_job_id = ${jobId}
      ORDER BY created_at ASC
    `;

    return NextResponse.json(
      { drawings: rows.map(toSummary) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load site plan drawings" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();
    const input = (await request.json()) as { jobId?: unknown; name?: unknown; document?: unknown };
    const jobId = typeof input.jobId === "string" ? input.jobId.trim() : "";
    const name = cleanSitePlanDrawingName(input.name);
    const document = input.document === undefined
      ? EMPTY_SITE_PLAN_DOCUMENT
      : parseSitePlanDocument(input.document);

    if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    if (!name) return NextResponse.json({ error: "Drawing name is required" }, { status: 400 });
    if (!document) return NextResponse.json({ error: "Invalid drawing document" }, { status: 400 });

    const rows = await overlaySql`
      INSERT INTO site_plan_drawings (
        insulhub_job_id,
        name,
        drawing_document,
        schema_version
      )
      VALUES (
        ${jobId},
        ${name},
        ${JSON.stringify(document)}::jsonb,
        ${document.schemaVersion}
      )
      RETURNING
        id,
        insulhub_job_id,
        name,
        revision,
        last_pdf_file_name,
        last_exported_at,
        created_at,
        updated_at,
        jsonb_array_length(drawing_document->'walls') AS wall_count,
        jsonb_array_length(drawing_document->'textNotes') AS text_note_count
    `;

    return NextResponse.json({ drawing: toSummary(rows[0]) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create site plan drawing" },
      { status: 500 },
    );
  }
}
