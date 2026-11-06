import { describe, expect, it } from "vitest";
import {
  initialSplit,
  projectVisits,
  reconcileUsage,
  type SourceJob,
} from "./projection";
import { completeVisit } from "./model";
const source: SourceJob = {
  _id: "abc",
  jobNumber: 1,
  stage: "INSTALLATION",
  quote: {
    c_total: 10000,
    wall: { SQM: 120, c_bagCount: 30 },
    ceiling: { SQM: 80 },
  },
  installation: {
    installDate: "2026-11-05T20:00:00Z",
    installStatus: "INSTALL_NOT_FINISHED",
  },
  installerChecksheet: { complete: false, actualBags: 99 },
};
describe("real job projections", () => {
  it("snapshots upstream quote and uses NZ date", () => {
    const s = initialSplit(source);
    expect(s.area).toBe(200);
    expect(s.wallArea).toBe(120);
    expect(s.visits[0].date).toBe("2026-11-06");
  });
  it("projects partial calendar rows without changing original job identity or quote", () => {
    const split = completeVisit(
      initialSplit(source),
      "initial",
      60,
      "2026-11-10",
    );
    const rows = projectVisits(source, split);
    expect(rows.map((r) => r._id)).toEqual(["abc", "abc"]);
    expect(rows.map((r) => r.quote?.c_total)).toEqual([6000, 4000]);
    expect(rows[0].quote?.wall?.SQM).toBe(72);
    expect(source.quote?.c_total).toBe(10000);
  });
  it("uses quoted estimates until checksheet complete, and actual after; does not silently finalise remaining work", () => {
    const split = completeVisit(
      initialSplit(source),
      "initial",
      60,
      "2026-11-10",
    );
    expect(reconcileUsage(source, split).rows[0].bags).toBe(18);
    const final = {
      ...source,
      installerChecksheet: { complete: true, actualBags: 32 },
    };
    expect(reconcileUsage(final, split).rows[0].bags).toBe(19.2);
    expect(reconcileUsage(final, split).warning).toContain("remaining");
    expect(reconcileUsage(final, split).rows).toHaveLength(1);
  });
  it("preserves missing final actual rather than reverting to a budget estimate", () => {
    const split = completeVisit(initialSplit(source), "initial", 100, null);
    const result = reconcileUsage(
      { ...source, installerChecksheet: { complete: true, actualBags: null } },
      split,
    );
    expect(result.rows[0].bags).toBeNull();
    expect(result.warning).toContain("missing");
  });
  it("preserves snapshots when quote changes and keeps unscheduled remainder", () => {
    const split = completeVisit(initialSplit(source), "initial", 60, null);
    const rows = projectVisits({ ...source, quote: { c_total: 20000 } }, split);
    expect(rows[0].quote?.c_total).toBe(6000);
    expect(rows[1].installation?.installDate).toBeNull();
  });
});

it("retains recorded quantities when final totals are missing or inconsistent", () => {
  let split = completeVisit(initialSplit(source), "initial", 60, "2026-11-10");
  split = completeVisit(split, split.visits[1].id, 40, null);
  split.visits[0].actualBags = 22;
  split.visits[1].actualBags = 10;
  const missing = reconcileUsage(
    { ...source, installerChecksheet: { complete: true, actualBags: null } },
    split,
  );
  expect(missing.rows.map((r) => r.bags)).toEqual([22, 10]);
  expect(missing.rows.every((r) => r.basis === "recorded")).toBe(true);
  const mismatch = reconcileUsage(
    { ...source, installerChecksheet: { complete: true, actualBags: 35 } },
    split,
  );
  expect(mismatch.rows.map((r) => r.bags)).toEqual([22, 10]);
  expect(mismatch.warning).toContain("does not reconcile");
});
