import { beforeEach, expect, it, vi } from "vitest";
import { reconcilePastRevisits } from "./reconcile";
import { type SavedSplit, type SourceJob } from "./projection";
import { readSplits, saveSplit, SplitError } from "./store";

vi.mock("./store", async importOriginal => ({
  ...(await importOriginal<typeof import("./store")>()),
  readSplits: vi.fn(),
  saveSplit: vi.fn(),
}));

const job: SourceJob = {
  _id: "job",
  stage: "COMPLETED",
  installation: { installStatus: "INSTALLED_AS_QUOTED" },
};
const split: SavedSplit = {
  id: "job", version: 4, number: "42", customer: "", area: 100, value: 1000,
  wallArea: 100, ceilingArea: 0, budgetBags: null,
  history: [], checksheet: { complete: false, actualBags: null },
  visits: [
    { id: "first", date: "2026-11-18", percent: 80, state: "completed" },
    { id: "return", date: "2026-11-22", percent: 20, state: "planned" },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(saveSplit).mockImplementation(async (next, version) => ({ ...next, version: version + 1 }));
});

it("closes the visit only once its scheduled day ends in New Zealand", async () => {
  const beforeMidnight = new Date("2026-11-22T10:59:59Z");
  expect(await reconcilePastRevisits(split, job, beforeMidnight)).toBe(split);
  expect(saveSplit).not.toHaveBeenCalled();

  const midnight = new Date("2026-11-22T11:00:00Z");
  const saved = await reconcilePastRevisits(split, job, midnight);
  expect(saved.visits[1]).toEqual({ ...split.visits[1], state: "completed" });
  expect(saved.history[0]).toContain("using their scheduled dates");
  expect(saveSplit).toHaveBeenCalledTimes(1);
});

it("keeps a concurrent reschedule and does not overwrite it with automatic completion", async () => {
  const rescheduled = {
    ...split,
    version: 5,
    visits: [split.visits[0], { ...split.visits[1], date: "2026-11-28" }],
  };
  vi.mocked(saveSplit).mockRejectedValue(new SplitError("Version changed", 409));
  vi.mocked(readSplits).mockResolvedValue({ [job._id]: rescheduled });
  expect(await reconcilePastRevisits(split, job, new Date("2026-11-23T00:00:00Z"))).toEqual(rescheduled);
  expect(saveSplit).toHaveBeenCalledTimes(1);
});

it("leaves archived jobs and a single remaining visit record alone", async () => {
  const now = new Date("2026-11-23T00:00:00Z");
  const single = { ...split, visits: [{ ...split.visits[1], percent: 100 }] };
  expect(await reconcilePastRevisits(split, { ...job, archivedAt: now.toISOString() }, now)).toBe(split);
  expect(await reconcilePastRevisits(single, job, now)).toBe(single);
  expect(saveSplit).not.toHaveBeenCalled();
});
