import { linkedJobContextRoute } from "@/lib/partner/linked-job-context-routes";

export async function GET(request: Request) { return linkedJobContextRoute(request); }
export async function POST(request: Request) { return linkedJobContextRoute(request); }
