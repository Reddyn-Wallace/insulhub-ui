import { deletePartnerDraft, getPartnerJob, updatePartnerDraft } from "@/lib/partner/job-routes";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) { return getPartnerJob(request, (await context.params).jobId); }
export async function PATCH(request: Request, context: { params: Promise<{ jobId: string }> }) { return updatePartnerDraft(request, (await context.params).jobId); }
export async function DELETE(request: Request, context: { params: Promise<{ jobId: string }> }) { return deletePartnerDraft(request, (await context.params).jobId); }
