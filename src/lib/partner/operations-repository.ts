import "server-only";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { partnerDemoModeEnabled, withPartnerDemoAtomicOperation, withPartnerDemoDatabaseLock } from "./demo";
import type { PartnerSql } from "./db";
import { writePartnerAuditEvent } from "./audit";
import type { InternalPrincipal } from "./repository";
import type { AmendmentInput, BillingModel, CompanyInput, InvoiceInput, OpsFactType, OpsRole, PartnerUserInput, SettlementInput } from "./operations";

export type OpsDashboardRow = { jobId: string; companyId: string; companyName: string; customerName: string; clientReference: string; submissionState: string; billingModel: BillingModel; latestMilestone: string | null; settlementStatus: string | null };
export type PartnerTrackingProjection = { id: string; clientReference: string; billingModel: BillingModel; milestones: Record<string, { recordedAt: string; effectiveAt?: string; installDate?: string }>; amendments: Array<{ sequence: number; description: string; contractDeltaCents?: number; createdAt: string }>; invoice: { reference: string; amountCents: number; sentAt: string; revision: number } | null; settlement: { grossCents: number; commissionCents: number; netDueCents: number; status: string; settledAt: string | null; revision: number } | null };

function iso(value: Date | string | null): string | null { return value === null ? null : (value instanceof Date ? value : new Date(value)).toISOString(); }
function dateOnly(value: Date | string | null): string | null { return value === null ? null : (value instanceof Date ? value.toISOString() : new Date(value).toISOString()).slice(0, 10); }
function apiError(code: string): never { throw Object.assign(new Error(code), { code }); }
const productionCodes = new Set(["OPS_FORBIDDEN", "OPS_NOT_FOUND", "OPS_STALE_REVISION", "OPS_JOB_NOT_ACTIONABLE", "OPS_INVOICE_REQUIRED", "OPS_TERMINAL", "OPS_INVALID_SETTLEMENT", "OPS_CANCELLED", "OPS_DUPLICATE_FACT"]);

export class PartnerOperationsRepository {
  private factClock = 0;
  constructor(private readonly sql: PartnerSql, private readonly demo = partnerDemoModeEnabled()) {}

  private async nextDemoFactRecordedAt(companyId:string,jobId:string): Promise<string> { const latest=await this.sql.query<{recorded_at:Date|string|null}>("SELECT max(recorded_at) recorded_at FROM partner_tracking_facts WHERE company_id=$1 AND job_id=$2",[companyId,jobId]); const prior=latest.rows[0]?.recorded_at; const priorMs=prior ? new Date(prior).getTime()+1 : 0; this.factClock=Math.max(Date.now(),this.factClock+1,priorMs); return new Date(this.factClock).toISOString(); }

  private async actor(actor: InternalPrincipal, allowed: readonly OpsRole[]): Promise<OpsRole> {
    const query = await this.sql.query<{ ops_role: OpsRole }>(`SELECT ops_role FROM partner_users WHERE id=$1 AND principal_type='INTERNAL' AND company_id IS NULL AND disabled_at IS NULL`, [actor.userId]);
    const role = query.rows[0]?.ops_role;
    if (!role || !allowed.includes(role)) apiError("OPS_FORBIDDEN");
    return role;
  }
  private async production<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
      // PostgreSQL errors are untrusted input: expose only exact contract tokens.
      if (error instanceof Error && productionCodes.has(error.message)) apiError(error.message);
      throw error;
    }
  }
  private audit(type:"OPS_COMPANY_CREATED"|"OPS_COMPANY_UPDATED"|"OPS_PARTNER_USER_PROVISIONED"|"OPS_FACT_RECORDED"|"OPS_AMENDMENT_RECORDED"|"OPS_INVOICE_RECORDED"|"OPS_SETTLEMENT_RECORDED",actor:InternalPrincipal,companyId?:string,jobId?:string,subjectUserId?:string){return writePartnerAuditEvent(this.sql,{type,actorUserId:actor.userId,companyId:companyId??null,jobId:jobId??null,subjectUserId:subjectUserId??null,metadata:{outcome:"success"}});}

  async dashboard(actor: InternalPrincipal, readLocked = true): Promise<OpsDashboardRow[]> {
    if (!this.demo) {
      const result = await this.production(()=>this.sql.query<{ job_id:string;company_id:string;company_name:string;customer_name:string;client_reference:string;submission_state:string;billing_model:BillingModel;latest_milestone:string|null;settlement_status:string|null }>("SELECT * FROM public.partner_ops_dashboard($1)", [actor.userId]));
      return result.rows.map((row) => ({ jobId:row.job_id,companyId:row.company_id,companyName:row.company_name,customerName:row.customer_name,clientReference:row.client_reference,submissionState:row.submission_state,billingModel:row.billing_model,latestMilestone:row.latest_milestone,settlementStatus:row.settlement_status }));
    }
    if (readLocked && partnerDemoModeEnabled()) return withPartnerDemoDatabaseLock(()=>this.dashboard(actor,false));
    await this.actor(actor, ["ADMIN", "OPERATIONS", "FINANCE", "VIEWER"]);
    const [jobs,facts,settlements] = await Promise.all([
      this.sql.query<{ job_id:string;company_id:string;company_name:string;customer_name:string;client_reference:string;submission_state:string;billing_model_snapshot:BillingModel }>(`SELECT j.id job_id,j.company_id,c.name company_name,j.customer_name,j.client_reference,j.submission_state,j.billing_model_snapshot FROM partner_jobs j JOIN partner_companies c ON c.id=j.company_id ORDER BY j.updated_at DESC,j.id`),
      this.sql.query<{company_id:string;job_id:string;fact_type:string;recorded_at:Date|string}>("SELECT company_id,job_id,fact_type,recorded_at FROM partner_tracking_facts ORDER BY recorded_at DESC,id DESC"),
      this.sql.query<{company_id:string;job_id:string;settlement_status:string}>("SELECT company_id,job_id,settlement_status FROM partner_job_settlements"),
    ]);
    const latest=new Map<string,string>(); for(const fact of facts.rows){const key=`${fact.company_id}:${fact.job_id}`;if(!latest.has(key))latest.set(key,fact.fact_type);}
    const status=new Map(settlements.rows.map(row=>[`${row.company_id}:${row.job_id}`,row.settlement_status]));
    return jobs.rows.map((row) => ({ jobId:row.job_id,companyId:row.company_id,companyName:row.company_name,customerName:row.customer_name,clientReference:row.client_reference,submissionState:row.submission_state,billingModel:row.billing_model_snapshot,latestMilestone:latest.get(`${row.company_id}:${row.job_id}`)??null,settlementStatus:status.get(`${row.company_id}:${row.job_id}`)??null }));
  }

  async listCompanies(actor:InternalPrincipal){if(!this.demo){const r=await this.production(()=>this.sql.query<{id:string;slug:string;name:string;is_active:boolean;billing_model:BillingModel;revision:number;quote_defaults_revision:number;wall_rate_cents:number|string|null;ceiling_rate_cents:number|string|null;deposit_basis_points:number;consent_fee_cents:number|string;extras:unknown[]}>("SELECT * FROM public.partner_ops_company_list($1)",[actor.userId]));return r.rows.map(x=>({id:x.id,slug:x.slug,name:x.name,isActive:x.is_active,billingModel:x.billing_model,revision:Number(x.revision),quoteDefaults:{wallRateCents:x.wall_rate_cents===null?null:Number(x.wall_rate_cents),ceilingRateCents:x.ceiling_rate_cents===null?null:Number(x.ceiling_rate_cents),depositBasisPoints:Number(x.deposit_basis_points),consentFeeCents:Number(x.consent_fee_cents),extras:x.extras}}));}await this.actor(actor,["ADMIN","OPERATIONS","FINANCE","VIEWER"]);const r=await this.sql.query<{id:string;slug:string;name:string;is_active:boolean;billing_model:BillingModel;revision:number;quote_default_wall_rate_cents:number|null;quote_default_ceiling_rate_cents:number|null;quote_default_deposit_basis_points:number;quote_default_consent_fee_cents:number;quote_default_extras:unknown[]}>("SELECT id,slug,name,is_active,billing_model,revision,quote_default_wall_rate_cents,quote_default_ceiling_rate_cents,quote_default_deposit_basis_points,quote_default_consent_fee_cents,quote_default_extras FROM partner_companies ORDER BY name,id");return r.rows.map(x=>({id:x.id,slug:x.slug,name:x.name,isActive:x.is_active,billingModel:x.billing_model,revision:x.revision,quoteDefaults:{wallRateCents:x.quote_default_wall_rate_cents,ceilingRateCents:x.quote_default_ceiling_rate_cents,depositBasisPoints:x.quote_default_deposit_basis_points,consentFeeCents:x.quote_default_consent_fee_cents,extras:x.quote_default_extras}}));}
  async createCompany(actor:InternalPrincipal,input:CompanyInput,atomic=true):Promise<{id:string}>{const d=input.quoteDefaults;if(!this.demo){const r=await this.production(()=>this.sql.query<{partner_ops_company_create_full:string}>("SELECT public.partner_ops_company_create_full($1,$2,$3,$4,$5::jsonb)",[actor.userId,input.slug,input.name,input.billingModel,JSON.stringify(d)]));return {id:r.rows[0]!.partner_ops_company_create_full};}if(atomic&&partnerDemoModeEnabled())return withPartnerDemoAtomicOperation(`company:${input.slug}`,"",()=>this.createCompany(actor,input,false));await this.actor(actor,["ADMIN"]);const r=await this.sql.query<{id:string}>("INSERT INTO partner_companies(slug,name,billing_model,quote_default_wall_rate_cents,quote_default_ceiling_rate_cents,quote_default_deposit_basis_points,quote_default_consent_fee_cents,quote_default_extras) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id",[input.slug,input.name,input.billingModel,d.wallRateCents,d.ceilingRateCents,d.depositBasisPoints,d.consentFeeCents,JSON.stringify(d.extras)]);await this.audit("OPS_COMPANY_CREATED",actor,r.rows[0]!.id);return {id:r.rows[0]!.id};}
  async updateCompany(actor:InternalPrincipal,companyId:string,revision:number,input:CompanyInput,atomic=true):Promise<void>{const d=input.quoteDefaults;if(!this.demo){const r=await this.production(()=>this.sql.query<{partner_ops_company_update_full:boolean}>("SELECT public.partner_ops_company_update_full($1,$2,$3,$4,$5,$6,$7::jsonb)",[actor.userId,companyId,revision,input.slug,input.name,input.billingModel,JSON.stringify(d)]));if(!r.rows[0]?.partner_ops_company_update_full)apiError("OPS_STALE_REVISION");return;}if(atomic&&partnerDemoModeEnabled())return withPartnerDemoAtomicOperation(companyId,"",()=>this.updateCompany(actor,companyId,revision,input,false));await this.actor(actor,["ADMIN"]);const r=await this.sql.query<{id:string}>("UPDATE partner_companies SET name=$3,billing_model=$4,quote_default_wall_rate_cents=$5,quote_default_ceiling_rate_cents=$6,quote_default_deposit_basis_points=$7,quote_default_consent_fee_cents=$8,quote_default_extras=$9::jsonb,revision=revision+1,quote_defaults_revision=quote_defaults_revision+1,updated_at=now() WHERE id=$1 AND revision=$2 AND slug=$10 RETURNING id",[companyId,revision,input.name,input.billingModel,d.wallRateCents,d.ceilingRateCents,d.depositBasisPoints,d.consentFeeCents,JSON.stringify(d.extras),input.slug]);if(!r.rows[0])apiError("OPS_STALE_REVISION");await this.audit("OPS_COMPANY_UPDATED",actor,companyId);}
  async listPartnerUsers(actor:InternalPrincipal,companyId:string){if(!this.demo){const r=await this.production(()=>this.sql.query<{id:string;name:string;email:string;disabled_at:Date|string|null}>("SELECT * FROM public.partner_ops_partner_user_list($1,$2)",[actor.userId,companyId]));return r.rows.map(x=>({id:x.id,name:x.name,email:x.email,disabledAt:iso(x.disabled_at)}));}await this.actor(actor,["ADMIN"]);const r=await this.sql.query<{id:string;name:string;email:string;disabled_at:Date|string|null}>("SELECT id,name,email,disabled_at FROM partner_users WHERE company_id=$1 AND principal_type='PARTNER' ORDER BY email",[companyId]);return r.rows.map(x=>({id:x.id,name:x.name,email:x.email,disabledAt:iso(x.disabled_at)}));}
  async createPartnerUser(actor:InternalPrincipal,companyId:string,input:PartnerUserInput,atomic=true):Promise<{id:string;name:string;email:string}>{const id=randomUUID();if(!this.demo){await this.production(()=>this.sql.query("SELECT * FROM public.partner_ops_partner_user_list($1,$2)",[actor.userId,companyId]));const hash=await hashPassword(input.initialPassword);await this.production(()=>this.sql.query("SELECT public.partner_ops_partner_user_create($1,$2,$3,$4,$5,$6)",[actor.userId,companyId,id,input.name,input.email,hash]));return {id,name:input.name,email:input.email};}if(atomic&&partnerDemoModeEnabled())return withPartnerDemoAtomicOperation(companyId,"",()=>this.createPartnerUser(actor,companyId,input,false));await this.actor(actor,["ADMIN"]);const hash=await hashPassword(input.initialPassword);await this.sql.query("INSERT INTO partner_users(id,company_id,principal_type,name,email) VALUES($1,$2,'PARTNER',$3,$4)",[id,companyId,input.name,input.email]);await this.sql.query("INSERT INTO partner_accounts(id,account_id,provider_id,user_id,password) VALUES($1,$2,'credential',$2,$3)",[randomUUID(),id,hash]);await this.audit("OPS_PARTNER_USER_PROVISIONED",actor,companyId,undefined,id);return {id,name:input.name,email:input.email};}
  async disablePartnerUser(actor:InternalPrincipal,companyId:string,userId:string,atomic=true):Promise<void>{if(!this.demo){const r=await this.production(()=>this.sql.query<{partner_ops_partner_user_disable:boolean}>("SELECT public.partner_ops_partner_user_disable($1,$2,$3)",[actor.userId,companyId,userId]));if(!r.rows[0]?.partner_ops_partner_user_disable)apiError("OPS_NOT_FOUND");return;}if(atomic&&partnerDemoModeEnabled())return withPartnerDemoAtomicOperation(companyId,"",()=>this.disablePartnerUser(actor,companyId,userId,false));await this.actor(actor,["ADMIN"]);const r=await this.sql.query<{id:string}>("UPDATE partner_users SET disabled_at=now(),password_version=password_version+1,updated_at=now() WHERE id=$1 AND company_id=$2 AND principal_type='PARTNER' AND disabled_at IS NULL RETURNING id",[userId,companyId]);if(!r.rows[0])apiError("OPS_NOT_FOUND");await this.sql.query("DELETE FROM partner_sessions WHERE user_id=$1",[userId]);await this.sql.query("DELETE FROM partner_account_links WHERE user_id=$1",[userId]);await writePartnerAuditEvent(this.sql,{type:"USER_DISABLED",actorUserId:actor.userId,subjectUserId:userId,companyId,metadata:{outcome:"success"}});await writePartnerAuditEvent(this.sql,{type:"SESSIONS_REVOKED",actorUserId:actor.userId,subjectUserId:userId,companyId,metadata:{outcome:"success"}});}

  async jobBillingModel(actor: InternalPrincipal, companyId: string, jobId: string): Promise<BillingModel | null> {
    if (!this.demo) { const result=await this.production(()=>this.sql.query<{partner_ops_job_detail: {companyId?: string;billingModel?: BillingModel}|null}>("SELECT public.partner_ops_job_detail($1,$2) partner_ops_job_detail",[actor.userId,jobId])); const detail=result.rows[0]?.partner_ops_job_detail; return detail?.companyId===companyId ? detail.billingModel ?? null : null; }
    await this.actor(actor,["ADMIN","OPERATIONS","FINANCE","VIEWER"]);
    const result=await this.sql.query<{billing_model_snapshot:BillingModel}>("SELECT billing_model_snapshot FROM partner_jobs WHERE company_id=$1 AND id=$2 AND deleted_at IS NULL",[companyId,jobId]); return result.rows[0]?.billing_model_snapshot ?? null;
  }
  async jobDetail(actor:InternalPrincipal,jobId:string,readLocked=true):Promise<unknown>{if(!this.demo){const r=await this.production(()=>this.sql.query<{partner_ops_job_detail:unknown}>("SELECT public.partner_ops_job_detail($1,$2) partner_ops_job_detail",[actor.userId,jobId]));return r.rows[0]?.partner_ops_job_detail??null;}if(readLocked&&partnerDemoModeEnabled())return withPartnerDemoDatabaseLock(()=>this.jobDetail(actor,jobId,false));await this.actor(actor,["ADMIN","OPERATIONS","FINANCE","VIEWER"]);const r=await this.sql.query<{id:string;company_id:string;client_reference:string;customer_name:string;site_address:unknown;submission_state:string;billing_model_snapshot:BillingModel;revision:number}>("SELECT id,company_id,client_reference,customer_name,site_address,submission_state,billing_model_snapshot,revision FROM partner_jobs WHERE id=$1",[jobId]);const job=r.rows[0];if(!job)return null;const detail=await this.partnerProjection(job.company_id,job.id);return {companyId:job.company_id,customerName:job.customer_name,siteAddress:job.site_address,submissionState:job.submission_state,revision:job.revision,...detail};}

  async appendFact(actor: InternalPrincipal, companyId: string, jobId: string, factType: OpsFactType, at: string, atomic = true): Promise<void> {
    if (!this.demo) { const result=await this.production(()=>this.sql.query<{partner_ops_fact_append:boolean}>("SELECT public.partner_ops_fact_append($1,$2,$3,$4,$5::timestamptz)",[actor.userId,companyId,jobId,factType,at])); if(!result.rows[0]?.partner_ops_fact_append)apiError("OPS_STALE_REVISION"); return; }
    if (atomic && partnerDemoModeEnabled()) return withPartnerDemoAtomicOperation(companyId,jobId,()=>this.appendFact(actor,companyId,jobId,factType,at,false));
    await this.actor(actor, ["ADMIN", "OPERATIONS"]);
    const validState = await this.sql.query<{ id:string }>("SELECT id FROM partner_jobs WHERE company_id=$1 AND id=$2 AND submission_state IN ('SUBMITTED','RECONCILIATION_REQUIRED')", [companyId, jobId]);
    if (!validState.rows[0]) apiError("OPS_JOB_NOT_ACTIONABLE");
    const cancelled=await this.sql.query<{id:string}>("SELECT id FROM partner_tracking_facts WHERE company_id=$1 AND job_id=$2 AND fact_type='CANCELLED'",[companyId,jobId]);
    if(cancelled.rows[0])apiError("OPS_JOB_NOT_ACTIONABLE");
    if(factType!=="INSTALL_DATE_SET") { const duplicate=await this.sql.query<{id:string}>("SELECT id FROM partner_tracking_facts WHERE company_id=$1 AND job_id=$2 AND fact_type=$3",[companyId,jobId,factType]); if(duplicate.rows[0])apiError("OPS_DUPLICATE_FACT"); }
    const recordedAt=await this.nextDemoFactRecordedAt(companyId,jobId);
    if (factType === "INSTALL_DATE_SET") {
      await this.sql.query("INSERT INTO partner_tracking_facts(company_id,job_id,fact_type,value_type,source,install_date,recorded_by_user_id,recorded_at) VALUES($1,$2,'INSTALL_DATE_SET','DATE','LOCAL_INTERNAL',$3::date,$4,$5::timestamptz)", [companyId,jobId,at.slice(0,10),actor.userId,recordedAt]);
    } else {
      await this.sql.query("INSERT INTO partner_tracking_facts(company_id,job_id,fact_type,value_type,value,source,effective_at,recorded_by_user_id,recorded_at) VALUES($1,$2,$3,'BOOLEAN','true'::jsonb,'LOCAL_INTERNAL',$4::timestamptz,$5,$6::timestamptz)", [companyId,jobId,factType,at,actor.userId,recordedAt]);
    }
    await this.audit("OPS_FACT_RECORDED",actor,companyId,jobId);
  }

  async appendAmendment(actor: InternalPrincipal, companyId: string, jobId: string, input: AmendmentInput, atomic = true): Promise<void> {
    if (!this.demo) { const patch={version:1,description:input.description,...(input.contractDeltaCents===undefined?{}:{contractDeltaCents:input.contractDeltaCents}),...(input.requestKey===undefined?{}:{requestKey:input.requestKey})}; const result=await this.production(()=>this.sql.query<{partner_ops_amendment_append:boolean}>("SELECT public.partner_ops_amendment_append($1,$2,$3,$4::jsonb)",[actor.userId,companyId,jobId,JSON.stringify(patch)])); if(!result.rows[0]?.partner_ops_amendment_append)apiError("OPS_JOB_NOT_ACTIONABLE"); return; }
    if (atomic && partnerDemoModeEnabled()) return withPartnerDemoAtomicOperation(companyId,jobId,()=>this.appendAmendment(actor,companyId,jobId,input,false));
    await this.actor(actor, ["ADMIN", "OPERATIONS"]);
    const job=await this.sql.query<{id:string;submission_state:string}>("SELECT id,submission_state FROM partner_jobs WHERE company_id=$1 AND id=$2",[companyId,jobId]);
    if(!job.rows[0]||!['SUBMITTED','RECONCILIATION_REQUIRED'].includes(job.rows[0].submission_state))apiError("OPS_JOB_NOT_ACTIONABLE");
    const sequence = await this.sql.query<{ next:number }>("SELECT COALESCE(max(sequence),0)+1 next FROM partner_job_amendments WHERE company_id=$1 AND job_id=$2",[companyId,jobId]);
    const id=input.requestKey??randomUUID();
    const patch = { version: 1, description: input.description, ...(input.contractDeltaCents===undefined?{}:{contractDeltaCents:input.contractDeltaCents}),...(input.requestKey===undefined?{}:{requestKey:input.requestKey}) };
    const existing=await this.sql.query<{company_id:string;job_id:string;patch:unknown}>("SELECT company_id,job_id,patch FROM partner_job_amendments WHERE id=$1",[id]);
    if(existing.rows[0]){if(existing.rows[0].company_id===companyId&&existing.rows[0].job_id===jobId&&JSON.stringify(existing.rows[0].patch)===JSON.stringify(patch))return;apiError("OPS_JOB_NOT_ACTIONABLE");}
    await this.sql.query("INSERT INTO partner_job_amendments(id,company_id,job_id,sequence,reason,patch,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",[id,companyId,jobId,sequence.rows[0]?.next ?? 1,input.description,JSON.stringify(patch),actor.userId]);
    await this.audit("OPS_AMENDMENT_RECORDED",actor,companyId,jobId);
  }

  async upsertInvoice(actor: InternalPrincipal, companyId: string, jobId: string, input: InvoiceInput): Promise<void> {
    if (!this.demo) { const result=await this.production(()=>this.sql.query<{partner_ops_invoice_upsert:boolean}>("SELECT public.partner_ops_invoice_upsert($1,$2,$3,$4,$5,$6,$7::timestamptz)",[actor.userId,companyId,jobId,input.revision,input.reference,input.amountCents,input.sentAt])); if(!result.rows[0]?.partner_ops_invoice_upsert)apiError("OPS_STALE_REVISION"); return; }
    if (partnerDemoModeEnabled()) return withPartnerDemoAtomicOperation(companyId,jobId,()=>this.upsertInvoiceDemo(actor,companyId,jobId,input));
    return this.upsertInvoiceDemo(actor,companyId,jobId,input);
  }
  private async upsertInvoiceDemo(actor: InternalPrincipal, companyId: string, jobId: string, input: InvoiceInput): Promise<void> {
    await this.actor(actor, ["ADMIN", "OPERATIONS", "FINANCE"]);
    const terminal=await this.sql.query<{id:string}>("SELECT id FROM partner_job_settlements WHERE company_id=$1 AND job_id=$2 AND settlement_status IN('PAID','RECEIVED')",[companyId,jobId]); if(terminal.rows[0])apiError("OPS_TERMINAL");
    const actionable=await this.sql.query<{id:string}>("SELECT id FROM partner_jobs WHERE company_id=$1 AND id=$2 AND submission_state IN('SUBMITTED','RECONCILIATION_REQUIRED')",[companyId,jobId]); if(!actionable.rows[0])apiError("OPS_JOB_NOT_ACTIONABLE");
    const cancelled=await this.sql.query<{id:string}>("SELECT id FROM partner_tracking_facts WHERE company_id=$1 AND job_id=$2 AND fact_type='CANCELLED'",[companyId,jobId]); if(cancelled.rows[0])apiError("OPS_JOB_NOT_ACTIONABLE");
    const current = await this.sql.query<{ revision:number }>("SELECT revision FROM partner_job_invoices WHERE company_id=$1 AND job_id=$2", [companyId, jobId]);
    if ((current.rows[0] && Number(current.rows[0].revision) !== input.revision) || (!current.rows[0] && input.revision !== 0)) apiError("OPS_STALE_REVISION");
    const result = await this.sql.query<{ revision:number }>(`INSERT INTO partner_job_invoices(company_id,job_id,reference,amount_cents,sent_at,revision,created_by_user_id,updated_by_user_id)
      VALUES($1,$2,$3,$4,$5::timestamptz,0,$6,$6) ON CONFLICT(company_id,job_id) DO UPDATE SET reference=excluded.reference,amount_cents=excluded.amount_cents,sent_at=excluded.sent_at,revision=partner_job_invoices.revision+1,updated_by_user_id=$6,updated_at=now() WHERE partner_job_invoices.revision=$7 RETURNING revision`,[companyId,jobId,input.reference,input.amountCents,input.sentAt,actor.userId,input.revision]);
    if (!result.rows[0]) apiError("OPS_STALE_REVISION");
    const recordedAt=await this.nextDemoFactRecordedAt(companyId,jobId);
    await this.sql.query("INSERT INTO partner_tracking_facts(company_id,job_id,fact_type,value_type,value,source,effective_at,recorded_by_user_id,recorded_at) VALUES($1,$2,'INVOICE_SENT','BOOLEAN','true'::jsonb,'LOCAL_INTERNAL',$3::timestamptz,$4,$5::timestamptz)",[companyId,jobId,input.sentAt,actor.userId,recordedAt]);
    await this.audit("OPS_INVOICE_RECORDED",actor,companyId,jobId);
  }

  async upsertSettlement(actor: InternalPrincipal, companyId: string, jobId: string, model: BillingModel, input: SettlementInput, atomic = true): Promise<void> {
    if (!this.demo) { const result=await this.production(()=>this.sql.query<{partner_ops_settlement_upsert:boolean}>("SELECT public.partner_ops_settlement_upsert($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)",[actor.userId,companyId,jobId,input.revision,input.grossCents,input.commissionCents,input.status,input.settledAt??null])); if(!result.rows[0]?.partner_ops_settlement_upsert)apiError("OPS_STALE_REVISION"); return; }
    if (atomic && partnerDemoModeEnabled()) return withPartnerDemoAtomicOperation(companyId,jobId,()=>this.upsertSettlement(actor,companyId,jobId,model,input,false));
    await this.actor(actor, ["ADMIN", "FINANCE"]);
    const job=await this.sql.query<{billing_model_snapshot:BillingModel;submission_state:string}>("SELECT billing_model_snapshot,submission_state FROM partner_jobs WHERE company_id=$1 AND id=$2",[companyId,jobId]);
    if(!job.rows[0]||job.rows[0].billing_model_snapshot!==model||!['SUBMITTED','RECONCILIATION_REQUIRED'].includes(job.rows[0].submission_state))apiError("OPS_JOB_NOT_ACTIONABLE");
    const invoice=await this.sql.query<{amount_cents:number}>("SELECT amount_cents FROM partner_job_invoices WHERE company_id=$1 AND job_id=$2",[companyId,jobId]); if(!invoice.rows[0]||Number(invoice.rows[0].amount_cents)!==input.grossCents)apiError("OPS_INVOICE_REQUIRED");
    const cancelled=await this.sql.query<{id:string}>("SELECT id FROM partner_tracking_facts WHERE company_id=$1 AND job_id=$2 AND fact_type='CANCELLED'",[companyId,jobId]); if(cancelled.rows[0])apiError("OPS_JOB_NOT_ACTIONABLE");
    const current = await this.sql.query<{ revision:number; settlement_status:string }>("SELECT revision,settlement_status FROM partner_job_settlements WHERE company_id=$1 AND job_id=$2", [companyId, jobId]);
    if ((current.rows[0] && (Number(current.rows[0].revision) !== input.revision || current.rows[0].settlement_status !== "PENDING")) || (!current.rows[0] && input.revision !== 0)) apiError("OPS_STALE_REVISION");
    const isInsulhub = model === "INSULHUB_BILLED"; const net = isInsulhub ? input.commissionCents : input.grossCents-input.commissionCents;
    const result=await this.sql.query<{revision:number}>(`INSERT INTO partner_job_settlements(company_id,job_id,billing_model_snapshot,gross_cents,manual_commission_cents,retained_margin_cents,net_due_cents,settlement_status,settled_at,revision,created_by_user_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,0,$10) ON CONFLICT(company_id,job_id) DO UPDATE SET gross_cents=excluded.gross_cents,manual_commission_cents=excluded.manual_commission_cents,retained_margin_cents=excluded.retained_margin_cents,net_due_cents=excluded.net_due_cents,settlement_status=excluded.settlement_status,settled_at=excluded.settled_at,revision=partner_job_settlements.revision+1,updated_at=now() WHERE partner_job_settlements.revision=$11 RETURNING revision`,[companyId,jobId,model,input.grossCents,isInsulhub?input.commissionCents:null,isInsulhub?null:input.commissionCents,net,input.status,input.settledAt??null,actor.userId,input.revision]);
    if(!result.rows[0])apiError("OPS_STALE_REVISION");
    if(input.status!=="PENDING") { const recordedAt=await this.nextDemoFactRecordedAt(companyId,jobId); await this.sql.query("INSERT INTO partner_tracking_facts(company_id,job_id,fact_type,value_type,value,source,effective_at,recorded_by_user_id,recorded_at) VALUES($1,$2,$3,'BOOLEAN','true'::jsonb,'LOCAL_INTERNAL',$4::timestamptz,$5,$6::timestamptz)",[companyId,jobId,isInsulhub?"COMMISSION_PAID":"REMITTANCE_RECEIVED",input.settledAt,actor.userId,recordedAt]); }
    await this.audit("OPS_SETTLEMENT_RECORDED",actor,companyId,jobId);
  }

  async partnerProjection(companyId: string, jobId: string, actorUserId?: string, readLocked = true): Promise<PartnerTrackingProjection | null> {
    if (!this.demo) { if (!actorUserId) apiError("OPS_FORBIDDEN"); const result=await this.sql.query<{partner_partner_tracking_projection:PartnerTrackingProjection|null}>("SELECT public.partner_partner_tracking_projection($1,$2,$3) partner_partner_tracking_projection WHERE EXISTS(SELECT 1 FROM partner_jobs WHERE company_id=$2 AND id=$3 AND deleted_at IS NULL)",[actorUserId,companyId,jobId]); return result.rows[0]?.partner_partner_tracking_projection ?? null; }
    if (readLocked && partnerDemoModeEnabled()) return withPartnerDemoDatabaseLock(()=>this.partnerProjection(companyId,jobId,actorUserId,false));
    if (actorUserId) { const actor=await this.sql.query<{id:string}>("SELECT u.id FROM partner_users u JOIN partner_companies c ON c.id=u.company_id AND c.is_active=true WHERE u.id=$1 AND u.company_id=$2 AND u.principal_type='PARTNER' AND u.disabled_at IS NULL",[actorUserId,companyId]); if(!actor.rows[0])return null; }
    const job = await this.sql.query<{id:string;client_reference:string;billing_model_snapshot:BillingModel}>("SELECT id,client_reference,billing_model_snapshot FROM partner_jobs WHERE company_id=$1 AND id=$2 AND deleted_at IS NULL",[companyId,jobId]);
    if(!job.rows[0])return null;
    const [facts,amendments,invoices,settlements]=await Promise.all([
      this.sql.query<{fact_type:string;recorded_at:Date|string;effective_at:Date|string|null;install_date:string|null}>("SELECT DISTINCT ON(fact_type) fact_type,recorded_at,effective_at,install_date FROM partner_tracking_facts WHERE company_id=$1 AND job_id=$2 ORDER BY fact_type,recorded_at DESC,id DESC",[companyId,jobId]),
      this.sql.query<{sequence:number;patch:{description:string;contractDeltaCents?:number};created_at:Date|string}>("SELECT sequence,patch,created_at FROM partner_job_amendments WHERE company_id=$1 AND job_id=$2 ORDER BY sequence",[companyId,jobId]),
      this.sql.query<{reference:string;amount_cents:number;sent_at:Date|string;revision:number}>("SELECT reference,amount_cents,sent_at,revision FROM partner_job_invoices WHERE company_id=$1 AND job_id=$2",[companyId,jobId]),
      this.sql.query<{gross_cents:number;manual_commission_cents:number|null;retained_margin_cents:number|null;net_due_cents:number;settlement_status:string;settled_at:Date|string|null;revision:number}>("SELECT gross_cents,manual_commission_cents,retained_margin_cents,net_due_cents,settlement_status,settled_at,revision FROM partner_job_settlements WHERE company_id=$1 AND job_id=$2",[companyId,jobId]),
    ]);
    const milestones:PartnerTrackingProjection["milestones"]={}; for(const row of facts.rows)milestones[row.fact_type]={recordedAt:iso(row.recorded_at)!, ...(row.effective_at?{effectiveAt:iso(row.effective_at)!}:{}),...(row.install_date?{installDate:dateOnly(row.install_date)!}: {})};
    const invoice=invoices.rows[0]; const settlement=settlements.rows[0];
    return {id:job.rows[0].id,clientReference:job.rows[0].client_reference,billingModel:job.rows[0].billing_model_snapshot,milestones,amendments:amendments.rows.map(row=>({sequence:row.sequence,description:row.patch.description,...(row.patch.contractDeltaCents===undefined?{}:{contractDeltaCents:row.patch.contractDeltaCents}),createdAt:iso(row.created_at)!})),invoice:invoice?{reference:invoice.reference,amountCents:Number(invoice.amount_cents),sentAt:iso(invoice.sent_at)!,revision:Number(invoice.revision)}:null,settlement:settlement?{grossCents:Number(settlement.gross_cents),commissionCents:Number(settlement.manual_commission_cents??settlement.retained_margin_cents),netDueCents:Number(settlement.net_due_cents),status:settlement.settlement_status,settledAt:iso(settlement.settled_at),revision:Number(settlement.revision)}:null};
  }
}
