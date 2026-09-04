import "server-only";
import { NextResponse } from "next/server";
import { getPartnerAuth, getAuthenticatedPrincipal, type PartnerAuth } from "./auth";
import { ensurePartnerRuntimeRole, getPartnerPool, type PartnerSql } from "./db";
import { writePartnerAuditEvent } from "./audit";
import { allowedPartnerOrigins, GENERIC_LOGIN_ERROR, genericLoginFailure, verifyMutationOrigin, verifyPartnerRequestHost, withPartnerNoStore } from "./security";
import type { AuthenticatedPrincipal } from "./repository";

export type PartnerSurface = "partner" | "ops";

export interface PartnerAuthRouteDependencies {
  auth: PartnerAuth;
  sql: PartnerSql;
  origins: ReadonlySet<string>;
  getPrincipal: (headers: Headers) => Promise<AuthenticatedPrincipal | null>;
}

function productionDependencies(): PartnerAuthRouteDependencies {
  return {
    auth: getPartnerAuth(),
    sql: getPartnerPool(),
    origins: allowedPartnerOrigins(),
    getPrincipal: getAuthenticatedPrincipal,
  };
}

function copySessionCookies(source: Response, target: NextResponse): void {
  const getSetCookie = (source.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const values = getSetCookie ? getSetCookie.call(source.headers) : [source.headers.get("set-cookie")].filter(Boolean) as string[];
  for (const value of values) target.headers.append("set-cookie", value);
}

function partnerJson(body: unknown, init?: ResponseInit): NextResponse { return withPartnerNoStore(NextResponse.json(body, init)); }

export async function partnerLogin(
  request: Request,
  surface: PartnerSurface,
  dependencies?: PartnerAuthRouteDependencies,
): Promise<NextResponse> {
  if (!dependencies && !verifyPartnerRequestHost(request.headers)) return partnerJson({ error: GENERIC_LOGIN_ERROR }, { status: 403 });
  if(!dependencies)await ensurePartnerRuntimeRole();
  const deps = dependencies ?? productionDependencies();
  if (!verifyMutationOrigin(request.headers, deps.origins)) return partnerJson({ error: GENERIC_LOGIN_ERROR }, { status: 403 });
  let credentials: { email?: unknown; password?: unknown };
  try {
    credentials = await request.json();
  } catch {
    credentials = {};
  }
  if (typeof credentials.email !== "string" || typeof credentials.password !== "string") {
    return partnerJson({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
  }

  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.set("x-partner-auth-surface", surface);
  const upstream = new Request(new URL("/api/partner/auth/sign-in/email", request.url), {
    method: "POST",
    headers,
    body: JSON.stringify({ email: credentials.email, password: credentials.password, rememberMe: false }),
  });
  let response: Response;
  try {
    response = await deps.auth.handler(upstream);
  } catch {
    response = new Response(null, { status: 401 });
  }

  if (!response.ok) {
    await writePartnerAuditEvent(deps.sql, { type: "LOGIN_FAILED", metadata: { outcome: "failure", requestMethod: request.method } });
    if (response.status === 403) {
      const failure = await response.clone().json().catch(() => null) as { code?: string } | null;
      if (failure?.code === "ACCOUNT_DISABLED") return partnerJson({ code: "ACCOUNT_DISABLED", error: "Your account is disabled. Contact your administrator." }, { status: 403 });
    }
    const failure = genericLoginFailure(response.status);
    return partnerJson(failure.body, { status: failure.status });
  }

  const data = await response.clone().json() as { user?: { id?: string; companyId?: string | null; principalType?: string } };
  const user = data.user;
  const expected = surface === "ops" ? "INTERNAL" : "PARTNER";
  if (!user?.id || user.principalType !== expected) {
    await writePartnerAuditEvent(deps.sql, { type: "LOGIN_FAILED", metadata: { outcome: "failure", requestMethod: request.method } });
    return partnerJson({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
  }

  await writePartnerAuditEvent(deps.sql, {
    type: "LOGIN_SUCCEEDED",
    actorUserId: user.id,
    subjectUserId: user.id,
    companyId: user.companyId ?? null,
    metadata: { outcome: "success", principalType: expected },
  });
  const result = partnerJson({ ok: true, destination: surface === "ops" ? "/partner-ops" : "/partner" });
  copySessionCookies(response, result);
  return result;
}

export async function partnerLogout(
  request: Request,
  surface: PartnerSurface,
  dependencies?: PartnerAuthRouteDependencies,
): Promise<NextResponse> {
  if (!dependencies && !verifyPartnerRequestHost(request.headers)) return partnerJson({ error: "Forbidden" }, { status: 403 });
  if(!dependencies)await ensurePartnerRuntimeRole();
  const deps = dependencies ?? productionDependencies();
  if (!verifyMutationOrigin(request.headers, deps.origins)) return partnerJson({ error: "Forbidden" }, { status: 403 });
  const principal = await deps.getPrincipal(request.headers);
  const allowed = principal && ((surface === "partner" && principal.principalType === "PARTNER") || (surface === "ops" && principal.principalType === "INTERNAL"));
  if (!allowed) return partnerJson({ error: "Unauthorized" }, { status: 401 });

  const upstream = new Request(new URL("/api/partner/auth/sign-out", request.url), { method: "POST", headers: request.headers });
  let response: Response;
  try {
    response = await deps.auth.handler(upstream);
  } catch {
    return partnerJson({ error: "Unable to sign out" }, { status: 503 });
  }
  if (!response.ok) return partnerJson({ error: "Unable to sign out" }, { status: 503 });
  await writePartnerAuditEvent(deps.sql, {
    type: "LOGOUT",
    actorUserId: principal.userId,
    subjectUserId: principal.userId,
    companyId: principal.companyId,
    metadata: { outcome: "success", principalType: principal.principalType },
  });
  const result = partnerJson({ ok: true });
  copySessionCookies(response, result);
  return result;
}
