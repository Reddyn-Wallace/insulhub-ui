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
