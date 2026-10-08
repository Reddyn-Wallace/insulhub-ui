// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { loadFinanceOverview, clearFinanceOverview } from "./overview-client";
import { financeApi } from "@/components/finance/format";
vi.mock("@/components/finance/format", () => ({ financeApi: vi.fn() }));
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) || null,
    setItem: (k: string, v: string) => values.set(k, v),
    clear: () => values.clear(),
  });
});
afterEach(() => {
  clearFinanceOverview();
  vi.clearAllMocks();
  localStorage.clear();
});
it("shares prefetch with the dashboard, delivers saved figures before fresh data and never requests a bank refresh", async () => {
  localStorage.setItem("token", "owner");
  let finish!: (d: unknown) => void;
  const saved = { checkedAt: "2026-10-01", snapshotStale: true };
  const fresh = { checkedAt: "2026-10-08" };
  vi.mocked(financeApi)
    .mockResolvedValueOnce(saved)
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
  const prefetch = loadFinanceOverview();
  await vi.waitFor(() => expect(financeApi).toHaveBeenCalledTimes(2));
  const show = vi.fn();
  const page = loadFinanceOverview(show);
  expect(show).toHaveBeenCalledWith(saved);
  finish(fresh);
  await Promise.all([prefetch, page]);
  expect(show).toHaveBeenLastCalledWith(fresh);
  expect(vi.mocked(financeApi).mock.calls).toEqual([
    ["dashboard?snapshot=1"],
    ["dashboard"],
  ]);
});
it("keeps saved data visible when revalidation fails and allows a later retry", async () => {
  localStorage.setItem("token", "owner");
  const show = vi.fn();
  vi.mocked(financeApi)
    .mockResolvedValueOnce({ snapshotStale: true })
    .mockRejectedValueOnce(Error("offline"));
  await expect(loadFinanceOverview(show)).rejects.toThrow("offline");
  expect(show).toHaveBeenCalledOnce();
  vi.mocked(financeApi).mockResolvedValueOnce({ snapshotStale: false });
  await loadFinanceOverview();
  expect(financeApi).toHaveBeenCalledTimes(3);
});
it("does not reuse another session or publish a response after logout", async () => {
  localStorage.setItem("token", "a");
  let finish!: (d: unknown) => void;
  vi.mocked(financeApi).mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const show = vi.fn();
  const a = loadFinanceOverview(show);
  localStorage.setItem("token", "b");
  vi.mocked(financeApi).mockResolvedValueOnce({ snapshotStale: false });
  await loadFinanceOverview();
  finish({ snapshotStale: false });
  await a;
  expect(show).not.toHaveBeenCalled();
});
