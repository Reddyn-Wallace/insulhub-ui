import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  queue: vi.fn(),
  activate: vi.fn(),
}));
vi.mock("@/lib/insulhub-auth", () => ({ requireInsulhubAuth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/communication-settings", async original => ({
  ...await original<typeof import("./communication-settings")>(),
  saveCommunicationSettings: mocks.save,
}));
vi.mock("@/lib/campaign-queue", () => ({ loadCampaignQueueState: mocks.queue }));
vi.mock("@/lib/campaign-scheduler", () => ({ activateCampaignScheduler: mocks.activate }));

import { PATCH } from "@/app/api/communication-settings/route";

const request = () => new NextRequest("http://localhost/api/communication-settings", {
  method: "PATCH",
  body: JSON.stringify({ settings: { campaignEmailDailyLimit: 100 } }),
});
const nextRunAt = "2026-11-22T01:15:00.000Z";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.save.mockImplementation(async settings => settings);
  mocks.queue.mockResolvedValue({ pendingCount: 2, nextRunAt });
  mocks.activate.mockResolvedValue({ activated: true });
});

it("recalculates the next alarm after saving delivery settings", async () => {
  const result = await PATCH(request());
  expect(result.status).toBe(200);
  expect(mocks.save).toHaveBeenCalledBefore(mocks.queue);
  expect(mocks.activate).toHaveBeenCalledExactlyOnceWith(nextRunAt);
});

it("leaves an empty queue asleep", async () => {
  mocks.queue.mockResolvedValue({ pendingCount: 0, nextRunAt: null });
  expect((await PATCH(request())).status).toBe(200);
  expect(mocks.activate).not.toHaveBeenCalled();
});

it("reports scheduler errors while retaining the saved settings", async () => {
  mocks.activate.mockResolvedValue({ activated: false });
  const result = await PATCH(request());
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({
    settings: { campaignEmailDailyLimit: 100 },
    schedulerWarning: expect.stringContaining("Settings saved"),
  });
});
