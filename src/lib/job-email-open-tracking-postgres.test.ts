import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/overlay-db", () => ({
  ensureOverlaySchema: vi.fn(),
  overlaySql: (parts: TemplateStringsArray, ...values: unknown[]) =>
    db.query(parts.reduce((sql, part, index) => sql + (index ? `$${index}` : "") + part, ""), values),
}));
vi.mock("@/lib/insulhub-auth", () => ({ requireInsulhubAuth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/job-sms-access", () => ({
  jobSmsIdentity: async () => ({
    me: { _id: "owner", firstname: "Sam" },
    job: { jobNumber: 42, client: { contactDetails: { email: "customer@example.com" } } },
  }),
}));
vi.mock("@/lib/communication-delivery", async original => ({
  ...await original<typeof import("./communication-delivery")>(),
  deliverCommunication: vi.fn(),
}));

import { POST } from "@/app/api/jobs/[id]/email/route";
import { GET as getHistory } from "@/app/api/jobs/[id]/campaign-communications/route";
import { GET as getPixel, HEAD } from "@/app/api/jobs/email/open/[token]/route";
import { deliverCommunication } from "@/lib/communication-delivery";

describe.skipIf(!process.env.JOB_EMAIL_TEST_DATABASE_URL)("job email open tracking in PostgreSQL", () => {
  let pool: Pool;
  const schema = `job_email_tracking_${randomUUID().replaceAll("-", "")}`;
  const jobId = "abcdefabcdefabcdefabcdef";
  const senderId = randomUUID();

  beforeAll(async () => {
    vi.stubEnv("CAMPAIGN_OPEN_TRACKING_ORIGIN", "https://tracking.example");
    pool = new Pool({ connectionString: process.env.JOB_EMAIL_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`
      CREATE TABLE communication_senders (id uuid PRIMARY KEY, owner_user_id text, label text, sender_value text,
        channel text, provider text, connection_status text, is_active boolean, provider_config jsonb);
      CREATE TABLE campaigns (id uuid, name text, channel text, sender_label text, sent_by text);
      CREATE TABLE campaign_recipients (id uuid, campaign_id uuid, insulhub_job_id text, destination text,
        contact_name text, job_number int, status text, rendered_subject text, rendered_body text,
        sent_at timestamptz, updated_at timestamptz, created_at timestamptz, failure_reason text);
      CREATE TABLE job_communication_logs (id uuid, insulhub_job_id text, template_id uuid, template_title text,
        channel text, destination text, contact_name text, job_number int, rendered_subject text,
        rendered_body text, launched_at timestamptz);
    `);
    const readSchema = (file: string) => readFile(new URL(`../../scripts/${file}`, import.meta.url), "utf8");
    const jobEmailSchema = await readSchema("job-email-schema.sql");
    await pool.query(await readSchema("job-sms-schema.sql"));
    await pool.query(jobEmailSchema);
    await pool.query(jobEmailSchema);
    await pool.query(`INSERT INTO communication_senders VALUES
      ($1, 'owner', 'Gmail', 'staff@example.com', 'email', 'gmail', 'connected', true, '{"gmailSignature":"<b>Sam</b>"}')`, [senderId]);
    db.query.mockImplementation(async (sql, values) => (await pool.query(sql, values)).rows);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (pool) {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    }
  });

  const pixel = (token: string, userAgent: string) => getPixel(new Request(`https://tracking.example/api/jobs/email/open/${token}`, {
    headers: { "user-agent": userAgent },
  }), { params: Promise.resolve({ token }) });

  const context = { params: Promise.resolve({ id: jobId }) };
  const send = (id: string) => POST(new NextRequest(`https://crm.example/api/jobs/${jobId}/email`, {
    method: "POST", body: JSON.stringify({ id, senderId, destination: "customer@example.com", subject: "Booking", body: "Hi <Customer>", trackEmailOpens: true }),
  }), context);
  const history = async () => (await getHistory(new NextRequest(`https://crm.example/api/jobs/${jobId}/campaign-communications`), context)).json();

  it("attributes opens to the sent message, deduplicates concurrent requests and keeps the pixel out of history", async () => {
    const delivery = vi.mocked(deliverCommunication);
    const id = randomUUID();
    let token = "";
    delivery.mockImplementationOnce(async input => {
      token = input.trustedHtml?.html.match(/\/api\/jobs\/email\/open\/([0-9a-f-]+)/)?.[1] ?? "";
      await pixel(token, "Mozilla/5.0");
      await Promise.all(Array.from({ length: 4 }, () => pixel(token, "GoogleImageProxy")));
      return { ok: true, providerMessageId: "gmail-message" };
    });
    const sent = await send(id);
    expect(sent.status).toBe(200);
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(token).not.toBe(id);
    expect(await sent.json()).toMatchObject({ message: { openTracking: { likelyCount: 1, ambiguousSeen: true } } });
    expect(delivery.mock.calls[0][0].trustedHtml?.html).toContain("Hi &lt;Customer&gt;");
    await send(id);
    expect(delivery).toHaveBeenCalledTimes(1);

    const response = await pixel(token, "GoogleImageProxy");
    const invalid = await pixel("invalid", "GoogleImageProxy");
    const unknown = await pixel(randomUUID(), "GoogleImageProxy");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.arrayBuffer()).toEqual(await invalid.arrayBuffer());
    expect(await unknown.arrayBuffer()).toEqual(await pixel(token, "GoogleImageProxy").then(r => r.arrayBuffer()));
    expect((await HEAD().arrayBuffer()).byteLength).toBe(0);

    await pool.query("UPDATE job_email_messages SET last_likely_open_at = now() - interval '2 minutes' WHERE id = $1", [id]);
    await pixel(token, "GoogleImageProxy");
    const result = await history();
    expect(result.communications).toMatchObject([{
      id, renderedHtml: "Hi &lt;Customer&gt;<br><br><b>Sam</b>", openTracking: { likelyCount: 2, ambiguousSeen: true },
    }]);
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("continues sending and displaying older records without tracking when no public origin is configured", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("CAMPAIGN_OPEN_TRACKING_ORIGIN", "");
    const id = randomUUID();
    const delivery = vi.mocked(deliverCommunication);
    delivery.mockResolvedValueOnce({ ok: true, providerMessageId: "untracked-message" });
    const sent = await send(id);
    expect(sent.status).toBe(200);
    expect(delivery.mock.lastCall?.[0].trustedHtml).toBeUndefined();
    expect((await history()).communications).toContainEqual(expect.objectContaining({ id, openTracking: null }));
  });
});
