import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { SitePlanTextNote, SitePlanWall } from "../site-plan-drawings";
import { PARTNER_SITE_PLAN_FONT_SHA256, PARTNER_SITE_PLAN_RENDERER_VERSION, PARTNER_SITE_PLAN_TEMPLATE_SHA256, sitePlanAddressLine, type SitePlanRenderInput } from "./site-plan-hash";

const TEMPLATE_PATH = "public/site-plan-template-v2.pdf";
const FONT_PATH = "public/fonts/NotoSans-Regular.ttf";
const EXPECTED_PAGE = { width: 872.4168, height: 1136 };
const BASE_GRID = { left: 41.68504, right: 716.8307, bottom: 254.1251, top: 928.7708 };
const BASE_CELL_X = (BASE_GRID.right - BASE_GRID.left) / 17;
const BASE_CELL_Y = (BASE_GRID.top - BASE_GRID.bottom) / 17;
export const PARTNER_SITE_PLAN_GRID = Object.freeze({
  left: BASE_GRID.left + 0.8 * BASE_CELL_X,
  right: BASE_GRID.right + 0.8 * BASE_CELL_X + BASE_CELL_X,
  bottom: BASE_GRID.bottom - 3 * BASE_CELL_Y,
  top: BASE_GRID.top - 3 * BASE_CELL_Y,
  width: BASE_GRID.right - BASE_GRID.left + BASE_CELL_X,
  height: BASE_GRID.top - BASE_GRID.bottom,
});
const COLOR = { slate: "#1e293b", teal: "#0f766e", blue: "#2563eb", amber: "#d97706", red: "#dc2626" } as const;

function hex(value: string) { return { r: Number.parseInt(value.slice(1, 3), 16) / 255, g: Number.parseInt(value.slice(3, 5), 16) / 255, b: Number.parseInt(value.slice(5, 7), 16) / 255 }; }
function toPdf(point: { x: number; y: number }) { return { x: PARTNER_SITE_PLAN_GRID.left + point.x / 18 * PARTNER_SITE_PLAN_GRID.width, y: PARTNER_SITE_PLAN_GRID.top - point.y / 17 * PARTNER_SITE_PLAN_GRID.height }; }
function wallLength(wall: SitePlanWall) { return wall.lengthOverride ?? Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y); }
function assertGlyphs(font: PDFFont, text: string) { try { font.encodeText(text); } catch { throw new Error("Site plan contains a glyph that the bundled Noto Sans font does not support"); } }
function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const result: string[] = [];
  for (const explicitLine of text.split("\n")) {
    if (!explicitLine) { result.push(""); continue; }
    let line = "";
    for (const word of explicitLine.split(/(\s+)/u).filter(Boolean)) {
      const candidate = line + word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue; }
      if (line.trim()) { result.push(line.trimEnd()); line = ""; }
      if (font.widthOfTextAtSize(word, size) <= maxWidth) { line = word.trimStart(); continue; }
      for (const character of word) {
        const characterCandidate = line + character;
        if (line && font.widthOfTextAtSize(characterCandidate, size) > maxWidth) { result.push(line); line = character; } else line = characterCandidate;
      }
    }
    result.push(line.trimEnd());
  }
  return result;
}
function drawWall(page: PDFPage, font: PDFFont, wall: SitePlanWall, dimensions: boolean) {
  const start = toPdf(wall.start); const end = toPdf(wall.end); const stroke = hex(COLOR[wall.color ?? "slate"]);
  page.drawLine({ start, end, thickness: 3.5, color: rgb(stroke.r, stroke.g, stroke.b), dashArray: wall.style === "dotted" ? [5, 4] : undefined });
  if (dimensions) { const label = `${wallLength(wall).toFixed(1)}m`; assertGlyphs(font, label); page.drawText(label, { x: (start.x + end.x) / 2 + 2, y: (start.y + end.y) / 2 + 2, size: 8, font, color: rgb(0.15, 0.15, 0.15) }); }
}
function drawNote(page: PDFPage, font: PDFFont, note: SitePlanTextNote) {
  const point = toPdf(note); const size = 11 * note.fontSize / 0.82; const maxWidth = note.boxWidth ? note.boxWidth / 18 * PARTNER_SITE_PLAN_GRID.width : 220; const lines = wrapText(font, note.text, size, maxWidth); const lineHeight = size * 1.2;
  const maxHeight = (note.boxHeight ?? 0.8) / 17 * PARTNER_SITE_PLAN_GRID.height;
  if (lines.length * lineHeight > maxHeight + 0.01) throw new Error("A site plan note does not fit inside its text box");
  const x = Math.max(PARTNER_SITE_PLAN_GRID.left, Math.min(PARTNER_SITE_PLAN_GRID.right - maxWidth, point.x - maxWidth / 2));
  const y = Math.max(PARTNER_SITE_PLAN_GRID.bottom + maxHeight, Math.min(PARTNER_SITE_PLAN_GRID.top, point.y));
  for (const [index, line] of lines.entries()) { assertGlyphs(font, line); page.drawText(line, { x, y: y - index * lineHeight, size, font, color: rgb(0.1, 0.1, 0.1), maxWidth }); }
}

export async function renderPartnerSitePlanPdf(input: SitePlanRenderInput): Promise<{ bytes: Buffer; contentSha256: string }> {
  if (input.templateVersion !== "site-plan-template-v2" || input.templateSha256 !== PARTNER_SITE_PLAN_TEMPLATE_SHA256 || input.rendererVersion !== PARTNER_SITE_PLAN_RENDERER_VERSION) throw new Error("Site plan render identity does not match the locked renderer");
  const [template, fontBytes] = await Promise.all([readFile(resolve(TEMPLATE_PATH)), readFile(resolve(FONT_PATH))]);
  if (createHash("sha256").update(template).digest("hex") !== PARTNER_SITE_PLAN_TEMPLATE_SHA256) throw new Error("Locked site plan template hash does not match");
  if (createHash("sha256").update(fontBytes).digest("hex") !== PARTNER_SITE_PLAN_FONT_SHA256 || input.fontSha256 !== PARTNER_SITE_PLAN_FONT_SHA256) throw new Error("Bundled site plan font hash does not match");
  const pdf = await PDFDocument.load(template, { updateMetadata: false });
  if (pdf.getPageCount() !== 1) throw new Error("Locked site plan template must contain exactly one page");
  const page = pdf.getPage(0); const size = page.getSize();
  if (Math.abs(size.width - EXPECTED_PAGE.width) > 0.001 || Math.abs(size.height - EXPECTED_PAGE.height) > 0.001) throw new Error("Locked site plan template page size does not match");
  const supportedCodePoints = new Set(fontkit.create(fontBytes).characterSet);
  for (const value of [input.drawingName, sitePlanAddressLine(input.siteAddress), ...input.document.textNotes.map((note) => note.text)]) {
    for (const character of value) if (character !== "\n" && !supportedCodePoints.has(character.codePointAt(0)!)) throw new Error("Site plan contains a glyph that the bundled Noto Sans font does not support");
  }
  pdf.registerFontkit(fontkit); const font = await pdf.embedFont(fontBytes, { subset: true });
  const fixed = new Date("2000-01-01T00:00:00.000Z"); pdf.setTitle("InsulHub site plan"); pdf.setAuthor("InsulHub"); pdf.setSubject("Site plan"); pdf.setCreator(input.rendererVersion); pdf.setProducer(input.rendererVersion); pdf.setCreationDate(fixed); pdf.setModificationDate(fixed);
  const bleed = 2; page.drawRectangle({ x: PARTNER_SITE_PLAN_GRID.left - bleed, y: PARTNER_SITE_PLAN_GRID.bottom - bleed, width: PARTNER_SITE_PLAN_GRID.width + bleed * 2, height: PARTNER_SITE_PLAN_GRID.height + bleed * 2, color: rgb(1, 1, 1) });
  for (let column = 0; column <= 18; column += 1) { const x = PARTNER_SITE_PLAN_GRID.left + column / 18 * PARTNER_SITE_PLAN_GRID.width; page.drawLine({ start: { x, y: PARTNER_SITE_PLAN_GRID.bottom }, end: { x, y: PARTNER_SITE_PLAN_GRID.top }, thickness: column === 0 || column === 18 ? 0.9 : 0.45, color: rgb(0.72, 0.72, 0.72) }); }
  for (let row = 0; row <= 17; row += 1) { const y = PARTNER_SITE_PLAN_GRID.bottom + row / 17 * PARTNER_SITE_PLAN_GRID.height; page.drawLine({ start: { x: PARTNER_SITE_PLAN_GRID.left, y }, end: { x: PARTNER_SITE_PLAN_GRID.right, y }, thickness: row === 0 || row === 17 ? 0.9 : 0.45, color: rgb(0.72, 0.72, 0.72) }); }
  input.document.walls.forEach((wall) => drawWall(page, font, wall, input.document.showDimensions)); input.document.textNotes.forEach((note) => drawNote(page, font, note));
  const address = sitePlanAddressLine(input.siteAddress); const heading = [input.drawingName, address].filter(Boolean).join(" — ");
  if (heading) { let headingSize=9; while(headingSize>7&&font.widthOfTextAtSize(heading,headingSize)>540)headingSize-=0.5; if(font.widthOfTextAtSize(heading,headingSize)>540)throw new Error("Floor plan name and site address are too long to fit the locked PDF template"); page.drawText(heading,{x:145,y:953,size:headingSize,font,color:rgb(0,0,0),maxWidth:540}); }
  const bytes = Buffer.from(await pdf.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false }));
  if (bytes.byteLength < 1 || bytes.byteLength > 5 * 1024 * 1024) throw new Error("Generated site plan PDF is outside the allowed size");
  return { bytes, contentSha256: createHash("sha256").update(bytes).digest("hex") };
}
