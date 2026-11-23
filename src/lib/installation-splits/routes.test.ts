import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  read: vi.fn(),
  pending: vi.fn(),
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
  readPendingSplits: mocks.pending,
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

it.each([
  { installerChecksheet: { complete: true, actualBags: 32 } },
  {
    installation: { ...source.installation, checkSheetSignedAsComplete: true },
  },
  {
    installation: {
      ...source.installation,
      installStatus: "INSTALLED_AS_QUOTED",
    },
  },
  { stage: "COMPLETED" },
])(
  "allows historical first splits with an audited reason: %j",
  async (overrides) => {
    const historical = { ...source, ...overrides };
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { me: { _id: "actor" }, job: historical } }),
    });
    const input = {
      version: 0,
      action: "complete",
      visitId: "initial",
      percent: 60,
      date: "2026-11-10",
      completedDate: "2026-11-06",
    };
    expect((await POST(req(input), context)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
    const response = await POST(
      req({ ...input, reason: "Work happened across two weeks" }),
      context,
    );
    expect(response.status).toBe(200);
    const split = (await response.json()).split;
    expect(split.visits.map((v: { percent: number }) => v.percent)).toEqual([
      60, 40,
    ]);
    expect(split.history.join(" ")).toContain("Work happened across two weeks");
    expect(mocks.save.mock.calls[0][3].reason).toBe(
      "Work happened across two weeks",
    );
    expect(JSON.parse(mocks.fetch.mock.calls.at(-1)![1].body).query).toMatch(
      /^query /,
    );
  },
);

it("saves a complete visit list atomically with trusted snapshots and audit", async () => {
 const visits = [
  {id:"initial",date:"2026-11-05",percent:60,state:"completed"},
  {id:"second",date:null,percent:25,state:"planned"},
  {id:"third",date:"2026-11-20",percent:15,state:"planned"},
 ];
 const response=await POST(req({version:0,action:"edit",visits,value:1}),context);
 expect(response.status).toBe(200);
 const {split}=await response.json();
 expect(split.visits).toEqual(visits);
 expect(split.value).toBe(10000);
 expect(mocks.save.mock.calls[0][3]?.visits).toEqual(visits);
 expect(split.history[0]).toContain("actor");
 expect((await POST(req({version:0,action:"edit",visits:visits.slice(0,2)}),context)).status).toBe(400);
});


it("lists pending overlays for the queue without fetching completed-job history",async()=>{
 mocks.pending.mockResolvedValue({[id]:initialSplit(source)});
 const response=await list(req({pending:true}));
 expect(response.status).toBe(200);
 expect((await response.json()).splits[id].visits[0].state).toBe("planned");
 expect(mocks.fetch).not.toHaveBeenCalled();
 mocks.auth.mockResolvedValue(NextResponse.json({error:"Unauthorized"},{status:401}));
 expect((await list(req({pending:true}))).status).toBe(401);
 expect(mocks.pending).toHaveBeenCalledTimes(1);
});

function splitWithReturnVisits() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
  return {
    ...initialSplit(source),
    version: 4,
    visits: [
      { id: "initial", date: "2020-01-01", percent: 50, state: "completed" as const },
      { id: "past", date: "2020-01-02", percent: 20, state: "planned" as const },
      { id: "past-again", date: "2020-01-03", percent: 10, state: "planned" as const },
      { id: "today", date: today, percent: 5, state: "planned" as const },
      { id: "future", date: "2099-11-13", percent: 5, state: "planned" as const },
      { id: "unscheduled", date: null, percent: 10, state: "planned" as const },
    ],
  };
}

it.each(["INSTALLED_AS_QUOTED", "INSTALLED_WITH_VARIATIONS_FROM_QUOTE"])(
  "records past returns once when the job detail verifies %s",
  async (installStatus) => {
    const stored = splitWithReturnVisits();
    mocks.read.mockResolvedValue({ [id]: stored });
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          me: { _id: "actor" },
          job: { ...source, installation: { ...source.installation, installStatus } },
        },
      }),
    });
    mocks.save.mockImplementation(async (next, version) => {
      const saved = { ...next, version: version + 1 };
      mocks.read.mockResolvedValue({ [id]: saved });
      return saved;
    });
    const response = await GET(new NextRequest("http://localhost"), context);
    expect(response.status).toBe(200);
    const { split } = await response.json();
    expect(split.version).toBe(5);
    expect(split.visits).toEqual(stored.visits.map(visit =>
      visit.id === "past" || visit.id === "past-again" ? { ...visit, state: "completed" } : visit,
    ));
    expect(mocks.save).toHaveBeenCalledWith(expect.anything(), 4, "system", {
      action: "complete-past-revisits",
      installStatus,
      dateBasis: "scheduled",
      visitIds: ["past", "past-again"],
    });
    expect((await GET(new NextRequest("http://localhost"), context)).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledTimes(1);
  },
);

it("keeps past revisits planned for an unfinished installation with completed paperwork", async () => {
  const stored = splitWithReturnVisits();
  mocks.read.mockResolvedValue({ [id]: stored });
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: {
      me: { _id: "actor" },
      job: { ...source, stage: "COMPLETED", installerChecksheet: { complete: true } },
    } }),
  });
  const response = await GET(new NextRequest("http://localhost"), context);
  expect((await response.json()).split).toEqual(stored);
  expect(mocks.save).not.toHaveBeenCalled();
});

it("drops a fully reconciled revisit from Jobs while retaining it for reports and search", async () => {
  const { visits, ...split } = splitWithReturnVisits();
  const stored = { ...split, visits: [{ ...visits[0], percent: 80 }, visits[1]] };
  mocks.pending.mockResolvedValue({ [id]: stored });
  mocks.read.mockResolvedValue({ [id]: stored });
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: {
      parent0: { _id: id, stage: "COMPLETED", installation: { installStatus: "INSTALLED_AS_QUOTED" } },
    } }),
  });
  const queue = await list(req({ pending: true }));
  expect(queue.status).toBe(200);
  expect((await queue.json()).splits).toEqual({});
  const report = await list(req({ jobIds: [id] }));
  expect((await report.json()).splits[id].visits[1].state).toBe("completed");
});
