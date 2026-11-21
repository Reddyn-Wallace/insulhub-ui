// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/graphql", () => ({ gql: query }));

import { invalidateCalendarData } from "@/lib/calendar/cache";
import { loadCrmEmailIndex, readRecordedSend, rememberRecordedSend } from "./sent-index";

let store: Map<string, string>;
let token: string;
let nextSession = 0;
beforeEach(() => {
  query.mockReset();
  vi.stubGlobal("crypto", webcrypto);
  sessionStorage.clear();
  token = `staff-${++nextSession}`;
  store = new Map([["token", token]]);
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
    listEmailLogs: { total: 2, results: [{ _id: "quote-id", to_email: email, type: "quote", createdAt: "2026-11-20" }] },
  }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));

  const show = vi.fn();
  const loading = loadCrmEmailIndex(token, show);
  await vi.waitFor(() => expect(show).toHaveBeenCalledWith(expect.objectContaining({ quote: { [email]: "2026-11-20" } })));
  expect(query).toHaveBeenCalledTimes(2);

  finish({ listEmailLogs: { total: 2, results: [{ _id: "older-quote", to_email: email, type: "quote", createdAt: "2026-11-01" }] } });
  expect((await loading).quote[email]).toBe("2026-11-20");
});

it("keeps the verified history after an unrelated job write", async () => {
  const email = "sample@example.test";
  query.mockResolvedValueOnce({
    listEmailLogs: { total: 1, results: [{ _id: "quote-id", to_email: email, type: "quote", createdAt: "2026-11-20" }] },
  });
  await loadCrmEmailIndex(token);
  invalidateCalendarData();
  expect((await loadCrmEmailIndex(token)).quote[email]).toBe("2026-11-20");
  expect(query).toHaveBeenCalledOnce();
});

it("restores encrypted send history in a new tab after unrelated writes", async () => {
  const email = "sample@example.test";
  query.mockResolvedValueOnce({
    listEmailLogs: { total: 1, results: [{ _id: "quote-id", to_email: email, type: "quote", createdAt: "2026-11-20" }] },
  });
  await loadCrmEmailIndex(token);
  await vi.waitFor(() => expect([...store.keys()].some(key => key.startsWith("crm-sent-cache:shared"))).toBe(true));
  expect([...store.values()].join("")).not.toContain(email);
  sessionStorage.clear();
  invalidateCalendarData();
  expect((await loadCrmEmailIndex(token)).quote[email]).toBe("2026-11-20");
  expect(query).toHaveBeenCalledOnce();

  store.set("token", "other staff");
  query.mockResolvedValueOnce({ listEmailLogs: { total: 0, results: [] } });
  expect((await loadCrmEmailIndex("other staff")).quote).toEqual({});
  expect(query).toHaveBeenCalledTimes(2);
});

it("only reuses a confirmed send for its job, email and session", async () => {
  const email = "sample@example.test";
  const sentAt = "2026-11-20";
  await rememberRecordedSend("quote", "job-a", email, token, sentAt);
  invalidateCalendarData();
  expect(await readRecordedSend("quote", "job-a", email, token)).toBe(sentAt);
  sessionStorage.clear();
  expect(await readRecordedSend("quote", "job-a", email, token)).toBe(sentAt);
  expect(await readRecordedSend("quote", "job-b", email, token)).toBeNull();
  expect(await readRecordedSend("quote", "job-a", "new@example.test", token)).toBeNull();

  store.set("token", "other staff");
  expect(await readRecordedSend("quote", "job-a", email, "other staff")).toBeNull();
});

it("shares positive flags with a new tab while the remainder is still unverified", async () => {
  const email = "sample@example.test";
  let finish!: (value: unknown) => void;
  query.mockResolvedValueOnce({
    listEmailLogs: { total: 2, results: [{ _id: "quote-id", to_email: email, type: "quote", createdAt: "2026-11-20" }] },
  }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const loading = loadCrmEmailIndex(token);
  await vi.waitFor(() => expect([...store.keys()].some(key => key.startsWith("crm-sent-cache:shared"))).toBe(true));

  finish({ listEmailLogs: { total: 3, results: [{ _id: "other-id", type: "unrelated", createdAt: "2026-11-20" }] } });
  await expect(loading).rejects.toThrow(/history changed/);
  sessionStorage.clear();

  query.mockResolvedValueOnce({ listEmailLogs: { total: 0, results: [] } });
  const observe = vi.fn();
  await loadCrmEmailIndex(token, observe);
  expect(observe).toHaveBeenCalledWith(expect.objectContaining({ quote: { [email]: "2026-11-20" } }));
  expect(query).toHaveBeenCalledTimes(3);
});

it("does not cache an incomplete scan as complete if offset pages duplicate an email log", async () => {
  const row = { _id: "same-row", to_email: "sample@example.test", type: "quote", createdAt: "2026-11-20" };
  query.mockResolvedValueOnce({ listEmailLogs: { total: 2, results: [row] } })
    .mockResolvedValueOnce({ listEmailLogs: { total: 2, results: [row] } });
  await expect(loadCrmEmailIndex(token)).rejects.toThrow(/history changed/);

  query.mockResolvedValueOnce({ listEmailLogs: { total: 1, results: [row] } });
  await expect(loadCrmEmailIndex(token)).resolves.toMatchObject({ quote: { [row.to_email]: row.createdAt } });
  expect(query).toHaveBeenCalledTimes(3);
});
