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
    expect(parseSitePlanDocument({ ...EMPTY_SITE_PLAN_DOCUMENT, extra: true })).toBeNull();
    expect(parseSitePlanDocument({ ...EMPTY_SITE_PLAN_DOCUMENT, walls: [{ id: "wall", start: { x: 1, y: 1 }, end: { x: 1, y: 1 }, style: "solid" }] })).toBeNull();
  });

  it("normalizes Unicode and line endings while rejecting unsafe controls and duplicate IDs", () => {
    const note = { id: "note-1", text: "Ma\u0304ori\r\nline", x: 1, y: 1, fontSize: 0.82 };
    expect(parseSitePlanDocument({ ...EMPTY_SITE_PLAN_DOCUMENT, textNotes: [note] })?.textNotes[0].text).toBe("Māori\nline");
    expect(parseSitePlanDocument({ ...EMPTY_SITE_PLAN_DOCUMENT, textNotes: [{ ...note, text: "bad\u0001" }] })).toBeNull();
    expect(parseSitePlanDocument({ ...EMPTY_SITE_PLAN_DOCUMENT, textNotes: [note, note] })).toBeNull();
  });

  it("enforces geometry, count and numeric bounds", () => {
    const wall = { id: "wall", start: { x: 0, y: 0 }, end: { x: 18, y: 17 }, style: "solid" as const };
    expect(parseSitePlanDocument({ ...EMPTY_SITE_PLAN_DOCUMENT, walls: [wall] })).not.toBeNull();
    expect(parseSitePlanDocument({ ...EMPTY_SITE_PLAN_DOCUMENT, walls: [{ ...wall, end: { x: 18.01, y: 17 } }] })).toBeNull();
    expect(parseSitePlanDocument({ ...EMPTY_SITE_PLAN_DOCUMENT, walls: Array.from({ length: 501 }, (_, index) => ({ ...wall, id: `w-${index}` })) })).toBeNull();
  });

  it("normalizes drawing names", () => {
    expect(cleanSitePlanDrawingName("  Upper   floor  ")).toBe("Upper floor");
    const supplementaryBoundary = `${"a".repeat(119)}😀tail`;
    const truncated = cleanSitePlanDrawingName(supplementaryBoundary);
    expect([...truncated]).toHaveLength(120);
    expect(truncated.endsWith("😀")).toBe(true);
    expect(truncated).not.toContain("\ufffd");
    expect(cleanSitePlanDrawingName(null)).toBe("");
  });
});
