import "server-only";
import { NextResponse } from "next/server";
import { getAuthenticatedPrincipal } from "./auth";
import { getPartnerPool } from "./db";
import { validatePartnerDraft } from "./draft";
import { DraftCreationConflict, PartnerRepository, partnerJobView, type AuthenticatedPrincipal, type PartnerSubmissionState } from "./repository";
import { allowedPartnerOrigins, verifyMutationOrigin, verifyPartnerRequestHost, withPartnerNoStore } from "./security";
import { readBody } from "./operations-routes";

export interface PartnerJobRouteDependencies {
  repository: PartnerRepository;
  origins: ReadonlySet<string>;
  getPrincipal: (headers: Headers) => Promise<AuthenticatedPrincipal | null>;
}

function productionDependencies(): PartnerJobRouteDependencies {
  return { repository: new PartnerRepository(getPartnerPool()), origins: allowedPartnerOrigins(), getPrincipal: getAuthenticatedPrincipal };
}

function partnerOnly(principal: AuthenticatedPrincipal | null) {
  return principal?.principalType === "PARTNER" ? principal : null;
}

function sessionExpired(): NextResponse {
  return partnerJson({ error: "Your session has expired. Sign in again." }, { status: 401 });
}

function partnerJson(body: unknown, init?: ResponseInit): NextResponse { return withPartnerNoStore(NextResponse.json(body, init)); }
function invalidDemoHost(dependencies?: PartnerJobRouteDependencies, headers?: Headers): NextResponse | null {
  return !dependencies && headers && !verifyPartnerRequestHost(headers) ? partnerJson({ error: "Forbidden" }, { status: 403 }) : null;
}

function validJobId(jobId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId);
}

const SUBMISSION_STATES = new Set<PartnerSubmissionState>(["DRAFT", "QUEUED", "CREATING_LEAD", "UPDATING_QUOTE", "ATTACHING_PLANS", "SUBMITTED", "FAILED_RETRYABLE", "RECONCILIATION_REQUIRED"]);

export async function deletePartnerDraft(request: Request, jobId: string, dependencies?: PartnerJobRouteDependencies): Promise<NextResponse> {
  const hostFailure=invalidDemoHost(dependencies,request.headers);if(hostFailure)return hostFailure;
  const deps=dependencies??productionDependencies();
  if(!deps.origins.has(request.headers.get("origin")??""))return partnerJson({error:"Forbidden"},{status:403});
  const principal=partnerOnly(await deps.getPrincipal(request.headers));if(!principal)return sessionExpired();
  if(!validJobId(jobId))return partnerJson({error:"Draft not found."},{status:404});
  const body=await readBody(request);
  if(new URL(request.url).search||!body||Object.keys(body).length!==1||!Number.isInteger(body.revision)||Number(body.revision)<0||Number(body.revision)>2_147_483_647)return partnerJson({error:"A saved draft revision is required."},{status:400});
  try {
    const outcome=await deps.repository.deleteDraft(principal,jobId,Number(body.revision));
    if(outcome==="deleted")return partnerJson({deleted:true});
    if(outcome==="not_found")return partnerJson({error:"Draft not found."},{status:404});
    if(outcome==="not_draft")return partnerJson({error:"Only drafts can be deleted. Submission has already started.",code:"DRAFT_LOCKED"},{status:409});
    return partnerJson({error:"This draft changed. Reload before deleting it.",code:"STALE_REVISION"},{status:409});
  } catch {return partnerJson({error:"Deletion could not be confirmed. Reload your jobs before trying again."},{status:503});}
}

export async function listPartnerJobs(request: Request, dependencies?: PartnerJobRouteDependencies): Promise<NextResponse> {
  const hostFailure = invalidDemoHost(dependencies, request.headers); if (hostFailure) return hostFailure;
  const deps = dependencies ?? productionDependencies();
  const principal = partnerOnly(await deps.getPrincipal(request.headers));
  if (!principal) return sessionExpired();
  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (search.length > 120 || (state && !SUBMISSION_STATES.has(state as PartnerSubmissionState))) return partnerJson({ error: "Invalid filter." }, { status: 400 });
  const jobs = await deps.repository.listJobs(principal, { search: search || undefined, submissionState: state ? state as PartnerSubmissionState : undefined });
  return partnerJson({ jobs: jobs.map(partnerJobView) });
}

export async function createPartnerDraft(request: Request, dependencies?: PartnerJobRouteDependencies): Promise<NextResponse> {
  const hostFailure = invalidDemoHost(dependencies, request.headers); if (hostFailure) return hostFailure;
  const deps = dependencies ?? productionDependencies();
  if (!verifyMutationOrigin(request.headers, deps.origins)) return partnerJson({ error: "Forbidden" }, { status: 403 });
  const principal = partnerOnly(await deps.getPrincipal(request.headers));
  if (!principal) return sessionExpired();
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const validated = validatePartnerDraft(body);
  if (!validated.ok) return partnerJson({ error: "Check the highlighted fields.", fieldErrors: validated.errors }, { status: 400 });
  const creationKey = request.headers.get("idempotency-key");
  if (creationKey !== null && !/^[0-9a-f-]{36}$/i.test(creationKey)) return partnerJson({ error: "Invalid creation key." }, { status: 400 });
  try {
    const job = await deps.repository.createDraft(principal, validated.value, creationKey ?? undefined);
    return partnerJson({ job: partnerJobView(job), destination: `/partner/jobs/${job.id}` }, { status: 201 });
  } catch (error) {
    if (error instanceof DraftCreationConflict) return partnerJson({ error: "This draft creation request has changed. Reload to recover the original draft.", code: "CREATION_CONFLICT" }, { status: 409 });
    throw error;
  }
}

export async function getPartnerJob(request: Request, jobId: string, dependencies?: PartnerJobRouteDependencies): Promise<NextResponse> {
  const hostFailure = invalidDemoHost(dependencies, request.headers); if (hostFailure) return hostFailure;
  const deps = dependencies ?? productionDependencies();
  const principal = partnerOnly(await deps.getPrincipal(request.headers));
  if (!principal) return sessionExpired();
  if (!validJobId(jobId)) return partnerJson({ error: "Draft not found." }, { status: 404 });
  const job = await deps.repository.getJob(principal, jobId);
  return job ? partnerJson({ job: partnerJobView(job) }) : partnerJson({ error: "Draft not found." }, { status: 404 });
}

export async function updatePartnerDraft(request: Request, jobId: string, dependencies?: PartnerJobRouteDependencies): Promise<NextResponse> {
  const hostFailure = invalidDemoHost(dependencies, request.headers); if (hostFailure) return hostFailure;
  const deps = dependencies ?? productionDependencies();
  if (!verifyMutationOrigin(request.headers, deps.origins)) return partnerJson({ error: "Forbidden" }, { status: 403 });
  const principal = partnerOnly(await deps.getPrincipal(request.headers));
  if (!principal) return sessionExpired();
  if (!validJobId(jobId)) return partnerJson({ error: "Draft not found." }, { status: 404 });
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some((key) => key !== "revision" && key !== "draft")
    || !Number.isInteger((body as { revision?: unknown }).revision)) return partnerJson({ error: "Draft update is invalid." }, { status: 400 });
  const revision = (body as { revision: number }).revision;
  if (revision < 0 || revision > 2_147_483_647) return partnerJson({ error: "Draft update is invalid." }, { status: 400 });
  const validated = validatePartnerDraft((body as { draft?: unknown }).draft);
  if (!validated.ok) return partnerJson({ error: "Check the highlighted fields.", fieldErrors: validated.errors }, { status: 400 });
  const result = await deps.repository.updateDraft(principal, jobId, revision, validated.value);
  if (result.outcome === "updated") return partnerJson({ job: partnerJobView(result.job) });
  if (result.outcome === "not_found") return partnerJson({ error: "Draft not found." }, { status: 404 });
  if (result.outcome === "not_draft") return partnerJson({ error: "Submitted jobs cannot be edited.", code: "DRAFT_LOCKED" }, { status: 409 });
  return partnerJson({ error: "This draft changed in another tab. Reload before saving.", code: "STALE_REVISION", currentRevision: result.currentRevision }, { status: 409 });
}
