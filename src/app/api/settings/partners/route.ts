import { partnerSettingsRoute } from "@/lib/partner/settings-routes";
export const runtime="nodejs";
export async function GET(request:Request){return partnerSettingsRoute(request);}
export async function POST(request:Request){return partnerSettingsRoute(request);}
