import "server-only";
import type { PartnerSql } from "./db";
import { partnerDemoModeEnabled, withPartnerDemoDatabaseLock } from "./demo";
import type { PartnerPrincipal } from "./repository";
import type { PartnerNoteFeed, PartnerNoteSummary } from "./note-updates";

export class PartnerNoteRepository {
  constructor(private readonly sql: PartnerSql, private readonly demo = partnerDemoModeEnabled()) {}

  private async demoAuthorised(principal: PartnerPrincipal): Promise<boolean> {
    const result = await this.sql.query("SELECT u.id FROM partner_users u JOIN partner_companies c ON c.id=u.company_id WHERE u.id=$1 AND u.company_id=$2 AND u.principal_type='PARTNER' AND u.disabled_at IS NULL AND c.is_active=true", [principal.userId, principal.companyId]);
    return result.rows.length > 0;
  }

  async feed(principal: PartnerPrincipal, jobId: string, seen: number | null = null, locked = false): Promise<PartnerNoteFeed | null> {
    if (!this.demo) return (await this.sql.query<{ feed: PartnerNoteFeed | null }>("SELECT public.partner_note_feed($1,$2,$3,$4) feed", [principal.userId, principal.companyId, jobId, seen])).rows[0]?.feed ?? null;
    if (!locked && partnerDemoModeEnabled()) return withPartnerDemoDatabaseLock(() => this.feed(principal, jobId, seen, true));
    if (!await this.demoAuthorised(principal)) return null;
    const scope = [principal.companyId, jobId, principal.userId];
    if (!(await this.sql.query("SELECT id FROM partner_jobs WHERE company_id=$1 AND id=$2 AND deleted_at IS NULL", scope.slice(0, 2))).rows.length) return null;
    const rows = (await this.sql.query<{sequence:number;patch:{description:string;authorName?:string};created_at:Date|string}>("SELECT sequence,patch,created_at FROM partner_job_amendments WHERE company_id=$1 AND job_id=$2 ORDER BY sequence", scope.slice(0, 2))).rows;
    const updates = rows.map(row => ({sequence:row.sequence, description:row.patch.description, authorName:row.patch.authorName || "InsulHub team", createdAt:new Date(row.created_at).toISOString()}));
    const latestSequence = updates.at(-1)?.sequence ?? 0;
    let readSequence = (await this.sql.query<{seen_sequence:number}>("SELECT seen_sequence FROM partner_note_reads WHERE company_id=$1 AND job_id=$2 AND user_id=$3", scope)).rows[0]?.seen_sequence ?? 0;
    if (seen !== null) {
      if (!Number.isSafeInteger(seen) || seen < 0 || seen > latestSequence) throw Error("UPDATE_INVALID");
      readSequence = Math.max(seen, readSequence);
      await this.sql.query("INSERT INTO partner_note_reads(company_id,job_id,user_id,seen_sequence) VALUES($1,$2,$3,$4) ON CONFLICT(company_id,job_id,user_id) DO UPDATE SET seen_sequence=EXCLUDED.seen_sequence,updated_at=now()", [...scope, readSequence]);
    }
    return { updates, latestSequence, readSequence };
  }

  async summaries(principal: PartnerPrincipal, locked = false): Promise<PartnerNoteSummary[]> {
    if (!this.demo) return (await this.sql.query<{ feed: { jobs: PartnerNoteSummary[] } | null }>("SELECT public.partner_note_feed($1,$2,NULL,NULL) feed", [principal.userId, principal.companyId])).rows[0]?.feed?.jobs ?? [];
    if (!locked && partnerDemoModeEnabled()) return withPartnerDemoDatabaseLock(() => this.summaries(principal, true));
    if (!await this.demoAuthorised(principal)) return [];
    const jobs = (await this.sql.query<{id:string}>("SELECT id FROM partner_jobs WHERE company_id=$1 AND deleted_at IS NULL", [principal.companyId])).rows;
    const summaries: PartnerNoteSummary[] = [];
    for (const job of jobs) {
      const feed = await this.feed(principal, job.id, null, true);
      if (feed) summaries.push({ id: job.id, latestSequence: feed.latestSequence, readSequence: feed.readSequence });
    }
    return summaries;
  }
}
