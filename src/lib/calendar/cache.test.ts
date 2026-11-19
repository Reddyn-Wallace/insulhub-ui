// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { createCalendarCache, CalendarCacheInvalidated } from "./cache";

beforeEach(() => sessionStorage.clear());

it("shares an in-flight refresh and caches even an empty month", async () => {
  const cache = createCalendarCache<string[]>("test");
  const fetchMonth = vi.fn(async () => []);
  const first = cache.refresh("staff", "November", fetchMonth);
  expect(cache.refresh("staff", "November", fetchMonth)).toBe(first);
  await expect(first).resolves.toEqual([]);
  expect(cache.read("staff", "November")?.data).toEqual([]);
  expect(fetchMonth).toHaveBeenCalledOnce();
  expect(cache.read("other", "November")).toBeNull();
});

it("keeps the last good data when refreshing fails", async () => {
  const cache = createCalendarCache<string[]>("test");
  await cache.refresh("staff", "November", async () => ["job"]);
  await expect(cache.refresh("staff", "November", async () => {
    throw Error("offline");
  })).rejects.toThrow("offline");
  expect(cache.read("staff", "November")?.data).toEqual(["job"]);
});

it("updates both cached months and rejects an older response after a booking moves", async () => {
  const cache = createCalendarCache<string[]>("test");
  await cache.refresh("staff", "October", async () => ["job"]);
  await cache.refresh("staff", "November", async () => []);
  let finish!: (data: string[]) => void;
  const pending = cache.refresh("staff", "October", () => new Promise(resolve => { finish = resolve; }));

  cache.patch("staff", (month, rows) => month === "October" ? rows.filter(row => row !== "job") : [...rows, "job"]);
  finish(["job"]);
  await expect(pending).rejects.toBeInstanceOf(CalendarCacheInvalidated);
  expect(cache.read("staff", "October")?.data).toEqual([]);
  expect(cache.read("staff", "November")?.data).toEqual(["job"]);
});

it("prefers the newer snapshot if browser storage is full", async () => {
  const cache = createCalendarCache<string[]>("test");
  await cache.refresh("staff", "November", async () => ["old"]);
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new DOMException("Storage is full", "QuotaExceededError");
  });
  try {
    await cache.refresh("staff", "November", async () => ["fresh"]);
    expect(cache.read("staff", "November")?.data).toEqual(["fresh"]);
  } finally {
    write.mockRestore();
  }
});
