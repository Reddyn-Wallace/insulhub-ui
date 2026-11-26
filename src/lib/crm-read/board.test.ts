// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ gql: vi.fn(), pending: vi.fn(), revision: 0 }));
vi.mock("@/lib/graphql", () => ({ gql: mocks.gql }));
vi.mock("@/lib/installation-splits/client", () => ({
  loadPendingSplits: mocks.pending, getSplitRevision: () => mocks.revision,
}));
import { loadBoard, readBoardSource, recentBoard } from "./board";
import { CrmReadAccessDenied } from "./session";

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

it("reads quote status and value for the full stage without loading every customer's contact", async () => {
  mocks.gql.mockResolvedValue({ jobs: { total: 1, results: [{ ...card, stage: "QUOTE" }] } });
  expect((await loadBoard("QUOTE", "staff")).total).toBe(1);
  expect(mocks.gql.mock.calls[0][0]).not.toContain("contactDetails");
  expect(mocks.gql.mock.calls[0][0]).not.toContain("allocatedTo");
  expect(mocks.gql.mock.calls[0][0]).toContain("c_total");
  expect(mocks.gql.mock.calls[0][0]).toContain("callbackDate");
  expect(mocks.gql.mock.calls[0][1].limit).toBe(1500);
});

it("retries a timed-out quote page without starting the complete scan again", async () => {
  const rows = ["first", "second", "third"].map(_id => ({ ...card, stage: "QUOTE", _id }));
  const offsets: number[] = [];
  let finishSecond!: (value: unknown) => void;
  mocks.gql.mockImplementation(async (_query, { skip, limit }) => {
    if (limit === 1500) throw new DOMException("Timed out", "TimeoutError");
    offsets.push(skip);
    expect(limit).toBe(skip === 0 ? 250 : 1);
    if (skip === 1) {
      if (offsets.filter(offset => offset === 1).length === 1) throw new DOMException("Timed out", "TimeoutError");
      return new Promise(resolve => { finishSecond = resolve; });
    }
    return { jobs: { total: 3, results: [rows[skip]] } };
  });
  const pending = readBoardSource("QUOTE", "staff");
  const outcome = pending.catch(error => error);
  await vi.waitFor(() => expect(finishSecond).toBeTypeOf("function"));
  expect(offsets).toContain(2);
  finishSecond({ jobs: { total: 3, results: [rows[1]] } });
  expect(await outcome).toEqual({ jobs: rows, total: 3 });
  expect(offsets.filter(offset => offset === 0)).toHaveLength(1);
});

it("uses bounded offsets if the first lean read is incomplete", async () => {
  const rows = Array.from({ length: 302 }, (_, i) => ({ ...card, _id: String(i), stage: "QUOTE" }));
  mocks.gql.mockImplementation(async (_query, { skip, limit }) => {
    expect(limit).toBe(skip === 0 ? 1500 : 250);
    return { jobs: { total: rows.length, results: rows.slice(skip, skip + (skip === 0 ? 301 : limit)) } };
  });
  expect(await readBoardSource("QUOTE", "staff")).toEqual({ jobs: rows, total: rows.length });
  expect(mocks.gql.mock.calls.map(([, { skip }]) => skip)).toEqual([0, 301]);
});

it("keeps filter-ready quote snapshots separate from the smaller unfiltered read", async () => {
  mocks.gql.mockResolvedValue({ jobs: { total: 1, results: [{ ...card, stage: "QUOTE" }] } });
  await loadBoard("QUOTE", "staff");
  expect(await recentBoard("QUOTE", "staff", true)).toBeNull();
  await loadBoard("QUOTE", "staff", true);
  expect(mocks.gql.mock.calls[0][0]).not.toContain("allocatedTo");
  expect(mocks.gql.mock.calls[1][0]).toContain("allocatedTo { _id }");
});

it("does not publish a partial view when another page reports a confirmed access refusal", async () => {
  const denial = new CrmReadAccessDenied("Request failed.");
  mocks.gql.mockImplementation(async (_query, { skip }) => {
    if (skip === 0) return { jobs: { total: 3, results: [{ ...card, stage: "QUOTE" }] } };
    if (skip === 1) throw Error("The CRM did not return a usable response.");
    throw denial;
  });
  await expect(loadBoard("QUOTE", "staff")).rejects.toBe(denial);
  expect(mocks.gql).toHaveBeenCalledTimes(3);
  expect(await recentBoard("QUOTE", "staff")).toBeNull();
});
