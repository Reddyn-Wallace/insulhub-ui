import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const scheduler = () => env.CAMPAIGN_QUEUE_SCHEDULER.getByName("insulhub");

describe("campaign queue scheduler", () => {
  it("rejects unauthenticated activation", async () => {
    const response = await exports.default.fetch("https://worker.test/activate", {
      method: "POST",
    });

    expect(response.status).toBe(401);
  });

  it("schedules an alarm when a campaign is activated", async () => {
    const response = await exports.default.fetch("https://worker.test/activate", {
      method: "POST",
      headers: { authorization: "Bearer test-secret" },
      body: JSON.stringify({ runAt: new Date(Date.now() + 60_000).toISOString() }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.scheduled).toBe(true);
  });

  it("stops scheduling when the backend reports an empty queue", async () => {
    await scheduler().activate(new Date(Date.now() + 10 * 60_000).toISOString());
    const status = await scheduler().applyQueueState({
      pendingCount: 0,
      nextRunAt: null,
    });
    expect(status.scheduled).toBe(false);
  });

  it("schedules the next alarm while recipients remain pending", async () => {
    const status = await scheduler().applyQueueState({
      pendingCount: 2,
      nextRunAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    expect(status.scheduled).toBe(true);
  });

  it("backs off when queue processing reports an error", async () => {
    const before = Date.now();
    const status = await scheduler().applyQueueState({
      pendingCount: 1,
      nextRunAt: new Date(before).toISOString(),
      hadErrors: true,
    });

    expect(status.scheduled).toBe(true);
    expect(Date.parse(status.alarmAt)).toBeGreaterThanOrEqual(before + 15 * 60_000);
  });
});
