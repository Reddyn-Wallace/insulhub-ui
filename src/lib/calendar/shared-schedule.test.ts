import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), expireTag: vi.fn() }));
vi.mock("@vercel/functions", () => ({ getCache: () => mocks }));
import { forgetSharedSchedule, readSharedSchedule, writeSharedSchedule } from "./shared-schedule";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL", "1");
});
afterEach(() => vi.unstubAllEnvs());

it("keeps a calendar result encrypted and scoped to its signed-in token and window", async () => {
  const value = { jobs: [{ notes: "Private booking" }], unscheduled: [], checkedAt: Date.now() };
  await writeSharedSchedule("session-a", "scope:november", "scope:", value);
  const [key, ciphertext, options] = mocks.set.mock.calls[0];
  expect(key).toBe("scope:november");
  expect(ciphertext).not.toContain("Private booking");
  expect(options).toMatchObject({ ttl: 60, tags: ["scope:"] });
  mocks.get.mockResolvedValue(ciphertext);
  expect(await readSharedSchedule("session-a", "scope:november")).toEqual(value);
  expect(await readSharedSchedule("session-b", "scope:november")).toBeUndefined();
  expect(await readSharedSchedule("session-a", "scope:december")).toBeUndefined();
});

it("falls back on cache errors and removes all shared windows for an invalidated session", async () => {
  mocks.get.mockRejectedValue(new Error("Cache unavailable"));
  expect(await readSharedSchedule("session-a", "scope:november")).toBeUndefined();
  await forgetSharedSchedule("scope:");
  expect(mocks.expireTag).toHaveBeenCalledWith("scope:");
});
