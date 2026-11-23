import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

let testInstance = 0;
beforeEach(() => { testInstance++; });
const scheduler = () => env.CAMPAIGN_QUEUE_SCHEDULER.getByName(`scheduler-test-${testInstance}`);

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
  it.each([
    { pendingCount: 0, nextRunAt: null },
    { pendingCount: 1, nextRunAt: "tomorrow" },
    { pendingCount: 1, nextRunAt: "tomorrow", hadErrors: true },
  ])("preserves an activation that arrived while an alarm was checking the queue", async queue => {
    const earlier = new Date(Date.now() + 2 * 60_000).toISOString();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    await scheduler().activate(earlier);
    const status = await scheduler().applyQueueState({
      ...queue,
      nextRunAt: queue.nextRunAt && tomorrow,
    });
    expect(status.alarmAt).toBe(earlier);
  });

});
