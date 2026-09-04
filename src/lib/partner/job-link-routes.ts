import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth, tokenFromRequest } from "@/lib/insulhub-auth";
import { allowedPartnerOrigins, verifyPartnerRequestHost, withPartnerNoStore } from "./security";
import { ensurePartnerOpsRole, getPartnerOpsPool } from "./db";
import { JobLinkError, type JobLinkTarget } from "./job-link";
import { PartnerJobLinkRepository } from "./job-link-repository";
import { LegacyJobStatusReader } from "./legacy/job-status";
import { jobLinkPreview, verifyJobLinkPreview } from "./job-link-preview";
import { isUuid } from "./operations";
import { readBody } from "./operations-routes";

export type JobLinkDependencies = {
  origins: ReadonlySet<string>; secret: string;
  verify: (request: NextRequest) => Promise<Response | null>;
  repository: Pick<PartnerJobLinkRepository, "list" | "lookup" | "commit" | "refresh" | "investigationRequired" | "commitInvestigated">;
  reader: (token: string) => { read: (identifier: string) => Promise<JobLinkTarget> };
};
const json = (body: unknown, status = 200) => withPartnerNoStore(NextResponse.json(body, { status }));
export async function partnerJobLinkRoute(request: Request, companyId?: string, jobId?: string, injected?: JobLinkDependencies) {
  try {
    const origins = injected?.origins ?? allowedPartnerOrigins();
    const url = new URL(request.url);
    const host = request.headers.get("host")?.toLowerCase() ?? url.host.toLowerCase();
    const forwardedHost = request.headers.get("x-forwarded-host")?.toLowerCase();
    const origin = [...origins].find(item => new URL(item).host.toLowerCase() === host);
    if (!origin || (forwardedHost && forwardedHost !== host) || (!injected && !verifyPartnerRequestHost(request.headers))
      || (request.method !== "GET" && !origins.has(request.headers.get("origin") ?? ""))) return json({ error: "Forbidden" }, 403);
    const canonical = new NextRequest(new URL(url.pathname, origin), { headers: request.headers });
    const denied = await (injected?.verify ?? requireInsulhubAuth)(canonical);
    if (denied) return withPartnerNoStore(denied);
    if (!injected) await ensurePartnerOpsRole();
    const repo = injected?.repository ?? new PartnerJobLinkRepository(getPartnerOpsPool());
    if (companyId && !isUuid(companyId) || jobId && !isUuid(jobId)) return json({ error: "Not found" }, 404);
    if (request.method === "GET" && companyId && !jobId) return json({ jobs: await repo.list(companyId) });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const body = await readBody(request);
    const reader = (injected?.reader ?? (token => new LegacyJobStatusReader(token)))(tokenFromRequest(canonical) ?? "");
    if (!companyId && !jobId) {
      // Background check from the normal job screen; no upstream call at all
      // for unrelated jobs, and no client-supplied statuses are accepted.
      if (!body || Object.keys(body).join() !== "legacyId" || typeof body.legacyId !== "string" || !/^[a-f0-9]{24}$/i.test(body.legacyId)) throw new JobLinkError("INVALID", 400);
      const legacyId = body.legacyId.toLowerCase();
      if (!await repo.lookup(legacyId)) return json({ linked: false });
      const observedAt = new Date().toISOString();
      const target = await reader.read(legacyId);
      target.status.checkedAt = observedAt;
      await repo.refresh(target);
      return json({ linked: true, checkedAt: observedAt });
    }
    if (!companyId || !jobId) throw new JobLinkError("NOT_FOUND", 404);
    const job = (await repo.list(companyId)).find(item => item.id === jobId);
    if (!job) throw new JobLinkError("NOT_FOUND", 404);
    if (!body || Object.keys(body).some(key => !["action", "identifier", "preview", "confirmed", "investigationConfirmed"].includes(key))) throw new JobLinkError("INVALID", 400);
    if (body.action === "refresh") {
      if (!job.linkedStatus || !job.legacyId || Object.keys(body).length !== 1) throw new JobLinkError("CONFLICT", 409);
      const observedAt = new Date().toISOString();
      const target = await reader.read(job.legacyId);
      target.status.checkedAt = observedAt;
      await repo.refresh(target);
      return json({ ok: true });
    }
    if (!["preview", "confirm"].includes(String(body.action)) || typeof body.identifier !== "string") throw new JobLinkError("INVALID", 400);
    const observedAt = new Date().toISOString();
    const target = await reader.read(body.identifier);
    target.status.checkedAt = observedAt;
    const resolutionRequired=await repo.investigationRequired(companyId,jobId);
    const secret = injected?.secret ?? process.env.PARTNER_AUTH_SECRET ?? "";
    if (body.action === "preview") {
      if (job.linkedStatus || !["FAILED_RETRYABLE","RECONCILIATION_REQUIRED","SUBMITTED"].includes(job.submissionState)) throw new JobLinkError("CONFLICT", 409);
      return json({ target, preview: jobLinkPreview(companyId, jobId, job.revision, target, secret), resolutionRequired });
    }
    if (body.confirmed !== true) throw new JobLinkError("CONFIRM", 400);
    if(resolutionRequired&&body.investigationConfirmed!==true)throw new JobLinkError("CONFIRM",400);
    verifyJobLinkPreview(body.preview, companyId, jobId, job.revision, target, secret);
    if(resolutionRequired)await repo.commitInvestigated(companyId,jobId,job.revision,target);else await repo.commit(companyId, jobId, job.revision, target);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof JobLinkError) return json({ code: error.code, error: error.message }, error.status);
    return json({ code: "UNAVAILABLE", error: "Linking is unavailable. No new InsulHub job has been created." }, 503);
  }
}
