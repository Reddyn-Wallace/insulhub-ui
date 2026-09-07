import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ sql: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/overlay-db", () => ({ overlaySql: mocks.sql }));
vi.mock("@/lib/insulhub-auth", () => ({ requireInsulhubAuth: mocks.auth }));
import { GET, PATCH } from "@/app/api/job-sms-settings/route";
const request = () => new NextRequest("http://localhost/api/job-sms-settings", { method: "PATCH", body: JSON.stringify({ enabled: false, testOnly: true }) });
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue(null); });
it("keeps old clients informed without consulting retired settings", async () => {
  mocks.sql.mockRejectedValue(Error("Retired settings must not be needed"));
  expect(await (await GET(request())).json()).toMatchObject({ enabled: true, testOnly: false, canManage: false });
});
it("rejects stale settings writes without changing the database", async () => {
  expect((await PATCH(request())).status).toBe(410);
  expect(mocks.sql).not.toHaveBeenCalled();
});
it("authenticates compatibility reads and writes", async () => {
  mocks.auth.mockResolvedValue(NextResponse.json({error:"Unauthorized"},{status:401}));
  expect((await GET(request())).status).toBe(401);
  expect((await PATCH(request())).status).toBe(401);
});
