import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { refreshReport } from "./refresh-client";
import type { Report } from "./types";

const old = {
  week: "2026-11-09",
  refreshing: false,
  snapshot: { builtAt: "old" },
} as Report;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", { getItem: () => "test" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("recovers a disconnected refresh by reading its saved result without starting a second build", async () => {
  const done = { ...old, snapshot: { ...old.snapshot, builtAt: "new" } };
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(
      Response.json({ report: { ...old, refreshing: true } }),
    )
    .mockResolvedValueOnce(Response.json({ report: done }));
  vi.stubGlobal("fetch", fetcher);
  const result = refreshReport(old.week, old);
  await vi.runAllTimersAsync();
  expect(await result).toEqual(done);
  expect(fetcher.mock.calls.filter((c) => c[1].method === "POST")).toHaveLength(
    1,
  );
});
it("waits for an already running first build without posting another refresh", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ report: old }));
  vi.stubGlobal("fetch", fetcher);
  expect(
    await refreshReport(old.week, { ...old, refreshing: true, snapshot: null }),
  ).toEqual(old);
  expect(fetcher.mock.calls[0][1].method).toBe("GET");
});
it("does not report an unchanged old snapshot as a successful refresh", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json({ report: old })),
  );
  await expect(refreshReport(old.week, old)).rejects.toThrow(
    /refresh did not finish/,
  );
});
it("preserves explicit source errors instead of polling or hiding them", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ error: "CRM source unavailable" }, { status: 503 }),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(refreshReport(old.week, old)).rejects.toThrow(
    "CRM source unavailable",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
