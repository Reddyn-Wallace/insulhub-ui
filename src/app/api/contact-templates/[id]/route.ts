import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";

type ContactTemplatePatch = {
  title?: string;
  channel?: "sms" | "email";
  description?: string | null;
  subject?: string | null;
  body?: string;
  sortOrder?: number | string | null;
};

function parseSortOrder(value: ContactTemplatePatch["sortOrder"], fallback: unknown) {
  if (value === undefined) return Number(fallback || 0);
  if (value === "" || value === null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toContactTemplate(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    channel: row.channel,
    description: row.description,
    subject: row.subject,
    body: row.body,
    sortOrder: row.sort_order,
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
    const input = (await request.json()) as ContactTemplatePatch;

    if (input.channel && !["sms", "email"].includes(input.channel)) {
      return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
    }

    const existingRows = await overlaySql`
      SELECT *
      FROM contact_templates
      WHERE id = ${id}::uuid
      LIMIT 1
    `;
    const existing = existingRows[0] as Record<string, unknown> | undefined;
    if (!existing) {
      return NextResponse.json({ error: "Contact template not found" }, { status: 404 });
    }

    const nextTitle = input.title === undefined ? String(existing.title) : input.title.trim();
    const nextBody = input.body === undefined ? String(existing.body) : input.body.trim();
    const nextChannel = input.channel || String(existing.channel);

    if (!nextTitle) return NextResponse.json({ error: "Title is required" }, { status: 400 });
    if (!nextBody) return NextResponse.json({ error: "Body is required" }, { status: 400 });

    const rows = await overlaySql`
      UPDATE contact_templates
      SET
        title = ${nextTitle},
        channel = ${nextChannel},
        description = ${input.description === undefined ? existing.description : input.description?.trim() || ""},
        subject = ${nextChannel === "email" ? input.subject === undefined ? existing.subject : input.subject?.trim() || "" : ""},
        body = ${nextBody},
        sort_order = ${parseSortOrder(input.sortOrder, existing.sort_order)},
        updated_at = now()
      WHERE id = ${id}::uuid
      RETURNING *
    `;

    return NextResponse.json({ template: toContactTemplate(rows[0]) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update contact template" },
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
      DELETE FROM contact_templates
      WHERE id = ${id}::uuid
      RETURNING id
    `;

    if (!rows[0]) {
      return NextResponse.json({ error: "Contact template not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete contact template" },
      { status: 500 }
    );
  }
}
