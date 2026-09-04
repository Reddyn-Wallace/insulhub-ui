import { createFloorPlan, listFloorPlans } from "@/lib/partner/site-plan-routes";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{jobId:string}>}){return listFloorPlans(request,(await params).jobId);}
export async function POST(request:Request,{params}:{params:Promise<{jobId:string}>}){return createFloorPlan(request,(await params).jobId);}
