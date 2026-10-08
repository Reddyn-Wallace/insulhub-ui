import { afterEach, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./live-data", () => ({ loadFinanceInputs: vi.fn() }));
vi.mock("./snapshot-store", () => ({
  readSnapshot: vi.fn().mockResolvedValue(null),
  writeSnapshot: vi.fn().mockResolvedValue(undefined),
}));
import { readSnapshot, writeSnapshot } from "./snapshot-store";
import { loadFinanceInputs } from "./live-data";
import { dashboardInputs, clearDashboardInputs } from "./snapshot-cache";
afterEach(() => {
  clearDashboardInputs();
  vi.clearAllMocks();
});
it("deduplicates and briefly reuses owner-scoped reads without sharing owners or bank modes", async () => {
  vi.mocked(loadFinanceInputs).mockResolvedValue({
    checkedAt: new Date().toISOString(),
  } as never);
  const owner = { userId: "a", token: "private" };
  await Promise.all([dashboardInputs(owner), dashboardInputs(owner)]);
  expect(loadFinanceInputs).toHaveBeenCalledTimes(1);
  await dashboardInputs(owner);
  expect(loadFinanceInputs).toHaveBeenCalledTimes(1);
  await dashboardInputs({ ...owner, userId: "b" });
  await dashboardInputs(owner, true);
  expect(loadFinanceInputs).toHaveBeenCalledTimes(3);
  await dashboardInputs(owner, false, true);
  expect(loadFinanceInputs).toHaveBeenCalledTimes(4);
});
it("does not retain failed loads", async () => {
  vi.mocked(loadFinanceInputs)
    .mockRejectedValueOnce(Error("down"))
    .mockResolvedValueOnce({ checkedAt: new Date().toISOString() } as never);
  await expect(dashboardInputs({ userId: "a", token: "t" })).rejects.toThrow(
    "down",
  );
  await dashboardInputs({ userId: "a", token: "t" });
  expect(loadFinanceInputs).toHaveBeenCalledTimes(2);
});

it("reuses an encrypted shared snapshot after instance memory is cleared, while explicit refresh bypasses it", async () => {
  const input = { checkedAt: new Date().toISOString() } as never;
  vi.mocked(readSnapshot).mockResolvedValueOnce(input);
  expect(await dashboardInputs({ userId: "a", token: "private" })).toBe(input);
  expect(loadFinanceInputs).not.toHaveBeenCalled();
  clearDashboardInputs();
  vi.mocked(loadFinanceInputs).mockResolvedValue(input);
  await dashboardInputs({ userId: "a", token: "private" }, false, true);
  expect(loadFinanceInputs).toHaveBeenCalledOnce();
  expect(writeSnapshot).toHaveBeenCalledWith("a", "overview", input);
});

it("forced refresh does not join a pending shared-cache lookup", async () => {
  let resolveStored!: (value: never) => void;
  vi.mocked(readSnapshot).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveStored = resolve;
    }),
  );
  const owner = { userId: "race", token: "private" };
  const normal = dashboardInputs(owner);
  const fresh = {
    checkedAt: new Date().toISOString(),
    marker: "fresh",
  } as never;
  vi.mocked(loadFinanceInputs).mockResolvedValueOnce(fresh);
  expect(await dashboardInputs(owner, false, true)).toBe(fresh);
  resolveStored({
    checkedAt: new Date().toISOString(),
    marker: "old",
  } as never);
  await normal;
});
