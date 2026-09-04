import { createPartnerDraft, listPartnerJobs } from "@/lib/partner/job-routes";

export const runtime = "nodejs";
export async function GET(request: Request) { return listPartnerJobs(request); }
export async function POST(request: Request) { return createPartnerDraft(request); }
