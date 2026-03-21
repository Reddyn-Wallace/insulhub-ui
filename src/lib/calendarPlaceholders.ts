export const CALENDAR_PLACEHOLDER_SHEET_ID = "15vtFkOQkuwZN0IDylSVXHYJhvvmvSJ-AeQxLByaq_hY";
export const CALENDAR_PLACEHOLDER_ACCOUNT = "reddyn@insulmax.co.nz";
export const CALENDAR_PLACEHOLDER_RANGE = "Sheet1!A2:N1000";

export type CalendarPlaceholderStatus = "pencilled" | "confirmed" | "blocked";
export type CalendarPlaceholderScope = "internal" | "external" | "both" | "";

export interface CalendarPlaceholder {
  id: string;
  title: string;
  date: string;
  startDate: string;
  endDate: string;
  status: CalendarPlaceholderStatus;
  scope: CalendarPlaceholderScope;
  team: string;
  notes: string;
  color: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export const PLACEHOLDER_HEADER = [
  "id",
  "title",
  "date",
  "start_date",
  "end_date",
  "status",
  "scope",
  "team",
  "notes",
  "color",
  "active",
  "sort_order",
  "created_at",
  "updated_at",
];

export function normalizePlaceholderRow(row: string[]): CalendarPlaceholder | null {
  if (!row?.[0]) return null;
  return {
    id: row[0] || "",
    title: row[1] || "",
    date: row[2] || row[3] || "",
    startDate: row[3] || row[2] || "",
    endDate: row[4] || row[3] || row[2] || "",
    status: (row[5] as CalendarPlaceholderStatus) || "pencilled",
    scope: (row[6] as CalendarPlaceholderScope) || "",
    team: row[7] || "",
    notes: row[8] || "",
    color: row[9] || "slate",
    active: String(row[10] || "true").toLowerCase() !== "false",
    sortOrder: Number(row[11] || 0) || 0,
    createdAt: row[12] || "",
    updatedAt: row[13] || "",
  };
}

export function placeholderToRow(item: CalendarPlaceholder): string[] {
  return [
    item.id,
    item.title,
    item.date,
    item.startDate,
    item.endDate,
    item.status,
    item.scope,
    item.team,
    item.notes,
    item.color,
    item.active ? "true" : "false",
    String(item.sortOrder ?? 0),
    item.createdAt,
    item.updatedAt,
  ];
}
