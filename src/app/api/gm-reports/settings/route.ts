import { NextRequest } from "next/server";
import { handle } from "@/lib/gm-report/api";
export const GET = (r: NextRequest) => handle(r, undefined, true);
export const PUT = GET;
