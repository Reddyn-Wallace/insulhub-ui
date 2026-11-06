import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  sql: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("./store", () => ({ readSplits: mocks.read }));
vi.mock("@/lib/overlay-db", () => ({
  ensureOverlaySchema: async () => {},
  overlaySql: mocks.sql,
}));
import { getSalesInstallsReport } from "@/lib/reports/sales-installs-server";
import { initialSplit } from "./projection";
import { completeVisit } from "./model";
const job = {
  _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  jobNumber: 42,
  stage: "INSTALLATION",
  createdAt: "2026-11-02T00:00:00Z",
  acceptedAt: "2026-11-03T00:00:00Z",
  quote: {
    status: "ACCEPTED",
    c_total: 10000,
    wall: { SQM: 120, c_bagCount: 30 },
    ceiling: { SQM: 80 },
  },
  installation: {
    installDate: "2026-11-06T00:00:00Z",
    installStatus: "INSTALL_NOT_FINISHED",
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { jobs: { total: 1, results: [job] } } }),
  });
  mocks.sql.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes("FROM report_accepted_dates"))
      return [{ insulhub_job_id: job._id, accepted_at: job.acceptedAt }];
    if (sql.includes("RETURNING built_at"))
      return [
        {
          built_at: "2026-11-06T00:00:00Z",
          expires_at: "2026-11-06T01:00:00Z",
        },
      ];
    if (sql.includes("RETURNING report_key"))
      return [{ report_key: "sales-installs-v2" }];
    return [];
  });
});
it("counts sale once, splits install values across weeks, and keeps only remaining work upcoming", async () => {
  const split = {
    ...initialSplit(job),
    ...completeVisit(initialSplit(job), "initial", 60, "2026-11-10"),
  };
  mocks.read.mockResolvedValue({ [job._id]: split });
  const first = await getSalesInstallsReport(
    "token",
    "2026-11-02",
    "2026-11-08",
  );
  expect(first.report.sales).toHaveLength(1);
  expect(first.report.sales[0].quote?.c_total).toBe(10000);
  expect(first.report.installs).toHaveLength(1);
  expect(first.report.installs[0].quote?.c_total).toBe(6000);
  expect(first.report.upcoming.confirmed).toHaveLength(1);
  expect(first.report.upcoming.confirmed[0].quote?.c_total).toBe(4000);
  expect(
    mocks.sql.mock.calls.some((call) =>
      call[0].join("").includes("SELECT payload, built_at"),
    ),
  ).toBe(false);
  const second = await getSalesInstallsReport(
    "token",
    "2026-11-09",
    "2026-11-15",
  );
  expect(second.report.sales).toHaveLength(0);
  expect(second.report.installs[0].quote?.c_total).toBe(4000);
});
it("puts undated remainder into unscheduled pipeline while retaining earlier completed work", async () => {
  const split = {
    ...initialSplit(job),
    ...completeVisit(initialSplit(job), "initial", 60, null),
  };
  mocks.read.mockResolvedValue({ [job._id]: split });
  const result = await getSalesInstallsReport(
    "token",
    "2026-11-02",
    "2026-11-08",
  );
  expect(result.report.upcoming.unscheduled[0].quote?.c_total).toBe(4000);
  expect(result.report.upcoming.confirmed).toHaveLength(0);
});
