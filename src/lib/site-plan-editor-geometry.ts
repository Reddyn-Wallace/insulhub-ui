import type { SitePlanPoint, SitePlanWall } from "./site-plan-drawings";

export const SITE_PLAN_GRID = { columns: 18, rows: 17, step: 0.1 } as const;
export function sitePlanDistance(a: SitePlanPoint, b: SitePlanPoint) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function clampSitePlanPoint(point: SitePlanPoint): SitePlanPoint {
  return { x: Math.max(0, Math.min(SITE_PLAN_GRID.columns, point.x)), y: Math.max(0, Math.min(SITE_PLAN_GRID.rows, point.y)) };
}
export function snapSitePlanPoint(point: SitePlanPoint): SitePlanPoint {
  const snap = (value: number) => Number((Math.round(value / SITE_PLAN_GRID.step) * SITE_PLAN_GRID.step).toFixed(10));
  return clampSitePlanPoint({ x: snap(point.x), y: snap(point.y) });
}
export function snapSitePlanOrtho(start: SitePlanPoint, end: SitePlanPoint, threshold = 0.14): SitePlanPoint {
  const dx = end.x - start.x; const dy = end.y - start.y;
  if (Math.abs(dy) <= Math.abs(dx) * threshold) return { x: end.x, y: start.y };
  if (Math.abs(dx) <= Math.abs(dy) * threshold) return { x: start.x, y: end.y };
  return end;
}
export function snapSitePlanEndpoint(point: SitePlanPoint, walls: readonly SitePlanWall[], excludeId?: string, radius = 0.32): SitePlanPoint {
  let result = point; let nearest = radius;
  for (const wall of walls) {
    if (wall.id === excludeId) continue;
    for (const endpoint of [wall.start, wall.end]) {
      const distance = sitePlanDistance(point, endpoint);
      if (distance <= nearest) { result = { ...endpoint }; nearest = distance; }
    }
  }
  return result;
}

export function rotateSitePlanPoint(point: SitePlanPoint, origin: SitePlanPoint, degrees: number): SitePlanPoint {
  const radians = degrees * Math.PI / 180; const dx = point.x - origin.x; const dy = point.y - origin.y;
  return clampSitePlanPoint({ x: origin.x + dx * Math.cos(radians) - dy * Math.sin(radians), y: origin.y + dx * Math.sin(radians) + dy * Math.cos(radians) });
}
