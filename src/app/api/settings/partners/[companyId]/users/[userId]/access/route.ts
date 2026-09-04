import { partnerSettingsRoute } from "@/lib/partner/settings-routes";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:Request,context:{params:Promise<{companyId:string;userId:string}>}){const {companyId,userId}=await context.params;return partnerSettingsRoute(request,companyId,userId,true,undefined,"access");}
