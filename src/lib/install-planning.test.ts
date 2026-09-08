import { expect, it } from "vitest";
import { buildInstallPlanningSummaryLines, normalizeInstallPlanningDetails } from "./install-planning";

it("keeps parking separate from access in installer notes", () => {
  const details = normalizeInstallPlanningDetails({ accessNotes: " Side gate ", parkingNotes: " Driveway beside garage " });
  expect(details.parkingNotes).toBe("Driveway beside garage");
  expect(buildInstallPlanningSummaryLines(details)).toEqual([
    "Access to the property: Side gate",
    "Parking: Driveway beside garage",
  ]);
});
it("preserves old access notes without inventing parking instructions", () => {
  const details = normalizeInstallPlanningDetails({ accessNotes: "Park on road, use side gate" });
  expect(details.parkingNotes).toBe("");
  expect(buildInstallPlanningSummaryLines(details)).toEqual(["Access to the property: Park on road, use side gate"]);
});
