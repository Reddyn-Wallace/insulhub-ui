"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PDFDocument, rgb } from "pdf-lib";
import { gql } from "@/lib/graphql";

type WallStyle = "solid" | "dotted";
type WallColor = "slate" | "teal" | "blue" | "amber" | "red";
type Point = { x: number; y: number };
type Wall = { id: string; start: Point; end: Point; style: WallStyle; color?: WallColor; lengthOverride?: number | null };
type WallSnapshot = { id: string; start: Point; end: Point };
type TextNote = { id: string; text: string; x: number; y: number; fontSize: number; boxWidth?: number; boxHeight?: number };
type TextMode = "idle" | "placing";
type SnapGuide = { kind: "horizontal" | "vertical" | "endpoint"; point?: Point; lineValue?: number } | null;

type Job = {
  _id: string;
  jobNumber?: string;
  quote?: { date?: string; files_QuoteSitePlan?: string[] };
  client?: { contactDetails?: { streetAddress?: string; suburb?: string; city?: string; postCode?: string } };
};

const JOB_QUERY = `
  query Job($_id: ObjectId!) {
    job(_id: $_id) {
      _id
      jobNumber
      quote { date files_QuoteSitePlan }
      client { contactDetails { streetAddress suburb city postCode } }
    }
  }
`;

const ADD_FILES = `
  mutation AddFiles($_id: ObjectId!, $documentType: UploadedFileType!, $fileNames: [String!]!) {
    addFiles(_id: $_id, documentType: $documentType, fileNames: $fileNames)
  }
`;

const REMOVE_FILE = `
  mutation RemoveFile($_id: ObjectId!, $documentType: UploadedFileType!, $fileName: String!) {
    removeFile(_id: $_id, documentType: $documentType, fileName: $fileName)
  }
`;

const API_BASE = "https://api.insulhub.nz";

// Locked to Site Plan Consent template (Version 2.0 8/5/16)
const BASE_GRID = { left: 41.68504, right: 716.8307, bottom: 254.1251, top: 928.7708 };
const BASE_COLS = 17;
const BASE_ROWS = 17;
const BASE_CELL_X = (BASE_GRID.right - BASE_GRID.left) / BASE_COLS;
const BASE_CELL_Y = (BASE_GRID.top - BASE_GRID.bottom) / BASE_ROWS;
const CAL_X_CELLS = 0.8;
const CAL_Y_CELLS = -3.0;
const WALL_COLOR_OPTIONS: Array<{ key: WallColor; label: string; stroke: string }> = [
  { key: "slate", label: "Slate", stroke: "#1e293b" },
  { key: "teal", label: "Teal", stroke: "#0f766e" },
  { key: "blue", label: "Blue", stroke: "#2563eb" },
  { key: "amber", label: "Amber", stroke: "#d97706" },
  { key: "red", label: "Red", stroke: "#dc2626" },
];
const WALL_COLOR_STROKES: Record<WallColor, string> = Object.fromEntries(WALL_COLOR_OPTIONS.map((o) => [o.key, o.stroke])) as Record<WallColor, string>;
const DEFAULT_WALL_COLOR: WallColor = "slate";
const hexToRgb = (hex: string) => {
  const clean = hex.replace("#", "");
  const parts = clean.length === 3
    ? clean.split("").map((c) => c + c)
    : clean.match(/.{1,2}/g) || ["00", "00", "00"];
  const [r, g, b] = parts.map((p) => parseInt(p, 16) / 255) as [number, number, number];
  return { r, g, b };
};

const GRID = {
  left: BASE_GRID.left + CAL_X_CELLS * BASE_CELL_X,
  right: BASE_GRID.right + CAL_X_CELLS * BASE_CELL_X + BASE_CELL_X,
  bottom: BASE_GRID.bottom + CAL_Y_CELLS * BASE_CELL_Y,
  top: BASE_GRID.top + CAL_Y_CELLS * BASE_CELL_Y,
  width: (BASE_GRID.right - BASE_GRID.left) + BASE_CELL_X,
  height: BASE_GRID.top - BASE_GRID.bottom,
};

const CELLS_X = 18;
const CELLS_Y = 17;
const SNAP_STEP = 0.1;
const ENDPOINT_SNAP_RADIUS = 0.32;
const ORTHO_SNAP_THRESHOLD = 0.27;         // ~15°, was 0.14 (~8°)
const ENDPOINT_DRAG_SNAP_RADIUS = 0.20;
const ENDPOINT_DRAG_ORTHO_THRESHOLD = 0.035;  // ~2°
const WALL_DRAG_ENDPOINT_SNAP_RADIUS = 0.3;
const DRAG_DEAD_ZONE = 0.18;
const ROTATE_SOFT_SNAP_DEG = 2.5;
const ROTATE_RELEASE_SNAP_DEG = 3.0;
const TEXT_NOTE_MIN_WIDTH = 2.2;
const TEXT_NOTE_MAX_WIDTH = 10.5;
const TEXT_NOTE_DEFAULT_WIDTH = 3.8;
const TEXT_NOTE_GROW_BUFFER = 0.18;
const TEXT_NOTE_FONT_FAMILY = 'Arial, Helvetica, sans-serif';
const TEXT_NOTE_HEIGHT = 0.8;
const TEXT_NOTE_LINE_HEIGHT = 1.2;
const TEXT_NOTE_PADDING_X = 0.18;
const TEXT_NOTE_PADDING_Y = 0.14;
const TEXT_NOTE_HIT_PAD = 0.22;
const TEXT_NOTE_DEFAULT_FONT_SIZE = 0.82;
const TEXT_NOTE_MIN_FONT_SIZE = 0.32;
const TEXT_NOTE_MAX_FONT_SIZE = 0.82;

function snap(v: number) { return Math.round(v / SNAP_STEP) * SNAP_STEP; }
function distance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }
function makeId() { return Math.random().toString(36).slice(2, 10); }
function toWinAnsiSafe(text: string): string {
  return (text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function clampPoint(p: Point): Point {
  return { x: Math.max(0, Math.min(CELLS_X, p.x)), y: Math.max(0, Math.min(CELLS_Y, p.y)) };
}
function snapPoint(p: Point): Point { return { x: snap(p.x), y: snap(p.y) }; }
function snapToExistingEndpoints(point: Point, walls: Wall[], excludeWallId?: string, radius: number = ENDPOINT_SNAP_RADIUS): Point {
  let best: Point | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const w of walls) {
    if (excludeWallId && w.id === excludeWallId) continue;
    for (const pt of [w.start, w.end]) {
      const d = distance(point, pt);
      if (d < bestD) { bestD = d; best = pt; }
    }
  }
  if (best && bestD <= radius) return { ...best };
  return point;
}
function snapOrtho(start: Point, end: Point, threshold: number = ORTHO_SNAP_THRESHOLD): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return end;
  if (Math.abs(dy) <= Math.abs(dx) * threshold) return { x: end.x, y: start.y };
  if (Math.abs(dx) <= Math.abs(dy) * threshold) return { x: start.x, y: end.y };
  return end;
}
function orthoKind(start: Point, end: Point, threshold: number = ORTHO_SNAP_THRESHOLD): "horizontal" | "vertical" | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return null;
  if (Math.abs(dy) <= Math.abs(dx) * threshold) return "horizontal";
  if (Math.abs(dx) <= Math.abs(dy) * threshold) return "vertical";
  return null;
}
function clampTextFontSize(size: number): number {
  return Math.max(TEXT_NOTE_MIN_FONT_SIZE, Math.min(TEXT_NOTE_MAX_FONT_SIZE, Number(size.toFixed(2))));
}
function getTextNoteLines(text: string): string[] {
  return (text || "").split("\n");
}
function clampTextNoteWidth(width?: number) {
  return Math.max(TEXT_NOTE_MIN_WIDTH, Math.min(TEXT_NOTE_MAX_WIDTH, width ?? TEXT_NOTE_DEFAULT_WIDTH));
}
function getTextNoteMinHeight(fontSize: number) {
  return Math.max(TEXT_NOTE_HEIGHT, fontSize * TEXT_NOTE_LINE_HEIGHT + TEXT_NOTE_PADDING_Y * 2);
}
function getTextNoteHeight(note: TextNote) {
  return Math.max(getTextNoteMinHeight(note.fontSize), note.boxHeight ?? getTextNoteMinHeight(note.fontSize));
}
function getTextNoteLayout(note: TextNote, liveText: string) {
  const text = liveText || "";
  const lines = getTextNoteLines(text);
  const width = clampTextNoteWidth(note.boxWidth);
  const height = getTextNoteHeight(note);
  const x = note.x - width / 2;
  const y = note.y - height * 0.72;
  return {
    text,
    lines,
    width,
    height,
    x,
    y,
    textX: x + TEXT_NOTE_PADDING_X,
    textY: y + TEXT_NOTE_PADDING_Y + note.fontSize,
  };
}
function getTextNoteBox(note: TextNote, liveText: string) {
  const layout = getTextNoteLayout(note, liveText);
  return { width: layout.width, height: layout.height, x: layout.x, y: layout.y };
}

const JUNCTION_EPSILON = 0.012;
function findLinkedEndpoints(pt: Point, excludeWallId: string, walls: Wall[]): { wallId: string; end: "start" | "end" }[] {
  const results: { wallId: string; end: "start" | "end" }[] = [];
  for (const w of walls) {
    if (w.id === excludeWallId) continue;
    if (distance(w.start, pt) < JUNCTION_EPSILON) results.push({ wallId: w.id, end: "start" });
    if (distance(w.end, pt) < JUNCTION_EPSILON) results.push({ wallId: w.id, end: "end" });
  }
  return results;
}

export default function DrawSitePlanPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const token = typeof window !== "undefined" ? localStorage.getItem("token") || "" : "";

  const [job, setJob] = useState<Job | null>(null);
  const [walls, setWalls] = useState<Wall[]>([]);
  const [textNotes, setTextNotes] = useState<TextNote[]>([]);
  const [history, setHistory] = useState<{ walls: Wall[]; textNotes: TextNote[] }[]>([]);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedWallIds, setSelectedWallIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"trace" | "single" | "select">("trace");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [showDimensions, setShowDimensions] = useState(true);
  const [saveFilename, setSaveFilename] = useState("");
  const [saveChoiceOpen, setSaveChoiceOpen] = useState(false);
  const [saveMode, setSaveMode] = useState<"exit" | "continue">("exit");
  const [wallColorPaletteOpen, setWallColorPaletteOpen] = useState(false);

  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const [draggingWallId, setDraggingWallId] = useState<string | null>(null);
  const [draggingTextId, setDraggingTextId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [textEditValue, setTextEditValue] = useState("");
  const [textMode, setTextMode] = useState<TextMode>("idle");
  const [draggingGroup, setDraggingGroup] = useState(false);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [selectionStart, setSelectionStart] = useState<Point | null>(null);
  const [selectionCurrent, setSelectionCurrent] = useState<Point | null>(null);
  const [draggingEndpoint, setDraggingEndpoint] = useState<{ wallId: string; end: "start" | "end" } | null>(null);
  const [dragStartPoint, setDragStartPoint] = useState<Point | null>(null);
  const [dragSnapshot, setDragSnapshot] = useState<WallSnapshot[]>([]);
  const [rotating, setRotating] = useState(false);
  const [rotateOrigin, setRotateOrigin] = useState<Point | null>(null);
  const [rotateStartAngle, setRotateStartAngle] = useState(0);
  const [rotateSnapshot, setRotateSnapshot] = useState<WallSnapshot[]>([]);
  const [rotateDeltaDeg, setRotateDeltaDeg] = useState(0);
  const [activePointerType, setActivePointerType] = useState<"mouse" | "touch" | "pen">("mouse");
  const [snapGuide, setSnapGuide] = useState<SnapGuide>(null);
  const [lengthEditValue, setLengthEditValue] = useState("");
  const drawStartRef = useRef<Point | null>(null);
  const modeRef = useRef<"trace" | "single" | "select">("trace");
  const wallsRef = useRef<Wall[]>([]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const [canvasDims, setCanvasDims] = useState<{ w: number; h: number } | null>(null);
  const dragActivatedRef = useRef(false);
  const textDragOffsetRef = useRef<Point | null>(null);
  const capturedPointerIdRef = useRef<number | null>(null);
  const isEditingLengthRef = useRef(false);
  const linkedEndpointsRef = useRef<{ wallId: string; end: "start" | "end" }[]>([]);
  const dragAnchorRef = useRef<Point | null>(null);
  const wallDragLinkedSnapshotRef = useRef<{ wallId: string; end: "start" | "end"; originalPos: Point }[]>([]);

  useEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const pad = 16; // p-2 = 8px each side
      const aw = Math.max(0, width - pad);
      const ah = Math.max(0, height - pad);
      if (!aw || !ah) return;
      const ratio = CELLS_X / CELLS_Y;
      if (aw / ah > ratio) {
        setCanvasDims({ w: Math.round(ah * ratio), h: Math.round(ah) });
      } else {
        setCanvasDims({ w: Math.round(aw), h: Math.round(aw / ratio) });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const address = useMemo(() => {
    const c = job?.client?.contactDetails;
    return [c?.streetAddress, c?.suburb, c?.city, c?.postCode].filter(Boolean).join(", ");
  }, [job]);

  const sitePlanFilenameBase = useMemo(() => {
    const firstStreetLine = job?.client?.contactDetails?.streetAddress?.split(/\r?\n/)[0]?.trim() || "";
    return firstStreetLine ? `${firstStreetLine} - site plan` : "site plan";
  }, [job]);

  const selectedWall = useMemo(() => walls.find((w) => w.id === selectedWallId) || null, [walls, selectedWallId]);
  const selectedWallLength = useMemo(() => {
    if (!selectedWall) return null;
    return wallLengthMeters(selectedWall);
  }, [walls, selectedWallId]);
  useEffect(() => {
    drawStartRef.current = drawStart;
  }, [drawStart]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    wallsRef.current = walls;
  }, [walls]);
  useEffect(() => {
    if (selectedWallLength === null) { setLengthEditValue(""); return; }
    if (isEditingLengthRef.current) return;
    setLengthEditValue(selectedWallLength.toFixed(1));
  }, [selectedWallLength, selectedWallId]);

  const activeSelectionIds = useMemo(
    () => (selectedWallIds.length ? selectedWallIds : (selectedWallId ? [selectedWallId] : [])),
    [selectedWallIds, selectedWallId]
  );
  const selectedWallColor = useMemo(() => {
    const ids = activeSelectionIds;
    if (!ids.length) return DEFAULT_WALL_COLOR;
    const colors = ids.map((id) => walls.find((w) => w.id === id)?.color ?? DEFAULT_WALL_COLOR);
    return colors.every((c) => c === colors[0]) ? colors[0] : DEFAULT_WALL_COLOR;
  }, [activeSelectionIds, walls]);
  const selectionBounds = useMemo(() => {
    if (!activeSelectionIds.length) return null;
    const sel = walls.filter((w) => activeSelectionIds.includes(w.id));
    if (!sel.length) return null;
    const pts = sel.flatMap((w) => [w.start, w.end]);
    return {
      minX: Math.min(...pts.map((p) => p.x)),
      maxX: Math.max(...pts.map((p) => p.x)),
      minY: Math.min(...pts.map((p) => p.y)),
      maxY: Math.max(...pts.map((p) => p.y)),
      cx: pts.reduce((a, p) => a + p.x, 0) / pts.length,
      cy: pts.reduce((a, p) => a + p.y, 0) / pts.length,
    };
  }, [walls, activeSelectionIds]);

  const junctionPoints = useMemo(() => {
    const seen = new Set<string>();
    const points: Point[] = [];
    for (const w of walls) {
      for (const pt of [w.start, w.end]) {
        if (findLinkedEndpoints(pt, w.id, walls).length > 0) {
          const key = `${pt.x.toFixed(3)},${pt.y.toFixed(3)}`;
          if (!seen.has(key)) { seen.add(key); points.push(pt); }
        }
      }
    }
    return points;
  }, [walls]);
  const editingTextNote = useMemo(
    () => (editingTextId ? textNotes.find((n) => n.id === editingTextId) ?? null : null),
    [editingTextId, textNotes]
  );

  useEffect(() => {
    if (!id) return;
    (async () => {
      const data = await gql<{ job: Job }>(JOB_QUERY, { _id: id });
      setJob(data.job);
    })().catch((e) => setNotice(e instanceof Error ? e.message : "Failed to load"));
  }, [id]);

  useEffect(() => {
    if (job) {
      setSaveFilename(`${sitePlanFilenameBase}.pdf`);
    }
  }, [sitePlanFilenameBase, job]);

  useEffect(() => {
    if (editingTextId) {
      requestAnimationFrame(() => {
        textInputRef.current?.focus();
        textInputRef.current?.select();
      });
    }
  }, [editingTextId]);

  const syncEditingTextBoxFromDom = useCallback((opts?: { forceGrow?: boolean }) => {
    if (!editingTextNote || !canvasDims) return;
    const textarea = textInputRef.current;
    if (!textarea) return;
    const forceGrow = opts?.forceGrow ?? false;
    const toUnitsX = (px: number) => (px / canvasDims.w) * CELLS_X;
    const toUnitsY = (px: number) => (px / canvasDims.h) * CELLS_Y;
    const pxX = (units: number) => (units / CELLS_X) * canvasDims.w;
    const pxY = (units: number) => (units / CELLS_Y) * canvasDims.h;

    const currentWidthPx = textarea.getBoundingClientRect().width;
    const maxWidthPx = pxX(TEXT_NOTE_MAX_WIDTH);
    const nextWidthPx = (forceGrow || textarea.scrollWidth > currentWidthPx + 0.5)
      ? Math.min(maxWidthPx, Math.max(currentWidthPx, textarea.scrollWidth + pxX(TEXT_NOTE_GROW_BUFFER)))
      : currentWidthPx;

    const minHeightPx = pxY(getTextNoteMinHeight(editingTextNote.fontSize));
    const nextHeightPx = Math.max(minHeightPx, textarea.scrollHeight);
    const nextWidthUnits = Number(clampTextNoteWidth(toUnitsX(nextWidthPx)).toFixed(3));
    const nextHeightUnits = Number(Math.max(getTextNoteMinHeight(editingTextNote.fontSize), toUnitsY(nextHeightPx)).toFixed(3));
    const currentWidthUnits = clampTextNoteWidth(editingTextNote.boxWidth);
    const currentHeightUnits = getTextNoteHeight(editingTextNote);

    if (Math.abs(nextWidthUnits - currentWidthUnits) < 0.001 && Math.abs(nextHeightUnits - currentHeightUnits) < 0.001) return;
    updateTextNote(editingTextNote.id, { boxWidth: nextWidthUnits, boxHeight: nextHeightUnits });
  }, [editingTextNote, canvasDims]);

  useEffect(() => {
    if (!editingTextId || !canvasDims) return;
    const raf = requestAnimationFrame(() => syncEditingTextBoxFromDom({ forceGrow: true }));
    return () => cancelAnimationFrame(raf);
  }, [editingTextId, canvasDims, syncEditingTextBoxFromDom]);

  const toGridPointRaw = useCallback((clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * CELLS_X;
    const y = ((clientY - rect.top) / rect.height) * CELLS_Y;
    return clampPoint({ x, y });
  }, []);

  const toGridPointSnapped = useCallback((clientX: number, clientY: number): Point | null => {
    const p = toGridPointRaw(clientX, clientY);
    return p ? snapPoint(p) : null;
  }, [toGridPointRaw]);

  function findWallNear(p: Point): Wall | null {
    let best: Wall | null = null;
    let bestDist = 999;
    for (const w of walls) {
      const ax = w.start.x, ay = w.start.y, bx = w.end.x, by = w.end.y;
      const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
      if (!l2) continue;
      const t = Math.max(0, Math.min(1, ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / l2));
      const proj = { x: ax + t * (bx - ax), y: ay + t * (by - ay) };
      const d = distance(p, proj);
      if (d < bestDist) { bestDist = d; best = w; }
    }
    return bestDist <= 0.6 ? best : null;
  }

  function findEndpointNearSelected(p: Point): { wallId: string; end: "start" | "end" } | null {
    if (!selectedWallId) return null;
    const w = walls.find((x) => x.id === selectedWallId);
    if (!w) return null;
    const ds = distance(p, w.start);
    const de = distance(p, w.end);
    if (Math.min(ds, de) > 0.5) return null;
    return ds <= de ? { wallId: w.id, end: "start" } : { wallId: w.id, end: "end" };
  }

  function findRotateHandleNear(p: Point): boolean {
    if (!selectionBounds) return false;
    const hx = selectionBounds.cx;
    const hy = selectionBounds.minY - 0.9;
    const hitRadius = activePointerType === "touch" ? 0.85 : activePointerType === "pen" ? 0.65 : 0.45;
    return distance(p, { x: hx, y: hy }) <= hitRadius;
  }

  function pushHistory() {
    setHistory(prev => [...prev.slice(-50), { walls, textNotes }]);
  }

  function undo() {
    if (!history.length) return;
    const previous = history[history.length - 1];
    setWalls(previous.walls);
    setTextNotes(previous.textNotes);
    setHistory(prev => prev.slice(0, -1));
    setSelectedWallId(null);
    setSelectedWallIds([]);
    setEditingTextId(null);
    setDrawStart(null);
    setHoverPoint(null);
  }

  function closeShape() {
    if (!drawStart || walls.length < 3) return;
    const first = walls[0].start;
    pushHistory();
    if (distance(drawStart, first) >= 0.25) {
      setWalls(prev => [...prev, { id: makeId(), start: drawStart, end: first, style: "solid" }]);
    }
    setDrawStart(null);
    setHoverPoint(null);
    setMode("select");
  }

  function addTextNote() {
    setTextMode("placing");
    setMode("select");
    setEditingTextId(null);
    setSelectedTextId(null);
    setTextEditValue("");
  }

  function selectTextNote(noteId: string | null) {
    setSelectedTextId(noteId);
    if (noteId === null) {
      setEditingTextId(null);
      setTextEditValue("");
    }
  }

  function startEditingTextNote(note: TextNote) {
    setTextMode("idle");
    setSelectedTextId(note.id);
    setEditingTextId(note.id);
    setTextEditValue(note.text);
    if (note.boxWidth == null || note.boxHeight == null) {
      updateTextNote(note.id, {
        boxWidth: clampTextNoteWidth(note.boxWidth),
        boxHeight: getTextNoteHeight(note),
      });
    }
  }

  function placeTextNote(at: Point) {
    const note: TextNote = {
      id: makeId(),
      text: "",
      x: at.x,
      y: at.y,
      fontSize: TEXT_NOTE_DEFAULT_FONT_SIZE,
      boxWidth: TEXT_NOTE_DEFAULT_WIDTH,
      boxHeight: getTextNoteMinHeight(TEXT_NOTE_DEFAULT_FONT_SIZE),
    };
    pushHistory();
    setTextNotes((prev) => [...prev, note]);
    setTextMode("idle");
    setSelectedTextId(note.id);
    setEditingTextId(note.id);
    setTextEditValue("");
  }

  function updateTextNote(id: string, patch: Partial<TextNote>) {
    setTextNotes((prev) => prev.map((n) => n.id === id ? { ...n, ...patch } : n));
  }

  function deleteTextNote(id: string) {
    pushHistory();
    setTextNotes((prev) => prev.filter((n) => n.id !== id));
    if (editingTextId === id) setEditingTextId(null);
    if (selectedTextId === id) setSelectedTextId(null);
  }

  function findTextHit(p: Point): TextNote | null {
    for (let i = textNotes.length - 1; i >= 0; i -= 1) {
      const note = textNotes[i];
      const liveText = editingTextId === note.id ? textEditValue : note.text;
      const box = getTextNoteBox(note, liveText);
      const inX = p.x >= box.x - TEXT_NOTE_HIT_PAD && p.x <= box.x + box.width + TEXT_NOTE_HIT_PAD;
      const inY = p.y >= box.y - TEXT_NOTE_HIT_PAD && p.y <= box.y + box.height + TEXT_NOTE_HIT_PAD;
      if (inX && inY) return note;
    }
    return null;
  }

  function pointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const pt = (e.pointerType === "touch" || e.pointerType === "pen") ? e.pointerType : "mouse";
    setActivePointerType(pt);
    const p = (mode === "trace" || mode === "single")
      ? toGridPointSnapped(e.clientX, e.clientY)
      : toGridPointRaw(e.clientX, e.clientY);
    if (!p) return;
    setSnapGuide(null);

    if (mode === "trace" || mode === "single") {
      if (!drawStart) {
        // Snap first point to nearest grid intersection for a clean anchor
        const snappedStart = { x: Math.round(p.x), y: Math.round(p.y) };
        setDrawStart(snappedStart);
        setHoverPoint(snappedStart);
        return;
      }

      // Apply same ortho + endpoint snapping as pointerMove so click lands where indicator shows
      let endPoint = snapToExistingEndpoints(snapOrtho(drawStart, p), walls);
      if (mode === "trace" && walls.length >= 2) {
        const first = walls[0]?.start;
        if (first && distance(p, first) <= 0.6) endPoint = first;
      }

      if (distance(drawStart, endPoint) >= 0.25) {
        pushHistory();
        setWalls((prev) => [...prev, { id: makeId(), start: drawStart, end: endPoint, style: "solid", color: DEFAULT_WALL_COLOR }]);
      }

      if (mode === "single") {
        setDrawStart(null);
        setHoverPoint(null);
        setMode("select");
        return;
      }

      const first = walls[0]?.start;
      if (first && distance(endPoint, first) <= 0.0001 && walls.length >= 2) {
        setDrawStart(null);
        setHoverPoint(null);
        setMode("select");
        return;
      }

      setDrawStart(endPoint);
      setHoverPoint(endPoint);
      return;
    }

    if (textMode === "placing") {
      placeTextNote(snapPoint(p));
      return;
    }

    const textHit = findTextHit(p);
    if (textHit) {
      setSelectedWallId(null);
      setSelectedWallIds([]);
      setTextMode("idle");
      if (editingTextId === textHit.id) return;
      if (selectedTextId === textHit.id) {
        pushHistory();
        setDraggingTextId(textHit.id);
        setDragStartPoint(p);
        textDragOffsetRef.current = { x: p.x - textHit.x, y: p.y - textHit.y };
        dragActivatedRef.current = false;
        svgRef.current?.setPointerCapture(e.pointerId);
        capturedPointerIdRef.current = e.pointerId;
        return;
      }
      selectTextNote(textHit.id);
      return;
    }

    if (editingTextId) {
      setEditingTextId(null);
    }
    setSelectedTextId(null);

    if (activeSelectionIds.length > 0 && findRotateHandleNear(p) && selectionBounds) {
      pushHistory();
      const snap = walls
        .filter((w) => activeSelectionIds.includes(w.id))
        .map((w) => ({ id: w.id, start: { ...w.start }, end: { ...w.end } }));
      setRotating(true);
      setRotateOrigin({ x: selectionBounds.cx, y: selectionBounds.cy });
      setRotateStartAngle(Math.atan2(p.y - selectionBounds.cy, p.x - selectionBounds.cx));
      setRotateSnapshot(snap);
      setRotateDeltaDeg(0);
      svgRef.current?.setPointerCapture(e.pointerId);
      capturedPointerIdRef.current = e.pointerId;
      return;
    }

    const endpoint = findEndpointNearSelected(p);
    if (endpoint) {
      pushHistory();
      setSelectedWallId(endpoint.wallId);
      setDraggingEndpoint(endpoint);
      dragActivatedRef.current = true;
      const ew = walls.find(x => x.id === endpoint.wallId);
      if (ew) {
        const origPt = endpoint.end === "start" ? ew.start : ew.end;
        linkedEndpointsRef.current = findLinkedEndpoints(origPt, endpoint.wallId, walls);
        dragAnchorRef.current = endpoint.end === "start" ? { ...ew.end } : { ...ew.start };
      }
      svgRef.current?.setPointerCapture(e.pointerId);
      capturedPointerIdRef.current = e.pointerId;
      return;
    }

    const hit = findWallNear(p);
    if (hit) {
      const alreadySelected = activeSelectionIds.includes(hit.id);
      const moveIds = alreadySelected ? activeSelectionIds : [hit.id];
      if (!alreadySelected) setSelectedWallIds([hit.id]);
      setSelectedWallId(hit.id);
      setEditingTextId(null);
      setSelectedTextId(null);
      setDragStartPoint(p);
      setDragSnapshot(
        walls
          .filter((w) => moveIds.includes(w.id))
          .map((w) => ({ id: w.id, start: { ...w.start }, end: { ...w.end } }))
      );
      // Build linked-endpoint snapshot for non-dragged walls connected to dragged walls
      const moveIdSet = new Set(moveIds);
      const wdLinked: { wallId: string; end: "start" | "end"; originalPos: Point }[] = [];
      const seenKey = new Set<string>();
      for (const mw of walls.filter(w => moveIds.includes(w.id))) {
        for (const { pt } of [{ pt: mw.start }, { pt: mw.end }]) {
          for (const neighbor of findLinkedEndpoints(pt, mw.id, walls)) {
            if (!moveIdSet.has(neighbor.wallId)) {
              const key = `${neighbor.wallId}:${neighbor.end}`;
              if (!seenKey.has(key)) {
                seenKey.add(key);
                const nw = walls.find(w => w.id === neighbor.wallId);
                if (nw) {
                  const origPos = neighbor.end === "start" ? { ...nw.start } : { ...nw.end };
                  wdLinked.push({ wallId: neighbor.wallId, end: neighbor.end, originalPos: origPos });
                }
              }
            }
          }
        }
      }
      wallDragLinkedSnapshotRef.current = wdLinked;
      pushHistory();
      dragActivatedRef.current = false;
      svgRef.current?.setPointerCapture(e.pointerId);
      capturedPointerIdRef.current = e.pointerId;
      if (moveIds.length > 1) {
        setDraggingGroup(true);
      } else {
        setDraggingWallId(hit.id);
      }
      return;
    }

    setSelectionStart(p);
    setSelectionCurrent(p);
    setSelectedWallId(null);
    setSelectedWallIds([]);
    setEditingTextId(null);
    setSelectedTextId(null);
  }

  function updateDrawPreview(clientX: number, clientY: number) {
    const modeNow = modeRef.current;
    if (modeNow !== "trace" && modeNow !== "single") return;
    const p = toGridPointSnapped(clientX, clientY);
    if (!p) return;
    setSnapGuide(null);
    const start = drawStartRef.current;
    const snapped = snapPoint(p);

    if (start) {
      const kind = orthoKind(start, snapped);
      const ortho = snapOrtho(start, snapped);
      const endpointSnapped = snapToExistingEndpoints(ortho, wallsRef.current);
      setHoverPoint(endpointSnapped);
      if (endpointSnapped.x !== ortho.x || endpointSnapped.y !== ortho.y) {
        setSnapGuide({ kind: "endpoint", point: endpointSnapped });
      } else if (kind === "horizontal") {
        setSnapGuide({ kind: "horizontal", lineValue: start.y });
      } else if (kind === "vertical") {
        setSnapGuide({ kind: "vertical", lineValue: start.x });
      } else {
        setSnapGuide(null);
      }
    } else {
      setHoverPoint(snapped);
      setSnapGuide(null);
    }
  }

  function pointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const p = (mode === "trace" || mode === "single")
      ? toGridPointSnapped(e.clientX, e.clientY)
      : toGridPointRaw(e.clientX, e.clientY);
    if (!p) return;

    if (mode === "trace" || mode === "single") {
      updateDrawPreview(e.clientX, e.clientY);
      return;
    }

    setSnapGuide(null);

    if (rotating && rotateOrigin && rotateSnapshot.length) {
      const currentAngle = Math.atan2(p.y - rotateOrigin.y, p.x - rotateOrigin.x);
      let delta = currentAngle - rotateStartAngle;
      let deg = (delta * 180) / Math.PI;
      const nearest = Math.round(deg / 90) * 90;
      if (Math.abs(deg - nearest) <= ROTATE_SOFT_SNAP_DEG) {
        deg = nearest;
        delta = (deg * Math.PI) / 180;
      }
      setRotateDeltaDeg(deg);
      setWalls((prev) => prev.map((w) => {
        const src = rotateSnapshot.find((x) => x.id === w.id);
        if (!src) return w;
        const rot = (pt: Point) => {
          const dx = pt.x - rotateOrigin.x;
          const dy = pt.y - rotateOrigin.y;
          return clampPoint({
            x: rotateOrigin.x + dx * Math.cos(delta) - dy * Math.sin(delta),
            y: rotateOrigin.y + dx * Math.sin(delta) + dy * Math.cos(delta),
          });
        };
        return { ...w, start: rot(src.start), end: rot(src.end) };
      }));
      return;
    }

    if (draggingTextId) {
      if (!dragActivatedRef.current) {
        if (distance(p, dragStartPoint ?? p) < DRAG_DEAD_ZONE) return;
        dragActivatedRef.current = true;
      }
      const offset = textDragOffsetRef.current ?? { x: 0, y: 0 };
      const nextCenter = clampPoint({ x: p.x - offset.x, y: p.y - offset.y });
      setTextNotes((prev) => prev.map((n) => n.id === draggingTextId ? { ...n, x: nextCenter.x, y: nextCenter.y } : n));
      return;
    }

    if (draggingEndpoint) {
      const anchor = dragAnchorRef.current ?? (() => {
        const fw = walls.find(x => x.id === draggingEndpoint.wallId);
        return fw ? (draggingEndpoint.end === "start" ? fw.end : fw.start) : null;
      })();
      if (!anchor) return;
      let candidate = snapPoint(p);
      const kind = orthoKind(anchor, candidate, ENDPOINT_DRAG_ORTHO_THRESHOLD);
      candidate = snapOrtho(anchor, candidate, ENDPOINT_DRAG_ORTHO_THRESHOLD);
      // Exclude dragged wall and its linked siblings from endpoint snap targets
      const snapWalls = walls.filter(w =>
        w.id !== draggingEndpoint.wallId &&
        !linkedEndpointsRef.current.some(l => l.wallId === w.id)
      );
      const newPt = clampPoint(snapToExistingEndpoints(candidate, snapWalls, undefined, ENDPOINT_DRAG_SNAP_RADIUS));
      if (newPt.x !== candidate.x || newPt.y !== candidate.y) {
        setSnapGuide({ kind: "endpoint", point: newPt });
      } else if (kind === "horizontal") {
        setSnapGuide({ kind: "horizontal", lineValue: anchor.y });
      } else if (kind === "vertical") {
        setSnapGuide({ kind: "vertical", lineValue: anchor.x });
      } else {
        setSnapGuide(null);
      }
      setWalls((prev) => prev.map((w) => {
        if (w.id === draggingEndpoint.wallId) {
          if (draggingEndpoint.end === "start") return { ...w, start: newPt, lengthOverride: null };
          return { ...w, end: newPt, lengthOverride: null };
        }
        const link = linkedEndpointsRef.current.find(l => l.wallId === w.id);
        if (link) return link.end === "start" ? { ...w, start: newPt } : { ...w, end: newPt };
        return w;
      }));
      return;
    }

    if (selectionStart) {
      setSelectionCurrent(p);
      return;
    }

    if ((draggingGroup || draggingWallId) && dragStartPoint && dragSnapshot.length) {
      if (!dragActivatedRef.current) {
        if (distance(p, dragStartPoint) < DRAG_DEAD_ZONE) return;
        dragActivatedRef.current = true;
      }
      let dx = snap(p.x - dragStartPoint.x);
      let dy = snap(p.y - dragStartPoint.y);
      if (!draggingGroup && dragSnapshot.length === 1) {
        const src = dragSnapshot[0];
        const candidateStart = { x: src.start.x + dx, y: src.start.y + dy };
        const candidateEnd = { x: src.end.x + dx, y: src.end.y + dy };
        let bestD = WALL_DRAG_ENDPOINT_SNAP_RADIUS;
        let bestDelta: Point | null = null;
        for (const w of walls) {
          if (w.id === src.id) continue;
          if (wallDragLinkedSnapshotRef.current.some(l => l.wallId === w.id)) continue;
          for (const their of [w.start, w.end]) {
            for (const mine of [candidateStart, candidateEnd]) {
              const d = distance(mine, their);
              if (d < bestD) { bestD = d; bestDelta = { x: their.x - mine.x, y: their.y - mine.y }; }
            }
          }
        }
        if (bestDelta) { dx += bestDelta.x; dy += bestDelta.y; }
      }
      setWalls((prev) => prev.map((w) => {
        const src = dragSnapshot.find((x) => x.id === w.id);
        if (src) {
          return {
            ...w,
            start: clampPoint({ x: src.start.x + dx, y: src.start.y + dy }),
            end: clampPoint({ x: src.end.x + dx, y: src.end.y + dy }),
          };
        }
        const links = wallDragLinkedSnapshotRef.current.filter(l => l.wallId === w.id);
        if (links.length > 0) {
          let updated = { ...w, lengthOverride: null };
          for (const link of links) {
            const newPos = clampPoint({ x: link.originalPos.x + dx, y: link.originalPos.y + dy });
            if (link.end === "start") updated = { ...updated, start: newPos };
            else updated = { ...updated, end: newPos };
          }
          return updated;
        }
        return w;
      }));
      return;
    }
  }

  useEffect(() => {
    const handleHoverLikeEvent = (e: Event) => {
      const evt = e as MouseEvent | PointerEvent;
      if (typeof evt.clientX !== "number" || typeof evt.clientY !== "number") return;
      updateDrawPreview(evt.clientX, evt.clientY);
    };

    const targets: EventTarget[] = [window, document];
    const eventNames = ["pointermove", "pointerrawupdate", "mousemove", "pointerover", "mouseover", "pointerenter", "mouseenter"];

    for (const target of targets) {
      for (const eventName of eventNames) {
        target.addEventListener(eventName, handleHoverLikeEvent, { passive: true, capture: true });
      }
    }

    return () => {
      for (const target of targets) {
        for (const eventName of eventNames) {
          target.removeEventListener(eventName, handleHoverLikeEvent, true);
        }
      }
    };
  }, []);

  function pointerUp() {
    if (capturedPointerIdRef.current !== null && svgRef.current) {
      try { svgRef.current.releasePointerCapture(capturedPointerIdRef.current); } catch {}
      capturedPointerIdRef.current = null;
    }
    linkedEndpointsRef.current = [];
    dragAnchorRef.current = null;
    wallDragLinkedSnapshotRef.current = [];
    textDragOffsetRef.current = null;
    setDraggingWallId(null);
    setDraggingTextId(null);
    setDraggingEndpoint(null);
    setDraggingGroup(false);
    setDragStartPoint(null);
    setDragSnapshot([]);

    if (rotating) {
      const nearest = Math.round(rotateDeltaDeg / 90) * 90;
      if (Math.abs(rotateDeltaDeg - nearest) <= ROTATE_RELEASE_SNAP_DEG && rotateOrigin && rotateSnapshot.length) {
        const rad = (nearest * Math.PI) / 180;
        setWalls((prev) => prev.map((w) => {
          const src = rotateSnapshot.find((x) => x.id === w.id);
          if (!src) return w;
          const rot = (pt: Point) => {
            const dx = pt.x - rotateOrigin.x;
            const dy = pt.y - rotateOrigin.y;
            return clampPoint({
              x: rotateOrigin.x + dx * Math.cos(rad) - dy * Math.sin(rad),
              y: rotateOrigin.y + dx * Math.sin(rad) + dy * Math.cos(rad),
            });
          };
          return { ...w, start: rot(src.start), end: rot(src.end) };
        }));
      }
      setRotating(false);
      setRotateSnapshot([]);
      setRotateDeltaDeg(0);
      return;
    }

    if (selectionStart && selectionCurrent) {
      const minX = Math.min(selectionStart.x, selectionCurrent.x);
      const maxX = Math.max(selectionStart.x, selectionCurrent.x);
      const minY = Math.min(selectionStart.y, selectionCurrent.y);
      const maxY = Math.max(selectionStart.y, selectionCurrent.y);
      const ids = walls
        .filter((w) => {
          const pts = [w.start, w.end, { x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 }];
          return pts.some((pt) => pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY);
        })
        .map((w) => w.id);
      setSelectedWallIds(ids);
      setSelectedWallId(ids[0] || null);
    }

    setWalls((prev) => prev.map((w) => ({
      ...w,
      start: snapPoint(w.start),
      end: snapPoint(w.end),
    })));

    setSelectionStart(null);
    setSelectionCurrent(null);
    setSnapGuide(null);
  }

  function removeSelectedWall() {
    const ids = selectedWallIds.length ? selectedWallIds : (selectedWallId ? [selectedWallId] : []);
    if (!ids.length) return;
    pushHistory();
    setWalls((prev) => prev.filter((w) => !ids.includes(w.id)));
    setSelectedWallId(null);
    setSelectedWallIds([]);
  }

  function wallLengthMeters(w: Wall) {
    return w.lengthOverride ?? Number(distance(w.start, w.end).toFixed(2));
  }

  function applyLengthOverride(wallId: string, lengthMeters: number) {
    pushHistory();
    setWalls((prev) => {
      const target = prev.find(w => w.id === wallId);
      if (!target) return prev;
      const dx = target.end.x - target.start.x;
      const dy = target.end.y - target.start.y;
      const current = Math.hypot(dx, dy);
      if (current < 1e-6 || !Number.isFinite(lengthMeters) || lengthMeters <= 0) return prev;
      const scale = lengthMeters / current;
      const newEnd = clampPoint({ x: target.start.x + dx * scale, y: target.start.y + dy * scale });
      const linked = findLinkedEndpoints(target.end, wallId, prev);
      return prev.map(w => {
        if (w.id === wallId) return { ...w, end: newEnd, lengthOverride: Number(lengthMeters.toFixed(2)) };
        const link = linked.find(l => l.wallId === w.id);
        if (link) return link.end === "start" ? { ...w, start: newEnd } : { ...w, end: newEnd };
        return w;
      });
    });
  }

  async function saveCompletedSitePlan(shouldExit = true) {
    if (!walls.length) {
      setNotice("Draw at least one wall.");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const sourcePdfBytes = await fetch(`/site-plan-template-v2.pdf`).then((r) => {
        if (!r.ok) throw new Error("Could not load locked site plan template PDF.");
        return r.arrayBuffer();
      });
      const pdfDoc = await PDFDocument.load(sourcePdfBytes);
      const page = pdfDoc.getPage(0);

      const toPdf = (pt: Point) => ({
        x: GRID.left + (pt.x / CELLS_X) * GRID.width,
        y: GRID.top - (pt.y / CELLS_Y) * GRID.height,
      });

      const MASK_BLEED = 2.0;
      page.drawRectangle({
        x: GRID.left - MASK_BLEED,
        y: GRID.bottom - MASK_BLEED,
        width: GRID.width + MASK_BLEED * 2,
        height: GRID.height + MASK_BLEED * 2,
        color: rgb(1, 1, 1),
      });

      for (let i = 0; i <= CELLS_X; i += 1) {
        const x = GRID.left + (i / CELLS_X) * GRID.width;
        page.drawLine({
          start: { x, y: GRID.bottom },
          end: { x, y: GRID.top },
          thickness: i === 0 || i === CELLS_X ? 0.9 : 0.45,
          color: rgb(0.72, 0.72, 0.72),
        });
      }
      for (let j = 0; j <= CELLS_Y; j += 1) {
        const y = GRID.bottom + (j / CELLS_Y) * GRID.height;
        page.drawLine({
          start: { x: GRID.left, y },
          end: { x: GRID.right, y },
          thickness: j === 0 || j === CELLS_Y ? 0.9 : 0.45,
          color: rgb(0.72, 0.72, 0.72),
        });
      }

      for (const w of walls) {
        const a = toPdf(w.start);
        const b = toPdf(w.end);
        const wallStroke = WALL_COLOR_STROKES[w.color ?? DEFAULT_WALL_COLOR] ?? WALL_COLOR_STROKES[DEFAULT_WALL_COLOR];
        const { r, g, b: bColor } = hexToRgb(wallStroke);
        page.drawLine({
          start: { x: a.x, y: a.y },
          end: { x: b.x, y: b.y },
          thickness: 3.5,
          color: rgb(r, g, bColor),
          dashArray: w.style === "dotted" ? [5, 4] : undefined,
        });

        if (showDimensions) {
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          page.drawText(`${wallLengthMeters(w).toFixed(1)}m`, {
            x: mid.x + 2,
            y: mid.y + 2,
            size: 8,
            color: rgb(0.15, 0.15, 0.15),
          });
        }
      }

      for (const note of textNotes) {
        const p = toPdf({ x: note.x, y: note.y });
        page.drawText(toWinAnsiSafe(note.text), {
          x: p.x,
          y: p.y,
          size: 11,
          color: rgb(0.1, 0.1, 0.1),
          maxWidth: 220,
        });
      }

      if (address) {
        page.drawText(toWinAnsiSafe(address), {
          x: 145,
          y: 953,
          size: 11,
          color: rgb(0, 0, 0),
          maxWidth: 540,
        });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
      const cleanedFilename = saveFilename.trim().replace(/\.pdf$/i, "").replace(/[\\/]/g, "-") || sitePlanFilenameBase;
      const filename = `${cleanedFilename}.pdf`;
      const file = new File([blob], filename, { type: "application/pdf" });

      const uploadData = new FormData();
      uploadData.append("files", file);
      const uploadRes = await fetch(`${API_BASE}/files/upload`, {
        method: "POST",
        headers: { "x-token": token },
        body: uploadData,
      });
      const uploadJson = await uploadRes.json();
      const uploaded = (uploadJson.fileNames || []) as string[];
      if (!uploaded.length) throw new Error("Upload failed");

      await gql(ADD_FILES, { _id: id, documentType: "QUOTE_SITE_PLAN", fileNames: [uploaded[0]] });

      setNotice("Site plan saved successfully.");
      if (shouldExit) setTimeout(() => router.push(`/jobs/${id}`), 400);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Failed to save site plan");
    } finally {
      setSaving(false);
    }
  }

  const canCloseShape = mode === "trace" && !!drawStart && walls.length >= 3;

  return (
    <div className="fixed inset-x-0 bottom-0 flex flex-col bg-[#eef0f3] overflow-hidden" style={{ top: "var(--nav-height, 0px)" }}>

      {/* Top bar */}
      <div className="relative flex items-center justify-between px-4 bg-white border-b border-gray-200 z-30 flex-shrink-0" style={{ height: 56 }}>
        <button
          onClick={() => router.push(`/jobs/${id}`)}
          className="text-sm font-medium text-gray-500 -ml-1 px-2 h-10 rounded-lg flex items-center gap-1 active:bg-gray-100"
        >
          ← Back
        </button>
        <span className="absolute left-1/2 -translate-x-1/2 text-sm font-semibold text-[#1a3a4a] pointer-events-none">
          Site Plan
        </span>
        <div className="flex items-center gap-2 flex-1 justify-end max-w-[68vw]">
          <input
            value={saveFilename}
            onChange={(e) => setSaveFilename(e.target.value)}
            placeholder="siteplan filename"
            className="min-w-0 w-full max-w-[280px] h-10 px-3 rounded-xl border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1a3a4a]/20"
          />
          <button
            onClick={() => { setSaveMode("exit"); setSaveChoiceOpen(true); }}
            disabled={saving}
            className="bg-[#1a3a4a] text-white px-4 h-10 rounded-xl text-sm font-semibold disabled:opacity-60 active:opacity-80"
          >
            {saving ? "Saving…" : "Save & Exit"}
          </button>
          <button
            onClick={() => { setSaveMode("continue"); setSaveChoiceOpen(true); }}
            disabled={saving}
            className="bg-white text-[#1a3a4a] border border-[#1a3a4a]/20 px-4 h-10 rounded-xl text-sm font-semibold disabled:opacity-60 active:opacity-80"
          >
            Save
          </button>
        </div>
      </div>

      {/* Save choice modal */}
      {saveChoiceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl border border-gray-100">
            <h3 className="text-base font-semibold text-gray-900 mb-2">
              {saveMode === "exit" ? "Save and exit?" : "Save?"}
            </h3>
            <p className="text-sm text-gray-600 mb-5">
              {saveMode === "exit"
                ? "Are you sure you'll no longer be able to edit this floor plan?"
                : "This will save the current floor plan and allow you to continue editing."}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setSaveChoiceOpen(false)}
                className="px-4 h-10 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 bg-white"
              >
                Cancel
              </button>
              <button
                onClick={() => { setSaveChoiceOpen(false); void saveCompletedSitePlan(saveMode === "exit"); }}
                disabled={saving}
                className="px-4 h-10 rounded-xl text-sm font-semibold text-white bg-[#1a3a4a] disabled:opacity-60"
              >
                {saving ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notice toast */}
      {notice && (
        <div
          className="absolute left-4 right-4 z-50 text-sm bg-amber-50 text-amber-800 border border-amber-200 rounded-xl px-4 py-2.5 shadow-lg"
          style={{ top: 64 }}
        >
          {notice}
        </div>
      )}

      {/* Canvas area */}
      <div ref={canvasAreaRef} className="flex-1 min-h-0 overflow-hidden relative">
        <div className="absolute inset-0 flex items-center justify-center p-2">
        {canvasDims && (
        <div
          className="relative rounded-xl shadow border border-gray-300 bg-white flex-shrink-0"
          style={{
            width: canvasDims.w,
            height: canvasDims.h,
            backgroundImage:
              "linear-gradient(to right, #c8d0da 1px, transparent 1px), linear-gradient(to bottom, #c8d0da 1px, transparent 1px)",
            backgroundSize: `calc(100%/${CELLS_X}) calc(100%/${CELLS_Y})`,
            userSelect: "none",
            touchAction: "none",
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Floating selection toolbar */}
          {selectionBounds && mode === "select" && (() => {
            const aboveY = (selectionBounds.minY - 2.8) / CELLS_Y * 100;
            const belowY = (selectionBounds.maxY + 1.2) / CELLS_Y * 100;
            // Show above if there's enough room, otherwise below
            const showAbove = aboveY > 18;
            const centerPct = (selectionBounds.cx / CELLS_X) * 100;
            return (
            <div
              className="absolute z-20 flex flex-col gap-1.5 bg-white/96 backdrop-blur-sm border border-gray-200 rounded-xl shadow-lg px-2.5 py-2"
              style={{
                left: `clamp(155px, ${centerPct}%, calc(100% - 155px))`,
                top: showAbove ? `max(4px, ${aboveY}%)` : `min(calc(100% - 4px), ${belowY}%)`,
                transform: showAbove ? "translate(-50%, -100%)" : "translate(-50%, 0%)",
              }}
            >
              <div className="flex items-center gap-1.5 flex-wrap max-w-[280px]">
                <button
                  onClick={() => {
                    const ids = activeSelectionIds;
                    setWalls((prev) => prev.map((w) => ids.includes(w.id) ? { ...w, style: "solid" } : w));
                  }}
                  className="px-3 h-8 rounded-lg text-xs font-medium bg-gray-100 active:bg-gray-200"
                >Solid</button>
                <button
                  onClick={() => {
                    const ids = activeSelectionIds;
                    setWalls((prev) => prev.map((w) => ids.includes(w.id) ? { ...w, style: "dotted" } : w));
                  }}
                  className="px-3 h-8 rounded-lg text-xs font-medium bg-gray-100 active:bg-gray-200"
                >Dotted</button>
                <button
                  onClick={() => setWallColorPaletteOpen((open) => !open)}
                  className="px-3 h-8 rounded-lg text-xs font-medium text-white border border-black/10 active:opacity-90"
                  style={{ backgroundColor: WALL_COLOR_STROKES[selectedWallColor] }}
                  title="Change wall color"
                >
                  Color
                </button>
                {wallColorPaletteOpen && WALL_COLOR_OPTIONS.map((opt) => {
                  const selected = activeSelectionIds.length > 0 && activeSelectionIds.every((id) => (walls.find((w) => w.id === id)?.color ?? DEFAULT_WALL_COLOR) === opt.key);
                  return (
                    <button
                      key={opt.key}
                      onClick={() => {
                        const ids = activeSelectionIds;
                        setWalls((prev) => prev.map((w) => ids.includes(w.id) ? { ...w, color: opt.key } : w));
                        setWallColorPaletteOpen(false);
                      }}
                      className={`px-3 h-8 rounded-lg text-xs font-medium border ${selected ? "border-gray-400 ring-2 ring-gray-300" : "border-gray-200"} active:opacity-90`}
                      style={{ backgroundColor: opt.stroke, color: "white" }}
                      title={opt.label}
                    >
                      {opt.label}
                    </button>
                  );
                })}
                {selectedWall && selectedWallId && (() => {
                  const lStart = findLinkedEndpoints(selectedWall.start, selectedWallId, walls);
                  const lEnd = findLinkedEndpoints(selectedWall.end, selectedWallId, walls);
                  if (!lStart.length && !lEnd.length) return null;
                  return (
                    <button
                      onClick={() => {
                        pushHistory();
                        setWalls(prev => {
                          const w = prev.find(x => x.id === selectedWallId);
                          if (!w) return prev;
                          const dx = w.end.x - w.start.x;
                          const dy = w.end.y - w.start.y;
                          const len = Math.hypot(dx, dy) || 1;
                          // Nudge perpendicular to wall to break coincidence
                          const nx = (-dy / len) * 0.08;
                          const ny = (dx / len) * 0.08;
                          return prev.map(x => x.id !== selectedWallId ? x : {
                            ...x,
                            start: lStart.length ? clampPoint({ x: x.start.x + nx, y: x.start.y + ny }) : x.start,
                            end: lEnd.length ? clampPoint({ x: x.end.x + nx, y: x.end.y + ny }) : x.end,
                          });
                        });
                      }}
                      className="px-3 h-8 rounded-lg text-xs font-medium bg-orange-50 text-orange-600 active:bg-orange-100"
                    >Break</button>
                  );
                })()}
                <div className="w-px h-5 bg-gray-200 flex-shrink-0" />
                <button
                  onClick={removeSelectedWall}
                  className="px-3 h-8 rounded-lg text-xs font-medium bg-red-50 text-red-600 active:bg-red-100"
                >Delete</button>
              </div>
              {selectedWall && selectedWallId && (
                <div className="flex items-center gap-1 pt-1 border-t border-gray-100">
                  <span className="text-xs font-medium text-gray-500 flex-shrink-0 w-10 text-center">{wallLengthMeters(selectedWall).toFixed(1)}m</span>
                  {([-0.5, -0.1, 0.1, 0.5] as const).map((delta) => (
                    <button
                      key={delta}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        if (!selectedWallId) return;
                        const current = wallLengthMeters(walls.find(w => w.id === selectedWallId)!);
                        const next = Math.max(0.1, Math.round((current + delta) * 10) / 10);
                        applyLengthOverride(selectedWallId, next);
                      }}
                      className="flex-1 h-8 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 active:bg-gray-200"
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </button>
                  ))}
                </div>
              )}
            </div>
            );
          })()}

          {mode === "select" && selectedTextId && (() => {
            const selectedText = textNotes.find((n) => n.id === selectedTextId);
            if (!selectedText) return null;
            const box = getTextNoteBox(selectedText, editingTextId === selectedText.id ? textEditValue : selectedText.text);
            const aboveY = ((box.y - 1.3) / CELLS_Y) * 100;
            const belowY = ((box.y + box.height + 0.35) / CELLS_Y) * 100;
            const centerPct = ((box.x + box.width / 2) / CELLS_X) * 100;
            const showAbove = aboveY > 12;
            return (
              <div
                className="absolute z-20 flex items-center gap-1.5 bg-white/96 backdrop-blur-sm border border-gray-200 rounded-xl shadow-lg px-2 py-2"
                style={{
                  left: `clamp(140px, ${centerPct}%, calc(100% - 140px))`,
                  top: showAbove ? `max(4px, ${aboveY}%)` : `min(calc(100% - 4px), ${belowY}%)`,
                  transform: showAbove ? "translate(-50%, -100%)" : "translate(-50%, 0%)",
                }}
              >
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => startEditingTextNote(selectedText)}
                  className="px-3 h-8 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 active:bg-blue-100"
                >Edit</button>
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => deleteTextNote(selectedText.id)}
                  className="px-3 h-8 rounded-lg text-xs font-medium bg-red-50 text-red-600 active:bg-red-100"
                >Delete</button>
              </div>
            );
          })()}

          {/* SVG drawing canvas */}
          <svg
            ref={svgRef}
            viewBox={`0 0 ${CELLS_X} ${CELLS_Y}`}
            className="w-full h-full touch-none"
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerEnter={(e) => updateDrawPreview(e.clientX, e.clientY)}
            onPointerOver={(e) => updateDrawPreview(e.clientX, e.clientY)}
            onMouseMove={(e) => updateDrawPreview(e.clientX, e.clientY)}
            onMouseEnter={(e) => updateDrawPreview(e.clientX, e.clientY)}
            onPointerUp={pointerUp}
            onPointerLeave={() => {
              // In draw modes, keep the last preview alive so pen hover can resume cleanly after lifting.
              if (capturedPointerIdRef.current === null) {
                if (drawStartRef.current && (modeRef.current === "trace" || modeRef.current === "single")) {
                  setSnapGuide(null);
                  return;
                }
                setHoverPoint(null);
                setSnapGuide(null);
              }
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {/* Walls */}
            {walls.map((w) => {
              const midX = (w.start.x + w.end.x) / 2;
              const midY = (w.start.y + w.end.y) / 2;
              const isSelected = selectedWallIds.includes(w.id) || w.id === selectedWallId;
              const labelText = `${wallLengthMeters(w).toFixed(1)}m`;
              const labelW = labelText.length * 0.21 + 0.14;
              return (
                <g key={w.id}>
                  <line
                    x1={w.start.x} y1={w.start.y}
                    x2={w.end.x} y2={w.end.y}
                    stroke={WALL_COLOR_STROKES[w.color ?? DEFAULT_WALL_COLOR] ?? WALL_COLOR_STROKES[DEFAULT_WALL_COLOR]}
                    strokeWidth={isSelected ? 0.16 : 0.12}
                    strokeDasharray={w.style === "dotted" ? "0.35 0.24" : undefined}
                    strokeLinecap="round"
                  />
                  {showDimensions && (
                    <>
                      <rect
                        x={midX - labelW / 2}
                        y={midY - 0.46}
                        width={labelW}
                        height={0.37}
                        fill="white"
                        rx={0.05}
                        opacity={0.92}
                      />
                      <text
                        x={midX}
                        y={midY - 0.15}
                        fontSize={0.31}
                        fill={isSelected ? "#0f766e" : "#475569"}
                        textAnchor="middle"
                      >
                        {labelText}
                      </text>
                    </>
                  )}
                  {isSelected && (
                    <>
                      <circle cx={w.start.x} cy={w.start.y} r={0.14} fill="#0f766e" />
                      <circle cx={w.end.x} cy={w.end.y} r={0.14} fill="#0f766e" />
                    </>
                  )}
                </g>
              );
            })}

            {/* Junction dots — where 2+ walls share an endpoint */}
            {junctionPoints.map((pt, i) => (
              <circle key={`j${i}`} cx={pt.x} cy={pt.y} r={0.13} fill="#0f766e" opacity={0.75} />
            ))}

            {/* Text annotations */}
            {textNotes.map((note) => {
              const isEditing = editingTextId === note.id;
              const isSelected = selectedTextId === note.id;
              const liveLabel = isEditing ? textEditValue : note.text;
              const layout = getTextNoteLayout(note, liveLabel);
              return (
                <g key={note.id}>
                  <rect
                    x={layout.x}
                    y={layout.y}
                    width={layout.width}
                    height={layout.height}
                    fill={isEditing ? "#eff6ff" : isSelected ? "#fef3c7" : "#fff7ed"}
                    stroke={isEditing ? "#2563eb" : isSelected ? "#d97706" : "#f59e0b"}
                    strokeWidth={isSelected ? 0.08 : 0.06}
                    rx={0.12}
                  />
                  {!isEditing && (
                    <text
                      x={layout.textX}
                      y={layout.textY}
                      fontSize={note.fontSize}
                      fontFamily={TEXT_NOTE_FONT_FAMILY}
                      fill="#1f2937"
                      textAnchor="start"
                      direction="ltr"
                      unicodeBidi="normal"
                      style={{ cursor: isSelected ? "grab" : "pointer", pointerEvents: "none", whiteSpace: "pre" }}
                    >
                      {layout.lines.map((line, index) => (
                        <tspan
                          key={`${note.id}-${index}`}
                          x={layout.textX}
                          dy={index === 0 ? 0 : note.fontSize * TEXT_NOTE_LINE_HEIGHT}
                        >
                          {line || " "}
                        </tspan>
                      ))}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Draw start dot */}
            {drawStart && (mode === "trace" || mode === "single") && (
              <circle cx={drawStart.x} cy={drawStart.y} r={0.18} fill="#0f766e" />
            )}

            {/* Preview line */}
            {drawStart && hoverPoint && (mode === "trace" || mode === "single") && (
              <line
                x1={drawStart.x} y1={drawStart.y}
                x2={hoverPoint.x} y2={hoverPoint.y}
                stroke="#0f766e"
                strokeWidth={0.1}
                strokeDasharray="0.22 0.18"
                strokeLinecap="round"
              />
            )}

            {/* Preview length label */}
            {drawStart && hoverPoint && (mode === "trace" || mode === "single") && (() => {
              const d = distance(drawStart, hoverPoint);
              if (d < 0.3) return null;
              const midX = (drawStart.x + hoverPoint.x) / 2;
              const midY = (drawStart.y + hoverPoint.y) / 2;
              const labelText = `${d.toFixed(1)}m`;
              const lw = labelText.length * 0.22 + 0.2;
              return (
                <>
                  <rect x={midX - lw / 2} y={midY - 0.48} width={lw} height={0.38} fill="#0f766e" rx={0.07} />
                  <text x={midX} y={midY - 0.16} fontSize={0.29} fill="white" textAnchor="middle" fontWeight="600">
                    {labelText}
                  </text>
                </>
              );
            })()}

            {/* Snap guides */}
            {snapGuide?.kind === "horizontal" && snapGuide.lineValue != null && (
              <line x1={0} y1={snapGuide.lineValue} x2={CELLS_X} y2={snapGuide.lineValue} stroke="rgba(20,184,166,0.55)" strokeDasharray="0.2 0.18" strokeWidth={0.07} />
            )}
            {snapGuide?.kind === "vertical" && snapGuide.lineValue != null && (
              <line x1={snapGuide.lineValue} y1={0} x2={snapGuide.lineValue} y2={CELLS_Y} stroke="rgba(20,184,166,0.55)" strokeDasharray="0.2 0.18" strokeWidth={0.07} />
            )}
            {snapGuide?.kind === "endpoint" && snapGuide.point && (
              <circle cx={snapGuide.point.x} cy={snapGuide.point.y} r={0.22} fill="rgba(20,184,166,0.15)" stroke="#14b8a6" strokeWidth={0.09} />
            )}

            {/* Drag selection box */}
            {selectionStart && selectionCurrent && (
              <rect
                x={Math.min(selectionStart.x, selectionCurrent.x)}
                y={Math.min(selectionStart.y, selectionCurrent.y)}
                width={Math.abs(selectionCurrent.x - selectionStart.x)}
                height={Math.abs(selectionCurrent.y - selectionStart.y)}
                fill="rgba(15,118,110,0.08)"
                stroke="#0f766e"
                strokeDasharray="0.25 0.2"
                strokeWidth={0.07}
              />
            )}

            {/* Selection bounds + rotate handle */}
            {selectionBounds && (
              <>
                <rect
                  x={selectionBounds.minX - 0.12}
                  y={selectionBounds.minY - 0.12}
                  width={selectionBounds.maxX - selectionBounds.minX + 0.24}
                  height={selectionBounds.maxY - selectionBounds.minY + 0.24}
                  fill="none"
                  stroke="rgba(15,118,110,0.5)"
                  strokeDasharray="0.3 0.22"
                  strokeWidth={0.07}
                  rx={0.1}
                />
                <line
                  x1={selectionBounds.cx}
                  y1={selectionBounds.minY - 0.12}
                  x2={selectionBounds.cx}
                  y2={selectionBounds.minY - 0.9}
                  stroke="#0f766e"
                  strokeWidth={0.07}
                />
                <circle
                  cx={selectionBounds.cx}
                  cy={selectionBounds.minY - 0.9}
                  r={0.3}
                  fill="white"
                  stroke="#0f766e"
                  strokeWidth={0.08}
                />
                <text
                  x={selectionBounds.cx - 0.14}
                  y={selectionBounds.minY - 0.78}
                  fontSize={0.32}
                  fill="#0f766e"
                >⟲</text>
              </>
            )}

            {/* Rotation crosshair + angle */}
            {rotating && rotateOrigin && (
              <>
                <line x1={0} y1={rotateOrigin.y} x2={CELLS_X} y2={rotateOrigin.y} stroke="rgba(14,116,144,0.3)" strokeDasharray="0.28 0.2" strokeWidth={0.06} />
                <line x1={rotateOrigin.x} y1={0} x2={rotateOrigin.x} y2={CELLS_Y} stroke="rgba(14,116,144,0.3)" strokeDasharray="0.28 0.2" strokeWidth={0.06} />
                <text x={rotateOrigin.x + 0.3} y={rotateOrigin.y - 0.3} fontSize={0.38} fill="#0f766e">
                  {rotateDeltaDeg.toFixed(0)}°
                </text>
              </>
            )}
          </svg>
          {canvasDims && editingTextNote && (() => {
            const layout = getTextNoteLayout(editingTextNote, textEditValue);
            const pxX = (units: number) => (units / CELLS_X) * canvasDims.w;
            const pxY = (units: number) => (units / CELLS_Y) * canvasDims.h;
            return (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: `${pxX(layout.x)}px`,
                  top: `${pxY(layout.y)}px`,
                  width: `${pxX(layout.width)}px`,
                  height: `${pxY(layout.height)}px`,
                }}
              >
                <textarea
                  ref={textInputRef as React.RefObject<HTMLTextAreaElement>}
                  value={textEditValue}
                  dir="ltr"
                  wrap="off"
                  spellCheck={false}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTextEditValue(v);
                    updateTextNote(editingTextNote.id, { text: v });
                    requestAnimationFrame(() => syncEditingTextBoxFromDom());
                  }}
                  onBlur={() => {
                    syncEditingTextBoxFromDom({ forceGrow: true });
                    setEditingTextId(null);
                  }}
                  className="pointer-events-auto w-full h-full text-gray-900 outline-none resize-none overflow-hidden rounded-[inherit]"
                  style={{
                    fontSize: `${pxY(editingTextNote.fontSize)}px`,
                    fontFamily: TEXT_NOTE_FONT_FAMILY,
                    lineHeight: TEXT_NOTE_LINE_HEIGHT,
                    padding: `${pxY(TEXT_NOTE_PADDING_Y)}px ${pxX(TEXT_NOTE_PADDING_X)}px`,
                    background: "transparent",
                    border: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            );
          })()}
        </div>
        )}
        </div>
      </div>

      {/* Bottom toolbar */}
      <div
        className="flex items-center gap-2 px-4 bg-white border-t border-gray-200 z-30 flex-shrink-0"
        style={{ height: 64 }}
      >
        {/* Mode segmented control */}
        <div className="flex rounded-xl overflow-hidden border border-gray-200 flex-shrink-0">
          <button
            onClick={() => { setMode("trace"); setDrawStart(null); setHoverPoint(null); }}
            className={`px-4 h-10 text-sm font-medium transition-colors ${mode === "trace" ? "bg-[#1a3a4a] text-white" : "bg-white text-gray-600 active:bg-gray-50"}`}
          >
            Outline
          </button>
          <button
            onClick={() => { setMode("select"); setDrawStart(null); setHoverPoint(null); }}
            className={`px-4 h-10 text-sm font-medium border-l border-gray-200 transition-colors ${mode === "select" ? "bg-[#1a3a4a] text-white" : "bg-white text-gray-600 active:bg-gray-50"}`}
          >
            Edit
          </button>
        </div>

        {/* Contextual drawing actions */}
        {mode === "trace" && drawStart && (
          <>
            {walls.length >= 3 && (
              <button
                onClick={closeShape}
                className="h-10 px-4 rounded-xl text-sm font-medium bg-teal-600 text-white flex-shrink-0 active:bg-teal-700"
              >
                Close
              </button>
            )}
            <button
              onClick={() => { setDrawStart(null); setHoverPoint(null); setMode("select"); }}
              className="h-10 px-4 rounded-xl text-sm font-medium bg-gray-200 text-gray-700 flex-shrink-0 active:bg-gray-300"
            >
              Finish
            </button>
          </>
        )}
        {mode === "select" && (
          <>
            <button
              onClick={() => { setMode("single"); setDrawStart(null); setHoverPoint(null); }}
              className="h-10 px-4 rounded-xl text-sm font-medium bg-gray-100 text-gray-700 flex-shrink-0 active:bg-gray-200"
            >
              + Wall
            </button>
            <button
              onClick={addTextNote}
              className={`h-10 px-4 rounded-xl text-sm font-medium flex-shrink-0 ${textMode === "placing" ? "bg-amber-600 text-white" : "bg-amber-100 text-amber-800 active:bg-amber-200"}`}
            >
              {textMode === "placing" ? "Tap to place" : "+ Text"}
            </button>
          </>
        )}

        <div className="flex-1" />

        {textMode === "placing" && (
          <span className="text-xs text-amber-700 font-medium">Tap anywhere on the plan to place text</span>
        )}

        {/* Undo */}
        <button
          onClick={undo}
          disabled={!history.length}
          className="h-10 w-10 rounded-xl flex items-center justify-center bg-gray-100 text-gray-700 disabled:opacity-30 flex-shrink-0 active:bg-gray-200 text-base"
          title="Undo"
        >
          ↩
        </button>

        {/* Labels toggle */}
        <button
          onClick={() => setShowDimensions((v) => !v)}
          className="h-10 px-3 rounded-xl text-sm font-medium flex-shrink-0 bg-gray-100 flex items-center gap-1.5 active:bg-gray-200"
        >
          <span className="text-gray-700">Labels</span>
          <span className={`text-xs font-bold ${showDimensions ? "text-[#e85d04]" : "text-gray-400"}`}>
            {showDimensions ? "ON" : "OFF"}
          </span>
        </button>

        {/* Clear */}
        <button
          onClick={() => {
            if (!walls.length) return;
            pushHistory();
            setWalls([]);
            setTextNotes([]);
            setSelectedWallId(null);
            setSelectedWallIds([]);
            setEditingTextId(null);
            setDrawStart(null);
            setHoverPoint(null);
          }}
          className="h-10 px-3 rounded-xl text-sm font-medium bg-gray-100 text-gray-400 flex-shrink-0 active:bg-gray-200"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
