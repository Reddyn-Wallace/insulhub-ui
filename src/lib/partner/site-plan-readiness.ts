import type { SitePlanDrawingDocument } from "../site-plan-drawings";

export type SitePlanReadinessFloor = {
  name: string;
  revision: number;
  document: SitePlanDrawingDocument;
  currentArtifact: null | { drawingRevision: number; renderHash: string };
  expectedRenderHash: string;
};

export function sitePlanReadiness(floors: readonly SitePlanReadinessFloor[]): { ready: boolean; issues: string[] } {
  const issues: string[] = [];
  if (floors.length === 0) issues.push("Add at least one floor plan.");
  const names = new Set<string>();
  for (const [index, floor] of floors.entries()) {
    const normalizedName = floor.name.trim().normalize("NFC").toLocaleLowerCase("en-NZ");
    if (!normalizedName) issues.push(`Floor ${index + 1} needs a name.`);
    else if (names.has(normalizedName)) issues.push(`Floor plan names must be unique.`);
    names.add(normalizedName);
    if (floor.document.walls.length === 0) issues.push(`${floor.name || `Floor ${index + 1}`} needs at least one wall.`);
    if (!floor.currentArtifact || floor.currentArtifact.drawingRevision !== floor.revision || floor.currentArtifact.renderHash !== floor.expectedRenderHash) issues.push(`${floor.name || `Floor ${index + 1}`} needs an up-to-date PDF.`);
  }
  return { ready: issues.length === 0, issues: [...new Set(issues)] };
}
