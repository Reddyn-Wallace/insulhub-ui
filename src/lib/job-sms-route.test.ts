import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ sql: vi.fn(), identity: vi.fn(), deliver: vi.fn(), check: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/insulhub-auth", () => ({ requireInsulhubAuth: mocks.auth }));
vi.mock("@/lib/overlay-db", () => ({ overlaySql: mocks.sql }));
vi.mock("@/lib/job-sms-access", () => ({ jobSmsIdentity: mocks.identity }));
vi.mock("@/lib/job-sms-delivery", () => ({ deliverJobSms: mocks.deliver, checkJobSms: mocks.check }));
import { POST } from "@/app/api/jobs/[id]/sms/route";
import { GET, PATCH } from "@/app/api/job-sms-settings/route";
const job = "abcdefabcdefabcdefabcdef";
const input = { id: "11111111-1111-4111-8111-111111111111", senderId: "22222222-2222-4222-8222-222222222222", destination: "0211234567", body: "Hi" };
const context = { params: Promise.resolve({ id: job }) };
const request = (body: unknown) => new NextRequest(`http://localhost/api/jobs/${job}/sms`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
let rows: Record<string, unknown>[];
let available: boolean;
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue(null); rows = []; available = true;
  mocks.identity.mockResolvedValue({ me: { _id: "staff", firstname: "Sam", lastname: "Smith", role: "ADMIN" }, job: { _id: job, jobNumber: 42, client: { contactDetails: { phoneMobile: "0211234567", name: "Customer" } } } });
  mocks.deliver.mockResolvedValue({ status: "accepted", failureReason: "" });
  mocks.sql.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("SELECT * FROM job_sms_messages")) return rows;
    if (text.includes("SELECT key,value FROM overlay_settings")) return [{ key: "job_sms_enabled", value: String(available) }];
    if (text.includes("SELECT * FROM communication_senders")) return [{ owner_user_id: "staff", label: "Business", sender_value: "021", provider_config: {} }];
    if (text.includes("INSERT INTO job_sms_messages")) {
      if (rows.length) return [];
      rows = [{ id: values[0], insulhub_job_id: values[1], request_hash: values[12], status: "sending", body: values[10], actor_name: values[7], created_at: new Date().toISOString() }];
      return [{ id: values[0] }];
    }
    if (text.includes("UPDATE job_sms_messages")) { rows[0].status = values[0]; return []; }
    return [];
  });
});
describe("job SMS route", () => {
  it("sends concurrent copies once, with the authenticated author", async () => {
    const results = await Promise.all([POST(request(input), context), POST(request(input), context)]);
    expect(results.map(result => result.status)).toEqual([200,200]);
    expect(mocks.deliver).toHaveBeenCalledTimes(1); expect(rows[0].actor_name).toBe("Sam Smith");
  });
  it("rejects a reused attempt with altered content", async () => {
    await POST(request(input), context);
    expect((await POST(request({ ...input, body: "Different" }), context)).status).toBe(409);
    expect(mocks.deliver).toHaveBeenCalledTimes(1);
  });
  it("sends even when the retired rollout switch was disabled", async () => {
    available = false; expect((await POST(request(input), context)).status).toBe(200); expect(rows[0].status).toBe("accepted");
  });
  it("rejects stale or substituted recipient numbers", async () => {
    expect((await POST(request({ ...input, destination: "0217654321" }), context)).status).toBe(409); expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it("never submits when job access cannot be verified", async () => {
    mocks.identity.mockRejectedValue(Error("Unauthorized")); await POST(request(input), context); expect(mocks.sql).not.toHaveBeenCalled(); expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it("reports universal availability but rejects obsolete setting changes", async () => {
    mocks.identity.mockResolvedValue({ me: { role: "SALES" } });
    expect(await (await GET(request({}))).json()).toMatchObject({ enabled: true, canManage: false });
    expect((await PATCH(request({ enabled: true }))).status).toBe(410);
    expect(mocks.auth).toHaveBeenCalledTimes(2);
    expect(mocks.identity).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated settings reads and writes before touching the database", async () => {
    mocks.auth.mockImplementation(async () => NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await GET(request({}))).status).toBe(401);
    expect((await PATCH(request({ enabled: true }))).status).toBe(401);
    expect(mocks.sql).not.toHaveBeenCalled();
  });
});
it("allows SMS for colleagues regardless of the retired tester restriction", async () => {
  const original = mocks.sql.getMockImplementation()!;
  mocks.sql.mockImplementation((parts: TemplateStringsArray, ...values: unknown[]) => parts.join("").includes("SELECT key,value") ? [{ key: "job_sms_enabled", value: "true" }, { key: "job_crm_test_user", value: JSON.stringify({ userId: "someone-else", name: "Tester" }) }] : original(parts, ...values));
  expect((await POST(request(input), context)).status).toBe(200); expect(rows[0].status).toBe("accepted");
});

it.each(["another-person", null])("blocks sending from a connection owned by %s", async owner => {
  const original = mocks.sql.getMockImplementation()!;
  mocks.sql.mockImplementation(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const result = await original(parts, ...values);
    return parts.join("").includes("SELECT * FROM communication_senders") ? result.map((row: Record<string,unknown>) => ({ ...row, owner_user_id: owner })) : result;
  });
  expect((await POST(request(input), context)).status).toBe(400);
  expect(mocks.deliver).not.toHaveBeenCalled();
});
