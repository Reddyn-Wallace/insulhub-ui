import { NextRequest } from "next/server";
import { handle } from "@/lib/gm-report/api";
export const maxDuration = 300;
type Context = { params: Promise<{ week: string }> };
export async function GET(request: NextRequest, context: Context) {
  return handle(request, (await context.params).week);
}
export const POST = GET;
