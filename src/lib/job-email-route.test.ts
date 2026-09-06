import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ sql: vi.fn(), identity: vi.fn(), deliver: vi.fn() }));
vi.mock("@/lib/overlay-db", () => ({ overlaySql: mocks.sql }));
vi.mock("@/lib/job-sms-access", () => ({ jobSmsIdentity: mocks.identity }));
vi.mock("@/lib/communication-delivery", async original => ({ ...await original<typeof import("./communication-delivery")>(), deliverCommunication: mocks.deliver }));
import { GmailPreflightError } from "./communication-delivery";
import { POST, GET } from "@/app/api/jobs/[id]/email/route";
const jobId = "abcdefabcdefabcdefabcdef";
const context = { params: Promise.resolve({ id: jobId }) };
const input = { id: "11111111-1111-4111-8111-111111111111", senderId: "22222222-2222-4222-8222-222222222222", destination: "customer@example.com", subject: "Booking", body: "Hi Customer", templateTitle: "Booking" };
const request = (value: unknown) => new NextRequest(`http://localhost/api/jobs/${jobId}/email`, { method: "POST", body: JSON.stringify(value) });
let rows: Record<string, unknown>[];
beforeEach(() => {
  vi.resetAllMocks(); rows = [];
  mocks.identity.mockResolvedValue({ me: { _id: "staff", firstname: "Sam", lastname: "Smith" }, job: { jobNumber: 42, client: { contactDetails: { email: input.destination, name: "Customer" } } } });
  mocks.deliver.mockResolvedValue({ ok: true, providerMessageId: "gmail-id", providerThreadId: "thread-id" });
  mocks.sql.mockImplementation(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const sql = parts.join("?");
    if (sql.includes("SELECT key,value FROM overlay_settings")) return [{ key: "job_sms_enabled", value: "true" }];
    if (sql.includes("SELECT * FROM job_email_messages")) return rows;
    if (sql.includes("FROM communication_senders")) return [{ id: input.senderId, label: "Staff Gmail", sender_value: "staff@example.com", provider_config: { gmailSignature: "<b>Sam</b>" }, provider_access_token: "secret", provider_refresh_token: "refresh-secret" }];
    if (sql.includes("INSERT INTO job_email_messages")) {
      if (rows.length) return [];
      const columns = sql.match(/job_email_messages\s*\(([^)]+)\)/)![1].split(",").map(s => s.trim());
      rows = [Object.fromEntries(columns.map((column, i) => [column, values[i]]))]; return [{ id: input.id }];
    }
    if (sql.includes("UPDATE job_email_messages")) {
      Object.assign(rows[0], { status: values[0], failure_reason: values[1], provider_message_id: values[2], provider_thread_id: values[3] });
    }
    return [];
  });
});
it("claims before delivery and sends concurrent copies once with a complete snapshot", async () => {
  const results = await Promise.all([POST(request(input), context), POST(request(input), context)]);
  expect(results.map(r => r.status)).toEqual([200, 200]); expect(mocks.deliver).toHaveBeenCalledTimes(1);
  expect(rows[0]).toMatchObject({ actor_name: "Sam Smith", status: "sent", subject: "Booking", body: "Hi Customer", rendered_body: "Hi Customer\n\nSam", provider_message_id: "gmail-id", provider_thread_id: "thread-id" });
  expect(mocks.deliver.mock.calls[0][0]).toMatchObject({ strictGmailConnection: true, from: "staff@example.com", to: input.destination, messageId: `<${input.id}@insulhub.nz>` });
});
it("never delivers if recording the attempt fails", async () => {
  mocks.sql.mockRejectedValue(Error("database unavailable")); expect((await POST(request(input), context)).status).toBe(503); expect(mocks.deliver).not.toHaveBeenCalled();
});
it("rejects changed content on a repeated identifier", async () => {
  await POST(request(input), context); expect((await POST(request({ ...input, subject: "Changed" }), context)).status).toBe(409); expect(mocks.deliver).toHaveBeenCalledTimes(1);
});
it("rejects stale or substituted contact addresses before sending", async () => {
  const response = await POST(request({ ...input, destination: "other@example.com" }), context);
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ safeToEdit: true }); expect(mocks.deliver).not.toHaveBeenCalled();
});
it("blocks access before reading any records", async () => {
  mocks.identity.mockRejectedValue(Error("Unauthorized")); await POST(request(input), context); expect(mocks.sql).not.toHaveBeenCalled();
});
it.each(["bad\r\nBcc: other@example.com", "two@example.com,other@example.com"])("rejects an invalid recipient %s", async destination => {
  expect((await POST(request({ ...input, destination }), context)).status).toBe(400); expect(mocks.deliver).not.toHaveBeenCalled();
});
it("keeps an uncertain attempt and never retries delivery", async () => {
  mocks.deliver.mockRejectedValue(Error("response lost"));
  await POST(request(input), context); await POST(request(input), context);
  expect(rows[0].status).toBe("unknown"); expect(mocks.deliver).toHaveBeenCalledTimes(1);
});
it("distinguishes definite failures from uncertain provider responses", async () => {
  mocks.deliver.mockResolvedValue({ ok: false, uncertain: false }); await POST(request(input), context); expect(rows[0].status).toBe("failed");
});
it("never exposes account tokens to the composer", async () => {
  const response = await GET(new NextRequest(`http://localhost/api/jobs/${jobId}/email`), context);
  const text = await response.text(); expect(text).toContain("Staff Gmail"); expect(text).not.toContain("secret");
});
it("records a rejected Gmail connection as failed, with reconnect guidance", async () => {
  mocks.deliver.mockRejectedValue(new GmailPreflightError("token rejected"));
  const response = await POST(request(input), context);
  expect(await response.json()).toMatchObject({ message: { status: "failed", failureReason: expect.stringContaining("Reconnect") } });
});
it("blocks a direct email send when CRM messaging is off", async () => {
  const original = mocks.sql.getMockImplementation()!;
  mocks.sql.mockImplementation((parts: TemplateStringsArray, ...values: unknown[]) => parts.join("").includes("SELECT key,value") ? [] : original(parts, ...values));
  expect((await POST(request(input), context)).status).toBe(403); expect(mocks.deliver).not.toHaveBeenCalled();
});
it("blocks email for another account when testing is restricted", async () => {
  const original = mocks.sql.getMockImplementation()!;
  mocks.sql.mockImplementation((parts: TemplateStringsArray, ...values: unknown[]) => parts.join("").includes("SELECT key,value") ? [{ key: "job_sms_enabled", value: "true" }, { key: "job_crm_test_user", value: JSON.stringify({ userId: "someone-else", name: "Tester" }) }] : original(parts, ...values));
  expect((await POST(request(input), context)).status).toBe(403); expect(mocks.deliver).not.toHaveBeenCalled();
});
