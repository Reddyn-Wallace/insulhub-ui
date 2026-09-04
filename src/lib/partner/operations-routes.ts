import "server-only";
import { NextResponse } from "next/server";
import { getAuthenticatedPrincipal } from "./auth";
import { ensurePartnerOpsRole, getPartnerOpsPool } from "./db";
import { PartnerOperationsRepository } from "./operations-repository";
import { isOpsRevision, isUuid, parseAmendment, parseCompany, parseInvoice, parseOpsFact, parsePartnerUser, parseSettlement } from "./operations";
import type { AuthenticatedPrincipal, InternalPrincipal } from "./repository";
import { allowedPartnerOrigins, verifyPartnerRequestHost, withPartnerNoStore } from "./security";

export interface OpsRouteDependencies {
  repository: PartnerOperationsRepository;
  origins: ReadonlySet<string>;
  getPrincipal: (headers: Headers) => Promise<AuthenticatedPrincipal | null>;
}
const json = (body: unknown, init?: ResponseInit) => withPartnerNoStore(NextResponse.json(body, init));
const invalid = (label: string) => json({ error: `Invalid ${label}.` }, { status: 400 });
const notFound = () => json({ error: "Not found." }, { status: 404 });
const MAX_BODY_BYTES = 16_384;

export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" || !request.body) return null;
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) return null;
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
    if (declared !== null && Number(declared) !== size) return null;
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; } finally { reader.releaseLock(); }
}

async function isEmptyBody(request: Request): Promise<boolean> {
  if (request.headers.has("content-type") || request.headers.has("transfer-encoding") || (request.headers.get("content-length") ?? "0") !== "0") return false;
  if (!request.body) return true;
  const reader = request.body.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return true;
      if (next.value.byteLength) { await reader.cancel(); return false; }
    }
  } catch { return false; } finally { reader.releaseLock(); }
}

function permittedHost(request: Request, origins: ReadonlySet<string>): boolean {
  const url = new URL(request.url);
  if (!origins.has(url.origin)) return false;
  for (const name of ["host", "x-forwarded-host"]) {
    const value = request.headers.get(name);
    if (value !== null && value.toLowerCase() !== url.host.toLowerCase()) return false;
  }
  return true;
}

function mapError(error: unknown): Response {
  const code = (error as { code?: string })?.code;
  if (code === "OPS_FORBIDDEN") return json({ error: "Forbidden" }, { status: 403 });
  if (code === "OPS_NOT_FOUND") return notFound();
  if (code === "OPS_STALE_REVISION") return json({ error: "The record changed. Reload and retry.", code }, { status: 409 });
  if (code === "OPS_JOB_NOT_ACTIONABLE") return json({ error: "This job cannot receive operational updates.", code }, { status: 409 });
  const conflicts = ["OPS_CANCELLED", "OPS_TERMINAL", "OPS_INVOICE_REQUIRED", "OPS_GROSS_MISMATCH", "OPS_MODEL_MISMATCH", "OPS_DUPLICATE_FACT", "OPS_SLUG_IMMUTABLE"];
  if (code && conflicts.includes(code)) return json({ error: "The operation conflicts with the current record. Reload and review its status.", code }, { status: 409 });
  if (code === "23505") return json({ error: "A matching record already exists." }, { status: 409 });
  return json({ error: "Unable to record the operation." }, { status: 400 });
}

type Operation = (deps: OpsRouteDependencies, actor: InternalPrincipal) => Promise<Response>;
async function route(request: Request, mutate: boolean, depsArg: OpsRouteDependencies | undefined, operation: Operation): Promise<Response> {
  try {
    if (!depsArg && !verifyPartnerRequestHost(request.headers)) return json({ error: "Forbidden" }, { status: 403 });
    const origins = depsArg?.origins ?? allowedPartnerOrigins();
    if (!permittedHost(request, origins) || (mutate && !origins.has(request.headers.get("origin") ?? ""))) return json({ error: "Forbidden" }, { status: 403 });
    const getPrincipal = depsArg?.getPrincipal ?? getAuthenticatedPrincipal;
    const actor = await getPrincipal(request.headers);
    if (actor?.principalType !== "INTERNAL") return json({ error: "Unauthorized" }, { status: 401 });
    if (!depsArg) await ensurePartnerOpsRole();
    const deps = depsArg ?? { repository: new PartnerOperationsRepository(getPartnerOpsPool()), origins, getPrincipal };
    return await operation(deps, actor);
  } catch (error) { return mapError(error); }
}

export function getOpsDashboard(request: Request, deps?: OpsRouteDependencies) {
  return route(request, false, deps, async (d, actor) => json({ jobs: await d.repository.dashboard(actor) }));
}
export function getOpsJob(request: Request, jobId: string, deps?: OpsRouteDependencies) {
  return route(request, false, deps, async (d, actor) => {
    if (!isUuid(jobId)) return notFound();
    const job = await d.repository.jobDetail(actor, jobId);
    return job ? json({ job }) : notFound();
  });
}
export function getOpsCompanies(request: Request, deps?: OpsRouteDependencies) {
  return route(request, false, deps, async (d, actor) => json({ companies: await d.repository.listCompanies(actor) }));
}
export function postOpsCompany(request: Request, deps?: OpsRouteDependencies) {
  return route(request, true, deps, async (d, actor) => {
    const input = parseCompany(await readBody(request));
    return input ? json({ company: await d.repository.createCompany(actor, input) }, { status: 201 }) : invalid("company");
  });
}
export function putOpsCompany(request: Request, companyId: string, deps?: OpsRouteDependencies) {
  return route(request, true, deps, async (d, actor) => {
    const raw = await readBody(request);
    if (!isUuid(companyId) || !raw || Object.keys(raw).some(key => key !== "revision" && key !== "company") || !isOpsRevision(raw.revision)) return invalid("company");
    const input = parseCompany(raw.company);
    if (!input) return invalid("company");
    await d.repository.updateCompany(actor, companyId, raw.revision, input);
    return json({ ok: true });
  });
}
export function getOpsPartnerUsers(request: Request, companyId: string, deps?: OpsRouteDependencies) {
  return route(request, false, deps, async (d, actor) => isUuid(companyId) ? json({ users: await d.repository.listPartnerUsers(actor, companyId) }) : notFound());
}
export function postOpsPartnerUser(request: Request, companyId: string, deps?: OpsRouteDependencies) {
  return route(request, true, deps, async (d, actor) => {
    const input = parsePartnerUser(await readBody(request));
    return isUuid(companyId) && input ? json({ user: await d.repository.createPartnerUser(actor, companyId, input) }, { status: 201 }) : invalid("partner user");
  });
}
export function deleteOpsPartnerUser(request: Request, companyId: string, userId: string, deps?: OpsRouteDependencies) {
  return route(request, true, deps, async (d, actor) => {
    if (!isUuid(companyId) || !userId.trim() || userId.length > 100) return notFound();
    if (!await isEmptyBody(request)) return invalid("request");
    await d.repository.disablePartnerUser(actor, companyId, userId);
    return json({ ok: true });
  });
}
export function postOpsFact(request: Request, companyId: string, jobId: string, deps?: OpsRouteDependencies) {
  return route(request, true, deps, async (d, actor) => {
    const input = parseOpsFact(await readBody(request));
    if (!isUuid(companyId) || !isUuid(jobId) || !input) return invalid("fact");
    await d.repository.appendFact(actor, companyId, jobId, input.factType, input.at);
    return json({ ok: true });
  });
}
export function postOpsAmendment(request: Request, companyId: string, jobId: string, deps?: OpsRouteDependencies) {
  return route(request, true, deps, async (d, actor) => {
    const input = parseAmendment(await readBody(request));
    if (!isUuid(companyId) || !isUuid(jobId) || !input) return invalid("amendment");
    await d.repository.appendAmendment(actor, companyId, jobId, input);
    return json({ ok: true }, { status: 201 });
  });
}
export function putOpsInvoice(request: Request, companyId: string, jobId: string, deps?: OpsRouteDependencies) {
  return route(request, true, deps, async (d, actor) => {
    const input = parseInvoice(await readBody(request));
    if (!isUuid(companyId) || !isUuid(jobId) || !input) return invalid("invoice");
    await d.repository.upsertInvoice(actor, companyId, jobId, input);
    return json({ ok: true });
  });
}
export function putOpsSettlement(request: Request, companyId: string, jobId: string, deps?: OpsRouteDependencies) {
  return route(request, true, deps, async (d, actor) => {
    const raw = await readBody(request);
    if (!isUuid(companyId) || !isUuid(jobId) || !raw || Object.keys(raw).some(key => !["revision", "grossCents", "commissionCents", "status", "settledAt"].includes(key))) return invalid("settlement");
    const model = await d.repository.jobBillingModel(actor, companyId, jobId);
    if (!model) return notFound();
    const input = parseSettlement(raw, model);
    if (!input) return invalid("settlement");
    await d.repository.upsertSettlement(actor, companyId, jobId, model, input);
    return json({ ok: true });
  });
}
