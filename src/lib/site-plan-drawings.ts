export type SitePlanWallStyle = "solid" | "dotted";
export type SitePlanWallColor = "slate" | "teal" | "blue" | "amber" | "red";
export type SitePlanPoint = { x: number; y: number };

export type SitePlanWall = {
  id: string;
  start: SitePlanPoint;
  end: SitePlanPoint;
  style: SitePlanWallStyle;
  color?: SitePlanWallColor;
  lengthOverride?: number | null;
};

export type SitePlanTextNote = {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  boxWidth?: number;
  boxHeight?: number;
};

export type SitePlanDrawingDocument = {
  schemaVersion: 1;
  templateVersion: "site-plan-template-v2";
  walls: SitePlanWall[];
  textNotes: SitePlanTextNote[];
  showDimensions: boolean;
};

export type SitePlanDrawing = {
  id: string;
  source: "overlay";
  jobId: string;
  name: string;
  document: SitePlanDrawingDocument;
  revision: number;
  lastPdfFileName: string | null;
  lastExportedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SitePlanDrawingSummary = Omit<SitePlanDrawing, "document"> & {
  wallCount: number;
  textNoteCount: number;
};

export const EMPTY_SITE_PLAN_DOCUMENT: SitePlanDrawingDocument = {
  schemaVersion: 1,
  templateVersion: "site-plan-template-v2",
  walls: [],
  textNotes: [],
  showDimensions: true,
};

const WALL_STYLES = new Set<SitePlanWallStyle>(["solid", "dotted"]);
const WALL_COLORS = new Set<SitePlanWallColor>(["slate", "teal", "blue", "amber", "red"]);
const MAX_WALLS = 2_000;
const MAX_TEXT_NOTES = 500;
const MAX_TEXT_LENGTH = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validPoint(value: unknown): value is SitePlanPoint {
  return isRecord(value) && finiteNumber(value.x) && finiteNumber(value.y);
}

function validWall(value: unknown): value is SitePlanWall {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" && value.id.length > 0 && value.id.length <= 100 &&
    validPoint(value.start) && validPoint(value.end) &&
    typeof value.style === "string" && WALL_STYLES.has(value.style as SitePlanWallStyle) &&
    (value.color === undefined || (typeof value.color === "string" && WALL_COLORS.has(value.color as SitePlanWallColor))) &&
    (value.lengthOverride === undefined || value.lengthOverride === null || finiteNumber(value.lengthOverride))
  );
}

function validTextNote(value: unknown): value is SitePlanTextNote {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" && value.id.length > 0 && value.id.length <= 100 &&
    typeof value.text === "string" && value.text.length <= MAX_TEXT_LENGTH &&
    finiteNumber(value.x) && finiteNumber(value.y) && finiteNumber(value.fontSize) &&
    (value.boxWidth === undefined || finiteNumber(value.boxWidth)) &&
    (value.boxHeight === undefined || finiteNumber(value.boxHeight))
  );
}

export function parseSitePlanDocument(value: unknown): SitePlanDrawingDocument | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== 1 || value.templateVersion !== "site-plan-template-v2") return null;
  if (!Array.isArray(value.walls) || value.walls.length > MAX_WALLS || !value.walls.every(validWall)) return null;
  if (!Array.isArray(value.textNotes) || value.textNotes.length > MAX_TEXT_NOTES || !value.textNotes.every(validTextNote)) return null;
  if (typeof value.showDimensions !== "boolean") return null;

  return {
    schemaVersion: 1,
    templateVersion: "site-plan-template-v2",
    walls: value.walls,
    textNotes: value.textNotes,
    showDimensions: value.showDimensions,
  };
}

export function cleanSitePlanDrawingName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 120);
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
