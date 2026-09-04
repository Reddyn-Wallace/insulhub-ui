import { partnerNotesRoute } from "@/lib/partner/note-routes";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{jobId:string}>}){return partnerNotesRoute(request,(await params).jobId);}
export async function POST(request:Request,{params}:{params:Promise<{jobId:string}>}){return partnerNotesRoute(request,(await params).jobId);}
