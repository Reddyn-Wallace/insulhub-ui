import { getPartnerTracking } from "@/lib/partner/tracking-routes";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{jobId:string}>}){return getPartnerTracking(request,(await params).jobId);}
