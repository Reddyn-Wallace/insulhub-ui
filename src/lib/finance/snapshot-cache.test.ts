import { afterEach, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./live-data", () => ({ loadFinanceInputs: vi.fn() }));
import { loadFinanceInputs } from "./live-data";
import { dashboardInputs, clearDashboardInputs } from "./snapshot-cache";
afterEach(() => {
  clearDashboardInputs();
  vi.clearAllMocks();
});
it("deduplicates and briefly reuses owner-scoped reads without sharing owners or bank modes", async () => {
  vi.mocked(loadFinanceInputs).mockResolvedValue({ checkedAt: "now" } as never);
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
    .mockResolvedValueOnce({ checkedAt: "now" } as never);
  await expect(dashboardInputs({ userId: "a", token: "t" })).rejects.toThrow(
    "down",
  );
  await dashboardInputs({ userId: "a", token: "t" });
  expect(loadFinanceInputs).toHaveBeenCalledTimes(2);
});
