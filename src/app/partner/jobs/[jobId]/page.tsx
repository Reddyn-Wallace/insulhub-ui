import PartnerUpdateTimeline from "@/components/PartnerUpdateTimeline";
import { PartnerNoteRepository } from "@/lib/partner/note-repository";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import PartnerDraftForm from "@/components/PartnerDraftForm";
import PartnerShell from "@/components/PartnerShell";
import PartnerSubmissionStatusPanel from "@/components/PartnerSubmissionStatusPanel";
import { partnerDemoModeEnabled } from "@/lib/partner/demo";
import { getPartnerPageContext } from "@/lib/partner/page-context";
import { partnerJobView } from "@/lib/partner/repository";
import { getPartnerPool } from "@/lib/partner/db";
import { PartnerSitePlanRepository } from "@/lib/partner/site-plan-repository";
import { floorPlanCollectionClientView } from "@/lib/partner/site-plan-view";
import { PartnerSubmissionRepository } from "@/lib/partner/submission-repository";
import { PartnerSubmissionService, type PartnerSubmissionView } from "@/lib/partner/submission-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;


export default async function PartnerDraftPage({ params }: { params: Promise<{ jobId: string }> }) {
  const context = await getPartnerPageContext(await headers());
  if (!context) redirect("/partner/login?reason=session-expired");
  const job = await context.repository.getJob(context.principal, (await params).jobId);
  if (!job) notFound();
  const visibleJob = partnerJobView(job);
  const updates = job.submissionState === "DRAFT" ? null : await new PartnerNoteRepository(getPartnerPool()).feed(context.principal, job.id);
  const floorPlans = await new PartnerSitePlanRepository(getPartnerPool()).list(context.principal, job.id);
  if (!floorPlans) notFound();
  let submissionStatus:PartnerSubmissionView|null=null;
  if(job.submissionState!=="DRAFT" && !job.linkedStatus)try{submissionStatus=await new PartnerSubmissionService(new PartnerSubmissionRepository(getPartnerPool())).status(context.principal,job.id);}catch{ /* Frozen job details remain readable without a submission receipt. */ }
  return (
    <PartnerShell viewer={context.viewer} demoMode={partnerDemoModeEnabled()} recoveryScope={context.recoveryScope}>
      {job.submissionState === "DRAFT" ? <PartnerDraftForm key={visibleJob.id} initialJob={visibleJob} initialFloorPlans={floorPlanCollectionClientView(floorPlans)} recoveryScope={context.recoveryScope} /> : <div className="mx-auto max-w-5xl space-y-6">
        {submissionStatus && submissionStatus.state !== "DRAFT" ? <PartnerSubmissionStatusPanel backgroundOnly jobId={job.id} initialStatus={submissionStatus} demoMode={partnerDemoModeEnabled()} /> : null}
        {updates ? <PartnerUpdateTimeline jobId={job.id} feed={updates} /> : null}
        <PartnerDraftForm readOnly key={visibleJob.id} initialJob={visibleJob} initialFloorPlans={floorPlanCollectionClientView(floorPlans)} recoveryScope={context.recoveryScope} />
      </div>}
    </PartnerShell>
  );
}
