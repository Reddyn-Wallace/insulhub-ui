import { handle } from "@/lib/gm-report/api";
import { NextRequest } from "next/server";
export const GET = (request: NextRequest) => handle(request);
