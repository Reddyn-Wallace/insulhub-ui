import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { JobLinkTarget } from "./job-link";
import { JobLinkError } from "./job-link";

export function linkIdentity(target: JobLinkTarget) {
  return JSON.stringify([target.id, target.jobNumber, target.customerName, target.address.street, target.address.suburb, target.address.city, target.address.postcode]);
}
export function jobLinkPreview(companyId: string, jobId: string, revision: number, target: JobLinkTarget, secret: string, expiry = Date.now() + 600_000) {
  if (secret.length < 32) throw new JobLinkError("UNAVAILABLE", 503);
  const body = JSON.stringify(["partner-job-link-v1", companyId, jobId, revision, linkIdentity(target), expiry]);
  return `${expiry}.${createHmac("sha256", secret).update(body).digest("hex")}`;
}
export function verifyJobLinkPreview(token: unknown, companyId: string, jobId: string, revision: number, target: JobLinkTarget, secret: string) {
  if (typeof token !== "string" || !/^\d{13}\.[a-f0-9]{64}$/.test(token)) throw new JobLinkError("STALE", 409);
  const expiry = Number(token.split(".")[0]);
  if (expiry < Date.now() || expiry > Date.now() + 600_000) throw new JobLinkError("STALE", 409);
  const expected = jobLinkPreview(companyId, jobId, revision, target, secret, expiry);
  if (!timingSafeEqual(Buffer.from(token), Buffer.from(expected))) throw new JobLinkError("STALE", 409);
}
