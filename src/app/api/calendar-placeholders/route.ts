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

type PlaceholderDraft = Partial<CalendarPlaceholder> & { title?: string; startDate?: string; date?: string };

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

function buildItem(input: PlaceholderDraft, existing?: CalendarPlaceholder): CalendarPlaceholder {
  const now = new Date().toISOString();
  const startDate = cleanDate(input.startDate || input.date || existing?.startDate) || cleanDate(existing?.date) || cleanDate(now);
  const endDate = cleanDate(input.endDate || existing?.endDate) || startDate;
  return {
    id: existing?.id || `ph_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    title: (input.title || existing?.title || "").trim(),
    date: startDate,
    startDate,
    endDate,
    status: (input.status || existing?.status || "pencilled") as CalendarPlaceholder["status"],
    scope: (input.scope || existing?.scope || "") as CalendarPlaceholder["scope"],
    team: (input.team || existing?.team || "").trim(),
    notes: (input.notes || existing?.notes || "").trim(),
    color: (input.color || existing?.color || "slate").trim(),
    active: input.active ?? existing?.active ?? true,
    sortOrder: Number(input.sortOrder ?? existing?.sortOrder ?? 0) || 0,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

export async function GET() {
  try {
    const rows = await readPlaceholdersRaw();
    const items = rows.map((r) => r.item).filter(Boolean).filter((item) => item!.active);
    return NextResponse.json({ placeholders: items });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load placeholders" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const item = buildItem(body);
    if (!item.title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
    await gog([
      "sheets", "append", CALENDAR_PLACEHOLDER_SHEET_ID, "Sheet1!A:N",
      "--values-json", JSON.stringify([placeholderToRow(item)]),
      "--input", "USER_ENTERED",
      "--account", CALENDAR_PLACEHOLDER_ACCOUNT,
    ]);
    return NextResponse.json({ placeholder: item });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create placeholder" }, { status: 500 });
  }
}
