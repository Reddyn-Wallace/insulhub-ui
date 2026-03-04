"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PDFDocument, rgb } from "pdf-lib";
import { gql } from "@/lib/graphql";

type WallStyle = "solid" | "dotted";
type Point = { x: number; y: number };
type Wall = { id: string; start: Point; end: Point; style: WallStyle; lengthOverride?: number | null };

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
const GRID = {
  left: 41.68504,
  right: 716.8307,
  bottom: 253.6251,
  top: 929.2708,
  width: 716.8307 - 41.68504,
  height: 929.2708 - 253.6251,
};
const CELLS_X = 17;
const CELLS_Y = 17;
const SNAP_STEP = 0.1;

function snap(v: number) {
  return Math.round(v / SNAP_STEP) * SNAP_STEP;
}
function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function makeId() {
  return Math.random().toString(36).slice(2, 10);
}
function clampPoint(p: Point): Point {
  return {
    x: Math.max(0, Math.min(CELLS_X, snap(p.x))),
    y: Math.max(0, Math.min(CELLS_Y, snap(p.y))),
  };
}

export default function DrawSitePlanPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const token = typeof window !== "undefined" ? localStorage.getItem("token") || "" : "";

  const [job, setJob] = useState<Job | null>(null);
  const [walls, setWalls] = useState<Wall[]>([]);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [mode, setMode] = useState<"draw" | "select">("draw");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [showDimensions, setShowDimensions] = useState(true);

  const [buildingRotation, setBuildingRotation] = useState(0);
  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [draggingWallId, setDraggingWallId] = useState<string | null>(null);
  const [draggingEndpoint, setDraggingEndpoint] = useState<{ wallId: string; end: "start" | "end" } | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);

  const address = useMemo(() => {
    const c = job?.client?.contactDetails;
    return [c?.streetAddress, c?.suburb, c?.city, c?.postCode].filter(Boolean).join(", ");
  }, [job]);

  const selectedWall = useMemo(() => walls.find((w) => w.id === selectedWallId) || null, [walls, selectedWallId]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const data = await gql<{ job: Job }>(JOB_QUERY, { _id: id });
      setJob(data.job);
    })().catch((e) => setNotice(e instanceof Error ? e.message : "Failed to load"));
  }, [id]);

  const toGridPoint = useCallback((clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * CELLS_X;
    const y = ((clientY - rect.top) / rect.height) * CELLS_Y;
    return clampPoint({ x, y });
  }, []);

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
      if (d < bestDist) {
        bestDist = d;
        best = w;
      }
    }
    return bestDist <= 0.6 ? best : null;
  }

  function findEndpointNear(p: Point): { wallId: string; end: "start" | "end" } | null {
    let best: { wallId: string; end: "start" | "end" } | null = null;
    let bestDist = 999;
    for (const w of walls) {
      const ds = distance(p, w.start);
      if (ds < bestDist) {
        bestDist = ds;
        best = { wallId: w.id, end: "start" };
      }
      const de = distance(p, w.end);
      if (de < bestDist) {
        bestDist = de;
        best = { wallId: w.id, end: "end" };
      }
    }
    return bestDist <= 0.5 ? best : null;
  }

  function pointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const p = toGridPoint(e.clientX, e.clientY);
    if (!p) return;

    if (mode === "draw") {
      if (!drawStart) {
        setDrawStart(p);
      } else {
        if (distance(drawStart, p) >= 0.25) {
          setWalls((prev) => [...prev, { id: makeId(), start: drawStart, end: p, style: "solid" }]);
        }
        // Chain drawing wall-after-wall like life app
        setDrawStart(p);
      }
      return;
    }

    const endpoint = findEndpointNear(p);
    if (endpoint) {
      setSelectedWallId(endpoint.wallId);
      setDraggingEndpoint(endpoint);
      return;
    }

    const hit = findWallNear(p);
    if (hit) {
      setSelectedWallId(hit.id);
      setDraggingWallId(hit.id);
    } else {
      setSelectedWallId(null);
    }
  }

  function pointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const p = toGridPoint(e.clientX, e.clientY);
    if (!p) return;

    if (mode !== "select") return;

    if (draggingEndpoint) {
      setWalls((prev) => prev.map((w) => {
        if (w.id !== draggingEndpoint.wallId) return w;
        if (draggingEndpoint.end === "start") {
          return { ...w, start: p, lengthOverride: null };
        }
        return { ...w, end: p, lengthOverride: null };
      }));
      return;
    }

    if (draggingWallId) {
      setWalls((prev) => prev.map((w) => {
        if (w.id !== draggingWallId) return w;
        const cx = (w.start.x + w.end.x) / 2;
        const cy = (w.start.y + w.end.y) / 2;
        const dx = p.x - cx;
        const dy = p.y - cy;
        return {
          ...w,
          start: clampPoint({ x: w.start.x + dx, y: w.start.y + dy }),
          end: clampPoint({ x: w.end.x + dx, y: w.end.y + dy }),
        };
      }));
    }
  }

  function pointerUp() {
    setDraggingWallId(null);
    setDraggingEndpoint(null);
  }

  function finishTrace() {
    setDrawStart(null);
  }

  function removeSelectedWall() {
    if (!selectedWallId) return;
    setWalls((prev) => prev.filter((w) => w.id !== selectedWallId));
    setSelectedWallId(null);
  }

  function rotateBuilding(deg: number) {
    if (!walls.length) return;
    const radians = (deg * Math.PI) / 180;
    const allPoints = walls.flatMap((w) => [w.start, w.end]);
    const cx = allPoints.reduce((a, p) => a + p.x, 0) / allPoints.length;
    const cy = allPoints.reduce((a, p) => a + p.y, 0) / allPoints.length;

    setWalls((prev) => prev.map((w) => {
      const rot = (pt: Point) => {
        const dx = pt.x - cx;
        const dy = pt.y - cy;
        return clampPoint({
          x: cx + dx * Math.cos(radians) - dy * Math.sin(radians),
          y: cy + dx * Math.sin(radians) + dy * Math.cos(radians),
        });
      };
      return { ...w, start: rot(w.start), end: rot(w.end) };
    }));
    setBuildingRotation((v) => v + deg);
  }

  function wallLengthMeters(w: Wall) {
    return w.lengthOverride ?? Number(distance(w.start, w.end).toFixed(2));
  }

  function applyLengthOverride(wallId: string, lengthMeters: number) {
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

      // White backing to fully cover original printed grid.
      page.drawRectangle({
        x: GRID.left,
        y: GRID.bottom,
        width: GRID.width,
        height: GRID.height,
        color: rgb(1, 1, 1),
      });

      // Overlay a fresh locked grid exactly on top of the template grid.
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
          thickness: 1.6,
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
          y: 933,
          size: 10,
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

      setNotice("Site plan saved and overwritten successfully.");
      setTimeout(() => router.push(`/jobs/${id}`), 400);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Failed to save site plan");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => router.push(`/jobs/${id}`)} className="text-sm text-gray-600">← Back to Job</button>
          <h1 className="text-lg font-bold text-[#1a3a4a]">Draw Site Plan</h1>
          <button
            onClick={saveCompletedSitePlan}
            disabled={saving}
            className="bg-[#1a3a4a] text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Completed Site Plan"}
          </button>
        </div>

        {notice && <div className="mb-3 text-sm bg-amber-50 text-amber-800 border border-amber-200 rounded-lg px-3 py-2">{notice}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-3">
            <div className="flex gap-2 mb-3 flex-wrap">
              <button onClick={() => setMode("draw")} className={`px-3 py-1.5 rounded-lg text-sm ${mode === "draw" ? "bg-[#1a3a4a] text-white" : "bg-gray-100"}`}>Trace</button>
              <button onClick={() => setMode("select")} className={`px-3 py-1.5 rounded-lg text-sm ${mode === "select" ? "bg-[#1a3a4a] text-white" : "bg-gray-100"}`}>Select/Edit</button>
              <button onClick={finishTrace} className="px-3 py-1.5 rounded-lg text-sm bg-gray-100">Finish Trace</button>
              <button onClick={() => rotateBuilding(-5)} className="px-3 py-1.5 rounded-lg text-sm bg-gray-100">Rotate -5°</button>
              <button onClick={() => rotateBuilding(5)} className="px-3 py-1.5 rounded-lg text-sm bg-gray-100">Rotate +5°</button>
              <button onClick={removeSelectedWall} className="px-3 py-1.5 rounded-lg text-sm bg-red-50 text-red-700">Delete Wall</button>
              <button onClick={() => setShowDimensions((v) => !v)} className="px-3 py-1.5 rounded-lg text-sm bg-gray-100">{showDimensions ? "Hide" : "Show"} Dimensions</button>
              <button onClick={() => { setWalls([]); setSelectedWallId(null); setDrawStart(null); }} className="px-3 py-1.5 rounded-lg text-sm bg-gray-100">Clear</button>
            </div>

            <div className="aspect-square w-full max-w-[760px] border border-gray-300 rounded-lg overflow-hidden bg-[linear-gradient(to_right,#f3f4f6_1px,transparent_1px),linear-gradient(to_bottom,#f3f4f6_1px,transparent_1px)]" style={{ backgroundSize: `calc(100%/${CELLS_X}) calc(100%/${CELLS_Y})` }}>
              <svg
                ref={svgRef}
                viewBox={`0 0 ${CELLS_X} ${CELLS_Y}`}
                className="w-full h-full touch-none"
                onPointerDown={pointerDown}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
                onPointerLeave={pointerUp}
              >
                {walls.map((w) => {
                  const midX = (w.start.x + w.end.x) / 2;
                  const midY = (w.start.y + w.end.y) / 2;
                  return (
                    <g key={w.id}>
                      <line
                        x1={w.start.x}
                        y1={w.start.y}
                        x2={w.end.x}
                        y2={w.end.y}
                        stroke={w.id === selectedWallId ? "#0f766e" : "#111827"}
                        strokeWidth={0.14}
                        strokeDasharray={w.style === "dotted" ? "0.35 0.24" : undefined}
                        strokeLinecap="round"
                      />
                      {showDimensions && (
                        <text x={midX + 0.1} y={midY - 0.12} fontSize={0.35} fill="#374151">
                          {wallLengthMeters(w).toFixed(1)}m
                        </text>
                      )}
                      {w.id === selectedWallId && (
                        <>
                          <circle cx={w.start.x} cy={w.start.y} r={0.18} fill="#0f766e" />
                          <circle cx={w.end.x} cy={w.end.y} r={0.18} fill="#0f766e" />
                        </>
                      )}
                    </g>
                  );
                })}
                {drawStart && mode === "draw" && <circle cx={drawStart.x} cy={drawStart.y} r={0.16} fill="#0f766e" />}
              </svg>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <h2 className="font-semibold text-gray-800 mb-2">Wall Inspector</h2>
            {!selectedWall && <p className="text-sm text-gray-500">Select a wall or endpoint to edit.</p>}
            {selectedWall && (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-500">Wall Style</p>
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={() => setWalls((prev) => prev.map((w) => w.id === selectedWall.id ? { ...w, style: "solid" } : w))}
                      className={`px-3 py-1.5 rounded text-sm ${selectedWall.style === "solid" ? "bg-[#1a3a4a] text-white" : "bg-gray-100"}`}
                    >Solid (Insulated)</button>
                    <button
                      onClick={() => setWalls((prev) => prev.map((w) => w.id === selectedWall.id ? { ...w, style: "dotted" } : w))}
                      className={`px-3 py-1.5 rounded text-sm ${selectedWall.style === "dotted" ? "bg-[#1a3a4a] text-white" : "bg-gray-100"}`}
                    >Dotted (Not insulated)</button>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-gray-500">Length (m)</p>
                  <input
                    type="number"
                    step="0.1"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    value={selectedWall.lengthOverride ?? wallLengthMeters(selectedWall)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v > 0) applyLengthOverride(selectedWall.id, v);
                    }}
                  />
                  <button
                    className="mt-1 text-xs text-blue-700"
                    onClick={() => setWalls((prev) => prev.map((w) => w.id === selectedWall.id ? { ...w, lengthOverride: null } : w))}
                  >Reset to auto length ({distance(selectedWall.start, selectedWall.end).toFixed(2)}m)</button>
                </div>
              </div>
            )}

            <div className="mt-5 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-500">Address (for PDF)</p>
              <p className="text-sm text-gray-700">{address || "No address set"}</p>
              <p className="text-xs text-gray-500 mt-2">Rotation: {buildingRotation.toFixed(0)}°</p>
              <p className="text-xs text-gray-500">Walls: {walls.length}</p>
              {mode === "draw" && <p className="text-xs text-emerald-700 mt-2">Trace mode: tap/click point-to-point to add continuous walls.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
