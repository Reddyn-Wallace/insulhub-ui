import { downloadFloorPlanPdf, generateFloorPlanPdf } from "@/lib/partner/site-plan-routes";
export const runtime="nodejs";
type Context={params:Promise<{jobId:string;drawingId:string}>};
export async function GET(request:Request,{params}:Context){const p=await params;return downloadFloorPlanPdf(request,p.jobId,p.drawingId);}
export async function POST(request:Request,{params}:Context){const p=await params;return generateFloorPlanPdf(request,p.jobId,p.drawingId);}
