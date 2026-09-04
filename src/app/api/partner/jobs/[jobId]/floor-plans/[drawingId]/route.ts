import { deleteFloorPlan, getFloorPlan, patchFloorPlan } from "@/lib/partner/site-plan-routes";
export const runtime="nodejs";
type Context={params:Promise<{jobId:string;drawingId:string}>};
export async function GET(request:Request,{params}:Context){const p=await params;return getFloorPlan(request,p.jobId,p.drawingId);}
export async function PATCH(request:Request,{params}:Context){const p=await params;return patchFloorPlan(request,p.jobId,p.drawingId);}
export async function DELETE(request:Request,{params}:Context){const p=await params;return deleteFloorPlan(request,p.jobId,p.drawingId);}
