import { headers } from "next/headers";
import { redirect } from "next/navigation";
import PartnerDashboard from "@/components/PartnerDashboard";
import PartnerShell from "@/components/PartnerShell";
import { partnerDemoModeEnabled } from "@/lib/partner/demo";
import { getPartnerPageContext } from "@/lib/partner/page-context";
import { partnerJobView } from "@/lib/partner/repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PartnerDashboardPage({ searchParams }: { searchParams: Promise<{ submitted?: string }> }) {
  const { submitted } = await searchParams;
  const context = await getPartnerPageContext(await headers());
  if (!context) redirect("/partner/login?reason=session-expired");
  const jobs = await context.repository.listJobs(context.principal);
  return <PartnerShell viewer={context.viewer} demoMode={partnerDemoModeEnabled()} recoveryScope={context.recoveryScope}><PartnerDashboard submitted={submitted === "1"} jobs={jobs.map(partnerJobView)} companyName={context.viewer.companyName} recoveryScope={context.recoveryScope} /></PartnerShell>;
}
