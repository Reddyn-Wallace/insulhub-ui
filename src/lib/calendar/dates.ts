const timeZone = "Pacific/Auckland";
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone, year: "numeric", month: "2-digit", day: "2-digit",
});
const offsetFormat = new Intl.DateTimeFormat("en-NZ", { timeZone, timeZoneName: "longOffset" });
const dayMs = 24 * 60 * 60 * 1000;

export function calendarDay(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dayFormat.format(date);
}

function offsetMs(instant: number) {
  const zone = offsetFormat.formatToParts(instant).find(part => part.type === "timeZoneName")?.value;
  const match = zone?.match(/^GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return 0;
  const [, sign, hours, minutes, seconds = "0"] = match;
  return (sign === "-" ? -1 : 1) * (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000;
}

function nzMidnight(utcDay: number) {
  const estimate = utcDay - offsetMs(utcDay);
  return utcDay - offsetMs(estimate);
}

export function calendarDateBounds(from: string, to: string) {
  return {
    start: new Date(nzMidnight(Date.parse(`${from}T00:00:00Z`))).toISOString(),
    end: new Date(nzMidnight(Date.parse(`${to}T00:00:00Z`) + dayMs) - 1).toISOString(),
  };
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function startOfWeekMonday(date: Date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, amount: number) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + amount);
  return d;
}

export function dateKeyLocal(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function calendarRangeForMonth(month: Date) {
  const calendarStart = startOfWeekMonday(month);
  const calendarEnd = addDays(startOfWeekMonday(endOfMonth(month)), 6);
  const from = dateKeyLocal(calendarStart);
  const to = dateKeyLocal(calendarEnd);
  return { calendarStart, calendarEnd, from, to, key: `${from}_${to}` };
}

export type MonthRange = ReturnType<typeof calendarRangeForMonth>;
