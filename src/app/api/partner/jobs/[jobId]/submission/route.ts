import { getPartnerSubmissionStatus, submitPartnerJob } from "@/lib/partner/submission-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) { return getPartnerSubmissionStatus(request, (await context.params).jobId); }
export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) { return submitPartnerJob(request,(await context.params).jobId); }
