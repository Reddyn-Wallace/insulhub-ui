import { partnerSettingsRoute } from "@/lib/partner/settings-routes";
export const runtime="nodejs";
export async function DELETE(request:Request,{params}:{params:Promise<{companyId:string;userId:string}>}){const p=await params;return partnerSettingsRoute(request,p.companyId,p.userId,true);}

export async function PATCH(request:Request,{params}:{params:Promise<{companyId:string;userId?:string}>}){const p=await params;return partnerSettingsRoute(request,p.companyId,p.userId,true);}
