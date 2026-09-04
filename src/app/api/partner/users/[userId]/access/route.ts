import { partnerUserManagementRoute } from "@/lib/partner/user-management-routes";
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{userId:string}>}){return partnerUserManagementRoute(request,(await params).userId,"access");}
