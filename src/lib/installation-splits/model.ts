export type Visit = {
  id: string;
  date: string | null;
  percent: number;
  state: "planned" | "completed";
  actualBags?: number;
};
export type SplitJob = {
  id: string;
  number: string;
  customer: string;
  area: number;
  value: number;
  budgetBags: number | null;
  visits: Visit[];
  checksheet: { complete: boolean; actualBags: number | null };
  history: string[];
};
export type UsageBasis =
  | "budget-estimate"
  | "actual-total-allocation"
  | "recorded";
const round = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
function validDate(date: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date
  );
}
export function weekOf(date: string) {
  if (!validDate(date)) throw new Error("Enter a valid date.");
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export function completeVisit(
  job: SplitJob,
  visitId: string,
  percent: number,
  returnDate: string | null,
): SplitJob {
  const visit = job.visits.find((v) => v.id === visitId);
  if (!visit || visit.state !== "planned")
    throw new Error("This visit has already been recorded.");
  if (!visit.date || !validDate(visit.date))
    throw new Error("Set the visit date before recording progress.");
  if (
    !Number.isFinite(percent) ||
    percent <= 0 ||
    percent > visit.percent ||
    round(percent) !== percent
  )
    throw new Error(
      `Enter more than 0 and no more than ${visit.percent}%, with up to two decimal places.`,
    );
  if (
    percent < visit.percent &&
    returnDate &&
    (!validDate(returnDate) || returnDate < visit.date)
  )
    throw new Error("Return date must be on or after this visit.");
  const remaining = round(visit.percent - percent);
  return {
    ...job,
    visits: job.visits.flatMap((v) =>
      v.id !== visitId
        ? [v]
        : [
            { ...v, percent, state: "completed" as const },
            ...(remaining > 0
              ? [
                  {
                    id: crypto.randomUUID(),
                    date: returnDate,
                    percent: remaining,
                    state: "planned" as const,
                  },
                ]
              : []),
          ],
    ),
    history: [
      ...job.history,
      `${visit.date}: recorded ${percent}% of the whole job; ${remaining}% remaining${remaining ? ` (${returnDate || "unscheduled"})` : ""}.`,
    ],
  };
}
export function rescheduleVisit(
  job: SplitJob,
  visitId: string,
  date: string | null,
): SplitJob {
  const visit = job.visits.find((v) => v.id === visitId);
  if (!visit || visit.state !== "planned")
    throw new Error("Completed visits cannot be rescheduled.");
  const latest = job.visits
    .filter((v) => v.state === "completed")
    .map((v) => v.date || "")
    .sort()
    .at(-1);
  if (date && (!validDate(date) || (latest && date < latest)))
    throw new Error(
      "Choose a valid date on or after the last completed visit.",
    );
  return {
    ...job,
    visits: job.visits.map((v) => (v.id === visitId ? { ...v, date } : v)),
    history: [
      ...job.history,
      `Moved ${visit.percent}% from ${visit.date || "unscheduled"} to ${date || "unscheduled"}. Completed work unchanged.`,
    ],
  };
}
export function finaliseChecksheet(
  job: SplitJob,
  actualBags: number,
): SplitJob {
  if (job.visits.some((v) => v.state === "planned"))
    throw new Error(
      "Record all remaining work before completing the checksheet.",
    );
  if (
    !Number.isFinite(actualBags) ||
    actualBags < 0 ||
    round(actualBags) !== actualBags
  )
    throw new Error(
      "Enter a non-negative bag total with up to two decimal places.",
    );
  const recorded = round(
    job.visits.reduce((n, v) => n + (v.actualBags ?? 0), 0),
  );
  if (
    recorded > actualBags ||
    (job.visits.every((v) => v.actualBags !== undefined) &&
      recorded !== actualBags)
  )
    throw new Error(
      "The total conflicts with individually recorded usage. Correct the recorded usage first.",
    );
  return {
    ...job,
    checksheet: { complete: true, actualBags },
    history: [
      ...job.history,
      `Final checksheet: ${actualBags} actual bags. Earlier estimates recalculated across visits; visit quantities remain allocated estimates.`,
    ],
  };
}
// Allocate in integer hundredths; assign rounding residue to the final visit.
function distribute(total: number | null, visits: Visit[]): (number | null)[] {
  if (total === null) return visits.map(() => null);
  const weight = visits.reduce((n, v) => n + v.percent, 0);
  if (weight === 0) return [];
  const units = Math.round(total * 100);
  let assigned = 0;
  return visits.map((v, i) => {
    const share =
      i === visits.length - 1
        ? units - assigned
        : Math.floor((units * v.percent) / weight);
    assigned += share;
    return share / 100;
  });
}
export function calendarRows(job: SplitJob) {
  const areas = distribute(job.area, job.visits),
    values = distribute(job.value, job.visits);
  return job.visits.map((v, i) => ({
    ...v,
    jobId: job.id,
    number: job.number,
    customer: job.customer,
    area: areas[i]!,
    value: values[i]!,
  }));
}
export function usageRows(job: SplitJob) {
  const final = job.checksheet.complete && job.checksheet.actualBags !== null;
  const budget = distribute(job.budgetBags, job.visits);
  const unrecorded = job.visits.filter((v) => v.actualBags === undefined);
  const total = final
    ? round(
        job.checksheet.actualBags! -
          job.visits.reduce((n, v) => n + (v.actualBags ?? 0), 0),
      )
    : job.budgetBags;
  const allocation = final ? distribute(total, unrecorded) : budget;
  const finalById = new Map(unrecorded.map((v, i) => [v.id, allocation[i]]));
  return calendarRows(job).flatMap((visit, i) =>
    visit.state !== "completed"
      ? []
      : [
          {
            ...visit,
            budget: budget[i],
            bags: final
              ? (visit.actualBags ?? finalById.get(visit.id) ?? null)
              : budget[i],
            basis: (final
              ? visit.actualBags !== undefined
                ? "recorded"
                : "actual-total-allocation"
              : "budget-estimate") as UsageBasis,
          },
        ],
  );
}
export function undoLastProgress(job: SplitJob, reason: string): SplitJob {
  if (!reason.trim() || reason.trim().length > 500)
    throw Error("Enter a correction reason (up to 500 characters).");
  if (job.checksheet.complete)
    throw Error(
      "A completed checksheet must be reviewed before correcting visit progress.",
    );
  const completed = job.visits.filter((v) => v.state === "completed");
  const last = completed.at(-1);
  if (!last) throw Error("There is no recorded progress to correct.");
  if (last.actualBags !== undefined)
    throw Error(
      "This visit has recorded usage and requires a reviewed correction.",
    );
  const pending = job.visits.filter((v) => v.state === "planned");
  return {
    ...job,
    visits: [
      ...completed.slice(0, -1),
      {
        ...last,
        state: "planned",
        percent: round(
          last.percent + pending.reduce((n, v) => n + v.percent, 0),
        ),
      },
    ],
    history: [
      ...job.history,
      `Correction: reopened the last ${last.percent}% and its remaining work on ${last.date}. Reason: ${reason.trim()}`,
    ],
  };
}

// Only scheduling fields are editable here. Recorded quantities remain server-owned.
export function editVisits(job: SplitJob, input: unknown): SplitJob {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100)
    throw Error("Keep between 1 and 100 visits.");
  const ids = new Set<string>();
  const visits: Visit[] = input.map((row) => {
    if (!row || typeof row !== "object" ||
        typeof row.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(row.id) ||
        ids.has(row.id)) throw Error("Each visit must have a unique ID.");
    ids.add(row.id);
    if (row.state !== "planned" && row.state !== "completed")
      throw Error("Choose Planned or Done for each visit.");
    if (typeof row.percent !== "number" || !Number.isFinite(row.percent) ||
        row.percent <= 0 || row.percent > 100 || round(row.percent) !== row.percent)
      throw Error("Each visit needs a percentage greater than 0, with up to two decimal places.");
    if (row.date !== null && (typeof row.date !== "string" || !validDate(row.date)))
      throw Error("Enter a valid visit date.");
    if (row.state === "completed" && !row.date)
      throw Error("Done visits need the date the work happened.");
    const prior = job.visits.find(v => v.id === row.id);
    if (prior?.actualBags !== undefined && row.state !== "completed")
      throw Error("A visit with recorded usage must remain Done.");
    return {
      id: row.id, date: row.date, percent: row.percent, state: row.state,
      ...(prior?.actualBags !== undefined ? {actualBags: prior.actualBags} : {}),
    };
  });
  if (visits.reduce((sum,v) => sum + Math.round(v.percent * 100), 0) !== 10000)
    throw Error("Visit percentages must total 100%.");
  if (job.visits.some(v => v.actualBags !== undefined && !ids.has(v.id)))
    throw Error("A visit with recorded usage cannot be removed.");
  return {...job, visits, history: [...job.history, "Updated visits: " +
    visits.map((v,i) => `Visit ${i+1} · ${v.date || "Unscheduled"} · ${v.percent}% · ${v.state}`).join("; ")]};
}
