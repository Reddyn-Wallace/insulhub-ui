import { partnerSettingsRoute } from "@/lib/partner/settings-routes";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:Request,context:{params:Promise<{companyId:string}>}){return partnerSettingsRoute(request,(await context.params).companyId,undefined,true,undefined,"invite");}
