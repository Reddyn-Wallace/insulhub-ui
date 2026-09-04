import "server-only";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { getAuthenticatedPrincipal } from "./auth";
import { ensurePartnerRuntimeRole, getPartnerPool } from "./db";
import { type AuthenticatedPrincipal } from "./repository";
import { allowedPartnerOrigins, verifyMutationOrigin, verifyPartnerRequestHost, withPartnerNoStore } from "./security";
import { PartnerSubmissionRepository } from "./submission-repository";
import { PartnerSubmissionService } from "./submission-service";
import { partnerDemoModeEnabled } from "./demo";
import { consumePartnerDemoRecoveryAllowance, signalPartnerDemoSubmissionWorker } from "./demo-submission-worker";
import type { PartnerDemoSignalScope } from "./demo-submission-worker";
import { completePartnerSubmissionImmediately, type ImmediateSubmissionScope } from "./immediate-submission";
import type { PartnerSubmissionView } from "./submission-service";

export interface PartnerSubmissionRouteDependencies {
  service: PartnerSubmissionService;
  origins: ReadonlySet<string>;
  getPrincipal: (headers: Headers) => Promise<AuthenticatedPrincipal | null>;
  ensureRuntime?: () => Promise<void>;
  resumeDemo?: (scope:PartnerDemoSignalScope) => Promise<unknown>;
  completeImmediately?: (scope: ImmediateSubmissionScope, readStatus: () => Promise<PartnerSubmissionView | null>, signal: AbortSignal) => Promise<PartnerSubmissionView | null>;
}

async function emptyBody(request:Request):Promise<boolean>{
  if(request.headers.has("content-type")||request.headers.has("transfer-encoding"))return false;
  const length=request.headers.get("content-length");
  if(length!==null&&length!=="0")return false;
  if(request.body===null)return true;
  // Next may represent a browser POST with Content-Length: 0 as an already-ended
  // ReadableStream. Only accept that transport shape after proving it has no bytes.
  if(length!=="0")return false;
  const reader=request.body.getReader();
  try{const first=await reader.read();if(!first.done){await reader.cancel();return false;}return true;}
  catch{return false;}
  finally{reader.releaseLock();}
}

export async function resumePartnerDemoSubmission(request:Request,jobId:string,injected?:PartnerSubmissionRouteDependencies,env:NodeJS.ProcessEnv=process.env):Promise<NextResponse>{
  const hostFailure=routeHostFailure(Boolean(injected),request.headers);if(hostFailure)return hostFailure;
  if(request.method!=="POST")return json({error:"Method not allowed.",code:"METHOD_NOT_ALLOWED"},{status:405,headers:{allow:"POST"}});
  const origins=injected?.origins??allowedPartnerOrigins();if(!verifyMutationOrigin(request.headers,origins))return json({error:"Forbidden",code:"FORBIDDEN"},{status:403});
  const url=new URL(request.url);if(url.search||!await emptyBody(request))return json({error:"Invalid recovery request.",code:"INVALID_REQUEST"},{status:400});
  try{if(!partnerDemoModeEnabled(env))return json({error:"Not found.",code:"NOT_FOUND"},{status:404});const configured=new URL(env.PARTNER_APP_ORIGIN!).origin;if(request.headers.get("origin")!==configured)return json({error:"Forbidden",code:"FORBIDDEN"},{status:403});}catch{return json({error:"Not found.",code:"NOT_FOUND"},{status:404});}
  let deps:PartnerSubmissionRouteDependencies;try{deps=injected??dependencies();await deps.ensureRuntime?.();}catch{return json({error:"Submission recovery is temporarily unavailable.",code:"SUBMISSION_UNAVAILABLE"},{status:503});}
  let authenticated:AuthenticatedPrincipal|null;try{authenticated=await deps.getPrincipal(request.headers);}catch{return json({error:"Submission recovery is temporarily unavailable.",code:"SUBMISSION_UNAVAILABLE"},{status:503});}const principal=partner(authenticated);
  if(!principal)return json({error:"Your session has expired.",code:"SESSION_EXPIRED"},{status:401});if(!validJobId(jobId))return json({error:"Job not found.",code:"NOT_FOUND"},{status:404});
  try{const before=await deps.service.status(principal,jobId);if(!before)return json({error:"Job not found.",code:"NOT_FOUND"},{status:404});if(before.state==="DRAFT")return json({error:"This draft has not been submitted.",code:"SUBMISSION_CONFLICT"},{status:409});const scope={companyId:principal.companyId,jobId};if(!consumePartnerDemoRecoveryAllowance(scope,principal.userId))return json({error:"Recovery checks are temporarily limited. Wait briefly and try again.",code:"RATE_LIMITED"},{status:429,headers:{"retry-after":"30"}});await (deps.resumeDemo?.(scope)??signalPartnerDemoSubmissionWorker(scope,env));const status=await deps.service.status(principal,jobId);return status?json({status}):json({error:"Job not found.",code:"NOT_FOUND"},{status:404});}
  catch{return json({error:"Submission recovery is temporarily unavailable. The job remains read-only.",code:"SUBMISSION_UNAVAILABLE"},{status:503});}
}

function dependencies(): PartnerSubmissionRouteDependencies {
  const pool = getPartnerPool();
  return { service: new PartnerSubmissionService(new PartnerSubmissionRepository(pool)), origins: allowedPartnerOrigins(), getPrincipal: getAuthenticatedPrincipal, ensureRuntime: ensurePartnerRuntimeRole, completeImmediately: completePartnerSubmissionImmediately };
}
function json(body: unknown, init?: ResponseInit): NextResponse { return withPartnerNoStore(NextResponse.json(body, init)); }
function validJobId(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function partner(principal: AuthenticatedPrincipal | null) { return principal?.principalType === "PARTNER" ? principal : null; }
function routeHostFailure(injected: boolean, headers: Headers): NextResponse | null { return !injected && !verifyPartnerRequestHost(headers) ? json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 }) : null; }
function trustedClientIp(headers: Headers): string { const header = process.env.PARTNER_TRUSTED_CLIENT_IP_HEADER; if (header !== "cf-connecting-ip") return "unknown"; const value = headers.get(header)?.trim() ?? ""; return value.length <= 64 && isIP(value) ? value : "unknown"; }
async function boundedJson(request: Request): Promise<unknown> {
  if (!request.body) return null; const reader = request.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0; let text = "";
  try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 4096) { await reader.cancel(); throw new Error("oversize"); } text += decoder.decode(part.value, { stream: true }); } text += decoder.decode(); return JSON.parse(text); }
  finally { reader.releaseLock(); }
}

export async function getPartnerSubmissionStatus(request: Request, jobId: string, injected?: PartnerSubmissionRouteDependencies): Promise<NextResponse> {
  const hostFailure = routeHostFailure(Boolean(injected), request.headers); if (hostFailure) return hostFailure;
  let deps: PartnerSubmissionRouteDependencies; try { deps=injected??dependencies(); await deps.ensureRuntime?.(); } catch { return json({ error:"Submission status is temporarily unavailable.",code:"SUBMISSION_UNAVAILABLE" },{status:503}); }
  let authenticated: AuthenticatedPrincipal|null;try{authenticated=await deps.getPrincipal(request.headers);}catch{return json({error:"Submission status is temporarily unavailable.",code:"SUBMISSION_UNAVAILABLE"},{status:503});}const principal=partner(authenticated);
  if (!principal) return json({ error: "Your session has expired.", code: "SESSION_EXPIRED" }, { status: 401 });
  const url = new URL(request.url); if ([...url.searchParams.keys()].length) return json({ error: "Invalid status request.", code: "INVALID_REQUEST" }, { status: 400 });
  if (!validJobId(jobId)) return json({ error: "Job not found.", code: "NOT_FOUND" }, { status: 404 });
  try { if(!await deps.service.statusAllowed(principal,trustedClientIp(request.headers)))return json({error:"Too many status checks. Wait briefly and try again.",code:"RATE_LIMITED"},{status:429,headers:{"retry-after":"15"}});const status = await deps.service.status(principal, jobId); return status ? json({ status }) : json({ error: "Job not found.", code: "NOT_FOUND" }, { status: 404 }); }
  catch { return json({ error: "Submission status is temporarily unavailable.", code: "SUBMISSION_UNAVAILABLE" }, { status: 503 }); }
}

export async function submitPartnerJob(request: Request, jobId: string, injected?: PartnerSubmissionRouteDependencies,onAcceptedDemo?:(scope:PartnerDemoSignalScope)=>void): Promise<NextResponse> {
  const hostFailure = routeHostFailure(Boolean(injected), request.headers); if (hostFailure) return hostFailure;
  const origins=injected?.origins??allowedPartnerOrigins();
  if (!verifyMutationOrigin(request.headers, origins)) return json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  let deps: PartnerSubmissionRouteDependencies; try { deps=injected??dependencies(); } catch { return json({ error:"Submission is temporarily unavailable. No submission was started.",code:"SUBMISSION_UNAVAILABLE" },{status:503}); }
  try { await deps.ensureRuntime?.(); } catch { return json({ error:"Submission is temporarily unavailable. No submission was started.",code:"SUBMISSION_UNAVAILABLE" },{status:503}); }
  let authenticated: AuthenticatedPrincipal|null;try{authenticated=await deps.getPrincipal(request.headers);}catch{return json({error:"Submission is temporarily unavailable. No submission was started.",code:"SUBMISSION_UNAVAILABLE"},{status:503});}const principal=partner(authenticated);
  if (!principal) return json({ error: "Your session has expired.", code: "SESSION_EXPIRED" }, { status: 401 });
  if (!validJobId(jobId)) return json({ error: "Job not found.", code: "NOT_FOUND" }, { status: 404 });
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") return json({ error: "Use application/json.", code: "INVALID_REQUEST" }, { status: 415 });
  const rawLength = request.headers.get("content-length"); const declared = rawLength === null ? null : Number(rawLength);
  if (declared !== null && (!Number.isInteger(declared) || declared < 0)) return json({ error: "Submission request is invalid.", code: "INVALID_REQUEST" }, { status: 400 });
  if (declared !== null && declared > 4096) return json({ error: "Request is too large.", code: "INVALID_REQUEST" }, { status: 413 });
  let body: unknown;
  try { body = await boundedJson(request); } catch { return json({ error: "Submission request is invalid.", code: "INVALID_REQUEST" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "floorPlanRevision,idempotencyKey,jobRevision") {
    return json({ error: "Submission request is invalid.", code: "INVALID_REQUEST" }, { status: 400 });
  }
  const value = body as { jobRevision?: unknown; floorPlanRevision?: unknown; idempotencyKey?: unknown };
  if (!Number.isInteger(value.jobRevision) || Number(value.jobRevision) < 0 || Number(value.jobRevision) > 2_147_483_647
    || !Number.isInteger(value.floorPlanRevision) || Number(value.floorPlanRevision) < 0 || Number(value.floorPlanRevision) > 2_147_483_647
    || typeof value.idempotencyKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.idempotencyKey)) {
    return json({ error: "Submission request is invalid.", code: "INVALID_REQUEST" }, { status: 400 });
  }
  let result;
  try { result = await deps.service.submit(principal, jobId, { jobRevision: Number(value.jobRevision), floorPlanRevision: Number(value.floorPlanRevision), idempotencyKey: value.idempotencyKey }, trustedClientIp(request.headers)); }
  catch { return json({ error:"Submission could not be started because the service is temporarily unavailable.",code:"SUBMISSION_UNAVAILABLE" },{status:503}); }
  if (result.outcome === "accepted") {
    const scope={companyId:principal.companyId,jobId,requestId:result.requestId};onAcceptedDemo?.(scope);
    if (!deps.completeImmediately) return json({ status: result.status, replayed: result.replayed, destination: `/partner/jobs/${jobId}` }, { status: 202 });
    let completed:PartnerSubmissionView|null=null;
    try { completed=await deps.completeImmediately(scope,()=>deps.service.status(principal,jobId),request.signal); }
    catch { try { completed=await deps.service.status(principal,jobId); } catch { /* bounded failure response below */ } }
    if (completed?.state === "SUCCEEDED") return json({ status:completed,replayed:result.replayed,destination:`/partner/jobs/${jobId}` },{status:200});
    if(completed?.state==="QUEUED"||completed?.state==="PROCESSING")return json({status:completed,replayed:result.replayed,destination:`/partner/jobs/${jobId}`},{status:202});
    return json({error:"Submission unsuccessful. Contact the Insulmax team directly.",code:"SUBMISSION_FAILED",status:completed,destination:`/partner/jobs/${jobId}`},{status:502});
  }
  if (result.outcome === "not_found") return json({ error: "Job not found.", code: "NOT_FOUND" }, { status: 404 });
  if (result.outcome === "unavailable") return json({ error: "Submission is not available yet. Your draft is still editable.", code: "SUBMISSION_UNAVAILABLE" }, { status: 503 });
  if (result.outcome === "rate_limited") return json({ error: "Too many submission attempts. Wait a few minutes and try again.", code: "RATE_LIMITED" }, { status: 429, headers: { "retry-after": "300" } });
  if (result.outcome === "stale") return json({ error: "This draft changed. Reload before submitting.", code: "STALE_REVISION", currentJobRevision: result.currentJobRevision, currentFloorPlanRevision: result.currentFloorPlanRevision }, { status: 409 });
  if (result.outcome === "not_ready") return json({ error: "Finish the highlighted readiness items before submitting.", code: result.code }, { status: 422 });
  if (result.outcome === "ambiguous") return json({ error: "Submission status could not be confirmed. Check this job before editing or trying again.", code: "SUBMISSION_STATUS_UNAVAILABLE" }, { status: 503 });
  return json({ error: "This job is already frozen or the submission request does not match.", code: "SUBMISSION_CONFLICT" }, { status: 409 });
}
