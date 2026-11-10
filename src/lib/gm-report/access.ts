import "server-only";
import type { NextRequest } from "next/server";
import { tokenFromRequest } from "@/lib/insulhub-auth";
import { ReportError } from "./model";
export async function sourceQuery<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch("https://api.insulhub.nz/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", "x-access-token": token },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new ReportError(
      "The CRM source could not be read. Please retry.",
      503,
    );
  const data = await response.json();
  if (data.errors?.length || !data.data)
    throw new ReportError(
      "The CRM source could not be read. Please retry.",
      503,
    );
  return data.data as T;
}
export async function requireReportActor(request: NextRequest) {
  const token = tokenFromRequest(request);
  if (!token || token.length > 8192 || /[\r\n]/.test(token))
    throw new ReportError("Sign in to the internal CRM.", 401);
  const { me } = await sourceQuery<{
    me: { _id: string; role: string } | null;
  }>(token, "query GMReportIdentity { me { _id role } }");
  if (!me || typeof me._id !== "string" || !me._id)
    throw new ReportError("Sign in to the internal CRM.", 401);
  const allow = (process.env.GM_REPORT_USER_IDS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (me.role !== "ADMIN" && !allow.includes(me._id))
    throw new ReportError(
      "Weekly GM reports are restricted to internal management.",
      403,
    );
  // This deployment has one internal CRM database; partner portal sessions are separate and never accepted here.
  return { id: me._id, token };
}
