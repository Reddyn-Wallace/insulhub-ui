import { describe, expect, it } from "vitest";
import { isActiveJob, isAwaitingCompletion } from "./awaiting-completion";

describe("awaiting completion queue", () => {
  it("includes both installed outcomes but excludes completed, archived and unfinished jobs", () => {
    const job = { stage: "INVOICE", installation: { installStatus: "INSTALLED_AS_QUOTED" } };
    expect(isAwaitingCompletion(job)).toBe(true);
    expect(isAwaitingCompletion({ ...job, stage: "INSTALLATION", installation: { installStatus: "INSTALLED_WITH_VARIATIONS_FROM_QUOTE" } })).toBe(true);
    expect(isAwaitingCompletion({ ...job, stage: "COMPLETED" })).toBe(false);
    expect(isAwaitingCompletion({ ...job, archivedAt: "2026-09-11" })).toBe(false);
    expect(isAwaitingCompletion({ ...job, installation: { installStatus: "NOT_STARTED" } })).toBe(false);
  });
});

it("keeps active stages regardless of installation status and excludes other stages and archives", () => {
  const jobs = [
    { stage: "SCHEDULED" },
    { stage: "INSTALLATION", installation: { installStatus: "INSTALLED_AS_QUOTED" } },
    { stage: "INVOICE", installation: { installStatus: "INSTALLED_WITH_VARIATIONS_FROM_QUOTE" } },
    { stage: "COMPLETED" },
    { stage: "INVOICE", archivedAt: "2026-09-18" },
    { stage: "LEAD" },
    { stage: "QUOTE", installation: { installStatus: "INSTALLED_AS_QUOTED" } },
  ];
  expect(jobs.map(isActiveJob)).toEqual([true, true, true, false, false, false, false]);
});
