import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getPartnerPageContext } from "@/lib/partner/page-context";

export const dynamic = "force-dynamic"; export const revalidate = 0;
export default async function PartnerFloorPlansPage({ params }: { params: Promise<{ jobId: string }> }) {
  const context = await getPartnerPageContext(await headers()); if (!context) redirect("/partner/login?reason=session-expired");
  const { jobId } = await params; const job = await context.repository.getJob(context.principal, jobId); if (!job) notFound();
  redirect(`/partner/jobs/${jobId}#floor-plans`);
}
