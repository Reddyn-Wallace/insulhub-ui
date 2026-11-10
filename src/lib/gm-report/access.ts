import "server-only";
import type { NextRequest } from "next/server";
import { tokenFromRequest } from "@/lib/insulhub-auth";
import { ReportError } from "./model";
import { SourceReadError, type SourceDiagnostic } from "./source-error";
const diagnosticFields = new Set([
  "jobs",
  "job",
  "results",
  "quote",
  "ceiling",
  "wall",
  "c_bagCount",
  "c_total",
  "acceptedAt",
  "SQM",
  "extras",
  "name",
  "price",
  "installerChecksheet",
  "actualBags",
  "complete",
  "client",
  "contactDetails",
  "installation",
  "createdAt",
  "archivedAt",
  "stage",
  "jobNumber",
  "installDate",
  "installStatus",
  "checkSheetSignedAsComplete",
  "me",
  "role",
  "_id",
]);
function sourceDiagnostic(
  query: string,
  status: number,
  errors: unknown[],
): SourceDiagnostic {
  const operation =
    query.match(
      /\bquery\s+(GMReportIdentity|GMReportJobs|GMReportAcceptedAt)\b/,
    )?.[1] || "unknown";
  const codes = new Set([
    "GRAPHQL_VALIDATION_FAILED",
    "INTERNAL_SERVER_ERROR",
    "UNAUTHENTICATED",
    "FORBIDDEN",
  ]);
  return {
    operation,
    httpStatus: status,
    errors: errors.map((value) => {
      const e =
        value && typeof value === "object"
          ? (value as {
              message?: unknown;
              path?: unknown;
              extensions?: { code?: unknown };
            })
          : {};
      const text = typeof e.message === "string" ? e.message : "";
      return {
        code:
          typeof e.extensions?.code === "string" && codes.has(e.extensions.code)
            ? e.extensions.code
            : "UPSTREAM_ERROR",
        path: Array.isArray(e.path)
          ? e.path.map((p) =>
              Number.isInteger(p)
                ? p
                : typeof p === "string" && diagnosticFields.has(p)
                  ? p
                  : "[field]",
            )
          : [],
        cause: /\b(Float|Int) cannot represent\b/.test(text)
          ? "non-numeric"
          : /Cannot return null for non-nullable field/.test(text)
            ? "missing-required-field"
            : "upstream-error",
      };
    }),
  };
}
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
  const data = await response.json().catch(() => null);
  const errors = Array.isArray(data?.errors) ? data.errors : [];
  if (!response.ok || errors.length || !data?.data) {
    const diagnostic = sourceDiagnostic(query, response.status, errors);
    // Never log raw upstream messages, exception objects, tokens, variables or customer values.
    console.error(
      "gm-report-source-failure",
      JSON.stringify({ ...diagnostic, errors: diagnostic.errors.slice(0, 5) }),
    );
    throw new SourceReadError(diagnostic);
  }
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
  if (!["ADMIN", "LICENSEE"].includes(me.role) && !allow.includes(me._id))
    throw new ReportError(
      "Weekly GM reports are restricted to internal management.",
      403,
    );
  // This deployment has one internal CRM database; partner portal sessions are separate and never accepted here.
  return { id: me._id, token };
}
