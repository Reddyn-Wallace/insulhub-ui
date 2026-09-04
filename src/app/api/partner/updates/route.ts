import { partnerNotesRoute } from "@/lib/partner/note-routes";
export const runtime="nodejs";
export async function GET(request:Request){return partnerNotesRoute(request);}
