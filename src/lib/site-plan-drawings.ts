export type SitePlanWallStyle = "solid" | "dotted";
export type SitePlanWallColor = "slate" | "teal" | "blue" | "amber" | "red";
export type SitePlanPoint = { x: number; y: number };
export type SitePlanWall = { id: string; start: SitePlanPoint; end: SitePlanPoint; style: SitePlanWallStyle; color?: SitePlanWallColor; lengthOverride?: number | null };
export type SitePlanTextNote = { id: string; text: string; x: number; y: number; fontSize: number; boxWidth?: number; boxHeight?: number };
export type SitePlanDrawingDocument = { schemaVersion: 1; templateVersion: "site-plan-template-v2"; walls: SitePlanWall[]; textNotes: SitePlanTextNote[]; showDimensions: boolean };
export type SitePlanDrawing = { id: string; source: "overlay"; jobId: string; name: string; document: SitePlanDrawingDocument; revision: number; sortOrder?: number; lastPdfFileName: string | null; lastExportedAt: string | null; createdAt: string; updatedAt: string };
export type SitePlanDrawingSummary = Omit<SitePlanDrawing, "document"> & { wallCount: number; textNoteCount: number; pdfReady?: boolean };

export const SITE_PLAN_TEMPLATE_VERSION = "site-plan-template-v2" as const;
export const EMPTY_SITE_PLAN_DOCUMENT: SitePlanDrawingDocument = Object.freeze({ schemaVersion: 1, templateVersion: SITE_PLAN_TEMPLATE_VERSION, walls: [], textNotes: [], showDimensions: true });
export const SITE_PLAN_DOCUMENT_MAX_BYTES = 256 * 1024;
export const SITE_PLAN_LIMITS = Object.freeze({ walls: 500, notes: 100, noteText: 2_000, aggregateNoteText: 20_000, x: 18, y: 17 });
const WALL_STYLES = new Set<SitePlanWallStyle>(["solid", "dotted"]);
const WALL_COLORS = new Set<SitePlanWallColor>(["slate", "teal", "blue", "amber", "red"]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const DISALLOWED_CONTROL = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;

function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean { const allowed = new Set([...required, ...optional]); return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key)); }
function finiteNumber(value: unknown, minimum: number, maximum: number): value is number { return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum; }
function parsePoint(value: unknown): SitePlanPoint | null { if (!isRecord(value) || !exactKeys(value, ["x", "y"]) || !finiteNumber(value.x, 0, SITE_PLAN_LIMITS.x) || !finiteNumber(value.y, 0, SITE_PLAN_LIMITS.y)) return null; return { x: Object.is(value.x, -0) ? 0 : value.x, y: Object.is(value.y, -0) ? 0 : value.y }; }
function normalizeText(value: string): string | null { const normalized = value.replace(/\r\n?/g, "\n").normalize("NFC"); return DISALLOWED_CONTROL.test(normalized) ? null : normalized; }
function truncateCodePoints(value: string, maximum: number): string { return [...value].slice(0, maximum).join(""); }
function parseWall(value: unknown): SitePlanWall | null {
  if (!isRecord(value) || !exactKeys(value, ["id", "start", "end", "style"], ["color", "lengthOverride"])) return null;
  if (typeof value.id !== "string" || !SAFE_ID.test(value.id) || typeof value.style !== "string" || !WALL_STYLES.has(value.style as SitePlanWallStyle)) return null;
  if (value.color !== undefined && (typeof value.color !== "string" || !WALL_COLORS.has(value.color as SitePlanWallColor))) return null;
  if (value.lengthOverride !== undefined && value.lengthOverride !== null && !finiteNumber(value.lengthOverride, 0.01, 10_000)) return null;
  const start = parsePoint(value.start); const end = parsePoint(value.end); if (!start || !end || (start.x === end.x && start.y === end.y)) return null;
  return { id: value.id, start, end, style: value.style as SitePlanWallStyle, ...(value.color === undefined ? {} : { color: value.color as SitePlanWallColor }), ...(value.lengthOverride === undefined ? {} : { lengthOverride: value.lengthOverride as number | null }) };
}
function parseTextNote(value: unknown): SitePlanTextNote | null {
  if (!isRecord(value) || !exactKeys(value, ["id", "text", "x", "y", "fontSize"], ["boxWidth", "boxHeight"])) return null;
  if (typeof value.id !== "string" || !SAFE_ID.test(value.id) || typeof value.text !== "string") return null;
  const text = normalizeText(value.text);
  if (text === null || [...text].length > SITE_PLAN_LIMITS.noteText || !finiteNumber(value.x, 0, SITE_PLAN_LIMITS.x) || !finiteNumber(value.y, 0, SITE_PLAN_LIMITS.y) || !finiteNumber(value.fontSize, 0.32, 0.82)) return null;
  if (value.boxWidth !== undefined && !finiteNumber(value.boxWidth, 0.8, 10.5)) return null;
  if (value.boxHeight !== undefined && !finiteNumber(value.boxHeight, 0.8, 17)) return null;
  return { id: value.id, text, x: Object.is(value.x, -0) ? 0 : value.x, y: Object.is(value.y, -0) ? 0 : value.y, fontSize: value.fontSize, ...(value.boxWidth === undefined ? {} : { boxWidth: value.boxWidth }), ...(value.boxHeight === undefined ? {} : { boxHeight: value.boxHeight }) };
}

export function parseSitePlanDocument(value: unknown): SitePlanDrawingDocument | null {
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "templateVersion", "walls", "textNotes", "showDimensions"])) return null;
  if (value.schemaVersion !== 1 || value.templateVersion !== SITE_PLAN_TEMPLATE_VERSION || typeof value.showDimensions !== "boolean") return null;
  if (!Array.isArray(value.walls) || value.walls.length > SITE_PLAN_LIMITS.walls || !Array.isArray(value.textNotes) || value.textNotes.length > SITE_PLAN_LIMITS.notes) return null;
  const walls = value.walls.map(parseWall); const textNotes = value.textNotes.map(parseTextNote); if (walls.some((wall) => wall === null) || textNotes.some((note) => note === null)) return null;
  const wallIds = new Set(walls.map((wall) => wall!.id)); const noteIds = new Set(textNotes.map((note) => note!.id));
  if (wallIds.size !== walls.length || noteIds.size !== textNotes.length || textNotes.reduce((sum, note) => sum + [...note!.text].length, 0) > SITE_PLAN_LIMITS.aggregateNoteText) return null;
  const document: SitePlanDrawingDocument = { schemaVersion: 1, templateVersion: SITE_PLAN_TEMPLATE_VERSION, walls: walls as SitePlanWall[], textNotes: textNotes as SitePlanTextNote[], showDimensions: value.showDimensions };
  return new TextEncoder().encode(JSON.stringify(document)).byteLength <= SITE_PLAN_DOCUMENT_MAX_BYTES ? document : null;
}
export function cleanSitePlanDrawingName(value: unknown) { if (typeof value !== "string") return ""; const normalized = normalizeText(value); if (normalized === null) return ""; return truncateCodePoints(normalized.trim().replace(/[\t ]+/g, " ").replace(/\n+/g, " "), 120).trim(); }
export function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
