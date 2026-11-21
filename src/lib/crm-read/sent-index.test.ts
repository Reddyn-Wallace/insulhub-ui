// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/graphql", () => ({ gql: query }));

import { invalidateCalendarData } from "@/lib/calendar/cache";
import { loadCrmEmailIndex, readRecordedSend, rememberRecordedSend } from "./sent-index";

let store: Map<string, string>;
beforeEach(() => {
  query.mockReset();
  vi.stubGlobal("crypto", webcrypto);
  sessionStorage.clear();
  store = new Map([["token", "staff"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

it("shows confirmed sends before the rest of the log scan finishes", async () => {
  let finish!: (value: unknown) => void;
  const email = "sample@example.test";
  query.mockResolvedValueOnce({
    listEmailLogs: { total: 2, results: [{ to_email: email, type: "quote", createdAt: "2026-11-20" }] },
  }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));

  const show = vi.fn();
  const loading = loadCrmEmailIndex("staff", show);
  await vi.waitFor(() => expect(show).toHaveBeenCalledWith(expect.objectContaining({ quote: { [email]: "2026-11-20" } })));
  expect(query).toHaveBeenCalledTimes(2);

  finish({ listEmailLogs: { total: 2, results: [{ to_email: email, type: "quote", createdAt: "2026-11-01" }] } });
  expect((await loading).quote[email]).toBe("2026-11-20");
});

it("keeps the verified history after an unrelated job write", async () => {
  const email = "sample@example.test";
  query.mockResolvedValueOnce({
    listEmailLogs: { total: 1, results: [{ to_email: email, type: "quote", createdAt: "2026-11-20" }] },
  });
  await loadCrmEmailIndex("staff");
  invalidateCalendarData();
  expect((await loadCrmEmailIndex("staff")).quote[email]).toBe("2026-11-20");
  expect(query).toHaveBeenCalledOnce();
});

it("restores encrypted send history in a new tab after unrelated writes", async () => {
  const email = "sample@example.test";
  query.mockResolvedValueOnce({
    listEmailLogs: { total: 1, results: [{ to_email: email, type: "quote", createdAt: "2026-11-20" }] },
  });
  await loadCrmEmailIndex("staff");
  await vi.waitFor(() => expect([...store.keys()].some(key => key.startsWith("crm-sent-cache:shared"))).toBe(true));
  expect([...store.values()].join("")).not.toContain(email);
  sessionStorage.clear();
  invalidateCalendarData();
  expect((await loadCrmEmailIndex("staff")).quote[email]).toBe("2026-11-20");
  expect(query).toHaveBeenCalledOnce();

  store.set("token", "other staff");
  query.mockResolvedValueOnce({ listEmailLogs: { total: 0, results: [] } });
  expect((await loadCrmEmailIndex("other staff")).quote).toEqual({});
  expect(query).toHaveBeenCalledTimes(2);
});

it("only reuses a confirmed send for its job, email and session", async () => {
  const email = "sample@example.test";
  const sentAt = "2026-11-20";
  await rememberRecordedSend("quote", "job-a", email, "staff", sentAt);
  invalidateCalendarData();
  expect(await readRecordedSend("quote", "job-a", email, "staff")).toBe(sentAt);
  sessionStorage.clear();
  expect(await readRecordedSend("quote", "job-a", email, "staff")).toBe(sentAt);
  expect(await readRecordedSend("quote", "job-b", email, "staff")).toBeNull();
  expect(await readRecordedSend("quote", "job-a", "new@example.test", "staff")).toBeNull();

  store.set("token", "other staff");
  expect(await readRecordedSend("quote", "job-a", email, "other staff")).toBeNull();
});
