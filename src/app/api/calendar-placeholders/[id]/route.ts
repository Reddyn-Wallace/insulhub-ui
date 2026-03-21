import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import {
  CALENDAR_PLACEHOLDER_ACCOUNT,
  CALENDAR_PLACEHOLDER_RANGE,
  CALENDAR_PLACEHOLDER_SHEET_ID,
  CalendarPlaceholder,
  normalizePlaceholderRow,
  placeholderToRow,
} from "@/lib/calendarPlaceholders";

const execFileAsync = promisify(execFile);
export const runtime = "nodejs";

type PlaceholderDraft = Partial<CalendarPlaceholder>;

async function gog(args: string[]) {
  const { stdout } = await execFileAsync("gog", args, { maxBuffer: 1024 * 1024 * 4 });
  return stdout.trim();
}

async function readPlaceholdersRaw() {
  const out = await gog([
    "sheets", "get", CALENDAR_PLACEHOLDER_SHEET_ID, CALENDAR_PLACEHOLDER_RANGE,
    "--json", "--account", CALENDAR_PLACEHOLDER_ACCOUNT,
  ]);
  const parsed = JSON.parse(out || "{}");
  const values: string[][] = parsed.values || [];
  return values.map((row, idx) => ({ rowIndex: idx + 2, item: normalizePlaceholderRow(row) })).filter((x) => x.item);
}

function cleanDate(value?: string) {
  if (!value) return "";
  return value.slice(0, 10);
}

function buildItem(input: PlaceholderDraft, existing: CalendarPlaceholder): CalendarPlaceholder {
  const now = new Date().toISOString();
  const startDate = cleanDate(input.startDate || input.date || existing.startDate) || cleanDate(existing.date) || cleanDate(now);
  const endDate = cleanDate(input.endDate || existing.endDate) || startDate;
  return {
    ...existing,
    title: (input.title ?? existing.title).trim(),
    date: startDate,
    startDate,
    endDate,
    status: (input.status || existing.status) as CalendarPlaceholder["status"],
    scope: (input.scope ?? existing.scope) as CalendarPlaceholder["scope"],
    team: (input.team ?? existing.team).trim(),
    notes: (input.notes ?? existing.notes).trim(),
    color: (input.color ?? existing.color).trim(),
    active: input.active ?? existing.active,
    sortOrder: Number(input.sortOrder ?? existing.sortOrder ?? 0) || 0,
    updatedAt: now,
  };
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await req.json();
    const rows = await readPlaceholdersRaw();
    const match = rows.find((r) => r.item?.id === id);
    if (!match?.item) return NextResponse.json({ error: "Placeholder not found" }, { status: 404 });
    const item = buildItem(body, match.item);
    await gog([
      "sheets", "update", CALENDAR_PLACEHOLDER_SHEET_ID, `Sheet1!A${match.rowIndex}:N${match.rowIndex}`,
      "--values-json", JSON.stringify([placeholderToRow(item)]),
      "--input", "USER_ENTERED",
      "--account", CALENDAR_PLACEHOLDER_ACCOUNT,
    ]);
    return NextResponse.json({ placeholder: item });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update placeholder" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const rows = await readPlaceholdersRaw();
    const match = rows.find((r) => r.item?.id === id);
    if (!match?.item) return NextResponse.json({ error: "Placeholder not found" }, { status: 404 });
    const item = { ...match.item, active: false, updatedAt: new Date().toISOString() };
    await gog([
      "sheets", "update", CALENDAR_PLACEHOLDER_SHEET_ID, `Sheet1!A${match.rowIndex}:N${match.rowIndex}`,
      "--values-json", JSON.stringify([placeholderToRow(item)]),
      "--input", "USER_ENTERED",
      "--account", CALENDAR_PLACEHOLDER_ACCOUNT,
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete placeholder" }, { status: 500 });
  }
}
