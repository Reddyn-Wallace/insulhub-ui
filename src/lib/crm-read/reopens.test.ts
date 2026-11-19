// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invalidateCalendarData } from "@/lib/calendar/cache";
import { loadCrmRead, recentCrmRead } from "./client";

const board = { jobs: [{ _id: "job-a", client: "Sample customer" }], total: 1 };
let local: Map<string, string>;

beforeEach(() => {
  local = new Map([["token", "staff-session-a"]]);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => local.set(key, value),
    removeItem: (key: string) => local.delete(key),
    key: (index: number) => [...local.keys()][index] ?? null,
    get length() { return local.size; },
  });
  sessionStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); });

it("reopens an encrypted board snapshot in a different tab using the same session", async () => {
  await loadCrmRead("board", "JOBS", "staff-session-a", async () => board);
  await vi.waitFor(() => expect([...local.keys()].some(key => key.startsWith("jobs-cache:"))).toBe(true));
  expect([...local.values()].join("")).not.toContain("Sample customer");
  sessionStorage.clear();
  expect((await recentCrmRead("board", "JOBS", "staff-session-a"))?.data).toEqual(board);

  local.set("token", "staff-session-b");
  expect(await recentCrmRead("board", "JOBS", "staff-session-b")).toBeNull();
  expect(await recentCrmRead("board", "JOBS", "staff-session-a")).toBeNull();
});

it("does not restore shared snapshots after a write", async () => {
  const checked = await loadCrmRead("board", "JOBS", "staff-session-a", async () => board);
  await vi.waitFor(() => expect([...local.keys()].some(key => key.startsWith("jobs-cache:"))).toBe(true));
  sessionStorage.clear();
  invalidateCalendarData();
  local.set("calendar-last-write", String(checked.checkedAt + 1));
  expect(await recentCrmRead("board", "JOBS", "staff-session-a")).toBeNull();
});

it("ignores a corrupted shared entry and can replace it on the next live read", async () => {
  await loadCrmRead("board", "QUOTE", "staff-session-a", async () => board);
  const key = await vi.waitFor(() => {
    const match = [...local.keys()].find(key => key.startsWith("jobs-cache:"));
    expect(match).toBeDefined();
    return match!;
  });
  const old = JSON.parse(local.get(key)!);
  const corrupt = (old.ciphertext[0] === "A" ? "B" : "A") + old.ciphertext.slice(1);
  local.set(key, JSON.stringify({ ...old, ciphertext: corrupt, checkedAt: old.checkedAt - 1 }));
  sessionStorage.clear();
  expect(await recentCrmRead("board", "QUOTE", "staff-session-a")).toBeNull();

  await loadCrmRead("board", "QUOTE", "staff-session-a", async () => board);
  await vi.waitFor(() => expect(JSON.parse(local.get(key)!).ciphertext).not.toEqual(corrupt));
  sessionStorage.clear();
  expect((await recentCrmRead("board", "QUOTE", "staff-session-a"))?.data).toEqual(board);
});

it("keeps job-detail records out of shared storage", async () => {
  await loadCrmRead("detail", "job-a", "staff-session-a", async () => board);
  expect([...local.keys()]).toEqual(["token"]);
});
