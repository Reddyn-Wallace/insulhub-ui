import { headers } from "next/headers";
import { redirect } from "next/navigation";
import PartnerDraftForm from "@/components/PartnerDraftForm";
import PartnerShell from "@/components/PartnerShell";
import { partnerDemoModeEnabled } from "@/lib/partner/demo";
import { getPartnerPageContext } from "@/lib/partner/page-context";
import { createQuoteDraft, PRODUCT_QUOTE_DEFAULTS } from "@/lib/partner/quote";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewPartnerDraftPage() {
  const context = await getPartnerPageContext(await headers());
  if (!context) redirect("/partner/login?reason=session-expired");
  const defaults = await context.repository.getQuoteDefaults(context.principal);
  return <PartnerShell viewer={context.viewer} demoMode={partnerDemoModeEnabled()} recoveryScope={context.recoveryScope}><PartnerDraftForm recoveryScope={context.recoveryScope} initialQuote={createQuoteDraft(defaults ?? PRODUCT_QUOTE_DEFAULTS)} /></PartnerShell>;
}
