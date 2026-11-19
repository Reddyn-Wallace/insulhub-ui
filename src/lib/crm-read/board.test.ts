// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ gql: vi.fn(), pending: vi.fn(), revision: 0 }));
vi.mock("@/lib/graphql", () => ({ gql: mocks.gql }));
vi.mock("@/lib/installation-splits/client", () => ({
  loadPendingSplits: mocks.pending, getSplitRevision: () => mocks.revision,
}));
import { loadBoard, recentBoard } from "./board";

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  const values = new Map([["token", "staff"]]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null });
  mocks.pending.mockResolvedValue({});
});
const card = { _id: "one", stage: "LEAD", jobNumber: 1, updatedAt: "2026-11-12" };

it("uses one lean request across prefetch and page load and preserves empty stage results", async () => {
  mocks.gql.mockResolvedValue({ jobs: { total: 0, results: [] } });
  await Promise.all([loadBoard("LEAD", "staff"), loadBoard("LEAD", "staff")]);
  expect(mocks.gql).toHaveBeenCalledOnce();
  expect(mocks.gql.mock.calls[0][0]).not.toContain("council");
  expect(await recentBoard("LEAD", "staff")).toMatchObject({ data: { jobs: [], total: 0 } });
  expect(await recentBoard("LEAD", "other")).toBeNull();
});

it("loads additional legacy pages without changing the sort and filter input", async () => {
  mocks.gql.mockResolvedValueOnce({ jobs: { total: 2, results: [card] } })
    .mockResolvedValueOnce({ jobs: { total: 2, results: [{ ...card, _id: "two" }] } });
  const value = await loadBoard("LEAD", "staff");
  expect(value.jobs.map(row => row._id)).toEqual(["one", "two"]);
  expect(mocks.gql.mock.calls[1][1].skip).toBe(1);
});

it("starts the pending revisit lookup before the active job list responds", async () => {
  let finish!: (value: unknown) => void;
  mocks.gql.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const work = loadBoard("JOBS", "staff");
  await vi.waitFor(() => expect(mocks.pending).toHaveBeenCalledOnce());
  expect(mocks.gql.mock.calls[0][1].stages).toEqual(["SCHEDULED", "INSTALLATION", "INVOICE"]);
  finish({ jobs: { total: 1, results: [{ ...card, stage: "INSTALLATION" }] } });
  expect((await work).jobs.map(row => row._id)).toEqual(["one"]);
});

it("includes planned work from a completed parent and retains the frozen allocation", async () => {
  const completed = { ...card, _id: "completed", stage: "COMPLETED" };
  mocks.pending.mockResolvedValue({
    completed: {
      id: "completed", number: "100", customer: "Customer", version: 1,
      wallArea: 90, ceilingArea: 10, area: 100, value: 2000, budgetBags: 10,
      checksheet: { complete: true, actualBags: 10 }, history: [],
      visits: [
        { id: "original", date: "2026-11-12", percent: 70, state: "completed" },
        { id: "revisit", date: null, percent: 30, state: "planned" },
      ],
    },
  });
  mocks.gql.mockResolvedValueOnce({ jobs: { total: 0, results: [] } })
    .mockResolvedValueOnce({ parent0: completed });
  const { jobs } = await loadBoard("JOBS", "staff");
  expect(mocks.gql.mock.calls[1][1]).toEqual({ job0: "completed" });
  expect(jobs).toEqual([expect.objectContaining({
    _id: "completed", splitVisit: expect.objectContaining({ id: "revisit", percent: 30 }),
    quote: expect.objectContaining({ c_total: 600, wall: { SQM: 27 }, ceiling: { SQM: 3 } }),
  })]);
});
