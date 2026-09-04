import { headers } from "next/headers";
import { redirect } from "next/navigation";
import PartnerShell from "@/components/PartnerShell";
import PartnerTeamManagement from "@/components/PartnerTeamManagement";
import { getPartnerPageContext } from "@/lib/partner/page-context";
import { partnerDemoModeEnabled } from "@/lib/partner/demo";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PartnerUsersPage() {
  const context = await getPartnerPageContext(await headers());
  if (!context) redirect("/partner/login?reason=session-expired");
  if (context.viewer.role !== "ADMIN") redirect("/partner");
  return <PartnerShell viewer={context.viewer} demoMode={partnerDemoModeEnabled()} recoveryScope={context.recoveryScope}><PartnerTeamManagement companyId={context.principal.companyId} companyName={context.viewer.companyName} currentUserId={context.principal.userId}/></PartnerShell>;
}
