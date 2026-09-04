import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import PartnerFloorPlanEditor from "@/components/PartnerFloorPlanEditor";
import PartnerShell from "@/components/PartnerShell";
import { partnerDemoModeEnabled } from "@/lib/partner/demo";
import { getPartnerPool } from "@/lib/partner/db";
import { getPartnerPageContext } from "@/lib/partner/page-context";
import { PartnerSitePlanRepository } from "@/lib/partner/site-plan-repository";
import { partnerFloorPlanClientView } from "@/lib/partner/site-plan-view";

export const dynamic = "force-dynamic"; export const revalidate = 0;
export default async function PartnerFloorPlanEditorPage({ params }: { params: Promise<{ jobId: string; drawingId: string }> }) {
  const context = await getPartnerPageContext(await headers()); if (!context) redirect("/partner/login?reason=session-expired");
  const { jobId, drawingId } = await params; const job = await context.repository.getJob(context.principal, jobId); if (!job) notFound();
  const collection = await new PartnerSitePlanRepository(getPartnerPool()).list(context.principal, jobId); const floor = collection?.floors.find((item) => item.id === drawingId); if (!collection || !floor) notFound();
  return <PartnerShell viewer={context.viewer} demoMode={partnerDemoModeEnabled()} recoveryScope={context.recoveryScope} fullScreen><PartnerFloorPlanEditor key={`${floor.id}:${floor.revision}:${collection.revision}:${job.revision}:${floor.currentPdf?.generatedAt ?? "none"}:${floor.pdfReady}`} jobId={jobId} initialFloor={partnerFloorPlanClientView(floor)} recoveryScope={context.recoveryScope} readOnly={job.submissionState !== "DRAFT"} submissionJobRevision={job.revision} submissionFloorPlanRevision={collection.revision} /></PartnerShell>;
}
