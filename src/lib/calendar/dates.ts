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

export function calendarDateBatches(from: string, to: string) {
  const first = Date.parse(`${from}T00:00:00Z`);
  const last = Date.parse(`${to}T00:00:00Z`);
  const days = (last - first) / dayMs + 1;
  // The normal month grid has four to six complete weeks. Keep other date
  // ranges on the existing paginated path and cap month reads at three batches.
  if (days < 28 || days > 42 || days % 7 !== 0) return [calendarDateBounds(from, to)];

  const batches = [];
  for (let start = first; start <= last; start += 14 * dayMs) {
    const end = Math.min(last, start + 13 * dayMs);
    batches.push(calendarDateBounds(
      new Date(start).toISOString().slice(0, 10),
      new Date(end).toISOString().slice(0, 10),
    ));
  }
  return batches;
}
