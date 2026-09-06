import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ sql: vi.fn(), identity: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/overlay-db", () => ({ overlaySql: mocks.sql }));
vi.mock("@/lib/job-sms-access", () => ({ jobSmsIdentity: mocks.identity }));
vi.mock("@/lib/insulhub-auth", () => ({ requireInsulhubAuth: mocks.auth }));
import { jobMessagingAllowed, readJobMessagingSettings } from "./job-messaging-settings";
import { PATCH } from "@/app/api/job-sms-settings/route";
beforeEach(() => { vi.resetAllMocks(); mocks.sql.mockResolvedValue([]); mocks.auth.mockResolvedValue(null); mocks.identity.mockResolvedValue({ me: { _id: "verified-user", firstname: "Test", lastname: "Person" } }); });
it("master off overrides tester access", () => { expect(jobMessagingAllowed({ enabled: false, testUserId: "me", testerName: "Me" }, "me")).toBe(false); });
it("restricts testing to the authenticated tester", () => {
  const settings = { enabled: true, testUserId: "me", testerName: "Me" };
  expect(jobMessagingAllowed(settings, "me")).toBe(true); expect(jobMessagingAllowed(settings, "other")).toBe(false);
});
it("retains the existing switch and fails closed for corrupt testing settings", async () => {
  mocks.sql.mockResolvedValue([{ key: "job_sms_enabled", value: "false" }]); expect((await readJobMessagingSettings()).enabled).toBe(false);
  mocks.sql.mockResolvedValue([{ key: "job_sms_enabled", value: "true" }, { key: "job_crm_test_user", value: "invalid" }]); expect((await readJobMessagingSettings()).enabled).toBe(false);
});
it("derives the tester from authentication rather than a supplied user ID", async () => {
  const response = await PATCH(new NextRequest("http://localhost/api/job-sms-settings", { method: "PATCH", body: JSON.stringify({ enabled: false, testOnly: true, userId: "someone-else" }) }));
  expect(await response.json()).toMatchObject({ enabled: false, testOnly: true, testerName: "Test Person" });
  const write = mocks.sql.mock.calls.find(call => call[0].join("").includes("INSERT INTO"));
  expect(JSON.parse(write![2])).toEqual({ userId: "verified-user", name: "Test Person" });
});
it("an old settings screen can turn off without clearing the test audience", async () => {
  await PATCH(new NextRequest("http://localhost/api/job-sms-settings", { method: "PATCH", body: JSON.stringify({ enabled: false }) }));
  expect(mocks.identity).not.toHaveBeenCalled(); expect(mocks.sql.mock.calls[0][0].join("")).not.toContain("job_crm_test_user");
});
