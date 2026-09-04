import { partnerSettingsRoute } from "@/lib/partner/settings-routes";
export const runtime="nodejs";
export async function GET(request:Request){return partnerSettingsRoute(request,undefined,undefined,false,undefined,undefined,true);}
export async function PUT(request:Request){return partnerSettingsRoute(request,undefined,undefined,false,undefined,undefined,true);}
