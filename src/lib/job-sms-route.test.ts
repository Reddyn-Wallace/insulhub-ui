import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ sql: vi.fn(), identity: vi.fn(), deliver: vi.fn(), check: vi.fn() }));
vi.mock("@/lib/overlay-db", () => ({ overlaySql: mocks.sql }));
vi.mock("@/lib/job-sms-access", () => ({ jobSmsIdentity: mocks.identity }));
vi.mock("@/lib/job-sms-delivery", () => ({ deliverJobSms: mocks.deliver, checkJobSms: mocks.check }));
import { POST } from "@/app/api/jobs/[id]/sms/route";
import { PATCH } from "@/app/api/job-sms-settings/route";
const job = "abcdefabcdefabcdefabcdef";
const input = { id: "11111111-1111-4111-8111-111111111111", senderId: "22222222-2222-4222-8222-222222222222", destination: "0211234567", body: "Hi" };
const context = { params: Promise.resolve({ id: job }) };
const request = (body: unknown) => new NextRequest(`http://localhost/api/jobs/${job}/sms`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
let rows: Record<string, unknown>[];
let available: boolean;
beforeEach(() => {
  vi.resetAllMocks(); rows = []; available = true;
  mocks.identity.mockResolvedValue({ me: { _id: "staff", firstname: "Sam", lastname: "Smith", role: "ADMIN" }, job: { _id: job, jobNumber: 42, client: { contactDetails: { phoneMobile: "0211234567", name: "Customer" } } } });
  mocks.deliver.mockResolvedValue({ status: "accepted", failureReason: "" });
  mocks.sql.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("SELECT * FROM job_sms_messages")) return rows;
    if (text.includes("SELECT value FROM overlay_settings")) return [{ value: String(available) }];
    if (text.includes("SELECT * FROM communication_senders")) return [{ label: "Business", sender_value: "021", provider_config: {} }];
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
  it("blocks sending while disabled", async () => {
    available = false; expect((await POST(request(input), context)).status).toBe(403); expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it("rejects stale or substituted recipient numbers", async () => {
    expect((await POST(request({ ...input, destination: "0217654321" }), context)).status).toBe(409); expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it("never submits when job access cannot be verified", async () => {
    mocks.identity.mockRejectedValue(Error("Unauthorized")); await POST(request(input), context); expect(mocks.sql).not.toHaveBeenCalled(); expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it("restricts enabling the feature to administrators", async () => {
    mocks.identity.mockResolvedValue({ me: { role: "SALES" } }); expect((await PATCH(request({ enabled: true }))).status).toBe(403); expect(mocks.sql).not.toHaveBeenCalled();
  });
});
