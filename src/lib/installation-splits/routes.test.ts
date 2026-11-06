import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/lib/insulhub-auth", () => ({
  requireInsulhubAuth: mocks.auth,
  tokenFromRequest: () => "staff-token",
}));
vi.mock("./store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store")>()),
  readSplits: mocks.read,
  saveSplit: mocks.save,
}));
import { GET, POST } from "@/app/api/jobs/[id]/installation-splits/route";
import { POST as list } from "@/app/api/installation-splits/route";
import { initialSplit } from "./projection";
const id = "aaaaaaaaaaaaaaaaaaaaaaaa";
const source = {
  _id: id,
  jobNumber: 42,
  stage: "INSTALLATION",
  quote: { c_total: 10000, wall: { SQM: 200, c_bagCount: 30 } },
  installation: {
    installDate: "2026-11-06T00:00:00Z",
    installStatus: "INSTALL_NOT_FINISHED",
  },
  installerChecksheet: { complete: false, actualBags: 999 },
};
const context = { params: Promise.resolve({ id }) };
function req(body: unknown) {
  return new NextRequest(
    "http://localhost/api/jobs/" + id + "/installation-splits",
    { method: "POST", body: JSON.stringify(body) },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(null);
  mocks.read.mockResolvedValue({});
  mocks.save.mockImplementation(async (split) => ({ ...split, version: 1 }));
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { me: { _id: "actor" }, job: source } }),
  });
  vi.stubGlobal("fetch", mocks.fetch);
});
it("requires authentication before reading upstream or saving", async () => {
  mocks.auth.mockResolvedValue(
    NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  );
  expect((await POST(req({}), context)).status).toBe(401);
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
it("loads the real job with its current split state", async () => {
  expect((await GET(new NextRequest("http://localhost"), context)).status).toBe(
    200,
  );
  expect(mocks.fetch.mock.calls[0][1].headers["x-access-token"]).toBe(
    "staff-token",
  );
});
it("creates percentage records from server quote and never writes upstream or completes the parent job", async () => {
  const response = await POST(
    req({
      version: 0,
      action: "complete",
      visitId: "initial",
      percent: 60,
      date: "2026-11-10",
      value: 1,
      budgetBags: 1,
    }),
    context,
  );
  expect(response.status).toBe(200);
  const split = (await response.json()).split;
  expect(split.value).toBe(10000);
  expect(split.budgetBags).toBe(30);
  expect(split.visits.map((v: { percent: number }) => v.percent)).toEqual([
    60, 40,
  ]);
  expect(split.checksheet.complete).toBe(false);
  expect(mocks.save.mock.calls[0][2]).toBe("actor");
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).query).toMatch(
    /^query /,
  );
});
it("rejects stale clients, invalid input, archived jobs and missing access", async () => {
  mocks.read.mockResolvedValue({
    [id]: { ...initialSplit(source), version: 1 },
  });
  expect((await POST(req({ version: 0 }), context)).status).toBe(409);
  mocks.read.mockResolvedValue({});
  expect(
    (
      await POST(
        req({
          version: 0,
          action: "complete",
          visitId: "initial",
          percent: 101,
          date: null,
        }),
        context,
      )
    ).status,
  ).toBe(400);
  mocks.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      data: {
        me: { _id: "actor" },
        job: { ...source, archivedAt: "2026-11-01" },
      },
    }),
  });
  expect((await POST(req({ version: 0 }), context)).status).toBe(400);
  mocks.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ errors: [{ message: "no access" }] }),
  });
  expect((await GET(new NextRequest("http://localhost"), context)).status).toBe(
    403,
  );
  expect(mocks.save).not.toHaveBeenCalled();
});
it("stops reporting visibly on allocation storage errors instead of omitting split records", async () => {
  mocks.read.mockRejectedValue(Error("private database details"));
  const response = await list(req({ jobIds: [id] }));
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain(
    "private database details",
  );
});
it("validates IDs and malformed bodies before persistence", async () => {
  expect((await POST(req(null), context)).status).toBe(400);
  expect(
    (
      await POST(req({ version: 0 }), {
        params: Promise.resolve({ id: "../bad" }),
      })
    ).status,
  ).toBe(400);
  expect((await list(req({ jobIds: ["bad"] }))).status).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled();
});

it("requires the legacy installation date before first split to retain completion prerequisites", async () => {
  mocks.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      data: {
        me: { _id: "actor" },
        job: { ...source, installation: { installDate: null } },
      },
    }),
  });
  const response = await POST(
    req({
      version: 0,
      action: "complete",
      visitId: "initial",
      percent: 60,
      date: null,
      completedDate: "2026-11-06",
    }),
    context,
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain("original installation date");
  expect(mocks.save).not.toHaveBeenCalled();
});
