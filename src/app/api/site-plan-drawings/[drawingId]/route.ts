import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";
import {
  cleanSitePlanDrawingName,
  isUuid,
  parseSitePlanDocument,
  type SitePlanDrawingDocument,
} from "@/lib/site-plan-drawings";

function rowDocument(value: unknown) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  return value;
}

function toDrawing(row: Record<string, unknown>) {
  const document = parseSitePlanDocument(rowDocument(row.drawing_document));
  if (!document) throw new Error("Stored site plan drawing is invalid or unsupported");
  return {
    id: String(row.id),
    source: "overlay" as const,
    jobId: String(row.insulhub_job_id),
    name: String(row.name),
    document,
    revision: Number(row.revision),
    lastPdfFileName: row.last_pdf_file_name ? String(row.last_pdf_file_name) : null,
    lastExportedAt: row.last_exported_at ? String(row.last_exported_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function readDrawing(drawingId: string, jobId: string) {
  const rows = await overlaySql`
    SELECT *
    FROM site_plan_drawings
    WHERE id = ${drawingId}::uuid
      AND insulhub_job_id = ${jobId}
    LIMIT 1
  `;
  return rows[0] ? toDrawing(rows[0]) : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ drawingId: string }> },
) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();
    const { drawingId } = await params;
    const jobId = new URL(request.url).searchParams.get("jobId")?.trim() || "";
    if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    if (!isUuid(drawingId)) return NextResponse.json({ error: "Invalid drawing id" }, { status: 400 });

    const drawing = await readDrawing(drawingId, jobId);
    if (!drawing) return NextResponse.json({ error: "Drawing not found" }, { status: 404 });
    return NextResponse.json({ drawing }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load site plan drawing" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ drawingId: string }> },
) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();
    const { drawingId } = await params;
    if (!isUuid(drawingId)) return NextResponse.json({ error: "Invalid drawing id" }, { status: 400 });

    const input = (await request.json()) as {
      jobId?: unknown;
      name?: unknown;
      document?: unknown;
      expectedRevision?: unknown;
      lastPdfFileName?: unknown;
    };
    const jobId = typeof input.jobId === "string" ? input.jobId.trim() : "";
    const expectedRevision = Number(input.expectedRevision);
    if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return NextResponse.json({ error: "expectedRevision is required" }, { status: 400 });
    }

    const existing = await readDrawing(drawingId, jobId);
    if (!existing) return NextResponse.json({ error: "Drawing not found" }, { status: 404 });
    const name = input.name === undefined ? existing.name : cleanSitePlanDrawingName(input.name);
    if (!name) return NextResponse.json({ error: "Drawing name is required" }, { status: 400 });

    let document: SitePlanDrawingDocument = existing.document;
    if (input.document !== undefined) {
      const parsed = parseSitePlanDocument(input.document);
      if (!parsed) return NextResponse.json({ error: "Invalid drawing document" }, { status: 400 });
      document = parsed;
    }

    const lastPdfFileName = input.lastPdfFileName === undefined
      ? existing.lastPdfFileName
      : input.lastPdfFileName === null
        ? null
        : typeof input.lastPdfFileName === "string"
          ? input.lastPdfFileName.trim().slice(0, 500) || null
          : existing.lastPdfFileName;
    const exportedNow = input.lastPdfFileName !== undefined && !!lastPdfFileName;

    const rows = await overlaySql`
      UPDATE site_plan_drawings
      SET
        name = ${name},
        drawing_document = ${JSON.stringify(document)}::jsonb,
        schema_version = ${document.schemaVersion},
        last_pdf_file_name = ${lastPdfFileName},
        last_exported_at = CASE WHEN ${exportedNow} THEN now() ELSE last_exported_at END,
        revision = revision + 1,
        updated_at = now()
      WHERE id = ${drawingId}::uuid
        AND insulhub_job_id = ${jobId}
        AND revision = ${expectedRevision}
      RETURNING *
    `;

    if (!rows[0]) {
      return NextResponse.json(
        { error: "This drawing was changed by someone else. Reload it before saving again." },
        { status: 409 },
      );
    }
    return NextResponse.json({ drawing: toDrawing(rows[0]) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save site plan drawing" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ drawingId: string }> },
) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();
    const { drawingId } = await params;
    const jobId = new URL(request.url).searchParams.get("jobId")?.trim() || "";
    if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    if (!isUuid(drawingId)) return NextResponse.json({ error: "Invalid drawing id" }, { status: 400 });

    const rows = await overlaySql`
      DELETE FROM site_plan_drawings
      WHERE id = ${drawingId}::uuid
        AND insulhub_job_id = ${jobId}
      RETURNING id
    `;
    if (!rows[0]) return NextResponse.json({ error: "Drawing not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete site plan drawing" },
      { status: 500 },
    );
  }
}
