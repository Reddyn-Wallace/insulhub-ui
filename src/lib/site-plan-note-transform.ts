import type { SitePlanPoint, SitePlanTextNote } from "./site-plan-drawings";

export function noteLayout(note: SitePlanTextNote, text = note.text) {
  const scale = note.fontSize / 0.82;
  const paddingX = 0.18 * scale;
  const paddingY = 0.14 * scale;
  const width = note.boxWidth ?? 0.8 * scale;
  const height = Math.max(note.boxHeight ?? 0, 0.8 * scale, note.fontSize * 1.2 + paddingY * 2);
  const x = note.x - width / 2;
  const y = note.y - height * 0.72;
  return { x, y, width, height, text, lines: text.split("\n"), textX: x + paddingX, textY: y + paddingY + note.fontSize, paddingX, paddingY };
}

// Stored y is the legacy placement anchor, 72% down the box, not its centre.
export function noteCenter(note: SitePlanTextNote): SitePlanPoint {
  return { x: note.x, y: note.y - noteLayout(note).height * 0.22 };
}

// Unlike wall geometry, note-local coordinates must not be clamped before rotating.
export function rotateNotePoint(point: SitePlanPoint, origin: SitePlanPoint, angle: number): SitePlanPoint {
  const radians = angle * Math.PI / 180;
  const dx = point.x - origin.x, dy = point.y - origin.y;
  return { x: origin.x + dx * Math.cos(radians) - dy * Math.sin(radians), y: origin.y + dx * Math.sin(radians) + dy * Math.cos(radians) };
}

export function resizeNote(note: SitePlanTextNote, requestedScale: number): SitePlanTextNote {
  const box = noteLayout(note);
  const minimum = Math.max(0.16 / note.fontSize, 0.16 / box.width, 0.16 / box.height);
  const maximum = Math.min(3.28 / note.fontSize, 18 / box.width, 17 / box.height);
  const scale = Math.max(minimum, Math.min(maximum, Number.isFinite(requestedScale) ? requestedScale : 1));
  // Clamp the products too: division/multiplication can overshoot a limit by an epsilon.
  return { ...note,
    fontSize: Math.max(0.16, Math.min(3.28, note.fontSize * scale)),
    boxWidth: Math.max(0.16, Math.min(18, box.width * scale)),
    boxHeight: Math.max(0.16, Math.min(17, box.height * scale)),
  };
}

export function notePdfLines(note: SitePlanTextNote, grid: { left: number; top: number; width: number; height: number }) {
  const layout = noteLayout(note);
  return layout.lines.map((text, index) => {
    const point = rotateNotePoint({ x: layout.textX, y: layout.textY + index * note.fontSize * 1.2 }, noteCenter(note), note.rotation ?? 0);
    return { text, x: grid.left + point.x / 18 * grid.width, y: grid.top - point.y / 17 * grid.height, size: note.fontSize * grid.height / 17, rotation: -(note.rotation ?? 0) };
  });
}
