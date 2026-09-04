import { partnerSettingsRoute } from "@/lib/partner/settings-routes";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{companyId:string}>}){return partnerSettingsRoute(request,(await params).companyId,undefined,true);}
export async function POST(request:Request,{params}:{params:Promise<{companyId:string}>}){return partnerSettingsRoute(request,(await params).companyId,undefined,true);}
