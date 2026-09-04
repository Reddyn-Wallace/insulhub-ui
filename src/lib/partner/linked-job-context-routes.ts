import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { allowedPartnerOrigins, verifyPartnerRequestHost, withPartnerNoStore } from "./security";
import { ensurePartnerOpsRole, getPartnerOpsPool } from "./db";
import { PartnerJobLinkRepository } from "./job-link-repository";
import { PartnerOperationsRepository } from "./operations-repository";
import { neutralPartnerTracking } from "./neutral-tracking";
import { readBody } from "./operations-routes";
import { PARTNER_SETTINGS_SERVICE_ID } from "./settings-service";
import type { InternalPrincipal } from "./repository";

type ContextRepository = Pick<PartnerOperationsRepository, "listCompanies" | "jobDetail" | "appendAmendment">;
export type LinkedJobContextDependencies = {
  origins: ReadonlySet<string>;
  verify: (request: NextRequest) => Promise<Response | null>;
  links: Pick<PartnerJobLinkRepository, "lookup">;
  repository: ContextRepository;
};

const actor: InternalPrincipal = { principalType: "INTERNAL", companyId: null, userId: PARTNER_SETTINGS_SERVICE_ID };
const json = (body: unknown, status = 200) => withPartnerNoStore(NextResponse.json(body, { status }));
const legacyId = (value: unknown) => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value) ? value.toLowerCase() : null;

async function loadContext(id: string, deps: LinkedJobContextDependencies) {
  const link = await deps.links.lookup(id);
  if (!link) return { linked: false as const };
  const [raw, companies] = await Promise.all([deps.repository.jobDetail(actor, link.jobId), deps.repository.listCompanies(actor)]);
  const tracking = neutralPartnerTracking(raw);
  const company = companies.find((item) => item.id === link.companyId);
  if (!tracking || !company) return { linked: false as const };
  return { linked: true as const, companyName: company.name, tracking };
}

/** Any authenticated InsulHub user may see attribution and record a partner-visible job update. */
export async function linkedJobContextRoute(request: Request, injected?: LinkedJobContextDependencies): Promise<Response> {
  try {
    const origins = injected?.origins ?? allowedPartnerOrigins();
    const url = new URL(request.url), host = request.headers.get("host")?.toLowerCase() ?? url.host.toLowerCase();
    const forwardedHost = request.headers.get("x-forwarded-host")?.toLowerCase();
    const canonicalOrigin = [...origins].find((origin) => new URL(origin).host.toLowerCase() === host);
    if (!canonicalOrigin || (forwardedHost && forwardedHost !== host) || (!injected && !verifyPartnerRequestHost(request.headers)) ||
      (request.method !== "GET" && !origins.has(request.headers.get("origin") ?? ""))) return json({ error: "Forbidden" }, 403);
    const canonical = new NextRequest(new URL(url.pathname + url.search, canonicalOrigin), { headers: request.headers });
    const denied = await (injected?.verify ?? requireInsulhubAuth)(canonical);
    if (denied) return withPartnerNoStore(denied);
    if (!injected) await ensurePartnerOpsRole();
    const deps = injected ?? {
      origins,
      verify: requireInsulhubAuth,
      links: new PartnerJobLinkRepository(getPartnerOpsPool()),
      repository: new PartnerOperationsRepository(getPartnerOpsPool()),
    };
    if (request.method === "GET") {
      if ([...url.searchParams.keys()].some((key) => key !== "legacyId")) return json({ error: "Invalid request." }, 400);
      const id = legacyId(url.searchParams.get("legacyId"));
      return id ? json(await loadContext(id, deps)) : json({ error: "Invalid request." }, 400);
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const body = await readBody(request);
    if (!body || Object.keys(body).some((key) => !["legacyId", "description", "requestKey"].includes(key)) || Object.keys(body).length !== 3) return json({ error: "Invalid update." }, 400);
    const id = legacyId(body.legacyId), description = typeof body.description === "string" ? body.description.trim() : "";
    const requestKey=typeof body.requestKey==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestKey)?body.requestKey.toLowerCase():null;
    if (!id || !requestKey || !description || description.length > 1000) return json({ error: "Invalid update." }, 400);
    const link = await deps.links.lookup(id);
    if (!link) return json({ error: "Not found." }, 404);
    await deps.repository.appendAmendment(actor, link.companyId, link.jobId, { description, requestKey });
    return json(await loadContext(id, deps), 201);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "OPS_JOB_NOT_ACTIONABLE") return json({ error: "This partner job cannot receive an update." }, 409);
    if (code === "OPS_FORBIDDEN") return json({ error: "Partner settings are unavailable." }, 503);
    return json({ error: "The partner job update could not be completed." }, 503);
  }
}
