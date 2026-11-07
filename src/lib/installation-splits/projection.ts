import { type SplitJob, usageRows, calendarRows } from "./model";
import { toNzDateKey } from "@/lib/reports/sales-installs-types";
export type SourceJob = {
  _id: string;
  jobNumber?: number | null;
  stage?: string | null;
  archivedAt?: string | null;
  client?: { contactDetails?: { name?: string | null } | null } | null;
  quote?: {
    c_total?: number | null;
    wall?: { SQM?: number | null; c_bagCount?: number | null } | null;
    ceiling?: { SQM?: number | null } | null;
  } | null;
  installation?: {
    installDate?: string | null;
    installStatus?: string | null;
    checkSheetSignedAsComplete?: boolean | null;
  } | null;
  installerChecksheet?: {
    complete?: boolean | null;
    actualBags?: number | null;
  } | null;
};
export type SavedSplit = SplitJob & {
  wallArea: number;
  ceilingArea: number;
  version: number;
};
export type VisitLabel = {
  count?: number;
  id: string;
  percent: number;
  state: "planned" | "completed";
};
const numeric = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;
export function initialSplit(job: SourceJob): SavedSplit {
  const wallArea = job.quote?.wall?.SQM ?? 0,
    ceilingArea = job.quote?.ceiling?.SQM ?? 0;
  if (
    !numeric(wallArea) ||
    !numeric(ceilingArea) ||
    !numeric(job.quote?.c_total)
  )
    throw Error(
      "A valid quote total and area are required before splitting this job.",
    );
  return {
    id: job._id,
    number: String(job.jobNumber ?? ""),
    customer: job.client?.contactDetails?.name || "",
    area: wallArea + ceilingArea,
    wallArea,
    ceilingArea,
    value: job.quote.c_total!,
    budgetBags: numeric(job.quote?.wall?.c_bagCount)
      ? job.quote.wall.c_bagCount
      : null,
    version: 0,
    visits: [
      {
        id: "initial",
        date: toNzDateKey(job.installation?.installDate) || null,
        percent: 100,
        state: "planned",
      },
    ],
    checksheet: { complete: false, actualBags: null },
    history: [],
  };
}
export function projectVisits<T extends SourceJob>(
  job: T,
  split: SplitJob & { wallArea?: number; ceilingArea?: number },
): Array<T & { splitVisit: VisitLabel }> {
  const values = calendarRows(split);
  return split.visits.map(
    (v, index) =>
      ({
        ...job,
        splitVisit: { id: v.id, percent: v.percent, state: v.state, count: split.visits.length },
        quote: {
          ...job.quote,
          c_total: values[index].value,
          wall: {
            ...job.quote?.wall,
            SQM: ((split.wallArea ?? 0) * v.percent) / 100,
          },
          ceiling: {
            ...job.quote?.ceiling,
            SQM: ((split.ceilingArea ?? 0) * v.percent) / 100,
          },
        },
        installation: {
          ...job.installation,
          installDate: v.date ? `${v.date}T00:00:00Z` : null,
        },
      }) as T & { splitVisit: VisitLabel },
  );
}
export function reconcileUsage(job: SourceJob, split: SplitJob) {
  const complete =
    job.installerChecksheet?.complete === true ||
    job.installation?.checkSheetSignedAsComplete === true;
  const actual = job.installerChecksheet?.actualBags;
  const missing = complete && !numeric(actual);
  const recorded = split.visits.reduce((n, v) => n + (v.actualBags ?? 0), 0);
  const conflict =
    complete &&
    numeric(actual) &&
    (recorded > actual ||
      (split.visits.every((v) => v.actualBags !== undefined) &&
        Math.round(recorded * 100) !== Math.round(actual * 100)));
  const model = {
    ...split,
    checksheet: {
      complete: complete && !missing && !conflict,
      actualBags: numeric(actual) ? actual : null,
    },
  };
  const rows = usageRows(model).map((r) => ({
    ...r,
    bags: missing || conflict ? (r.actualBags ?? null) : r.bags,
    basis:
      (missing || conflict) && r.actualBags !== undefined
        ? ("recorded" as const)
        : r.basis,
  }));
  const warning = missing
    ? "Final checksheet bag total is missing."
    : conflict
      ? "Final total does not reconcile with individually recorded usage."
      : complete && split.visits.some((v) => v.state === "planned")
        ? "Final checksheet is complete but remaining visit work has not been recorded. Record it to include the remaining allocation."
        : "";
  return { rows, warning, final: complete };
}
export type UsageAllocation = {
  id: string;
  percent: number;
  basis: "budget-estimate" | "actual-total-allocation" | "recorded";
  warning: string;
};
export function projectUsageJobs<T extends SourceJob>(
  job: T,
  split: SavedSplit,
): Array<T & { usageAllocation: UsageAllocation }> {
  const usage = reconcileUsage(job, split);
  return usage.rows.map(
    (row) =>
      ({
        ...job,
        usageAllocation: {
          id: row.id,
          percent: row.percent,
          basis: row.basis,
          warning: usage.warning,
        },
        installation: {
          ...job.installation,
          installDate: `${row.date}T00:00:00Z`,
        },
        installerChecksheet: {
          ...job.installerChecksheet,
          budgetBags: row.budget,
          actualBags: row.bags,
          wallAreaInstalled: null,
        },
      }) as T & { usageAllocation: UsageAllocation },
  );
}

export function needsHistoricalSplitReason(job: SourceJob): boolean {
  return (
    job.stage === "COMPLETED" ||
    ["INSTALLED_AS_QUOTED", "INSTALLED_WITH_VARIATIONS_FROM_QUOTE"].includes(
      job.installation?.installStatus || "",
    ) ||
    job.installerChecksheet?.complete === true ||
    job.installation?.checkSheetSignedAsComplete === true
  );
}
