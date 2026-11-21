// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/graphql", () => ({ gql: mock }));
import { invalidateCalendarData } from "@/lib/calendar/cache";
import { loadJobDetail, recentJobDetail } from "./detail";
import { loadCrmEmailIndex } from "./sent-index";

beforeEach(() => {
  mock.mockReset();
  sessionStorage.clear();
  const values = new Map([["token", "staff"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});

it("reuses an overlapping detail prefetch and drops its snapshot after a write", async () => {
  const job = { _id: "a", notes: "Current note" };
  mock.mockResolvedValue({ job });
  expect(await Promise.all([loadJobDetail("a", "staff", true), loadJobDetail("a", "staff", true)])).toEqual([job, job]);
  expect(mock).toHaveBeenCalledOnce();
  expect(mock.mock.calls[0][0]).not.toContain("installerDetails");
  expect((await recentJobDetail("a", "staff"))?.data).toEqual(job);
  localStorage.setItem("calendar-last-write", String(Date.now() + 1));
  expect(await recentJobDetail("a", "staff")).toBeNull();
});

it("does not reuse a detail read that started before a mutation", async () => {
  let finish!: (value: unknown) => void;
  mock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const stale = loadJobDetail("a", "staff");
  const rejected = expect(stale).rejects.toThrow(/changed while loading/);
  await vi.waitFor(() => expect(mock).toHaveBeenCalledOnce());
  invalidateCalendarData();
  mock.mockResolvedValue({ job: { _id: "a", notes: "New" } });
  expect(await loadJobDetail("a", "staff", true)).toMatchObject({ notes: "New" });
  finish({ job: { _id: "a", notes: "Old" } });
  await rejected;
  expect((await recentJobDetail("a", "staff", true))?.data).toMatchObject({ notes: "New" });
  expect(await recentJobDetail("a", "staff")).toBeNull();
});

it("shares one paginated email history scan and preserves the latest send of each type", async () => {
  const recipient = "example@example.test";
  const quote = (createdAt: string) => ({ _id: createdAt, subject: "Insulation quote", to_email: recipient, createdAt });
  mock.mockResolvedValueOnce({ listEmailLogs: { total: 3, results: [quote("2026-11-01")] } })
    .mockResolvedValueOnce({ listEmailLogs: { total: 3, results: [
      quote("2026-11-05"),
      { _id: "eba-1", subject: "Existing building assessment", to_email: recipient, createdAt: "2026-11-04" },
    ] } });
  const results = await Promise.all([loadCrmEmailIndex("staff"), loadCrmEmailIndex("staff")]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toEqual({ quote: { [recipient]: "2026-11-05" }, eba: { [recipient]: "2026-11-04" } });
  expect(mock).toHaveBeenCalledTimes(2);
});
