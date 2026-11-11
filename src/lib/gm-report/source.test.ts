import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), sql: vi.fn(), splits: vi.fn() }));
vi.mock("./access", () => ({ sourceQuery: m.query }));
vi.mock("@/lib/overlay-db", () => ({ overlaySql: m.sql }));
vi.mock("@/lib/installation-splits/store", () => ({ readSplits: m.splits }));
import { loadSnapshot, GM_JOBS_QUERY } from "./source";
import { SourceReadError } from "./source-error";
const settings = {
  wallBagCost: 100,
  ceilingBagCost: 200,
  weeklyWages: 1000,
  weeklyOpex: 500,
  profitBudget: 1000,
  salesSqmBudget: 400,
  councilAliases: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  m.splits.mockResolvedValue({});
  m.sql.mockResolvedValue([]);
});
it("does not request acceptedAt from the bulk endpoint that returns null for that non-null field", async () => {
  m.query.mockImplementation(async (_token, query) => {
    if (query === GM_JOBS_QUERY) {
      if (/\bacceptedAt\b/.test(query))
        throw Error(
          "Cannot return null for non-nullable field JobSchema.acceptedAt",
        );
      return {
        jobs: {
          total: 1,
          results: [
            {
              _id: "a",
              stage: "SCHEDULED",
              quote: {
                status: "ACCEPTED",
                c_total: 1150,
                wall: { SQM: 80, c_bagCount: 10 },
              },
              installation: { installDate: "2026-11-17T00:00:00Z" },
            },
          ],
        },
      };
    }
    return { job: { _id: "a", acceptedAt: "2026-11-10T00:00:00Z" } };
  });
  const snapshot = await loadSnapshot("token", "2026-11-09", settings);
  expect(snapshot.sales.sqm).toBe(80);
  expect(snapshot.sales.jobs[0].date).toBe("2026-11-10");
  expect(m.query).toHaveBeenCalledTimes(2);
});
it("reuses an existing acceptance date only when fresh job metadata proves the job has not changed", async () => {
  m.sql.mockImplementation(async (strings: TemplateStringsArray) =>
    strings.join("").includes("gm_report_accepted_dates")
      ? [
          {
            insulhub_job_id: "a",
            accepted_at: "2026-11-10T00:00:00Z",
            last_checked_at: "2026-11-11T00:00:00Z",
          },
        ]
      : [],
  );
  m.query
    .mockResolvedValueOnce({
      jobs: {
        total: 1,
        results: [
          {
            _id: "a",
            updatedAt: "2026-11-09T00:00:00Z",
            stage: "SCHEDULED",
            quote: {
              status: "ACCEPTED",
              c_total: 1150,
              wall: { SQM: 80, c_bagCount: 10 },
            },
            installation: { installDate: "2026-11-17T00:00:00Z" },
          },
        ],
      },
    })
    .mockRejectedValue(Error("Unnecessary historical detail read"));
  const snapshot = await loadSnapshot("token", "2026-11-09", settings);
  expect(snapshot.sales.sqm).toBe(80);
  expect(m.query).toHaveBeenCalledTimes(1);
});
it("refreshes the acceptance date for a job modified after its last cached lookup", async () => {
  m.sql.mockImplementation(async (strings: TemplateStringsArray) =>
    strings.join("").includes("gm_report_accepted_dates")
      ? [
          {
            insulhub_job_id: "a",
            accepted_at: "2026-11-03T00:00:00Z",
            last_checked_at: "2026-11-04T00:00:00Z",
          },
        ]
      : [],
  );
  m.query
    .mockResolvedValueOnce({
      jobs: {
        total: 1,
        results: [
          {
            _id: "a",
            updatedAt: "2026-11-10T00:00:00Z",
            stage: "SCHEDULED",
            quote: {
              status: "ACCEPTED",
              c_total: 1150,
              wall: { SQM: 80, c_bagCount: 10 },
            },
            installation: { installDate: "2026-11-17T00:00:00Z" },
          },
        ],
      },
    })
    .mockResolvedValueOnce({
      job: { _id: "a", acceptedAt: "2026-11-10T00:00:00Z" },
    });
  const snapshot = await loadSnapshot("token", "2026-11-09", settings);
  expect(snapshot.sales.jobs[0].date).toBe("2026-11-10");
  expect(m.query).toHaveBeenCalledTimes(2);
});
it.each([
  { updatedAt: undefined, accepted_at: "2026-11-10T00:00:00Z" },
  { updatedAt: "invalid", accepted_at: "2026-11-10T00:00:00Z" },
  {
    updatedAt: "2026-11-09T00:00:00Z",
    accepted_at: null,
    accepted_at_missing: true,
  },
  { updatedAt: "2026-11-09T00:00:00Z", accepted_at: "invalid" },
  {
    updatedAt: "2026-11-09T00:00:00Z",
    accepted_at: "2026-11-10T00:00:00Z",
    last_error: "old failure",
  },
])(
  "rechecks missing dates and untrustworthy cache metadata: %j",
  async (row) => {
    m.sql.mockImplementation(async (strings: TemplateStringsArray) =>
      strings.join("").includes("gm_report_accepted_dates")
        ? [
            {
              insulhub_job_id: "a",
              last_checked_at: "2026-11-11T00:00:00Z",
              ...row,
            },
          ]
        : [],
    );
    m.query
      .mockResolvedValueOnce({
        jobs: {
          total: 1,
          results: [{ _id: "a", stage: "SCHEDULED", updatedAt: row.updatedAt }],
        },
      })
      .mockResolvedValueOnce({
        job: { _id: "a", acceptedAt: "2026-11-10T00:00:00Z" },
      });
    await loadSnapshot("token", "2026-11-09", settings);
    expect(m.query).toHaveBeenCalledTimes(2);
  },
);
it("re-reads missing acceptance dates on refresh and reads real split and placeholder sources", async () => {
  const j = {
    _id: "a",
    stage: "SCHEDULED",
    quote: {
      status: "ACCEPTED",
      c_total: 1150,
      wall: { SQM: 80, c_bagCount: 10 },
    },
    installation: { installDate: "2026-11-17T00:00:00Z" },
  };
  m.query
    .mockResolvedValueOnce({ jobs: { total: 1, results: [j] } })
    .mockResolvedValueOnce({
      job: { _id: "a", acceptedAt: "2026-11-10T00:00:00Z" },
    });
  m.sql.mockResolvedValue([
    { id: "p", title: "Surfapore", starts_at: "2026-11-11T00:00:00Z" },
  ]);
  const s = await loadSnapshot("token", "2026-11-09", settings);
  expect(s.sales.sqm).toBe(80);
  expect(s.current.placeholders[0].title).toBe("Surfapore");
  expect(m.splits).toHaveBeenCalledWith(["a"]);
  expect(m.query).toHaveBeenCalledTimes(2);
});
it("never publishes success after a truncated or duplicated upstream job list", async () => {
  m.query.mockResolvedValueOnce({
    jobs: { total: 2, results: [{ _id: "a" }, { _id: "a" }] },
  });
  await expect(
    loadSnapshot("token", "2026-11-09", settings),
  ).rejects.toMatchObject({ status: 503 });
  expect(m.sql).not.toHaveBeenCalled();
});
it("fails a whole refresh when an acceptance-date lookup fails", async () => {
  m.query
    .mockResolvedValueOnce({
      jobs: { total: 1, results: [{ _id: "a", stage: "INSTALLATION" }] },
    })
    .mockRejectedValue(Error("upstream"));
  await expect(loadSnapshot("token", "2026-11-09", settings)).rejects.toThrow();
});
it("flags a specifically missing acceptance date without inventing a sale week or losing the remaining report", async () => {
  m.query
    .mockResolvedValueOnce({
      jobs: {
        total: 1,
        results: [
          {
            _id: "a",
            stage: "SCHEDULED",
            quote: {
              status: "ACCEPTED",
              c_total: 1150,
              wall: { SQM: 80, c_bagCount: 10 },
            },
            installation: { installDate: "2026-11-17T00:00:00Z" },
          },
        ],
      },
    })
    .mockRejectedValueOnce(
      new SourceReadError({
        operation: "GMReportAcceptedAt",
        httpStatus: 200,
        errors: [
          {
            code: "INTERNAL_SERVER_ERROR",
            path: ["job", "acceptedAt"],
            cause: "missing-required-field",
          },
        ],
      }),
    );
  const s = await loadSnapshot("token", "2026-11-09", settings);
  expect(s.sales.jobs).toHaveLength(0);
  expect(s.sales.undatedJobs).toHaveLength(1);
  expect(s.pipeline.sqm).toBe(80);
});
it("still rejects a failed refresh when a different required CRM field is missing", async () => {
  m.query
    .mockResolvedValueOnce({
      jobs: { total: 1, results: [{ _id: "a", stage: "SCHEDULED" }] },
    })
    .mockRejectedValueOnce(
      new SourceReadError({
        operation: "GMReportAcceptedAt",
        httpStatus: 200,
        errors: [
          {
            code: "INTERNAL_SERVER_ERROR",
            path: ["job", "_id"],
            cause: "missing-required-field",
          },
        ],
      }),
    );
  await expect(
    loadSnapshot("token", "2026-11-09", settings),
  ).rejects.toMatchObject({ status: 503 });
});
it("does not look up sale dates for leads carrying an accepted quote status", async () => {
  m.query
    .mockResolvedValueOnce({
      jobs: {
        total: 1,
        results: [
          {
            _id: "lead",
            stage: "LEAD",
            quote: { status: "ACCEPTED" },
            createdAt: "2026-11-10T00:00:00Z",
          },
        ],
      },
    })
    .mockRejectedValue(new Error("Lead must not be hydrated"));
  const snapshot = await loadSnapshot("token", "2026-11-09", settings);
  expect(snapshot.leads[1].count).toBe(1);
  expect(snapshot.sales.undatedJobs).toEqual([]);
  expect(m.query).toHaveBeenCalledTimes(1);
});
