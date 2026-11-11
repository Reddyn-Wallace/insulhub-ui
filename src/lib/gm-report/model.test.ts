import { expect, it } from "vitest";
import { buildSnapshot, parseSettings, weekKey } from "./model";
import { initialSplit } from "../installation-splits/projection";
const settings = {
  wallBagCost: 1000,
  ceilingBagCost: 2000,
  weeklyWages: 10000,
  weeklyOpex: 5000,
  profitBudget: 10000,
  salesSqmBudget: 100,
  councilAliases: [],
};
const job = {
  _id: "a",
  jobNumber: 1,
  createdAt: "2026-11-08T12:00:00Z",
  acceptedAt: "2026-11-09T00:00:00Z",
  stage: "INSTALLATION",
  quote: {
    status: "ACCEPTED",
    c_total: 1150,
    wall: { SQM: 80, c_bagCount: 10 },
    ceiling: { SQM: 0, c_bagCount: 0 },
    extras: [{ name: "Council Exemption Application", price: 100 }],
  },
  installation: {
    installDate: "2026-11-10T00:00:00Z",
    installStatus: "INSTALLED_AS_QUOTED",
  },
  installerChecksheet: { complete: true, actualBags: 8 },
};
const build = (jobs = [job], splits = {}, placeholders = []) =>
  buildSnapshot(
    "2026-11-09",
    jobs,
    splits,
    placeholders,
    settings,
    "2026-11-16T00:00:00Z",
  );
it("uses NZ Monday boundaries across DST and year boundaries", () => {
  expect(weekKey("2026-11-08T12:00:00Z")).toBe("2026-11-09");
  expect(weekKey("2026-09-27T11:00:00Z")).toBe("2026-09-28");
  expect(weekKey("2027-01-01")).toBe("2026-12-28");
});
it("calculates ex-GST revenue without adding council revenue twice, deducts actual bags and full fixed costs", () => {
  const s = build();
  expect(s.current.pnl).toMatchObject({
    revenue: 100000,
    wallCogs: 8000,
    ceilingCogs: 0,
    council: 10000,
    wages: 10000,
    opex: 5000,
    profit: 67000,
    variance: 57000,
  });
  expect(s.leads[0].count).toBe(1);
  expect(s.sales.sqm).toBe(80);
  expect(s.sales.variance).toBe(-20);
});
it("deduplicates whole-job sales but allocates completed and remaining split portions separately", () => {
  const split = {
    ...initialSplit(job),
    visits: [
      {
        id: "first",
        date: "2026-11-10",
        percent: 60,
        state: "completed" as const,
      },
      {
        id: "next",
        date: "2026-11-17",
        percent: 40,
        state: "planned" as const,
      },
    ],
  };
  const s = build([job], { a: split });
  expect(s.sales.jobs).toHaveLength(1);
  expect(s.current.sqm).toBe(48);
  expect(s.current.pnl.revenue).toBe(60000);
  expect(s.upcoming[0].sqm).toBe(32);
  expect(s.pipeline).toMatchObject({ sqm: 32, days: 0.4, weeks: 0.08 });
  expect(s.current.rows[0].basis).toContain("Allocated");
  expect(s.current.rows[0].estimated).toBe(true);
});
it("uses estimated usage for incomplete split work and excludes undated remainders from booked pipeline", () => {
  const source = {
    ...job,
    installerChecksheet: { complete: false, actualBags: 0 },
  };
  const split = {
    ...initialSplit(source),
    visits: [
      {
        id: "first",
        date: "2026-11-10",
        percent: 50,
        state: "completed" as const,
      },
      { id: "next", date: null, percent: 50, state: "planned" as const },
    ],
  };
  const s = build([source], { a: split });
  expect(s.current.pnl.wallCogs).toBe(5000);
  expect(s.current.estimated).toBe(true);
  expect(s.pipeline.sqm).toBe(0);
  expect(s.pipeline.unscheduledSqm).toBe(40);
});
it("treats placeholders as text only and subtracts fixed costs in an empty forecast week", () => {
  const s = buildSnapshot(
    "2026-11-09",
    [],
    {},
    [
      {
        id: "p",
        title: "Extra painting",
        startsAt: "2026-11-17T00:00:00Z",
        estimatedSqm: 999,
        estimatedValue: 99999,
      },
    ],
    settings,
  );
  expect(s.upcoming[0].placeholders).toHaveLength(1);
  expect(s.upcoming[0].sqm).toBe(0);
  expect(s.upcoming[0].pnl.profit).toBe(-15000);
  expect(s.pipeline.sqm).toBe(0);
});
it("keeps ceiling usage estimated, respects zero actual bags and flags missing inputs", () => {
  const j = {
    ...job,
    quote: { ...job.quote, ceiling: { SQM: 20, c_bagCount: 3 } },
    installerChecksheet: { complete: true, actualBags: 0 },
  };
  const s = build([j]);
  expect(s.current.pnl.wallCogs).toBe(0);
  expect(s.current.pnl.ceilingCogs).toBe(6000);
  expect(s.current.estimated).toBe(true);
  const missing = build([
    {
      ...job,
      installerChecksheet: {
        complete: true,
        actualBags: null as unknown as number,
      },
    },
  ]);
  expect(missing.issues.join(" ")).toContain("bag");
});
it("keeps planned past visits out of earned revenue and includes both booking statuses in forecast", () => {
  const planned = {
    ...job,
    installerChecksheet: { complete: false, actualBags: 0 },
    installation: { ...job.installation, installStatus: "SCHEDULED" },
  };
  const s = build([planned]);
  expect(s.current.rows).toHaveLength(1);
  expect(s.current.pnl.revenue).toBe(0);
  const future = build([
    {
      ...planned,
      installation: {
        ...planned.installation,
        installDate: "2026-11-17T00:00:00Z",
      },
    },
  ]);
  expect(future.upcoming[0].pnl.revenue).toBe(100000);
});
it("flags ambiguous council extras, recognises configured aliases and does not round fractions of bags to whole bags", () => {
  const j = {
    ...job,
    quote: {
      ...job.quote,
      extras: [{ name: "Council miscellaneous", price: 100 }],
    },
  };
  expect(build([j]).issues.join(" ")).toContain("council");
  const s = buildSnapshot("2026-11-09", [j], {}, [], {
    ...settings,
    councilAliases: ["Council miscellaneous"],
  });
  expect(s.current.pnl.council).toBe(10000);
});
it("validates settings, permits negative profit targets and rejects unknown/invalid settings", () => {
  expect(parseSettings({ ...settings, profitBudget: -1000 }).profitBudget).toBe(
    -1000,
  );
  expect(() => parseSettings({ ...settings, wallBagCost: -1 })).toThrow();
  expect(() => parseSettings({ ...settings, weeklyWages: Infinity })).toThrow();
  expect(() => parseSettings({ ...settings, extra: 1 })).toThrow();
});
it("does not turn leads, unaccepted quotes or completed-but-unmarked jobs into booked pipeline", () => {
  const lead = {
    ...job,
    stage: "LEAD",
    installation: { installDate: "2026-11-17" },
    installerChecksheet: { complete: false, actualBags: 0 },
  };
  const completed = { ...lead, _id: "done", stage: "COMPLETED" };
  const s = build([lead, completed]);
  expect(s.pipeline.sqm).toBe(0);
  expect(s.pipeline.unscheduledSqm).toBe(0);
  expect(s.upcoming[0].rows.map((r) => r.jobId)).toEqual(["done"]);
});
it("does not silently discard wall costs when a mixed job is missing wall area", () => {
  const mixed = {
    ...job,
    quote: {
      ...job.quote,
      wall: { SQM: null as unknown as number, c_bagCount: 10 },
      ceiling: { SQM: 20, c_bagCount: 3 },
    },
  };
  const s = build([mixed]);
  expect(s.current.pnl.wallCogs).toBe(8000);
  expect(s.issues.join(" ")).toContain("Wall area");
});
it("uses explicitly recorded actual bags for a completed split visit even before the final job checksheet", () => {
  const incomplete = {
    ...job,
    installerChecksheet: { complete: false, actualBags: 0 },
  };
  const split = {
    ...initialSplit(incomplete),
    visits: [
      {
        id: "first",
        date: "2026-11-10",
        percent: 50,
        state: "completed" as const,
        actualBags: 9,
      },
      {
        id: "next",
        date: "2026-11-17",
        percent: 50,
        state: "planned" as const,
      },
    ],
  };
  const s = build([incomplete], { a: split });
  expect(s.current.pnl.wallCogs).toBe(9000);
  expect(s.current.rows[0].basis).toBe("Actual recorded");
});
it("shows completed and planned calendar visits in a retrospective forward week", () => {
  const completed = {
    ...job,
    installation: { ...job.installation, installDate: "2026-11-17" },
  };
  const planned = {
    ...completed,
    _id: "planned",
    installerChecksheet: { complete: false, actualBags: 0 },
    installation: {
      installDate: "2026-11-18",
      installStatus: "SCHEDULED",
      checkSheetSignedAsComplete: false,
    },
  };
  const snapshot = build([completed, planned]);
  expect(snapshot.upcoming[0].rows.map((r) => [r.jobId, r.completed])).toEqual([
    ["a", true],
    ["planned", false],
  ]);
  expect(snapshot.upcoming[0].sqm).toBe(160);
  expect(snapshot.upcoming[0].pnl).toMatchObject({
    revenue: 200000,
    wallCogs: 18000,
  });
  expect(snapshot.pipeline.sqm).toBe(80);
});
it("does not count a lead or label it as a missing sale even when it carries acceptance fields", () => {
  const lead = { ...job, stage: "LEAD", acceptedAtMissing: true };
  expect(build([lead]).sales).toMatchObject({
    jobs: [],
    undatedJobs: [],
    sqm: 0,
  });
});
it("flags a scheduled installation whose source quote has zero area", () => {
  const emptyQuote = {
    ...job,
    quote: { ...job.quote, wall: { SQM: 0, c_bagCount: 0 } },
    installerChecksheet: { complete: true, actualBags: 0 },
  };
  expect(build([emptyQuote]).current.issues.join(" ")).toMatch(/area/i);
});
it("keeps signed installation work in actuals when the calendar status has not caught up", () => {
  const signed = {
    ...job,
    installation: {
      ...job.installation,
      installStatus: "SCHEDULED",
      checkSheetSignedAsComplete: true,
    },
  };
  const snapshot = build([signed]);
  expect(snapshot.current.pnl).toMatchObject({
    revenue: 100000,
    wallCogs: 8000,
  });
  expect(snapshot.pipeline.sqm).toBe(0);
});
it("removes GST from the taxable amount and keeps a separate consent fee in revenue", () => {
  const quoted = {
    ...job,
    quote: { ...job.quote, c_total: 1250, consentFee: 100 },
  };
  const s = build([quoted]);
  expect(s.current.rows[0]).toMatchObject({
    grossRevenue: 125000,
    revenue: 110000,
    council: 10000,
  });
  expect(s.current.pnl).toMatchObject({
    revenue: 110000,
    council: 10000,
    profit: 77000,
  });
  expect(s.sales.jobs[0].revenue).toBe(110000);
});
it("keeps the saved calendar value and updated quote distinct on a split visit", () => {
  const saved = initialSplit(job);
  const split = {
    ...saved,
    visits: [
      {
        id: "done",
        date: "2026-11-10",
        percent: 50,
        state: "completed" as const,
      },
      {
        id: "later",
        date: "2026-11-17",
        percent: 50,
        state: "planned" as const,
      },
    ],
  };
  const updated = { ...job, quote: { ...job.quote, c_total: 1380 } };
  const s = build([updated], { a: split });
  expect(s.current.rows[0]).toMatchObject({
    calendarRevenue: 57500,
    grossRevenue: 69000,
    revenue: 60000,
    council: 5000,
  });
});
it("flags an override whose separate consent fee and recorded GST do not reconcile", () => {
  const overridden = {
    ...job,
    quote: {
      ...job.quote,
      c_total: 1250,
      consentFee: 100,
      totalOverridden: true,
      c_gst: 200,
    },
  };
  const s = build([overridden]);
  expect(s.current.issues.join(" ")).toMatch(/GST.*overridden/i);
  expect(s.sales.jobs[0].revenueIssue).toMatch(/GST.*overridden/i);
});
