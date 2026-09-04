import { partnerJobLinkRoute } from "@/lib/partner/job-link-routes";
export async function POST(request: Request, context: { params: Promise<{ companyId: string; jobId: string }> }) {
  const { companyId, jobId } = await context.params;
  return partnerJobLinkRoute(request, companyId, jobId);
}
