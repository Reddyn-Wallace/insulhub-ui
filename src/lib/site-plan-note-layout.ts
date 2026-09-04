import type { SitePlanTextNote } from "./site-plan-drawings";

const GRID_WIDTH_POINTS = 714.86;
const GRID_HEIGHT_POINTS = 674.65;
const WORST_CASE_GLYPH_EM = 1.5;

function metrics(note: SitePlanTextNote) {
  const size = 11 * note.fontSize / 0.82;
  const maxWidth = (note.boxWidth ?? 3.2) / 18 * GRID_WIDTH_POINTS;
  const charactersPerLine = Math.max(1, Math.floor(maxWidth / (size * WORST_CASE_GLYPH_EM)));
  const lineHeight = size * 1.2;
  return { charactersPerLine, lineHeight };
}

export function sitePlanNotePreviewLines(note: SitePlanTextNote): string[] {
  const { charactersPerLine } = metrics(note); const lines: string[] = [];
  for (const explicit of note.text.split("\n")) {
    const characters = [...explicit]; if (!characters.length) { lines.push(""); continue; }
    for (let index = 0; index < characters.length; index += charactersPerLine) lines.push(characters.slice(index, index + charactersPerLine).join(""));
  }
  return lines;
}

export function sitePlanNoteRequiredHeight(note: SitePlanTextNote): number {
  const { lineHeight } = metrics(note); return Number(Math.max(0.8, sitePlanNotePreviewLines(note).length * lineHeight / (GRID_HEIGHT_POINTS / 17)).toFixed(2));
}

export function sitePlanNoteLayoutFits(note: SitePlanTextNote): boolean { return sitePlanNoteRequiredHeight(note) <= (note.boxHeight ?? 0.8) + 0.001; }
export function autoSizeSitePlanNote(note: SitePlanTextNote): SitePlanTextNote { return { ...note, boxHeight: Math.min(17, Math.max(note.boxHeight ?? 0.8, sitePlanNoteRequiredHeight(note))) }; }
