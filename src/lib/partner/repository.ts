import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PartnerSql } from "./db";
import type { LeadDraftFields } from "./draft";
import { deleteDraftRecord } from "./draft-deletion";
import type { LinkedJobStatus } from "./job-link";
import { calculateQuote, partnerQuoteTerms, createQuoteDraft, normalizeQuoteDefaults, normalizeQuoteDraft, PRODUCT_QUOTE_DEFAULTS, type QuoteCalculation, type QuoteDefaults, type QuoteDefaultsSnapshot, type QuoteDraft } from "./quote";

export type PartnerPrincipal = { readonly userId: string; readonly principalType: "PARTNER"; readonly companyId: string };
export type InternalPrincipal = { readonly userId: string; readonly principalType: "INTERNAL"; readonly companyId: null };
export type AuthenticatedPrincipal = PartnerPrincipal | InternalPrincipal;

export class DraftCreationConflict extends Error {}

export type PartnerSubmissionState = "DRAFT" | "QUEUED" | "CREATING_LEAD" | "UPDATING_QUOTE" | "ATTACHING_PLANS" | "SUBMITTED" | "FAILED_RETRYABLE" | "RECONCILIATION_REQUIRED";
export type PartnerTrackingFact = "EBA_COMPLETED" | "INSTALL_DATE_SET" | "JOB_COMPLETED";

export interface PartnerViewer {
  role?: "ADMIN" | "SALES";
  userId: string;
  userName: string;
  companyId: string;
  companyName: string;
}

export interface PartnerJobRecord extends LeadDraftFields {
  id: string;
  companyId: string;
  clientReference: string;
  finalQuoteNumber?: string | null;
  legacyJobNumber?: number | null;
  submissionState: PartnerSubmissionState;
  revision: number;
  trackingFacts: PartnerTrackingFact[];
  linkedStatus?: LinkedJobStatus | null;
  quote: QuoteDraft;
  quoteCalculation: QuoteCalculation;
  createdAt: string;
  submittedAt?: string | null;
  updatedAt: string;
}

export type PartnerJobView = Omit<PartnerJobRecord, "companyId">;

export function partnerJobView(job: PartnerJobRecord): PartnerJobView {
  return {
    id: job.id, clientReference: job.clientReference, submissionState: job.submissionState,
    finalQuoteNumber: job.finalQuoteNumber ?? null, legacyJobNumber: job.legacyJobNumber ?? null,
    customerName: job.customerName, customerMobile: job.customerMobile,
    customerEmail: job.customerEmail, siteAddress: job.siteAddress, leadSources: job.leadSources,
    notes: job.notes, revision: job.revision, trackingFacts: job.trackingFacts, linkedStatus: job.linkedStatus ?? null,
    quote: job.quote, quoteCalculation: job.quoteCalculation,
    createdAt: job.createdAt, submittedAt: job.submittedAt ?? null, updatedAt: job.updatedAt,
  };
}

type JobRow = {
  id: string; company_id: string; client_reference: string; submission_state: PartnerSubmissionState;
  final_quote_number: string | null; legacy_job_number: number | string | null;
  customer_name: string;
  customer_mobile: string; customer_email: string; site_address: LeadDraftFields["siteAddress"];
  lead_sources: LeadDraftFields["leadSources"]; notes: string; revision: number;
  fact_type: PartnerTrackingFact | null; submitted_at: Date | string | null; created_at: Date | string; updated_at: Date | string;
  quote_data: QuoteDraft | null; quote_defaults_snapshot: QuoteDefaultsSnapshot | null;
  quote_default_wall_rate_cents: number | null; quote_default_ceiling_rate_cents: number | null;
  quote_default_deposit_basis_points: number; quote_default_consent_fee_cents: number;
  quote_default_extras: QuoteDefaults["extras"]; company_quote_defaults_revision: number;
  link_checked_at: Date | string | null; link_eba_completed: boolean | null;
  link_install_date: string | null; link_job_completed: boolean | null;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function jobsFromRows(rows: JobRow[]): PartnerJobRecord[] {
  const jobs = new Map<string, PartnerJobRecord>();
  for (const row of rows) {
    let job = jobs.get(row.id);
    if (!job) {
      const defaultsInput: QuoteDefaults = {
        wallRateCents: row.quote_default_wall_rate_cents,
        ceilingRateCents: row.quote_default_ceiling_rate_cents,
        depositBasisPoints: Number(row.quote_default_deposit_basis_points ?? PRODUCT_QUOTE_DEFAULTS.depositBasisPoints),
        consentFeeCents: Number(row.quote_default_consent_fee_cents ?? PRODUCT_QUOTE_DEFAULTS.consentFeeCents),
        extras: row.quote_default_extras ?? PRODUCT_QUOTE_DEFAULTS.extras.map((extra) => ({ ...extra })),
        revision: Number(row.company_quote_defaults_revision ?? 0),
      };
      const defaults = normalizeQuoteDefaults(defaultsInput);
      if (!defaults.ok) throw new Error("Stored quote defaults are invalid");
      const fallbackQuote = createQuoteDraft(defaults.value, `LOCAL-${row.client_reference}`, iso(row.created_at));
      const storedQuote = row.quote_data ? normalizeQuoteDraft(row.quote_data) : null;
      if (storedQuote && !storedQuote.ok) throw new Error("Stored quote data is invalid");
      const savedQuote = storedQuote?.value ?? fallbackQuote;
      const quote = row.submission_state === "DRAFT" ? partnerQuoteTerms(savedQuote) : savedQuote;
      job = {
        id: row.id, companyId: row.company_id, clientReference: row.client_reference,
        submissionState: row.submission_state,
        finalQuoteNumber: row.final_quote_number ?? null, legacyJobNumber: row.legacy_job_number == null ? null : Number(row.legacy_job_number),
        customerName: row.customer_name, customerMobile: row.customer_mobile, customerEmail: row.customer_email,
        siteAddress: row.site_address ?? { street: "", suburb: "", city: "", postcode: "" },
        leadSources: row.lead_sources ?? [], notes: row.notes, revision: row.revision, trackingFacts: [],
        quote, quoteCalculation: calculateQuote(quote),
        createdAt: iso(row.created_at), submittedAt: row.submitted_at ? iso(row.submitted_at) : null, updatedAt: iso(row.updated_at),
        linkedStatus: row.link_checked_at ? { checkedAt: iso(row.link_checked_at), ebaCompleted: row.link_eba_completed,
          installDate: row.link_install_date, jobCompleted: row.link_job_completed } : null,
      };
      jobs.set(row.id, job);
    }
    if (row.fact_type && !job.trackingFacts.includes(row.fact_type)) job.trackingFacts.push(row.fact_type);
  }
  return [...jobs.values()];
}

const JOB_SELECT = `SELECT j.id, j.company_id, j.client_reference, j.submission_state,
  j.final_quote_number, j.legacy_job_number, j.customer_name, j.customer_mobile, j.customer_email,
  j.site_address, j.lead_sources, j.notes, j.quote_data, j.quote_defaults_snapshot,
  j.revision, j.created_at, j.submitted_at, j.updated_at, f.fact_type,
  l.checked_at AS link_checked_at, l.eba_completed AS link_eba_completed,
  to_char(l.install_date,'YYYY-MM-DD') AS link_install_date, l.job_completed AS link_job_completed,
  c.quote_default_wall_rate_cents, c.quote_default_ceiling_rate_cents,
  c.quote_default_deposit_basis_points, c.quote_default_consent_fee_cents,
  c.quote_default_extras, c.quote_defaults_revision AS company_quote_defaults_revision
  FROM partner_jobs j
  JOIN partner_companies c ON c.id = j.company_id
  LEFT JOIN partner_manual_job_links l ON l.company_id = j.company_id AND l.job_id = j.id
  LEFT JOIN partner_tracking_facts f ON f.company_id = j.company_id AND f.job_id = j.id
    AND f.fact_type IN ('EBA_COMPLETED','INSTALL_DATE_SET','JOB_COMPLETED')`;

export type UpdateDraftResult =
  | { outcome: "updated"; job: PartnerJobRecord }
  | { outcome: "not_found" }
  | { outcome: "not_draft" }
  | { outcome: "stale"; currentRevision: number };

export class PartnerRepository {
  constructor(private readonly sql: PartnerSql) {}
  deleteDraft(principal: PartnerPrincipal, jobId: string, revision: number) { return deleteDraftRecord(this.sql, principal, jobId, revision); }

  async getViewer(principal: PartnerPrincipal): Promise<PartnerViewer | null> {
    const result = await this.sql.query<{ user_id: string; user_name: string; company_id: string; company_name: string; partner_role: "ADMIN"|"SALES" }>(
      `SELECT u.id AS user_id, u.name AS user_name, c.id AS company_id, c.name AS company_name, u.partner_role
       FROM partner_users u JOIN partner_companies c ON c.id = u.company_id AND c.is_active = true
       WHERE u.id = $1 AND u.company_id = $2 AND u.principal_type = 'PARTNER' AND u.disabled_at IS NULL`,
      [principal.userId, principal.companyId],
    );
    const row = result.rows[0];
    return row ? { role:row.partner_role, userId: row.user_id, userName: row.user_name, companyId: row.company_id, companyName: row.company_name } : null;
  }

  async getQuoteDefaults(principal: PartnerPrincipal): Promise<QuoteDefaults | null> {
    const result = await this.sql.query<{
      quote_default_wall_rate_cents: number | null; quote_default_ceiling_rate_cents: number | null;
      quote_default_deposit_basis_points: number; quote_default_consent_fee_cents: number;
      quote_default_extras: QuoteDefaults["extras"]; quote_defaults_revision: number;
    }>(`SELECT quote_default_wall_rate_cents, quote_default_ceiling_rate_cents,
       quote_default_deposit_basis_points, quote_default_consent_fee_cents,
       quote_default_extras, quote_defaults_revision
       FROM partner_companies WHERE id = $1 AND is_active = true`, [principal.companyId]);
    const row = result.rows[0];
    if (!row) return null;
    const defaults = normalizeQuoteDefaults({ wallRateCents: row.quote_default_wall_rate_cents, ceilingRateCents: row.quote_default_ceiling_rate_cents, depositBasisPoints: Number(row.quote_default_deposit_basis_points), consentFeeCents: Number(row.quote_default_consent_fee_cents), extras: row.quote_default_extras, revision: Number(row.quote_defaults_revision) });
    if (!defaults.ok) throw new Error("Stored quote defaults are invalid");
    return defaults.value;
  }

  private async initializeMissingQuotes(principal: PartnerPrincipal, rows: JobRow[]): Promise<boolean> {
    const missingIds = [...new Set(rows.filter((row) => row.quote_data === null && row.submission_state === "DRAFT").map((row) => row.id))];
    for (const jobId of missingIds) {
      const jobRows = rows.filter((row) => row.id === jobId);
      const fallback = jobsFromRows(jobRows)[0];
      if (!fallback) continue;
      await this.sql.query(`UPDATE partner_jobs SET
        quote_data = $3::jsonb, quote_initialized_at = now(), quote_defaults_revision = $4,
        quote_defaults_snapshot = $5::jsonb, quote_total_cents = $6
        WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL AND quote_data IS NULL AND submission_state = 'DRAFT'`,
        [principal.companyId, jobId, JSON.stringify(fallback.quote), fallback.quote.defaultsSnapshot.revision, JSON.stringify(fallback.quote.defaultsSnapshot), fallback.quoteCalculation.totalCents]);
    }
    return missingIds.length > 0;
  }

  async listJobs(principal: PartnerPrincipal, filters: { search?: string; submissionState?: PartnerSubmissionState } = {}): Promise<PartnerJobRecord[]> {
    const values: unknown[] = [principal.companyId];
    const predicates = ["j.company_id = $1", "j.deleted_at IS NULL"];
    if (filters.search) {
      values.push(`%${filters.search.toLowerCase()}%`);
      predicates.push(`(lower(j.customer_name) LIKE $${values.length} OR lower(j.client_reference) LIKE $${values.length} OR lower(j.final_quote_number) LIKE $${values.length} OR CAST(j.legacy_job_number AS text) LIKE $${values.length})`);
    }
    if (filters.submissionState) {
      values.push(filters.submissionState);
      predicates.push(`j.submission_state = $${values.length}`);
    }
    const query = `${JOB_SELECT} WHERE ${predicates.join(" AND ")} ORDER BY j.updated_at DESC, j.id, f.recorded_at`;
    let result = await this.sql.query<JobRow>(query, values);
    if (await this.initializeMissingQuotes(principal, result.rows)) result = await this.sql.query<JobRow>(query, values);
    return jobsFromRows(result.rows);
  }

  async getJob(principal: PartnerPrincipal, jobId: string): Promise<PartnerJobRecord | null> {
    const query = `${JOB_SELECT} WHERE j.company_id = $1 AND j.id = $2 AND j.deleted_at IS NULL ORDER BY f.recorded_at`;
    let result = await this.sql.query<JobRow>(query, [principal.companyId, jobId]);
    if (await this.initializeMissingQuotes(principal, result.rows)) result = await this.sql.query<JobRow>(query, [principal.companyId, jobId]);
    return jobsFromRows(result.rows)[0] ?? null;
  }

  async createDraft(principal: PartnerPrincipal, input: Partial<LeadDraftFields> & { quote?: QuoteDraft; clientReference?: string }, creationKey?: string): Promise<PartnerJobRecord> {
    const keyHash = creationKey ? createHash("sha256").update(`${principal.companyId}:${creationKey}`).digest("hex") : null;
    const payloadHash = keyHash ? createHash("sha256").update(JSON.stringify(input)).digest("hex") : null;
    const clientReference = input.clientReference ?? `DRAFT-${randomUUID().slice(0, 8).toUpperCase()}`;
    const defaults = await this.getQuoteDefaults(principal);
    if (!defaults) throw new Error("Partner company not found");
    const generated = createQuoteDraft(defaults, `LOCAL-${clientReference}`, new Date().toISOString());
    const normalized = input.quote ? normalizeQuoteDraft(partnerQuoteTerms(input.quote), { quoteNumber: generated.quoteNumber, quoteDate: generated.quoteDate, defaultsSnapshot: generated.defaultsSnapshot }) : { ok: true as const, value: generated };
    if (!normalized.ok) throw new Error("Quote input was not normalized");
    const quoteCalculation = calculateQuote(normalized.value);
    const result = await this.sql.query<{ id: string }>(
      `INSERT INTO partner_jobs
        (company_id, created_by_user_id, client_reference, billing_model_snapshot, customer_name,
         customer_mobile, customer_email, site_address, lead_sources, notes, quote_data,
         quote_initialized_at, quote_defaults_revision, quote_defaults_snapshot, quote_total_cents,
         draft_create_key_hash, draft_create_payload_hash)
       SELECT c.id, $2, $3, 'INSULHUB_BILLED', $4, $5, $6, $7::jsonb, $8::jsonb, $9,
         $10::jsonb, now(), $11::integer, $12::jsonb, $13::bigint, $14, $15
       FROM partner_companies c WHERE c.id = $1 AND c.is_active = true
       ON CONFLICT (company_id,draft_create_key_hash) DO NOTHING RETURNING id`,
      [principal.companyId, principal.userId, clientReference, input.customerName ?? "", input.customerMobile ?? "", input.customerEmail ?? "", JSON.stringify(input.siteAddress ?? { street: "", suburb: "", city: "", postcode: "" }), JSON.stringify(input.leadSources ?? []), input.notes ?? "", JSON.stringify(normalized.value), normalized.value.defaultsSnapshot.revision, JSON.stringify(normalized.value.defaultsSnapshot), quoteCalculation.totalCents, keyHash, payloadHash],
    );
    let id = result.rows[0]?.id;
    if (keyHash) {
      const existing = await this.sql.query<{ id: string; draft_create_payload_hash: string; deleted_at: unknown }>("SELECT id,draft_create_payload_hash,deleted_at FROM partner_jobs WHERE company_id=$1 AND draft_create_key_hash=$2", [principal.companyId,keyHash]);
      if (existing.rows[0]?.deleted_at) throw new DraftCreationConflict("This draft has been deleted");
      if (existing.rows[0]?.draft_create_payload_hash !== payloadHash) throw new DraftCreationConflict("Creation key already belongs to a different request");
      id = existing.rows[0]?.id;
    }
    if (!id) throw new Error("Partner company not found");
    const job = await this.getJob(principal, id);
    if (!job) throw new Error("Draft could not be loaded");
    return job;
  }

  async updateDraft(principal: PartnerPrincipal, jobId: string, revision: number, input: LeadDraftFields & { quote?: QuoteDraft }): Promise<UpdateDraftResult> {
    const currentJob = await this.getJob(principal, jobId);
    if (!currentJob) return { outcome: "not_found" };
    if (currentJob.submissionState !== "DRAFT") return { outcome: "not_draft" };
    const normalized = input.quote ? normalizeQuoteDraft(partnerQuoteTerms(input.quote), { quoteNumber: currentJob.quote.quoteNumber, quoteDate: currentJob.quote.quoteDate, defaultsSnapshot: currentJob.quote.defaultsSnapshot }) : { ok: true as const, value: partnerQuoteTerms(currentJob.quote) };
    if (!normalized.ok) throw new Error("Quote input was not normalized");
    const quoteCalculation = calculateQuote(normalized.value);
    const updated = await this.sql.query<{ id: string }>(
      `UPDATE partner_jobs SET customer_name = $4, customer_mobile = $5, customer_email = $6,
         site_address = $7::jsonb, lead_sources = $8::jsonb, notes = $9, quote_data = $10::jsonb,
         quote_total_cents = $11::bigint, quote_initialized_at = COALESCE(quote_initialized_at, now()),
         quote_defaults_revision = $12::integer, quote_defaults_snapshot = $13::jsonb,
         revision = revision + 1, updated_at = now()
       WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL AND revision = $3 AND submission_state = 'DRAFT' RETURNING id`,
      [principal.companyId, jobId, revision, input.customerName, input.customerMobile, input.customerEmail, JSON.stringify(input.siteAddress), JSON.stringify(input.leadSources), input.notes, JSON.stringify(normalized.value), quoteCalculation.totalCents, normalized.value.defaultsSnapshot.revision, JSON.stringify(normalized.value.defaultsSnapshot)],
    );
    if (updated.rows[0]) {
      const job = await this.getJob(principal, updated.rows[0].id);
      return job ? { outcome: "updated", job } : { outcome: "not_found" };
    }
    const current = await this.sql.query<{ submission_state: PartnerSubmissionState; revision: number }>("SELECT submission_state, revision FROM partner_jobs WHERE company_id = $1 AND id = $2 AND deleted_at IS NULL", [principal.companyId, jobId]);
    if (!current.rows[0]) return { outcome: "not_found" };
    if (current.rows[0].submission_state !== "DRAFT") return { outcome: "not_draft" };
    return { outcome: "stale", currentRevision: current.rows[0].revision };
  }

  async getDrawing(principal: PartnerPrincipal, jobId: string, drawingId: string): Promise<{ id: string; jobId: string; revision: number } | null> {
    const result = await this.sql.query<{ id: string; job_id: string; revision: number }>(
      `SELECT d.id, d.job_id, d.revision FROM partner_site_plan_drawings d
       JOIN partner_jobs j ON j.company_id = d.company_id AND j.id = d.job_id AND j.deleted_at IS NULL
       WHERE d.company_id = $1 AND d.job_id = $2 AND d.id = $3`,
      [principal.companyId, jobId, drawingId],
    );
    return result.rows[0] ? { id: result.rows[0].id, jobId: result.rows[0].job_id, revision: result.rows[0].revision } : null;
  }
}

export class PartnerOpsRepository {
  constructor(private readonly sql: PartnerSql) {}
  async listCompanies(principal: InternalPrincipal): Promise<Array<{ id: string; name: string; billingModel: string }>> {
    if (principal.principalType !== "INTERNAL") return [];
    const result = await this.sql.query<{ id: string; name: string; billing_model: string }>("SELECT id, name, billing_model FROM partner_companies ORDER BY name");
    return result.rows.map((row) => ({ id: row.id, name: row.name, billingModel: row.billing_model }));
  }
}
