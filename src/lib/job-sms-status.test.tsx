// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useJobSmsStatus } from "./use-job-sms-status";
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("automatically queries status without resending, stops at delivery and cleans up", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", { getItem: () => "test" });
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ message: { id: "one", status: "delivered" } }));
  vi.stubGlobal("fetch", fetcher);
  const update = vi.fn();
  const { rerender, unmount } = renderHook(({ status }) => useJobSmsStatus("job", [{ id: "one", status, sentAt: new Date().toISOString() }], update), { initialProps: { status: "accepted" } });
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual({ id: "one", action: "check" });
  expect(update).toHaveBeenCalledWith({ id: "one", status: "delivered" });
  rerender({ status: "delivered" });
  await act(() => vi.advanceTimersByTimeAsync(60000));
  expect(fetcher).toHaveBeenCalledTimes(1);
  unmount(); expect(vi.getTimerCount()).toBe(0);
});
it("pauses while hidden and retries failed checks without altering the last status", async () => {
  vi.useFakeTimers(); vi.stubGlobal("localStorage", { getItem: () => "test" });
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  const fetcher = vi.fn(async () => { throw Error("offline"); }); vi.stubGlobal("fetch", fetcher);
  const update = vi.fn(); renderHook(() => useJobSmsStatus("job", [{ id: "one", status: "sent", sentAt: new Date().toISOString() }], update));
  await act(() => vi.advanceTimersByTimeAsync(10000)); expect(fetcher).not.toHaveBeenCalled();
  hidden.mockReturnValue(false);
  await act(() => vi.advanceTimersByTimeAsync(11000));
  expect(fetcher).toHaveBeenCalledTimes(3); expect(update).not.toHaveBeenCalled(); hidden.mockRestore();
});

it("limits automatic checks to the first 15 minutes and honours backoff on focus", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", { getItem: () => "test" });
  const now = Date.now();
  const fetcher = vi.fn(async () => Response.json({ message: { id: "recent", status: "sent" } }));
  vi.stubGlobal("fetch", fetcher);
  renderHook(() => useJobSmsStatus("job", [
    { id: "old", status: "accepted", sentAt: new Date(now - 86400000).toISOString() },
    { id: "undated", status: "unknown" },
    { id: "recent", status: "sent", sentAt: new Date(now - 14 * 60000 - 55000).toISOString() },
  ], vi.fn()));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  await act(() => vi.advanceTimersByTimeAsync(60000));
  expect(fetcher).toHaveBeenCalledTimes(1);
});
