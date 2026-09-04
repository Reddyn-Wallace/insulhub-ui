import { partnerSettingsRoute } from "@/lib/partner/settings-routes";
export const runtime="nodejs";
export async function PUT(request:Request,{params}:{params:Promise<{companyId:string}>}){return partnerSettingsRoute(request,(await params).companyId);}

export async function PATCH(request:Request,{params}:{params:Promise<{companyId:string;userId?:string}>}){const p=await params;return partnerSettingsRoute(request,p.companyId,p.userId,false);}
