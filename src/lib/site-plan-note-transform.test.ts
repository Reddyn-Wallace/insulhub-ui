import { EMPTY_SITE_PLAN_DOCUMENT, parseSitePlanDocument } from "./site-plan-drawings";
import { expect, it } from "vitest";
import { notePdfLines, resizeNote, rotateNotePoint } from "./site-plan-note-transform";
const note = { id: "note", text: "First\nSecond", x: 8, y: 8, boxWidth: 4, boxHeight: 2, fontSize: 0.82, rotation: 90 };
it("scales proportionally at both limits without producing an invalid box", () => {
  const large = resizeNote(note, 100);
  expect(large.fontSize).toBeCloseTo(3.28);
  expect(large.boxWidth).toBeCloseTo(16);
  expect(large.boxHeight).toBeCloseTo(8);
  const small = resizeNote(note, -1);
  expect(small.fontSize).toBeCloseTo(0.16);
  expect(small.boxWidth! / small.boxHeight!).toBeCloseTo(2);
  expect(small.x).toBe(8); expect(small.rotation).toBe(90);
});
it("rotates points without clipping them to the canvas", () => {
  expect(rotateNotePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, -90).y).toBeCloseTo(-1);
});
it("exports each line at its rotated baseline, with the same scale and line spacing as the canvas", () => {
  const lines = notePdfLines(note, { left: 0, top: 680, width: 720, height: 680 });
  expect(lines).toHaveLength(2);
  expect(lines[0].size).toBeCloseTo(32.8);
  expect(lines[0]).toMatchObject({ text: "First", rotation: -90 });
  expect(lines[0].x).toBeCloseTo(321.6); expect(lines[0].y).toBeCloseTo(450.4);
  expect(lines[1].x).toBeCloseTo(282.24); expect(lines[1].y).toBeCloseTo(450.4);
});

it("keeps repeated resizing saveable at the minimum and maximum limits", () => {
  let current = note;
  for (const factor of [1.1, 100, 0.17, 100, 0, 100, 0.7, 0, 1.1, 100]) {
    current = resizeNote(current, factor) as typeof note;
    expect(parseSitePlanDocument({ ...EMPTY_SITE_PLAN_DOCUMENT, textNotes: [current] }, { noteTransforms: true })).not.toBeNull();
  }
});
