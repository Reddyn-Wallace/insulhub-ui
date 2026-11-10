import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  actor: vi.fn(),
  load: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  settings: vi.fn(),
  create: vi.fn(),
  start: vi.fn(),
  publish: vi.fn(),
  cancel: vi.fn(),
  save: vi.fn(),
  finalise: vi.fn(),
}));
vi.mock("./access", () => ({ requireReportActor: m.actor }));
vi.mock("./source", () => ({ loadSnapshot: m.load }));
vi.mock("./store", () => ({
  getReport: m.get,
  listReports: m.list,
  readSettings: m.settings,
  createReport: m.create,
  startRefresh: m.start,
  publishRefresh: m.publish,
  cancelRefresh: m.cancel,
  saveCommentary: m.save,
  finaliseReport: m.finalise,
}));
import { GET } from "@/app/api/gm-reports/route";
import { handle } from "./api";
const req = (body?: unknown) =>
  new NextRequest("http://localhost/api/gm-reports/2026-11-09", {
    method: body ? "POST" : "GET",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeEach(() => {
  vi.resetAllMocks();
  m.actor.mockResolvedValue({ id: "admin", token: "secret" });
});
it("lists history through the actual Next route with its context argument", async () => {
  m.list.mockResolvedValue([{ week: "2026-11-09", status: "draft" }]);
  const route = GET as (r: NextRequest, c: unknown) => Promise<Response>;
  const r = await route(req(), { params: Promise.resolve({}) });
  expect(r.status).toBe(200);
  expect((await r.json()).reports).toHaveLength(1);
  expect(r.headers.get("cache-control")).toContain("no-store");
});
it("GET reads a snapshot without loading source or creating drafts", async () => {
  m.get.mockResolvedValue(null);
  expect((await handle(req(), "2026-11-09")).status).toBe(200);
  expect(m.create).not.toHaveBeenCalled();
  expect(m.load).not.toHaveBeenCalled();
});
it("keeps last snapshot and releases refresh lease when upstream fails", async () => {
  m.settings.mockResolvedValue({ settings: {} });
  m.create.mockResolvedValue({ status: "draft" });
  m.start.mockResolvedValue("lease");
  m.load.mockRejectedValue(Error("private upstream request"));
  const r = await handle(req({ action: "refresh" }), "2026-11-09");
  expect(r.status).toBe(503);
  expect(await r.text()).not.toContain("private");
  expect(m.publish).not.toHaveBeenCalled();
  expect(m.cancel).toHaveBeenCalledWith("2026-11-09", "lease");
});
it("fails closed before any data access when permission cannot be checked", async () => {
  m.actor.mockRejectedValue(Error("unavailable"));
  expect((await handle(req(), "2026-11-09")).status).toBe(503);
  expect(m.get).not.toHaveBeenCalled();
});
