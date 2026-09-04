import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { cleanSitePlanDrawingName, EMPTY_SITE_PLAN_DOCUMENT, parseSitePlanDocument, type SitePlanDrawingDocument } from "../site-plan-drawings";
import type { PartnerPrincipal } from "./repository";
import { normalizeSitePlanRenderInput, sitePlanRenderHash, type SitePlanRenderInput } from "./site-plan-hash";
import { deletePartnerDemoPdfBytes, partnerDemoModeEnabled, readPartnerDemoPdfBytes, storePartnerDemoPdfBytes, withPartnerDemoAtomicOperation } from "./demo";

export type PartnerFloorPlan = {
  id: string; jobId: string; name: string; sortOrder: number; document: SitePlanDrawingDocument;
  revision: number; currentPdf: null | { artifactId: string; drawingRevision: number; renderHash: string; fileName: string; generatedAt: string };
  pdfReady: boolean; createdAt: string; updatedAt: string;
};
export type FloorPlanCollection = { revision: number; floors: PartnerFloorPlan[] };
export type FloorPlanMutationResult = { outcome: "updated"; collection: FloorPlanCollection } | { outcome: "not_found" } | { outcome: "not_draft" } | { outcome: "stale"; currentRevision: number };
type JobSnapshot = { id: string; revision: number; floor_plan_revision: number; customer_name: string; site_address: SitePlanRenderInput["siteAddress"]; submission_state: string };
type PurgeResult = { collectionRevision: number; drawingIds: string[] };

function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function localPgEmulationEnabled(): boolean { return process.env.NODE_ENV === "test" || partnerDemoModeEnabled(); }
function documentValue(value: unknown): SitePlanDrawingDocument { const parsed = parseSitePlanDocument(typeof value === "string" ? JSON.parse(value) : value); if (!parsed) throw new Error("Stored floor plan is invalid"); return parsed; }
function expectedHash(row: { name: string; drawing_data: unknown; site_address: SitePlanRenderInput["siteAddress"] }): string { return sitePlanRenderHash(normalizeSitePlanRenderInput({ drawingName: row.name, siteAddress: row.site_address, document: documentValue(row.drawing_data) })); }

const FLOOR_SELECT = `SELECT d.id,d.job_id,d.name,d.sort_order,d.drawing_data,d.revision,d.created_at,d.updated_at,
  j.site_address,a.id AS artifact_id,a.drawing_revision AS artifact_drawing_revision,a.render_hash,a.file_name,a.generated_at
  FROM partner_site_plan_drawings d JOIN partner_jobs j ON (j.company_id,j.id)=(d.company_id,d.job_id) AND j.deleted_at IS NULL
  LEFT JOIN partner_site_plan_pdf_artifacts a ON (a.company_id,a.job_id,a.drawing_id,a.id)=(d.company_id,d.job_id,d.id,d.current_pdf_artifact_id)`;

export class PartnerSitePlanRepository {
  constructor(private readonly pool: Pool) {}
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> { const client = await this.pool.connect(); try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
  private async deferOrderConstraint(client:PoolClient):Promise<void>{try{await client.query("SET CONSTRAINTS public.partner_site_plan_order_unique DEFERRED");}catch(error){if(localPgEmulationEnabled()&&error instanceof Error&&error.message.includes("SET CONSTRAINTS"))return;throw error;}}
  private async purgeDrawing(client:PoolClient,principal:PartnerPrincipal,jobId:string,drawingId:string,collectionRevision:number):Promise<PurgeResult|null>{
    try{const result=await client.query<{collection_revision:number;drawing_ids:string[]}>("SELECT collection_revision,drawing_ids FROM partner_purge_draft_site_plan_drawing($1,$2,$3,$4)",[principal.companyId,jobId,drawingId,collectionRevision]);const row=result.rows[0];return row?{collectionRevision:Number(row.collection_revision),drawingIds:row.drawing_ids.map(String)}:null;}
    catch(error){
      if(!localPgEmulationEnabled()||!(error instanceof Error)||(process.env.NODE_ENV==="test"&&!error.message.includes("partner_purge_draft_site_plan_drawing")))throw error;
      // Break the current-artifact reference before removing artifact history.
      // The production definer function owns its cascade; this is pg-mem only.
      await client.query("UPDATE partner_site_plan_drawings SET current_pdf_artifact_id=NULL WHERE company_id=$1 AND job_id=$2 AND id=$3",[principal.companyId,jobId,drawingId]);
      await client.query("DELETE FROM partner_site_plan_pdf_artifacts WHERE company_id=$1 AND job_id=$2 AND drawing_id=$3",[principal.companyId,jobId,drawingId]);
      const removed=await client.query("DELETE FROM partner_site_plan_drawings WHERE company_id=$1 AND job_id=$2 AND id=$3",[principal.companyId,jobId,drawingId]);if(removed.rowCount!==1)return null;
      const remaining=await client.query<{id:string;sort_order:number}>("SELECT id,sort_order FROM partner_site_plan_drawings WHERE company_id=$1 AND job_id=$2 ORDER BY sort_order,id",[principal.companyId,jobId]);
      for(const[index,row]of remaining.rows.entries())if(Number(row.sort_order)!==index)await client.query("UPDATE partner_site_plan_drawings SET sort_order=$4 WHERE company_id=$1 AND job_id=$2 AND id=$3",[principal.companyId,jobId,row.id,index]);
      const updated=await client.query<{floor_plan_revision:number}>("UPDATE partner_jobs SET floor_plan_revision=floor_plan_revision+1,updated_at=now() WHERE company_id=$1 AND id=$2 RETURNING floor_plan_revision",[principal.companyId,jobId]);
      return{collectionRevision:Number(updated.rows[0].floor_plan_revision),drawingIds:remaining.rows.map((row)=>row.id)};
    }
  }
  private async publishArtifact(client:PoolClient,principal:PartnerPrincipal,jobId:string,drawingId:string,snapshot:NonNullable<Awaited<ReturnType<PartnerSitePlanRepository["renderSnapshot"]>>>,pdf:{bytes:Buffer;contentSha256:string},fileName:string):Promise<string|null>{
    const targetId=randomUUID();
    try{const result=await client.query<{artifact_id:string|null}>(`SELECT partner_publish_site_plan_pdf_artifact($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) AS artifact_id`,[principal.companyId,jobId,drawingId,targetId,snapshot.renderHash,pdf.bytes,snapshot.drawingRevision,snapshot.input.rendererVersion,snapshot.input.templateVersion,snapshot.input.templateSha256,pdf.contentSha256,fileName,principal.userId,snapshot.jobRevision,snapshot.collectionRevision,snapshot.currentArtifactId]);return result.rows[0]?.artifact_id??null;}
    catch(error){
      if(!localPgEmulationEnabled()||!(error instanceof Error)||(process.env.NODE_ENV==="test"&&!error.message.includes("partner_publish_site_plan_pdf_artifact")))throw error;
      const artifact=await client.query<{id:string;pdf_bytes:Buffer;content_sha256:string}>("SELECT id,pdf_bytes,content_sha256 FROM partner_site_plan_pdf_artifacts WHERE company_id=$1 AND drawing_id=$2 AND drawing_revision=$3 AND render_hash=$4",[principal.companyId,drawingId,snapshot.drawingRevision,snapshot.renderHash]);
      const demo=partnerDemoModeEnabled();const verifiedBytes=artifact.rows[0]&&demo?readPartnerDemoPdfBytes(artifact.rows[0].id):artifact.rows[0]?.pdf_bytes;
      let artifactId=artifact.rows[0]?.id;if(artifact.rows[0]&&(!verifiedBytes||artifact.rows[0].content_sha256!==createHash("sha256").update(verifiedBytes).digest("hex")||artifact.rows[0].content_sha256!==pdf.contentSha256))throw new Error("Stored PDF artifact verification failed");
      if(!artifactId){artifactId=targetId;const storedBytes=demo?Buffer.from("%PDF-1.7 local-demo-placeholder"):pdf.bytes;if(demo)storePartnerDemoPdfBytes(artifactId,pdf.bytes);try{await client.query("INSERT INTO partner_site_plan_pdf_artifacts(company_id,job_id,drawing_id,id,render_hash,pdf_bytes,byte_size,drawing_revision,renderer_version,template_version,template_sha256,content_sha256,file_name,generated_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",[principal.companyId,jobId,drawingId,artifactId,snapshot.renderHash,storedBytes,storedBytes.byteLength,snapshot.drawingRevision,snapshot.input.rendererVersion,snapshot.input.templateVersion,snapshot.input.templateSha256,pdf.contentSha256,fileName,principal.userId]);}catch(insertError){if(demo)deletePartnerDemoPdfBytes([artifactId]);throw insertError;}}
      await client.query("UPDATE partner_site_plan_drawings SET current_pdf_artifact_id=$4 WHERE company_id=$1 AND job_id=$2 AND id=$3",[principal.companyId,jobId,drawingId,artifactId]);return artifactId;
    }
  }
  private floor(row: Record<string, unknown>): PartnerFloorPlan {
    const document = documentValue(row.drawing_data); const hash = expectedHash({ name: String(row.name), drawing_data: document, site_address: row.site_address as SitePlanRenderInput["siteAddress"] });
    const currentPdf = row.artifact_id ? { artifactId: String(row.artifact_id), drawingRevision: Number(row.artifact_drawing_revision), renderHash: String(row.render_hash), fileName: String(row.file_name), generatedAt: iso(row.generated_at as string | Date) } : null;
    return { id: String(row.id), jobId: String(row.job_id), name: String(row.name), sortOrder: Number(row.sort_order), document, revision: Number(row.revision), currentPdf, pdfReady: Boolean(currentPdf && currentPdf.drawingRevision === Number(row.revision) && currentPdf.renderHash === hash), createdAt: iso(row.created_at as string | Date), updatedAt: iso(row.updated_at as string | Date) };
  }
  private async listUsing(sql: Pick<PoolClient, "query">, principal: PartnerPrincipal, jobId: string): Promise<FloorPlanCollection | null> {
    const job = await sql.query<{ floor_plan_revision: number }>("SELECT floor_plan_revision FROM partner_jobs WHERE company_id=$1 AND id=$2 AND deleted_at IS NULL", [principal.companyId, jobId]); if (!job.rows[0]) return null;
    const rows = await sql.query(`${FLOOR_SELECT} WHERE d.company_id=$1 AND d.job_id=$2 ORDER BY d.sort_order,d.id`, [principal.companyId, jobId]);
    return { revision: Number(job.rows[0].floor_plan_revision), floors: rows.rows.map((row) => this.floor(row)) };
  }
  async list(principal: PartnerPrincipal, jobId: string): Promise<FloorPlanCollection | null> { return this.listUsing(this.pool, principal, jobId); }
  private async getUsing(sql: Pick<PoolClient,"query">,principal:PartnerPrincipal,jobId:string,drawingId:string):Promise<PartnerFloorPlan|null>{const rows=await sql.query(`${FLOOR_SELECT} WHERE d.company_id=$1 AND d.job_id=$2 AND d.id=$3`,[principal.companyId,jobId,drawingId]);return rows.rows[0]?this.floor(rows.rows[0]):null;}
  async get(principal: PartnerPrincipal, jobId: string, drawingId: string): Promise<PartnerFloorPlan | null> { return this.getUsing(this.pool,principal,jobId,drawingId); }
  private async lockJob(client: PoolClient, principal: PartnerPrincipal, jobId: string): Promise<JobSnapshot | null> {
    let companyLocked:boolean;
    if(localPgEmulationEnabled())companyLocked=Boolean((await client.query<{id:string}>("SELECT id FROM partner_companies WHERE id=$1 AND is_active=true FOR UPDATE",[principal.companyId])).rows[0]);
    else companyLocked=(await client.query<{locked:boolean}>("SELECT public.partner_lock_site_plan_company($1) AS locked",[principal.companyId])).rows[0]?.locked===true;
    if(!companyLocked)return null;
    const result = await client.query<JobSnapshot>("SELECT id,revision,floor_plan_revision,customer_name,site_address,submission_state FROM partner_jobs WHERE company_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE", [principal.companyId, jobId]);
    return result.rows[0] ?? null;
  }
  async create(principal: PartnerPrincipal, jobId: string, collectionRevision: number, name: string, document: SitePlanDrawingDocument = EMPTY_SITE_PLAN_DOCUMENT): Promise<FloorPlanMutationResult> {
    return this.transaction(async (client) => { const job = await this.lockJob(client, principal, jobId); if (!job) return { outcome: "not_found" }; if (job.submission_state !== "DRAFT") return { outcome: "not_draft" }; if (job.floor_plan_revision !== collectionRevision) return { outcome: "stale", currentRevision: job.floor_plan_revision };
      await this.deferOrderConstraint(client); const locked = await client.query<{ id: string; sort_order: number }>("SELECT id,sort_order FROM partner_site_plan_drawings WHERE company_id=$1 AND job_id=$2 ORDER BY id FOR UPDATE", [principal.companyId,jobId]); if (locked.rows.length >= 20) throw new Error("A draft can have at most 20 floor plans");
      await client.query("INSERT INTO partner_site_plan_drawings (company_id,job_id,name,sort_order,drawing_data,created_by_user_id) VALUES ($1,$2,$3,$4,$5::jsonb,$6)", [principal.companyId,jobId,name,locked.rows.length,JSON.stringify(document),principal.userId]); await client.query("UPDATE partner_jobs SET floor_plan_revision=floor_plan_revision+1,updated_at=now() WHERE company_id=$1 AND id=$2", [principal.companyId,jobId]); return { outcome: "updated", collection: (await this.listUsing(client,principal,jobId))! }; });
  }
  async patch(principal: PartnerPrincipal, jobId: string, drawingId: string, revision: number, input: { name?: string; document?: SitePlanDrawingDocument }): Promise<{ outcome: "updated"; floor: PartnerFloorPlan } | { outcome: "not_found" } | { outcome: "not_draft" } | { outcome: "stale"; currentRevision: number }> {
    return this.transaction(async (client) => { const job=await this.lockJob(client,principal,jobId); if(!job)return{outcome:"not_found"}; if(job.submission_state!=="DRAFT")return{outcome:"not_draft"}; const current=await client.query<{revision:number}>("SELECT revision FROM partner_site_plan_drawings WHERE company_id=$1 AND job_id=$2 AND id=$3 FOR UPDATE",[principal.companyId,jobId,drawingId]); if(!current.rows[0])return{outcome:"not_found"}; if(Number(current.rows[0].revision)!==revision)return{outcome:"stale",currentRevision:Number(current.rows[0].revision)};
      const set: string[]=[]; const values:unknown[]=[principal.companyId,jobId,drawingId,revision]; if(input.name!==undefined){values.push(input.name);set.push(`name=$${values.length}`);} if(input.document!==undefined){values.push(JSON.stringify(input.document));set.push(`drawing_data=$${values.length}::jsonb`);} if(!set.length) throw new Error("Floor plan patch is empty");
      await client.query(`UPDATE partner_site_plan_drawings SET ${set.join(",")},revision=revision+1,updated_at=now() WHERE company_id=$1 AND job_id=$2 AND id=$3 AND revision=$4`,values); const floor=await this.getUsing(client,principal,jobId,drawingId); return floor?{outcome:"updated",floor}:{outcome:"not_found"}; });
  }
  async remove(principal: PartnerPrincipal, jobId: string, drawingId: string, collectionRevision: number): Promise<FloorPlanMutationResult> {
    const removeDrawing = () => this.transaction<FloorPlanMutationResult>(async(client)=>{const job=await this.lockJob(client,principal,jobId);if(!job)return{outcome:"not_found"};if(job.submission_state!=="DRAFT")return{outcome:"not_draft"};if(job.floor_plan_revision!==collectionRevision)return{outcome:"stale",currentRevision:job.floor_plan_revision}; await this.deferOrderConstraint(client); const drawings=await client.query<{id:string;sort_order:number}>("SELECT id,sort_order FROM partner_site_plan_drawings WHERE company_id=$1 AND job_id=$2 ORDER BY id FOR UPDATE",[principal.companyId,jobId]);if(!drawings.rows.some((row)=>row.id===drawingId))return{outcome:"not_found"}; const purged=await this.purgeDrawing(client,principal,jobId,drawingId,collectionRevision);if(!purged)return{outcome:"not_found"};const collection=await this.listUsing(client,principal,jobId);if(!collection||collection.revision!==purged.collectionRevision||collection.floors.map((floor)=>floor.id).join(",")!==purged.drawingIds.join(","))throw new Error("Floor plan purge returned an inconsistent collection");return{outcome:"updated",collection};});
    if (!partnerDemoModeEnabled()) return removeDrawing();
    return withPartnerDemoAtomicOperation(principal.companyId, jobId, async () => {
      const artifacts = await this.pool.query<{id:string}>("SELECT id FROM partner_site_plan_pdf_artifacts WHERE company_id=$1 AND job_id=$2 AND drawing_id=$3", [principal.companyId,jobId,drawingId]);
      const result = await removeDrawing();
      // Remove in-memory bytes only after commit; rollback retains both.
      if (result.outcome === "updated") deletePartnerDemoPdfBytes(artifacts.rows.map(row => row.id));
      return result;
    });
  }
  async reorder(principal: PartnerPrincipal, jobId: string, collectionRevision: number, drawingIds: readonly string[]): Promise<FloorPlanMutationResult> {
    return this.transaction(async(client)=>{const job=await this.lockJob(client,principal,jobId);if(!job)return{outcome:"not_found"};if(job.submission_state!=="DRAFT")return{outcome:"not_draft"};if(job.floor_plan_revision!==collectionRevision)return{outcome:"stale",currentRevision:job.floor_plan_revision};await this.deferOrderConstraint(client);const locked=await client.query<{id:string}>("SELECT id FROM partner_site_plan_drawings WHERE company_id=$1 AND job_id=$2 ORDER BY id FOR UPDATE",[principal.companyId,jobId]);if(locked.rows.length!==drawingIds.length||new Set(drawingIds).size!==drawingIds.length||locked.rows.some((row)=>!drawingIds.includes(row.id)))throw new Error("Floor plan order must contain every floor exactly once");if(drawingIds.length){const values:unknown[]=[principal.companyId,jobId];const cases=drawingIds.map((id,index)=>{values.push(id);return `WHEN $${values.length}::uuid THEN ${index}`;}).join(" ");await client.query(`UPDATE partner_site_plan_drawings SET sort_order=CASE id ${cases} END WHERE company_id=$1 AND job_id=$2`,values);}await client.query("UPDATE partner_jobs SET floor_plan_revision=floor_plan_revision+1,updated_at=now() WHERE company_id=$1 AND id=$2",[principal.companyId,jobId]);return{outcome:"updated",collection:(await this.listUsing(client,principal,jobId))!};});
  }
  async consumeRateLimit(scopeKey:string,action:"GENERATE"|"DOWNLOAD",windowSeconds:number,limit:number):Promise<boolean>{const attemptAt=new Date();const cutoff=new Date(attemptAt.getTime()-windowSeconds*1000);const result=await this.pool.query<{allowed:boolean}>(`INSERT INTO partner_site_plan_rate_limits(scope_key,action,window_seconds,window_started_at,attempt_count)
    VALUES($1,$2,$3,$4,1) ON CONFLICT(scope_key,action,window_seconds) DO UPDATE SET
      window_started_at=CASE WHEN partner_site_plan_rate_limits.window_started_at<=$5 THEN EXCLUDED.window_started_at ELSE partner_site_plan_rate_limits.window_started_at END,
      attempt_count=CASE WHEN partner_site_plan_rate_limits.window_started_at<=$5 THEN 1 ELSE partner_site_plan_rate_limits.attempt_count+1 END
    RETURNING attempt_count<=$6 AS allowed`,[scopeKey,action,windowSeconds,attemptAt,cutoff,limit]);return result.rows[0]?.allowed===true;}
  async renderSnapshot(principal:PartnerPrincipal,jobId:string,drawingId:string):Promise<null|{jobRevision:number;collectionRevision:number;drawingRevision:number;currentArtifactId:string|null;input:SitePlanRenderInput;renderHash:string}>{const result=await this.pool.query<Record<string,unknown>>(`SELECT j.revision AS job_revision,j.floor_plan_revision,j.site_address,j.submission_state,d.name,d.drawing_data,d.revision AS drawing_revision,d.current_pdf_artifact_id FROM partner_jobs j JOIN partner_site_plan_drawings d ON(d.company_id,d.job_id)=(j.company_id,j.id) WHERE j.company_id=$1 AND j.id=$2 AND j.deleted_at IS NULL AND d.id=$3`,[principal.companyId,jobId,drawingId]);const row=result.rows[0];if(!row||row.submission_state!=="DRAFT")return null;const input=normalizeSitePlanRenderInput({drawingName:String(row.name),siteAddress:row.site_address as SitePlanRenderInput["siteAddress"],document:documentValue(row.drawing_data)});return{jobRevision:Number(row.job_revision),collectionRevision:Number(row.floor_plan_revision),drawingRevision:Number(row.drawing_revision),currentArtifactId:row.current_pdf_artifact_id?String(row.current_pdf_artifact_id):null,input,renderHash:sitePlanRenderHash(input)};}
  async publish(principal:PartnerPrincipal,jobId:string,drawingId:string,snapshot:NonNullable<Awaited<ReturnType<PartnerSitePlanRepository["renderSnapshot"]>>>,pdf:{bytes:Buffer;contentSha256:string},fileName:string):Promise<PartnerFloorPlan|null>{return this.transaction(async(client)=>{const job=await this.lockJob(client,principal,jobId);if(!job||job.submission_state!=="DRAFT"||job.revision!==snapshot.jobRevision||job.floor_plan_revision!==snapshot.collectionRevision)return null;const drawing=await client.query<Record<string,unknown>>("SELECT name,drawing_data,revision,current_pdf_artifact_id FROM partner_site_plan_drawings WHERE company_id=$1 AND job_id=$2 AND id=$3 FOR UPDATE",[principal.companyId,jobId,drawingId]);const row=drawing.rows[0];if(!row||Number(row.revision)!==snapshot.drawingRevision||(row.current_pdf_artifact_id?String(row.current_pdf_artifact_id):null)!==snapshot.currentArtifactId)return null;const authoritative=normalizeSitePlanRenderInput({drawingName:String(row.name),siteAddress:job.site_address,document:documentValue(row.drawing_data)});if(sitePlanRenderHash(authoritative)!==snapshot.renderHash)return null;const artifactId=await this.publishArtifact(client,principal,jobId,drawingId,snapshot,pdf,fileName);if(!artifactId)return null;return this.getUsing(client,principal,jobId,drawingId);});}
  async download(principal:PartnerPrincipal,jobId:string,drawingId:string):Promise<null|{bytes:Buffer;fileName:string;sha256:string}>{const result=await this.pool.query<{id:string;pdf_bytes:Buffer;file_name:string;content_sha256:string}>("SELECT a.id,a.pdf_bytes,a.file_name,a.content_sha256 FROM partner_site_plan_drawings d JOIN partner_jobs j ON (j.company_id,j.id)=(d.company_id,d.job_id) AND j.deleted_at IS NULL JOIN partner_site_plan_pdf_artifacts a ON(a.company_id,a.job_id,a.drawing_id,a.id)=(d.company_id,d.job_id,d.id,d.current_pdf_artifact_id) WHERE d.company_id=$1 AND d.job_id=$2 AND d.id=$3",[principal.companyId,jobId,drawingId]);const row=result.rows[0];if(!row)return null;const bytes=partnerDemoModeEnabled()?readPartnerDemoPdfBytes(row.id):row.pdf_bytes;if(!bytes)throw new Error("Stored PDF artifact verification failed");const actual=createHash("sha256").update(bytes).digest("hex");if(actual!==row.content_sha256)throw new Error("Stored PDF artifact verification failed");return{bytes,fileName:row.file_name,sha256:actual};}
}

export function normalizeFloorPlanName(value:unknown):string|null{const name=cleanSitePlanDrawingName(value);return name&&[...name].length<=120?name:null;}
