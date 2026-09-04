import { reorderFloorPlans } from "@/lib/partner/site-plan-routes";
export const runtime="nodejs";
export async function PATCH(request:Request,{params}:{params:Promise<{jobId:string}>}){return reorderFloorPlans(request,(await params).jobId);}
