import { newDb } from "pg-mem";
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), sql: null as unknown as (sql: string, values: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }));
vi.mock("@/lib/job-sms-access", () => ({ jobSmsIdentity: mocks.identity }));
vi.mock("@/lib/overlay-db", () => ({ ensureOverlaySchema: async () => {}, overlaySql: async (parts: TemplateStringsArray, ...values: unknown[]) => (await mocks.sql(parts.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values)).rows }));
import { GET, POST } from "@/app/api/jobs/[id]/manual-invoice/route";
const id = "69ea7a15a5185b0a06d7615e";
const context = { params: Promise.resolve({ id }) };
const request = (body?: unknown) => new NextRequest(`http://localhost/api/jobs/${id}/manual-invoice`, body ? { method: "POST", body: JSON.stringify(body) } : {});
beforeEach(() => {
  const db = newDb();
  db.public.none("CREATE TABLE overlay_settings(key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())");
  const pool = new (db.adapters.createPg().Pool)();
  mocks.sql = (text, values) => pool.query(text, values);
  mocks.identity.mockReset().mockResolvedValue({ me: { _id: "user", firstname: "Sam", lastname: "Smith" }, job: { _id: id } });
});
it("stores a server-attributed manual confirmation and reads it back without changing Xero data", async () => {
  expect((await (await GET(request(), context)).json()).confirmation).toBeNull();
  const response = await POST(request({ reference: " INV-20 ", confirmed: true, confirmedBy: "forged" }), context);
  expect(response.status).toBe(200);
  const saved = (await response.json()).confirmation;
  expect(saved).toMatchObject({ reference: "INV-20", confirmedBy: "user", confirmedByName: "Sam Smith" });
  expect(Number.isFinite(Date.parse(saved.confirmedAt))).toBe(true);
  expect((await (await GET(request(), context)).json()).confirmation).toEqual(saved);
  expect(mocks.identity).toHaveBeenCalledWith(expect.anything(), id);
  // Retrying never changes the original confirmation or its audit attribution.
  expect((await (await POST(request({ reference: "INV-20", confirmed: true }), context)).json()).confirmation).toEqual(saved);
});
it("rejects an unchecked confirmation and blank reference", async () => {
  expect((await POST(request({ reference: "INV-20" }), context)).status).toBe(400);
  expect((await POST(request({ reference: " ", confirmed: true }), context)).status).toBe(400);
  expect((await (await GET(request(), context)).json()).confirmation).toBeNull();
});
it("refuses inaccessible jobs without writing a confirmation", async () => {
  mocks.identity.mockRejectedValue(new Error("Job not found"));
  expect((await POST(request({ reference: "INV-20", confirmed: true }), context)).status).toBe(404);
  expect((await GET(request(), context)).status).toBe(404);
  expect((await mocks.sql("SELECT * FROM overlay_settings", [])).rows).toHaveLength(0);
});

it("rejects a conflicting reference without overwriting the original confirmation", async () => {
  await POST(request({ reference: "INV-20", confirmed: true }), context);
  expect((await POST(request({ reference: "INV-21", confirmed: true }), context)).status).toBe(409);
  expect((await (await GET(request(), context)).json()).confirmation.reference).toBe("INV-20");
});
it("does not allow unauthenticated reads or writes", async () => {
  mocks.identity.mockRejectedValue(new Error("Unauthorized"));
  expect((await GET(request(), context)).status).toBe(401);
  expect((await POST(request({ reference: "INV-20", confirmed: true }), context)).status).toBe(401);
});
