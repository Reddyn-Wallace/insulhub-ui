import { describe, expect, it } from "vitest";
import {
  cleanSitePlanDrawingName,
  EMPTY_SITE_PLAN_DOCUMENT,
  parseSitePlanDocument,
} from "./site-plan-drawings";

describe("site plan drawing documents", () => {
  it("accepts the current empty drawing format", () => {
    expect(parseSitePlanDocument(EMPTY_SITE_PLAN_DOCUMENT)).toEqual(EMPTY_SITE_PLAN_DOCUMENT);
  });

  it("round-trips wall and text data needed by the editor", () => {
    const document = {
      ...EMPTY_SITE_PLAN_DOCUMENT,
      walls: [{
        id: "wall-1",
        start: { x: 1.2, y: 2.3 },
        end: { x: 8.4, y: 2.3 },
        style: "dotted" as const,
        color: "teal" as const,
        lengthOverride: 7.2,
      }],
      textNotes: [{
        id: "note-1",
        text: "Upper floor",
        x: 4,
        y: 5,
        fontSize: 0.82,
        boxWidth: 3.1,
        boxHeight: 0.9,
      }],
      showDimensions: false,
    };

    expect(parseSitePlanDocument(document)).toEqual(document);
  });

  it("rejects unsupported or malformed drawing data", () => {
    expect(parseSitePlanDocument({ ...EMPTY_SITE_PLAN_DOCUMENT, schemaVersion: 2 })).toBeNull();
    expect(parseSitePlanDocument({ ...EMPTY_SITE_PLAN_DOCUMENT, walls: [{ id: "broken" }] })).toBeNull();
    expect(parseSitePlanDocument({ ...EMPTY_SITE_PLAN_DOCUMENT, showDimensions: "yes" })).toBeNull();
  });

  it("normalizes drawing names", () => {
    expect(cleanSitePlanDrawingName("  Upper   floor  ")).toBe("Upper floor");
    expect(cleanSitePlanDrawingName(null)).toBe("");
  });
});
