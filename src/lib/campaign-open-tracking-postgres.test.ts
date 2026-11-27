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
vi.mock("@/lib/job-sms-access", () => ({ jobSmsIdentity: vi.fn().mockResolvedValue({ me: { _id: "owner" } }) }));
vi.mock("@/lib/campaign-scheduler", () => ({ activateCampaignScheduler: vi.fn().mockResolvedValue({ activated: true }) }));
vi.mock("@/lib/communication-settings", async original => ({
  ...await original<typeof import("./communication-settings")>(),
  loadCommunicationSettings: vi.fn().mockResolvedValue({
    campaignSendWindowEnabled: false, campaignEmailDailyLimit: 100,
  }),
  campaignRecipientScheduleAt: () => new Date("2026-11-01T00:00:00Z"),
}));
vi.mock("@/lib/communication-delivery", async original => ({
  ...await original<typeof import("./communication-delivery")>(),
  deliverCommunication: vi.fn(),
}));

import { PATCH, GET as getCampaign } from "@/app/api/campaigns/[id]/route";
import { GET as getPixel } from "@/app/api/campaigns/open/[token]/route";
import { deliverCommunication } from "@/lib/communication-delivery";
import { processCampaignQueue } from "@/lib/campaign-queue";

describe.skipIf(!process.env.CAMPAIGN_RESUME_TEST_DATABASE_URL)("campaign open tracking in PostgreSQL", () => {
  let pool: Pool;
  const schema = `open_tracking_${randomUUID().replaceAll("-", "")}`;

  beforeAll(async () => {
    vi.stubEnv("CAMPAIGN_OPEN_TRACKING_ORIGIN", "https://tracking.example");
    pool = new Pool({ connectionString: process.env.CAMPAIGN_RESUME_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`
      CREATE TABLE campaigns (id uuid PRIMARY KEY, name text, status text, channel text, sender_id uuid,
        sender_label text, message_subject text, message_body text,
        send_authorized_user_id text, sent_by text, sent_at timestamptz, updated_at timestamptz);
      CREATE TABLE communication_senders (id uuid PRIMARY KEY, owner_user_id text, channel text,
        sender_value text, provider text, connection_status text, is_active boolean);
      CREATE TABLE campaign_recipients (id uuid PRIMARY KEY, campaign_id uuid, selected boolean, status text,
        destination text, failure_reason text DEFAULT '', provider_message_id text DEFAULT '',
        sent_at timestamptz, scheduled_at timestamptz, updated_at timestamptz, rendered_body text,
        rendered_subject text, contact_name text, job_number int);
    `);
    const migration = await readFile(new URL("../../scripts/campaign-open-tracking-schema.sql", import.meta.url), "utf8");
    await pool.query(migration);
    await pool.query(migration);
    db.query.mockImplementation(async (sql, values) => (await pool.query(sql, values)).rows);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (pool) {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    }
  });

  const pixel = (token: string, userAgent: string) => getPixel(new Request("https://tracking.example/pixel", {
    headers: { "user-agent": userAgent },
  }), { params: Promise.resolve({ token }) });

  it("attributes concurrent fetches to the right sent recipient and retires tokens on retry", async () => {
    const campaignId = randomUUID();
    const senderId = randomUUID();
    const firstId = randomUUID(), secondId = randomUUID();
    const options = { params: Promise.resolve({ id: campaignId }) };
    const url = `https://tracking.example/api/campaigns/${campaignId}`;
    const patch = (body: Record<string, unknown>) => PATCH(new NextRequest(url, {
      method: "PATCH", body: JSON.stringify(body),
    }), options);
    const readCampaign = async () => (await getCampaign(new NextRequest(url), options)).json();

    await pool.query("INSERT INTO campaigns (id,status,channel,sender_id,sender_label,message_subject,message_body) VALUES ($1,'draft','email',$2,'Gmail','Your quote','Hi')", [campaignId, senderId]);
    await pool.query("INSERT INTO communication_senders VALUES ($1,'owner','email','sales@example.com','gmail','connected',true)", [senderId]);
    await pool.query(`INSERT INTO campaign_recipients (id,campaign_id,selected,status,destination,contact_name)
      VALUES ($1,$3,true,'pending','first@example.com','First'),($2,$3,true,'pending','second@example.com','Second')`, [firstId, secondId, campaignId]);

    let openedToken = "";
    let failedToken = "";
    vi.mocked(deliverCommunication).mockImplementation(async input => {
      const token = input.trustedHtml?.html.match(/\/open\/([0-9a-f-]+)/)?.[1] ?? "";
      if (input.to === "second@example.com") {
        failedToken = token;
        return { ok: false, failureReason: "Gmail rejected" };
      }
      openedToken = token;
      await pixel(token, "Mozilla/5.0");
      await Promise.all(Array.from({ length: 5 }, () => pixel(token, "GoogleImageProxy")));
      return { ok: true, providerMessageId: "first-message" };
    });

    const queued = await patch({ sendCampaign: true });
    const response = await queued.json();
    expect(queued.status, JSON.stringify(response)).toBe(200);
    expect(openedToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(failedToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(openedToken).not.toBe(failedToken);
    expect(JSON.stringify(response)).not.toContain(openedToken);
    expect(response.recipients.map((row: { openTracking: unknown }) => row.openTracking)).toEqual([
      expect.objectContaining({ likelyCount: 1, ambiguousSeen: true }), null,
    ]);

    await pool.query("UPDATE campaign_recipients SET last_likely_open_at = now() - interval '2 minutes' WHERE id = $1", [firstId]);
    await pixel(openedToken, "GoogleImageProxy");
    expect((await readCampaign()).recipients[0].openTracking.likelyCount).toBe(2);

    const retry = await patch({ retryFailed: true, recipientIds: [secondId] });
    expect(retry.status).toBe(200);
    const { rows: [second] } = await pool.query("SELECT open_tracking_token, likely_open_count FROM campaign_recipients WHERE id = $1", [secondId]);
    expect(second.open_tracking_token).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.open_tracking_token).not.toBe(failedToken);
    await pixel(failedToken, "GoogleImageProxy");
    const { rows: [retried] } = await pool.query("SELECT likely_open_count FROM campaign_recipients WHERE id = $1", [secondId]);
    expect(retried.likely_open_count).toBe(0);
  });

  it("adds tracking before sending a previously queued Gmail recipient", async () => {
    const campaignId = randomUUID(), senderId = randomUUID(), recipientId = randomUUID();
    await pool.query("INSERT INTO campaigns (id,status,channel,sender_id,send_authorized_user_id) VALUES ($1,'pending','email',$2,'owner')", [campaignId, senderId]);
    await pool.query("INSERT INTO communication_senders VALUES ($1,'owner','email','sales@example.com','gmail','connected',true)", [senderId]);
    await pool.query(`INSERT INTO campaign_recipients (id,campaign_id,selected,status,destination,rendered_body)
      VALUES ($1,$2,true,'pending','queued@example.com','Hi')`, [recipientId, campaignId]);

    let deliveryToken = "";
    vi.mocked(deliverCommunication).mockImplementationOnce(async input => {
      deliveryToken = input.trustedHtml?.html.match(/\/open\/([0-9a-f-]+)/)?.[1] ?? "";
      await pixel(deliveryToken, "GoogleImageProxy");
      return { ok: true, providerMessageId: "queued-message" };
    });
    expect((await processCampaignQueue(campaignId, "owner")).processedCount).toBe(1);
    const { rows: [recipient] } = await pool.query("SELECT status, open_tracking_token, likely_open_count FROM campaign_recipients WHERE id = $1", [recipientId]);
    expect(deliveryToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(recipient).toEqual({ status: "sent", open_tracking_token: deliveryToken, likely_open_count: 1 });
  });
});
