import "server-only";
import type { FloorPlanCollection, PartnerFloorPlan } from "./site-plan-repository";
import type { FloorPlanCollectionClient, PartnerFloorPlanClient } from "./site-plan-client";

export function partnerFloorPlanClientView(floor: PartnerFloorPlan): PartnerFloorPlanClient {
  return { id: floor.id, jobId: floor.jobId, name: floor.name, sortOrder: floor.sortOrder, document: floor.document, revision: floor.revision, pdfReady: floor.pdfReady, createdAt: floor.createdAt, updatedAt: floor.updatedAt, currentPdf: floor.currentPdf ? { drawingRevision: floor.currentPdf.drawingRevision, fileName: floor.currentPdf.fileName, generatedAt: floor.currentPdf.generatedAt } : null };
}
export function floorPlanCollectionClientView(collection: FloorPlanCollection): FloorPlanCollectionClient { return { revision: collection.revision, floors: collection.floors.map(partnerFloorPlanClientView) }; }
