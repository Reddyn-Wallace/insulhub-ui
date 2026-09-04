import { partnerJobLinkRoute } from "@/lib/partner/job-link-routes";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ companyId: string }> }) {
  return partnerJobLinkRoute(request, (await context.params).companyId);
}
