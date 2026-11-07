import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ read: vi.fn(), fetch: vi.fn() }));
vi.mock("./store", () => ({ readSplits: mocks.read }));
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
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.read.mockResolvedValue({});
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { jobs: { total: 1, results: [job] } } }),
  });
});
const req = () =>
  new NextRequest(
    "http://localhost/api/calendar/jobs?start=2026-11-01&end=2026-11-30",
    { headers: { "x-access-token": "test" } },
  );
it("includes return visit in a new month even when legacy install date lies outside the range", async () => {
  const split = completeVisit(initialSplit(job), "initial", 60, "2026-11-10");
  mocks.read.mockResolvedValue({ [job._id]: split });
  const response = await GET(req());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.jobs).toHaveLength(1);
  expect(body.jobs[0].quote.c_total).toBe(4000);
  expect(body.jobs[0].splitVisit.percent).toBe(40);
  expect(body.jobs[0].splitSource.quote.c_total).toBe(10000);
  expect(body.jobs[0].installationSplit.visits).toHaveLength(2);
  const query = JSON.parse(mocks.fetch.mock.calls[0][1].body);
  expect(query.variables.installStartDate).toBeUndefined();
  expect(query.variables.limit).toBe(250);
});
it("returns unscheduled remainder separately without duplicating the original job", async () => {
  mocks.read.mockResolvedValue({
    [job._id]: completeVisit(initialSplit(job), "initial", 60, null),
  });
  const body = await (await GET(req())).json();
  expect(body.jobs).toEqual([]);
  expect(body.unscheduled).toHaveLength(1);
  expect(body.unscheduled[0]._id).toBe(job._id);
});
it("fails visibly when job results or allocation storage are incomplete", async () => {
  mocks.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: { jobs: { total: 2, results: [] } } }),
  });
  expect((await GET(req())).status).toBe(500);
  mocks.read.mockRejectedValueOnce(Error("storage unavailable"));
  expect((await GET(req())).status).toBe(500);
});
