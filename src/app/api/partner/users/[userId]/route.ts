import { partnerUserManagementRoute } from "@/lib/partner/user-management-routes";
export const runtime="nodejs";
export async function PATCH(request:Request,{params}:{params:Promise<{userId:string}>}){return partnerUserManagementRoute(request,(await params).userId,undefined);}
export async function DELETE(request:Request,{params}:{params:Promise<{userId:string}>}){return partnerUserManagementRoute(request,(await params).userId,undefined);}
