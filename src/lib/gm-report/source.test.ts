import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), sql: vi.fn(), splits: vi.fn() }));
vi.mock("./access", () => ({ sourceQuery: m.query }));
vi.mock("@/lib/overlay-db", () => ({ overlaySql: m.sql }));
vi.mock("@/lib/installation-splits/store", () => ({ readSplits: m.splits }));
import { loadSnapshot, GM_JOBS_QUERY } from "./source";
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
