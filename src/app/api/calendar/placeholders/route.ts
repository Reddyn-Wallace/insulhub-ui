import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";

type PlaceholderInput = {
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

function parseNumber(value: PlaceholderInput["estimatedSqm"]) {
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

export async function GET(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();

    const { searchParams } = new URL(request.url);
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    const rows = start && end
      ? await overlaySql`
          SELECT *
          FROM calendar_placeholders
          WHERE starts_at >= ${start}::timestamptz
            AND starts_at <= ${end}::timestamptz
            AND resolved_at IS NULL
          ORDER BY starts_at ASC, created_at ASC
        `
      : await overlaySql`
          SELECT *
          FROM calendar_placeholders
          WHERE resolved_at IS NULL
          ORDER BY starts_at ASC, created_at ASC
        `;

    return NextResponse.json({ placeholders: rows.map(toPlaceholder) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load placeholders" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();

    const input = (await request.json()) as PlaceholderInput;
    const title = input.title?.trim();
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (!input.startsAt || Number.isNaN(new Date(input.startsAt).getTime())) {
      return NextResponse.json({ error: "Valid startsAt is required" }, { status: 400 });
    }

    const status = input.status || "pencilled";
    const scope = input.scope || "";
    if (!["pencilled", "confirmed"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    if (!["", "internal", "external", "both"].includes(scope)) {
      return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
    }

    const rows = await overlaySql`
      INSERT INTO calendar_placeholders (
        starts_at,
        ends_at,
        title,
        status,
        scope,
        estimated_sqm,
        estimated_value,
        note,
        linked_job_id,
        resolved_at
      )
      VALUES (
        ${input.startsAt}::timestamptz,
        ${input.endsAt || null}::timestamptz,
        ${title},
        ${status},
        ${scope},
        ${parseNumber(input.estimatedSqm)},
        ${parseNumber(input.estimatedValue)},
        ${input.note?.trim() || null},
        ${input.linkedJobId?.trim() || null},
        ${input.resolvedAt || null}::timestamptz
      )
      RETURNING *
    `;

    return NextResponse.json({ placeholder: toPlaceholder(rows[0]) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create placeholder" },
      { status: 500 }
    );
  }
}
