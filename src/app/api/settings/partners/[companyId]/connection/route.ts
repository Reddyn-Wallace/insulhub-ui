import {partnerLiveConnectionRoute} from "@/lib/partner/live-connection-route";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{companyId:string}>}){return partnerLiveConnectionRoute(request,(await params).companyId);}
export async function POST(request:Request,{params}:{params:Promise<{companyId:string}>}){return partnerLiveConnectionRoute(request,(await params).companyId);}
