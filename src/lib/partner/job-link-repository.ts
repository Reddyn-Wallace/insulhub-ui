import "server-only";
import type { PartnerSql } from "./db";
import { JobLinkError, type JobLinkTarget, type LinkablePartnerJob } from "./job-link";
import { PARTNER_SETTINGS_SERVICE_ID } from "./settings-service";

// SQL link functions retain the legacy invoice field. The portal no longer
// observes it, so send unknown rather than inventing an invoicing status.
export class PartnerJobLinkRepository {
  constructor(private readonly sql: PartnerSql) {}
  private async call<T>(sql: string, args: unknown[]): Promise<T> {
    try { return (await this.sql.query<{ result: T }>(sql, [PARTNER_SETTINGS_SERVICE_ID, ...args])).rows[0].result; }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "LINK_NOT_FOUND") throw new JobLinkError("NOT_FOUND", 404);
      if (message === "LINK_STALE") throw new JobLinkError("STALE", 409);
      if (message.startsWith("LINK_") || (error as { code?: string })?.code === "23505") throw new JobLinkError("CONFLICT", 409);
      throw error;
    }
  }
  list(companyId: string) {
    return this.call<LinkablePartnerJob[]>("SELECT public.partner_ops_job_links($1,$2) result", [companyId]);
  }
  lookup(legacyId: string) {
    return this.call<{ companyId: string; jobId: string } | null>("SELECT public.partner_ops_link_lookup($1,$2) result", [legacyId]);
  }
  commit(companyId: string, jobId: string, revision: number, target: JobLinkTarget) {
    const { checkedAt, ...status } = target.status;
    return this.call<boolean>("SELECT public.partner_ops_job_link($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz) result", [companyId, jobId, revision, target.id, target.jobNumber, JSON.stringify({ ...status, invoiceRecorded: null }), checkedAt]);
  }
  investigationRequired(companyId:string,jobId:string){
    return this.call<"NO_EFFECT_CONFIRMED"|"RETURNED_IDENTITY"|null>("SELECT public.partner_ops_job_link_investigation_required($1,$2,$3) result",[companyId,jobId]);
  }
  commitInvestigated(companyId:string,jobId:string,revision:number,target:JobLinkTarget){
    const {checkedAt,...status}=target.status;
    return this.call<boolean>("SELECT public.partner_ops_job_link_investigated($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz) result",[companyId,jobId,revision,target.id,target.jobNumber,JSON.stringify({ ...status, invoiceRecorded: null }),checkedAt]);
  }
  refresh(target: JobLinkTarget) {
    const { checkedAt, ...status } = target.status;
    return this.call<boolean>("SELECT public.partner_ops_job_status($1,$2,$3::jsonb,$4::timestamptz) result", [target.id, JSON.stringify({ ...status, invoiceRecorded: null }), checkedAt]);
  }
}
