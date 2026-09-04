import { resumePartnerDemoSubmission } from "@/lib/partner/submission-routes";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:Request,context:{params:Promise<{jobId:string}>}){return resumePartnerDemoSubmission(request,(await context.params).jobId);}
