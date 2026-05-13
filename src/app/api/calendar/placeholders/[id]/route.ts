import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";

type PlaceholderPatch = {
  startsAt?: string;
  endsAt?: string | null;
  title?: string;
  status?: "pencilled" | "confirmed";
  scope?: "" | "internal" | "external" | "both";
  estimatedSqm?: number | string | null;
  estimatedValue?: number | string | null;
  note?: string | null;
  linkedJobId?: string | null;
  resolvedAt?: string | null;
};

function parseNumber(value: PlaceholderPatch["estimatedSqm"]) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPlaceholder(row: Record<string, unknown>) {
  return {
    source: "overlay",
    kind: "placeholder",
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    title: row.title,
    status: row.status,
    scope: row.scope,
    estimatedSqm: row.estimated_sqm === null ? null : Number(row.estimated_sqm),
    estimatedValue: row.estimated_value === null ? null : Number(row.estimated_value),
    note: row.note,
    linkedJobId: row.linked_job_id,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();
    const { id } = await params;
    const input = (await request.json()) as PlaceholderPatch;

    if (input.status && !["pencilled", "confirmed"].includes(input.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    if (input.scope !== undefined && !["", "internal", "external", "both"].includes(input.scope)) {
      return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
    }
    if (input.startsAt && Number.isNaN(new Date(input.startsAt).getTime())) {
      return NextResponse.json({ error: "Invalid startsAt" }, { status: 400 });
    }

    const existingRows = await overlaySql`
      SELECT *
      FROM calendar_placeholders
      WHERE id = ${id}::uuid
      LIMIT 1
    `;

    const existing = existingRows[0] as Record<string, unknown> | undefined;
    if (!existing) {
      return NextResponse.json({ error: "Placeholder not found" }, { status: 404 });
    }

    const rows = await overlaySql`
      UPDATE calendar_placeholders
      SET
        starts_at = ${input.startsAt || existing.starts_at}::timestamptz,
        ends_at = ${input.endsAt === undefined ? existing.ends_at : input.endsAt}::timestamptz,
        title = ${input.title?.trim() || existing.title},
        status = ${input.status || existing.status},
        scope = ${input.scope === undefined ? existing.scope : input.scope},
        estimated_sqm = ${input.estimatedSqm === undefined ? existing.estimated_sqm : parseNumber(input.estimatedSqm)},
        estimated_value = ${input.estimatedValue === undefined ? existing.estimated_value : parseNumber(input.estimatedValue)},
        note = ${input.note === undefined ? existing.note : input.note?.trim() || null},
        linked_job_id = ${input.linkedJobId === undefined ? existing.linked_job_id : input.linkedJobId?.trim() || null},
        resolved_at = ${input.resolvedAt === undefined ? existing.resolved_at : input.resolvedAt}::timestamptz,
        updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING *
    `;

    return NextResponse.json({ placeholder: toPlaceholder(rows[0]) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update placeholder" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();
    const { id } = await params;
    const rows = await overlaySql`
      DELETE FROM calendar_placeholders
      WHERE id = ${id}::uuid
      RETURNING id
    `;

    if (!rows[0]) {
      return NextResponse.json({ error: "Placeholder not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete placeholder" },
      { status: 500 }
    );
  }
}
