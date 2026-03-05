"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PDFDocument, rgb } from "pdf-lib";
import { gql } from "@/lib/graphql";

type WallStyle = "solid" | "dotted";
type Point = { x: number; y: number };
type Wall = { id: string; start: Point; end: Point; style: WallStyle; lengthOverride?: number | null };
type WallSnapshot = { id: string; start: Point; end: Point };
type SnapGuide = { kind: "horizontal" | "vertical" | "endpoint"; point?: Point; lineValue?: number } | null;

type Job = {
  _id: string;
  quote?: { date?: string; files_QuoteSitePlan?: string[] };
  client?: { contactDetails?: { streetAddress?: string; suburb?: string; city?: string; postCode?: string } };
};

const JOB_QUERY = `
  query Job($_id: ObjectId!) {
    job(_id: $_id) {
      _id
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
const ENDPOINT_DRAG_ORTHO_THRESHOLD = 0.08;
const ROTATE_SOFT_SNAP_DEG = 2.5;
const ROTATE_RELEASE_SNAP_DEG = 3.0;

function snap(v: number) { return Math.round(v / SNAP_STEP) * SNAP_STEP; }
function distance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }
function makeId() { return Math.random().toString(36).slice(2, 10); }
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

export default function DrawSitePlanPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const token = typeof window !== "undefined" ? localStorage.getItem("token") || "" : "";

  const [job, setJob] = useState<Job | null>(null);
  const [walls, setWalls] = useState<Wall[]>([]);
  const [wallHistory, setWallHistory] = useState<Wall[][]>([]);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedWallIds, setSelectedWallIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"trace" | "single" | "select">("trace");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [showDimensions, setShowDimensions] = useState(true);

  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const [draggingWallId, setDraggingWallId] = useState<string | null>(null);
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
  useEffect(() => {
    if (!selectedWall) { setLengthEditValue(""); return; }
    setLengthEditValue(wallLengthMeters(selectedWall).toFixed(1));
  }, [selectedWallId, walls.length]);

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

  useEffect(() => {
    if (!id) return;
    (async () => {
      const data = await gql<{ job: Job }>(JOB_QUERY, { _id: id });
      setJob(data.job);
    })().catch((e) => setNotice(e instanceof Error ? e.message : "Failed to load"));
  }, [id]);

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
    setWallHistory(prev => [...prev.slice(-50), walls]);
  }

  function undo() {
    if (!wallHistory.length) return;
    const previous = wallHistory[wallHistory.length - 1];
    setWalls(previous);
    setWallHistory(prev => prev.slice(0, -1));
    setSelectedWallId(null);
    setSelectedWallIds([]);
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
        setDrawStart(p);
        setHoverPoint(p);
        return;
      }

      let endPoint = p;
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
      return;
    }

    const endpoint = findEndpointNearSelected(p);
    if (endpoint) {
      pushHistory();
      setSelectedWallId(endpoint.wallId);
      setDraggingEndpoint(endpoint);
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
      pushHistory();
      if (moveIds.length > 1) {
        setDraggingGroup(true);
      } else {
        setDraggingWallId(hit.id);
      }
    } else {
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

    if (draggingEndpoint) {
      setWalls((prev) => prev.map((w) => {
        if (w.id !== draggingEndpoint.wallId) return w;
        const anchor = draggingEndpoint.end === "start" ? w.end : w.start;
        let candidate = snapPoint(p);
        const kind = orthoKind(anchor, candidate, ENDPOINT_DRAG_ORTHO_THRESHOLD);
        candidate = snapOrtho(anchor, candidate, ENDPOINT_DRAG_ORTHO_THRESHOLD);
        const endpointSnapped = snapToExistingEndpoints(candidate, prev, w.id, ENDPOINT_DRAG_SNAP_RADIUS);
        if (endpointSnapped.x !== candidate.x || endpointSnapped.y !== candidate.y) {
          setSnapGuide({ kind: "endpoint", point: endpointSnapped });
        } else if (kind === "horizontal") {
          setSnapGuide({ kind: "horizontal", lineValue: anchor.y });
        } else if (kind === "vertical") {
          setSnapGuide({ kind: "vertical", lineValue: anchor.x });
        } else {
          setSnapGuide(null);
        }
        if (draggingEndpoint.end === "start") return { ...w, start: clampPoint(endpointSnapped), lengthOverride: null };
        return { ...w, end: clampPoint(endpointSnapped), lengthOverride: null };
      }));
      return;
    }

    if (selectionStart) {
      setSelectionCurrent(p);
      return;
    }

    if ((draggingGroup || draggingWallId) && dragStartPoint && dragSnapshot.length) {
      const dx = snap(p.x - dragStartPoint.x);
      const dy = snap(p.y - dragStartPoint.y);
      setWalls((prev) => prev.map((w) => {
        const src = dragSnapshot.find((x) => x.id === w.id);
        if (!src) return w;
        return {
          ...w,
          start: clampPoint({ x: src.start.x + dx, y: src.start.y + dy }),
          end: clampPoint({ x: src.end.x + dx, y: src.end.y + dy }),
        };
      }));
      return;
    }
  }

  function pointerUp() {
    setDraggingWallId(null);
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
    setWalls((prev) => prev.map((w) => {
      if (w.id !== wallId) return w;
      const dx = w.end.x - w.start.x;
      const dy = w.end.y - w.start.y;
      const current = Math.hypot(dx, dy);
      if (current < 1e-6 || !Number.isFinite(lengthMeters) || lengthMeters <= 0) return { ...w, lengthOverride: null };
      const scale = lengthMeters / current;
      const nextEnd = clampPoint({ x: w.start.x + dx * scale, y: w.start.y + dy * scale });
      return { ...w, end: nextEnd, lengthOverride: Number(lengthMeters.toFixed(2)) };
    }));
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
          thickness: 1.9,
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

      if (address) {
        page.drawText(address, {
          x: 145,
          y: 953,
          size: 11,
          color: rgb(0, 0, 0),
          maxWidth: 540,
        });
      }

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
      const filename = `siteplan-${id}-${Date.now()}.pdf`;
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

      for (const existing of job?.quote?.files_QuoteSitePlan || []) {
        await gql(REMOVE_FILE, { _id: id, documentType: "QUOTE_SITE_PLAN", fileName: existing });
      }
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
        <button
          onClick={saveCompletedSitePlan}
          disabled={saving}
          className="bg-[#1a3a4a] text-white px-4 h-10 rounded-xl text-sm font-semibold disabled:opacity-60 active:opacity-80"
        >
          {saving ? "Saving…" : "Save & Done"}
        </button>
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
          className="relative rounded-xl overflow-hidden shadow border border-gray-300 bg-white flex-shrink-0"
          style={{
            width: canvasDims.w,
            height: canvasDims.h,
            backgroundImage:
              "linear-gradient(to right, #c8d0da 1px, transparent 1px), linear-gradient(to bottom, #c8d0da 1px, transparent 1px)",
            backgroundSize: `calc(100%/${CELLS_X}) calc(100%/${CELLS_Y})`,
          }}
        >
          {/* Floating selection toolbar */}
          {selectionBounds && mode === "select" && (() => {
            const aboveY = (selectionBounds.minY - 1.8) / CELLS_Y * 100;
            const belowY = (selectionBounds.maxY + 0.3) / CELLS_Y * 100;
            const showAbove = aboveY > 4;
            return (
            <div
              className="absolute z-20 flex items-center gap-1.5 bg-white/96 backdrop-blur-sm border border-gray-200 rounded-xl shadow-lg px-2 py-1.5"
              style={{
                left: `${Math.max(5, Math.min(95, (selectionBounds.cx / CELLS_X) * 100))}%`,
                top: showAbove ? `${aboveY}%` : `${belowY}%`,
                transform: showAbove ? "translate(-50%, -100%)" : "translate(-50%, 0%)",
              }}
            >
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

              {selectedWall && (
                <input
                  value={lengthEditValue}
                  onChange={(e) => setLengthEditValue(e.target.value)}
                  onBlur={() => {
                    const v = Number(lengthEditValue);
                    if (!Number.isFinite(v) || v <= 0 || !selectedWallId) return;
                    applyLengthOverride(selectedWallId, v);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = Number(lengthEditValue);
                      if (!Number.isFinite(v) || v <= 0 || !selectedWallId) return;
                      applyLengthOverride(selectedWallId, v);
                    }
                  }}
                  className="w-16 h-8 text-xs border border-gray-300 rounded-lg px-2 text-center"
                  inputMode="decimal"
                  placeholder="m"
                />
              )}

              <button
                onClick={removeSelectedWall}
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
            onPointerUp={pointerUp}
            onPointerLeave={pointerUp}
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
                      <circle cx={w.start.x} cy={w.start.y} r={0.22} fill="white" stroke="#0f766e" strokeWidth={0.09} />
                      <circle cx={w.end.x} cy={w.end.y} r={0.22} fill="white" stroke="#0f766e" strokeWidth={0.09} />
                    </>
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
          <button
            onClick={() => { setMode("single"); setDrawStart(null); setHoverPoint(null); }}
            className="h-10 px-4 rounded-xl text-sm font-medium bg-gray-100 text-gray-700 flex-shrink-0 active:bg-gray-200"
          >
            + Wall
          </button>
        )}

        <div className="flex-1" />

        {/* Undo */}
        <button
          onClick={undo}
          disabled={!wallHistory.length}
          className="h-10 w-10 rounded-xl flex items-center justify-center bg-gray-100 text-gray-700 disabled:opacity-30 flex-shrink-0 active:bg-gray-200 text-base"
          title="Undo"
        >
          ↩
        </button>

        {/* Dims toggle */}
        <button
          onClick={() => setShowDimensions((v) => !v)}
          className={`h-10 px-3 rounded-xl text-sm font-medium flex-shrink-0 transition-colors ${showDimensions ? "bg-[#1a3a4a] text-white" : "bg-gray-100 text-gray-600 active:bg-gray-200"}`}
        >
          Dims
        </button>

        {/* Clear */}
        <button
          onClick={() => {
            if (!walls.length) return;
            pushHistory();
            setWalls([]);
            setSelectedWallId(null);
            setSelectedWallIds([]);
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
