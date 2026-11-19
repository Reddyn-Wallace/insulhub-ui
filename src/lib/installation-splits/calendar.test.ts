import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ read: vi.fn(), fetch: vi.fn(), auth: vi.fn(), schema: vi.fn() }));
vi.mock("./store", () => ({ readCalendarSplits: mocks.read }));
vi.mock("@/lib/insulhub-auth", () => ({
  tokenFromRequest: (request: Request) => request.headers.get("x-access-token"),
  requireInsulhubAuth: mocks.auth,
}));
vi.mock("@/lib/overlay-db", () => ({ ensureOverlaySchema: mocks.schema }));
import { GET } from "@/app/api/calendar/jobs/route";
import { initialSplit } from "./projection";
import { completeVisit } from "./model";

const job = {
  _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  jobNumber: 42,
  stage: "INSTALLATION",
  quote: { c_total: 10000, wall: { SQM: 200, c_bagCount: 30 } },
  installation: { installDate: "2026-10-01T00:00:00Z" },
};
const regular = {
  ...job,
  _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
  installation: { installDate: "2026-11-05T00:00:00Z" },
};
const archived = { ...job, _id: "cccccccccccccccccccccccc", archivedAt: "2026-11-01" };
const outOfRange = { ...job, _id: "dddddddddddddddddddddddd" };
const split = completeVisit(initialSplit(job), "initial", 60, "2026-11-10");

type Query = { query: string; variables: Record<string, unknown> };

const response = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
const list = (results: object[], total = results.length) => response({ jobs: { total, results } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.read.mockResolvedValue({});
  mocks.auth.mockResolvedValue(null);
  mocks.schema.mockResolvedValue(undefined);
  mocks.fetch.mockResolvedValue(list([regular]));
});

const req = (query = "start=2026-11-01&end=2026-11-30") =>
  new NextRequest(`http://localhost/api/calendar/jobs?${query}`, {
    headers: { "x-access-token": "test" },
  });

function queryAt(index: number): Query {
  return JSON.parse(mocks.fetch.mock.calls[index][1].body);
}

it("asks upstream for the visible NZ days and exposes backend timings", async () => {
  const result = await GET(req());
  expect(result.status).toBe(200);
  expect(queryAt(0).variables).toMatchObject({
    installStartDate: "2026-10-31T11:00:00.000Z",
    installEndDate: "2026-11-30T10:59:59.999Z",
    limit: 250,
  });
  expect(result.headers.get("server-timing")).toContain("jobs;dur=");
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect((await result.json()).jobs.map((row: typeof regular) => row._id)).toEqual([regular._id]);
});

it("keeps both ends of the NZ date range across the daylight-saving change", async () => {
  await GET(req("start=2026-09-27&end=2026-09-27"));
  expect(queryAt(0).variables).toMatchObject({
    installStartDate: "2026-09-26T12:00:00.000Z",
    installEndDate: "2026-09-27T10:59:59.999Z",
  });
});

it("looks up the source of a November revisit from October and preserves its allocation", async () => {
  mocks.read.mockResolvedValue({ [job._id]: split });
  mocks.fetch.mockResolvedValueOnce(list([regular])).mockResolvedValueOnce(response({ source0: job }));
  const result = await GET(req());
  expect(result.status).toBe(200);
  const body = await result.json();
  expect(body.jobs).toHaveLength(2);
  expect(body.jobs[1].quote.c_total).toBe(4000);
  expect(body.jobs[1].splitVisit.percent).toBe(40);
  expect(body.jobs[1].splitSource.quote.c_total).toBe(10000);
  expect(body.jobs[1].installationSplit.visits).toHaveLength(2);
  expect(queryAt(1).variables).toEqual({ id0: job._id });
  expect(mocks.fetch.mock.calls[1][1].headers["x-access-token"]).toBe("test");
});

it("hides superseded original dates and skips unrelated split source lookups", async () => {
  mocks.read.mockResolvedValue({
    [regular._id]: null,
    [outOfRange._id]: null,
  });
  const result = await GET(req());
  expect(result.status).toBe(200);
  expect((await result.json()).jobs).toEqual([]);
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it("excludes archived, inaccessible and out-of-stage split source jobs", async () => {
  mocks.read.mockResolvedValue(Object.fromEntries([job, archived, outOfRange].map(source => [source._id, split])));
  mocks.fetch.mockResolvedValueOnce(list([])).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      data: { source0: null, source1: archived, source2: { ...outOfRange, stage: "QUOTE" } },
      errors: [{ message: "Job unavailable", path: ["source0"], extensions: { code: "NOT_FOUND" } }],
    }),
  });
  const result = await GET(req());
  expect(result.status).toBe(200);
  expect((await result.json()).jobs).toEqual([]);
});

it("preserves undated planned visits for existing callers and skips them for visible-month reads", async () => {
  const undated = completeVisit(initialSplit(job), "initial", 60, null);
  mocks.read.mockResolvedValueOnce({ [job._id]: undated }).mockResolvedValueOnce({ [job._id]: null });
  mocks.fetch.mockResolvedValueOnce(list([])).mockResolvedValueOnce(response({ source0: job })).mockResolvedValueOnce(list([]));
  const body = await (await GET(req())).json();
  expect(body.jobs).toEqual([]);
  expect(body.unscheduled).toHaveLength(1);
  expect(body.unscheduled[0]._id).toBe(job._id);
  const visibleOnly = await (await GET(req("start=2026-11-01&end=2026-11-30&includeUnscheduled=0"))).json();
  expect(visibleOnly.unscheduled).toEqual([]);
  expect(mocks.read).toHaveBeenNthCalledWith(2, "2026-11-01", "2026-11-30", false);
  expect(mocks.fetch).toHaveBeenCalledTimes(3);
});

it("fails visibly when range results, split source results or split storage are incomplete", async () => {
  mocks.fetch.mockResolvedValueOnce(list([], 2));
  expect((await GET(req())).status).toBe(500);
  mocks.read.mockResolvedValueOnce({ [job._id]: split });
  mocks.fetch.mockResolvedValueOnce(list([])).mockResolvedValueOnce(response({}));
  expect((await GET(req())).status).toBe(500);
  mocks.read.mockRejectedValueOnce(Error("storage unavailable"));
  expect((await GET(req())).status).toBe(500);
});

it("never queries the overlay until CRM access has been verified", async () => {
  mocks.auth.mockResolvedValue(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));
  expect((await GET(req())).status).toBe(401);
  expect(mocks.schema).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});
