"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PDFDocument, rgb } from "pdf-lib";
import { gql } from "@/lib/graphql";

type WallStyle = "solid" | "dotted";
type Point = { x: number; y: number };
type Wall = { id: string; start: Point; end: Point; style: WallStyle; lengthOverride?: number | null };
type WallSnapshot = { id: string; start: Point; end: Point };
type TextNote = { id: string; text: string; x: number; y: number };
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

  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const [draggingWallId, setDraggingWallId] = useState<string | null>(null);
  const [draggingTextId, setDraggingTextId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [textEditValue, setTextEditValue] = useState("");
  const [draggingGroup, setDraggingGroup] = useState(false);
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

  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const [canvasDims, setCanvasDims] = useState<{ w: number; h: number } | null>(null);
  const dragActivatedRef = useRef(false);
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

  const selectedWall = useMemo(() => walls.find((w) => w.id === selectedWallId) || null, [walls, selectedWallId]);
  const selectedWallLength = useMemo(() => {
    if (!selectedWall) return null;
    return wallLengthMeters(selectedWall);
  }, [walls, selectedWallId]);
  useEffect(() => {
    if (selectedWallLength === null) { setLengthEditValue(""); return; }
    if (isEditingLengthRef.current) return;
    setLengthEditValue(selectedWallLength.toFixed(1));
  }, [selectedWallLength, selectedWallId]);

  const activeSelectionIds = useMemo(
    () => (selectedWallIds.length ? selectedWallIds : (selectedWallId ? [selectedWallId] : [])),
    [selectedWallIds, selectedWallId]
  );
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

  useEffect(() => {
    if (!id) return;
    (async () => {
      const data = await gql<{ job: Job }>(JOB_QUERY, { _id: id });
      setJob(data.job);
    })().catch((e) => setNotice(e instanceof Error ? e.message : "Failed to load"));
  }, [id]);

  useEffect(() => {
    if (job) {
      const fallback = `siteplan-${job.jobNumber || id}-${Date.now()}.pdf`;
      setSaveFilename(fallback);
    }
  }, [id, job]);

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
    const nextX = Math.max(1, Math.min(CELLS_X - 1, (selectionBounds?.cx ?? CELLS_X / 2)));
    const nextY = Math.max(1, Math.min(CELLS_Y - 1, (selectionBounds?.cy ?? CELLS_Y / 2)));
    pushHistory();
    const note: TextNote = { id: makeId(), text: "New text", x: nextX, y: nextY };
    setTextNotes((prev) => [...prev, note]);
    setEditingTextId(note.id);
    setTextEditValue(note.text);
    setMode("select");
  }

  function updateTextNote(id: string, patch: Partial<TextNote>) {
    setTextNotes((prev) => prev.map((n) => n.id === id ? { ...n, ...patch } : n));
  }

  function deleteTextNote(id: string) {
    pushHistory();
    setTextNotes((prev) => prev.filter((n) => n.id !== id));
    if (editingTextId === id) setEditingTextId(null);
  }

  function findTextNear(p: Point) {
    let best: TextNote | null = null;
    let bestDist = 999;
    for (const note of textNotes) {
      const d = distance(p, { x: note.x, y: note.y });
      if (d < bestDist) {
        bestDist = d;
        best = note;
      }
    }
    return bestDist <= 0.6 ? best : null;
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
        setWalls((prev) => [...prev, { id: makeId(), start: drawStart, end: endPoint, style: "solid" }]);
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
        for (const { pt, e } of [{ pt: mw.start, e: "start" as const }, { pt: mw.end, e: "end" as const }]) {
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
    }

    const textHit = findTextNear(p);
    if (textHit) {
      setDraggingTextId(textHit.id);
      setEditingTextId(textHit.id);
      setTextEditValue(textHit.text);
      svgRef.current?.setPointerCapture(e.pointerId);
      capturedPointerIdRef.current = e.pointerId;
      return;
    }

    setSelectionStart(p);
    setSelectionCurrent(p);
    setSelectedWallId(null);
    setSelectedWallIds([]);
  }
  }

  function pointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const p = (mode === "trace" || mode === "single")
      ? toGridPointSnapped(e.clientX, e.clientY)
      : toGridPointRaw(e.clientX, e.clientY);
    if (!p) return;
    setSnapGuide(null);

    if (mode === "trace" || mode === "single") {
      const snapped = snapPoint(p);
      if (drawStart) {
        const kind = orthoKind(drawStart, snapped);
        const ortho = snapOrtho(drawStart, snapped);
        const endpointSnapped = snapToExistingEndpoints(ortho, walls);
        setHoverPoint(endpointSnapped);
        if (endpointSnapped.x !== ortho.x || endpointSnapped.y !== ortho.y) {
          setSnapGuide({ kind: "endpoint", point: endpointSnapped });
        } else if (kind === "horizontal") {
          setSnapGuide({ kind: "horizontal", lineValue: drawStart.y });
        } else if (kind === "vertical") {
          setSnapGuide({ kind: "vertical", lineValue: drawStart.x });
        } else {
          setSnapGuide(null);
        }
      } else {
        setHoverPoint(snapped);
        setSnapGuide(null);
      }
      return;
    }

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
      setTextNotes((prev) => prev.map((n) => n.id === draggingTextId ? { ...n, x: p.x, y: p.y } : n));
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

  function pointerUp() {
    if (capturedPointerIdRef.current !== null && svgRef.current) {
      try { svgRef.current.releasePointerCapture(capturedPointerIdRef.current); } catch {}
      capturedPointerIdRef.current = null;
    }
    linkedEndpointsRef.current = [];
    dragAnchorRef.current = null;
    wallDragLinkedSnapshotRef.current = [];
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

  async function saveCompletedSitePlan() {
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
        page.drawLine({
          start: { x: a.x, y: a.y },
          end: { x: b.x, y: b.y },
          thickness: 3.5,
          color: rgb(0, 0, 0),
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
      const cleanedFilename = saveFilename.trim().replace(/\.pdf$/i, "").replace(/[\\/]/g, "-") || `siteplan-${job?.jobNumber || id}-${Date.now()}`;
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
      setTimeout(() => router.push(`/jobs/${id}`), 400);
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
            onClick={saveCompletedSitePlan}
            disabled={saving}
            className="bg-[#1a3a4a] text-white px-4 h-10 rounded-xl text-sm font-semibold disabled:opacity-60 active:opacity-80"
          >
            {saving ? "Saving…" : "Save & Done"}
          </button>
        </div>
      </div>

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
              <div className="flex items-center gap-1.5">
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

          {/* SVG drawing canvas */}
          <svg
            ref={svgRef}
            viewBox={`0 0 ${CELLS_X} ${CELLS_Y}`}
            className="w-full h-full touch-none"
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerLeave={() => {
              // Only clear preview when no active drag (pointer capture keeps events during drag)
              if (capturedPointerIdRef.current === null) {
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
                    stroke={isSelected ? "#0f766e" : "#1e293b"}
                    strokeWidth={0.12}
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
              const label = note.text || "";
              return (
                <g
                  key={note.id}
                  onDoubleClick={() => { setEditingTextId(note.id); setTextEditValue(note.text); }}
                  style={{ cursor: "move" }}
                >
                  <rect
                    x={note.x - Math.min(2.2, Math.max(1.6, label.length * 0.12 + 0.8)) / 2}
                    y={note.y - 0.42}
                    width={Math.min(2.2, Math.max(1.6, label.length * 0.12 + 0.8))}
                    height={0.5}
                    fill={isEditing ? "#eff6ff" : "#fff7ed"}
                    stroke={isEditing ? "#2563eb" : "#f59e0b"}
                    strokeWidth={0.05}
                    rx={0.08}
                  />
                  <text x={note.x} y={note.y - 0.06} fontSize={0.28} fill="#1f2937" textAnchor="middle">
                    {label || "Text"}
                  </text>
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
              className="h-10 px-4 rounded-xl text-sm font-medium bg-amber-100 text-amber-800 flex-shrink-0 active:bg-amber-200"
            >
              + Text
            </button>
          </>
        )}

        <div className="flex-1" />

        {editingTextId && (
          <div className="flex items-center gap-2 max-w-[42vw]">
            <input
              value={textEditValue}
              onChange={(e) => {
                const v = e.target.value;
                setTextEditValue(v);
                updateTextNote(editingTextId, { text: v });
              }}
              placeholder="Text"
              className="min-w-0 w-full max-w-[240px] h-10 px-3 rounded-xl border border-amber-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/30"
            />
            <button
              onClick={() => setEditingTextId(null)}
              className="h-10 px-3 rounded-xl text-sm font-medium bg-amber-100 text-amber-800 active:bg-amber-200"
            >
              Done
            </button>
            <button
              onClick={() => deleteTextNote(editingTextId)}
              className="h-10 px-3 rounded-xl text-sm font-medium bg-red-50 text-red-600 active:bg-red-100"
            >
              Delete
            </button>
          </div>
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
