import { partnerUserManagementRoute } from "@/lib/partner/user-management-routes";
export const runtime="nodejs";
export async function GET(request:Request){return partnerUserManagementRoute(request,undefined,undefined);}
export async function POST(request:Request){return partnerUserManagementRoute(request,undefined,undefined);}
