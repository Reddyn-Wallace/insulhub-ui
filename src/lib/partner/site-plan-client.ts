import type { SitePlanDrawingDocument } from "../site-plan-drawings";

export type PartnerFloorPlanClient = {
  id: string;
  jobId: string;
  name: string;
  sortOrder: number;
  document: SitePlanDrawingDocument;
  revision: number;
  currentPdf: null | {
    drawingRevision: number;
    fileName: string;
    generatedAt: string;
  };
  pdfReady: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FloorPlanCollectionClient = { revision: number; floors: PartnerFloorPlanClient[] };

export function floorPdfState(floor: PartnerFloorPlanClient): "current" | "stale" | "missing" {
  if (!floor.currentPdf) return "missing";
  return floor.pdfReady ? "current" : "stale";
}

export function floorPlanReadiness(collection: FloorPlanCollectionClient | null): { ready: boolean; issues: string[] } {
  if (!collection || collection.floors.length === 0) return { ready: false, issues: ["Add at least one floor plan."] };
  const issues: string[] = [];
  const names = new Set<string>();
  for (const [index, floor] of collection.floors.entries()) {
    const name = floor.name.trim().normalize("NFC").toLocaleLowerCase("en-NZ");
    if (!name) issues.push(`Floor ${index + 1} needs a name.`);
    else if (names.has(name)) issues.push("Floor plan names must be unique.");
    names.add(name);
    if (floor.document.walls.length === 0) issues.push(`${floor.name || `Floor ${index + 1}`} needs at least one wall.`);
    if (!floor.pdfReady) issues.push(`${floor.name || `Floor ${index + 1}`} must be marked complete.`);
  }
  return { ready: issues.length === 0, issues: [...new Set(issues)] };
}

export function nextDefaultFloorName(floors: readonly PartnerFloorPlanClient[]): string {
  const preferred = floors.length === 0 ? "Ground floor" : floors.length === 1 ? "Upper floor" : `Floor ${floors.length + 1}`;
  const existing = new Set(floors.map((floor) => floor.name.trim().normalize("NFC").toLocaleLowerCase("en-NZ")));
  if (!existing.has(preferred.toLocaleLowerCase("en-NZ"))) return preferred;
  let number = floors.length + 1;
  while (existing.has(`floor ${number}`)) number += 1;
  return `Floor ${number}`;
}

export type SitePlanRecovery<T> = { scope: string; jobId: string; drawingId: string; revision: number; savedAt: string; value: T };
export function sitePlanRecoveryKey(scope: string, jobId: string, drawingId: string) { return `partner:site-plan:v1:${scope}:${jobId}:${drawingId}`; }
export function encodeSitePlanRecovery<T>(value: SitePlanRecovery<T>) { return JSON.stringify(value); }
export function decodeSitePlanRecovery<T>(raw: string | null, scope: string, jobId: string, drawingId: string, validateValue?: (value: unknown) => value is T, now = Date.now()): SitePlanRecovery<T> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as SitePlanRecovery<T>;
    const savedAt = Date.parse(value.savedAt);
    if (value.scope !== scope || value.jobId !== jobId || value.drawingId !== drawingId || !Number.isInteger(value.revision) || value.revision < 0 || !Number.isFinite(savedAt) || savedAt > now + 60_000 || (validateValue && !validateValue(value.value))) return null;
    return value;
  } catch { return null; }
}
export function clearSitePlanRecoveryScope(storage: { length: number; key(index: number): string | null; removeItem(key: string): void } | null, scope: string): boolean {
  if (!storage) return false;
  try {
    const prefix = `partner:site-plan:v1:${scope}:`; const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) { const key = storage.key(index); if (key?.startsWith(prefix)) keys.push(key); }
    keys.forEach((key) => storage.removeItem(key)); return true;
  } catch { return false; }
}
