import { calendarRows } from "../installation-splits/model";
import { reconcileUsage } from "../installation-splits/projection";
import { toNzDateKey } from "../reports/sales-installs-types";
import type {
  Settings,
  Snapshot,
  Job,
  Placeholder,
  Splits,
  Row,
  Week,
} from "./types";
export class ReportError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const money = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;
export const addDays = (day: string, count: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
};
export function weekKey(date: string): string {
  const key = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : toNzDateKey(date);
  if (
    !key ||
    !Number.isFinite(Date.parse(key)) ||
    new Date(key).toISOString().slice(0, 10) !== key
  )
    throw new ReportError("Choose a valid week.");
  const d = new Date(`${key}T12:00:00Z`);
  return addDays(key, -((d.getUTCDay() + 6) % 7));
}
const numeric = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;
export function parseSettings(input: unknown): Settings {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ReportError("Check the report settings.");
  const x = input as Settings;
  const keys = [
    "wallBagCost",
    "ceilingBagCost",
    "weeklyWages",
    "weeklyOpex",
    "profitBudget",
    "salesSqmBudget",
    "councilAliases",
  ];
  if (
    Object.keys(x).some((k) => !keys.includes(k)) ||
    keys.slice(0, 6).some((k) => {
      const v = x[k as keyof Settings];
      return (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        Math.abs(v) > 1e10 ||
        (k !== "profitBudget" && v < 0) ||
        (k !== "salesSqmBudget" && !Number.isInteger(v))
      );
    }) ||
    !Array.isArray(x.councilAliases) ||
    x.councilAliases.length > 50 ||
    x.councilAliases.some(
      (a) => typeof a !== "string" || !a.trim() || a.length > 150,
    )
  )
    throw new ReportError(
      "Enter valid costs and targets. Money must be in whole cents.",
    );
  return { ...x, councilAliases: x.councilAliases.map((a) => a.trim()) };
}
const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
function fees(job: Job, settings: Settings) {
  const lines: { name: string; cents: number }[] = [],
    issues: string[] = [];
  for (const extra of job.quote?.extras || []) {
    const name = extra.name || "",
      key = normalise(name);
    const match =
      settings.councilAliases.some((a) => normalise(a) === key) ||
      /\bcouncil\b.*\b(fee|fees|application|exemption)\b/.test(key) ||
      /\b(fee|fees|application|exemption)\b.*\bcouncil\b/.test(key);
    if (match) {
      if (numeric(extra.price))
        lines.push({ name, cents: Math.round(extra.price * 100) });
      else issues.push("Council fee amount is missing.");
    } else if (/\bcouncil\b/.test(key) && extra.price !== 0)
      issues.push(`Review council extra: ${name}`);
  }
  return { lines, issues };
}
// Integer cents, including the last-visit rounding residue, must reconcile to a whole job.
function shares(total: number, percents: number[]) {
  let assigned = 0;
  return percents.map((p, i) => {
    const n =
      i === percents.length - 1
        ? total - assigned
        : Math.floor((total * p) / 100);
    assigned += n;
    return n;
  });
}
function project(job: Job, splits: Splits, settings: Settings): Row[] {
  const split = splits[job._id],
    wall = job.quote?.wall?.SQM,
    ceiling = job.quote?.ceiling?.SQM;
  const w = numeric(wall) ? wall : 0,
    c = numeric(ceiling) ? ceiling : 0;
  const complete =
    job.stage === "COMPLETED" ||
    job.installerChecksheet?.complete === true ||
    job.installation?.checkSheetSignedAsComplete === true ||
    ["INSTALLED_AS_QUOTED", "INSTALLED_WITH_VARIATIONS_FROM_QUOTE"].includes(
      job.installation?.installStatus || "",
    );
  const visits = split
    ? split.visits
    : [
        {
          id: "whole",
          date: toNzDateKey(job.installation?.installDate) || null,
          percent: 100,
          state: complete ? ("completed" as const) : ("planned" as const),
        },
      ];
  const rawTotal = job.quote?.c_total;
  const revenues = shares(
    numeric(rawTotal) ? Math.round((rawTotal / 1.15) * 100) : 0,
    visits.map((v) => v.percent),
  );
  const council = fees(job, settings),
    councilTotals = shares(
      council.lines.reduce((s, l) => s + l.cents, 0),
      visits.map((v) => v.percent),
    );
  const budget = job.quote?.wall?.c_bagCount,
    ceilingBudget = job.quote?.ceiling?.c_bagCount;
  const hasWall =
    w > 0 ||
    (numeric(budget) && budget > 0) ||
    (numeric(job.installerChecksheet?.actualBags) &&
      job.installerChecksheet.actualBags > 0);
  const hasCeiling = c > 0 || (numeric(ceilingBudget) && ceilingBudget > 0);
  const currentSplit = split
    ? {
        ...split,
        area: w + c,
        wallArea: w,
        ceilingArea: c,
        value: rawTotal ?? 0,
        budgetBags: numeric(budget) ? budget : null,
      }
    : null;
  const usage = currentSplit ? reconcileUsage(job, currentSplit) : null;
  // Reuse existing centi-bag distribution for split estimates.
  const estimates = currentSplit
    ? calendarRows({ ...currentSplit, area: numeric(budget) ? budget : 0 })
    : null;
  return visits.map((visit, index) => {
    const issues = [...council.issues];
    const done = visit.state === "completed",
      share = visit.percent / 100;
    if (!numeric(rawTotal)) issues.push("Quote revenue is missing.");
    if (!numeric(wall) && !numeric(ceiling))
      issues.push("Quoted area is missing.");
    if (hasWall && (!numeric(wall) || wall === 0))
      issues.push("Wall area is missing or zero despite wall bag usage.");
    if (hasCeiling && (!numeric(ceiling) || ceiling === 0))
      issues.push("Ceiling area is missing or zero despite ceiling bag usage.");
    let wallBags: number | null = !hasWall
      ? 0
      : numeric(budget)
        ? estimates
          ? estimates[index].area
          : budget
        : null;
    let basis = "Estimated",
      estimated = w + c > 0;
    if (done && hasWall) {
      if (usage) {
        const row = usage.rows.find((r) => r.id === visit.id);
        const recorded = split?.visits.find(
          (v) => v.id === visit.id,
        )?.actualBags;
        wallBags = numeric(recorded) ? recorded : (row?.bags ?? null);
        basis =
          numeric(recorded) || row?.basis === "recorded"
            ? "Actual recorded"
            : row?.basis === "actual-total-allocation"
              ? "Allocated from actual total"
              : "Estimated";
        estimated = basis !== "Actual recorded";
        if (usage.warning) issues.push(usage.warning);
      } else if (numeric(job.installerChecksheet?.actualBags)) {
        wallBags = job.installerChecksheet!.actualBags!;
        basis = "Actual recorded";
        estimated = false;
      } else {
        wallBags = null;
        issues.push("Actual wall bag usage is missing.");
      }
    }
    const ceilingBags = !hasCeiling
      ? 0
      : numeric(ceilingBudget)
        ? ceilingBudget * share
        : null;
    if (hasCeiling) {
      estimated = true;
      basis = hasWall ? `${basis}; ceiling estimated` : "Ceiling estimated";
    }
    if (wallBags === null) issues.push("Wall bag usage is missing.");
    if (ceilingBags === null) issues.push("Ceiling bag estimate is missing.");
    return {
      id: `${job._id}:${visit.id}`,
      jobId: job._id,
      number: String(job.jobNumber ?? ""),
      customer: job.client?.contactDetails?.name || "Unnamed customer",
      date: visit.date || "",
      percent: visit.percent,
      completed: done,
      wallSqm: money(w * share),
      ceilingSqm: money(c * share),
      sqm: money((w + c) * share),
      revenue: revenues[index],
      wallBags,
      ceilingBags,
      council: councilTotals[index],
      councilLines: council.lines,
      basis,
      estimated,
      issues,
    };
  });
}
export function buildSnapshot(
  week: string,
  jobs: Job[],
  splits: Splits,
  placeholders: Placeholder[],
  settings: Settings,
  now = new Date().toISOString(),
): Snapshot {
  if (weekKey(week) !== week)
    throw new ReportError("Choose a Monday week start.");
  parseSettings(settings);
  const unique = [
    ...new Map(
      jobs.filter((j) => !j.archivedAt).map((j) => [j._id, j]),
    ).values(),
  ];
  const rows = unique
    .filter(
      (j) =>
        splits[j._id] ||
        ["SCHEDULED", "INSTALLATION", "INVOICE", "COMPLETED"].includes(
          j.stage || "",
        ),
    )
    .flatMap((j) => project(j, splits, settings));
  function buildWeek(start: string, forecast: boolean): Week {
    const end = addDays(start, 7),
      selected = rows
        .filter(
          (r) => r.date >= start && r.date < end && (!forecast || !r.completed),
        )
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) || a.number.localeCompare(b.number),
        );
    const counted = forecast ? selected : selected.filter((r) => r.completed);
    const sum = (f: (r: Row) => number) =>
      Math.round(counted.reduce((s, r) => s + f(r), 0));
    const revenue = sum((r) => r.revenue),
      wallCogs = sum((r) => (r.wallBags ?? 0) * settings.wallBagCost),
      ceilingCogs = sum((r) => (r.ceilingBags ?? 0) * settings.ceilingBagCost),
      council = sum((r) => r.council);
    const profit =
      revenue -
      wallCogs -
      ceilingCogs -
      council -
      settings.weeklyWages -
      settings.weeklyOpex;
    return {
      week: start,
      rows: selected,
      placeholders: placeholders
        .filter((p) => {
          const d = toNzDateKey(p.startsAt);
          return d < end && (p.endsAt ? toNzDateKey(p.endsAt) : d) >= start;
        })
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      sqm: money(counted.reduce((s, r) => s + r.sqm, 0)),
      estimated: counted.some((r) => r.estimated),
      issues: counted.flatMap((r) =>
        r.issues.map((issue) => `Job ${r.number || r.jobId}: ${issue}`),
      ),
      pnl: {
        revenue,
        wallCogs,
        ceilingCogs,
        council,
        wages: settings.weeklyWages,
        opex: settings.weeklyOpex,
        profit,
        budget: settings.profitBudget,
        variance: profit - settings.profitBudget,
      },
    };
  }
  const current = buildWeek(week, false),
    upcoming = [
      buildWeek(addDays(week, 7), true),
      buildWeek(addDays(week, 14), true),
    ];
  // Pipeline is what is still booked at the snapshot time, including overdue remaining visits.
  const pending = rows.filter((r) => !r.completed),
    sqm = money(pending.filter((r) => r.date).reduce((s, r) => s + r.sqm, 0));
  const sold = unique
    .filter((j) => {
      const d = toNzDateKey(j.acceptedAt);
      return d >= week && d < addDays(week, 7);
    })
    .map((j) => {
      const wallSqm = j.quote?.wall?.SQM ?? 0,
        ceilingSqm = j.quote?.ceiling?.SQM ?? 0;
      return {
        id: j._id,
        number: String(j.jobNumber ?? ""),
        customer: j.client?.contactDetails?.name || "Unnamed customer",
        date: toNzDateKey(j.acceptedAt),
        wallSqm,
        ceilingSqm,
        sqm: wallSqm + ceilingSqm,
        revenue: Math.round(((j.quote?.c_total ?? 0) / 1.15) * 100),
      };
    });
  const salesSqm = money(sold.reduce((s, j) => s + j.sqm, 0));
  return {
    version: 1,
    week,
    builtAt: now,
    retrospective: addDays(week, 7) < weekKey(now),
    settings: { ...settings, councilAliases: [...settings.councilAliases] },
    leads: Array.from({ length: 7 }, (_, i) => {
      const date = addDays(week, i);
      return {
        date,
        count: unique.filter((j) => toNzDateKey(j.createdAt) === date).length,
      };
    }),
    current,
    upcoming,
    pipeline: {
      sqm,
      days: money(sqm / 80),
      weeks: money(sqm / 400),
      unscheduledSqm: money(
        pending.filter((r) => !r.date).reduce((s, r) => s + r.sqm, 0),
      ),
    },
    sales: {
      jobs: sold,
      sqm: salesSqm,
      budget: settings.salesSqmBudget,
      variance: money(salesSqm - settings.salesSqmBudget),
    },
    issues: [...current.issues, ...upcoming.flatMap((w) => w.issues)],
  };
}
