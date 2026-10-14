// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  loadFinanceOverview,
  clearFinanceOverview,
  refreshFinanceOverview,
} from "./overview-client";
import { financeApi } from "@/components/finance/format";
vi.mock("@/components/finance/format", () => ({
  financeApi: vi.fn(),
  FinanceRequestError: class extends Error {},
}));
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
it("refreshes bank data on dashboard entry while retaining saved figures and sharing concurrent opens", async () => {
  localStorage.setItem("token", "owner");
  let finish!: (d: unknown) => void;
  const saved = { checkedAt: "2026-10-13", snapshotStale: false };
  const fresh = {
    checkedAt: "2026-10-14",
    bankRefresh: [{ status: "updated" }],
  };
  vi.mocked(financeApi)
    .mockReset()
    .mockResolvedValueOnce(saved)
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
  const show = vi.fn();
  const a = refreshFinanceOverview(show);
  const b = refreshFinanceOverview();
  await vi.waitFor(() => expect(show).toHaveBeenCalledWith(saved));
  expect(vi.mocked(financeApi).mock.calls).toEqual([
    ["dashboard?snapshot=1"],
    ["dashboard", { refresh: true }],
  ]);
  finish(fresh);
  await Promise.all([a, b]);
  expect(show).toHaveBeenLastCalledWith(fresh);
  vi.mocked(financeApi).mockResolvedValue(fresh);
  await refreshFinanceOverview();
  expect(vi.mocked(financeApi).mock.calls.filter((c) => c[1])).toHaveLength(2);
});
it("keeps saved figures on a failed bank refresh and does not publish after logout", async () => {
  localStorage.setItem("token", "owner");
  const show = vi.fn();
  vi.mocked(financeApi)
    .mockReset()
    .mockResolvedValueOnce({ checkedAt: "2026-10-13" })
    .mockRejectedValueOnce(Error("offline"));
  await expect(refreshFinanceOverview(show)).rejects.toThrow("offline");
  expect(show).toHaveBeenCalledOnce();
  clearFinanceOverview();
  show.mockClear();
  let finish!: (d: unknown) => void;
  vi.mocked(financeApi)
    .mockResolvedValueOnce(null)
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
  const pending = refreshFinanceOverview(show);
  await vi.waitFor(() =>
    expect(vi.mocked(financeApi).mock.calls).toHaveLength(4),
  );
  localStorage.setItem("token", "other");
  finish({ checkedAt: "2026-10-14" });
  await pending;
  expect(show).not.toHaveBeenCalled();
});
