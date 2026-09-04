import { partnerJobLinkRoute } from "@/lib/partner/job-link-routes";
export async function POST(request: Request) { return partnerJobLinkRoute(request); }
