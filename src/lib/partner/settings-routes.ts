import "server-only";
import { manageUsers, managementError } from "./user-management-routes";
import { PartnerAccountAccessRepository } from "./account-access-repository";
import { staffAccountAccess, type AccountAccessDependencies } from "./account-access-routes";
import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { ensurePartnerOpsRole, getPartnerOpsPool } from "./db";
import { PartnerOperationsRepository } from "./operations-repository";
import { allowedPartnerOrigins, verifyPartnerRequestHost, withPartnerNoStore } from "./security";
import { PRODUCT_QUOTE_DEFAULTS } from "./quote";
import { isOpsRevision, isUuid } from "./operations";
import type { InternalPrincipal } from "./repository";
import { PARTNER_SETTINGS_SERVICE_ID } from "./settings-service";
import { deleteOpsPartnerUser, getOpsPartnerUsers, postOpsCompany, postOpsPartnerUser, putOpsCompany, readBody, type OpsRouteDependencies } from "./operations-routes";
import { PartnerNotificationSettingsRepository } from "./notification-settings";

const actor: InternalPrincipal = { principalType: "INTERNAL", companyId: null, userId: PARTNER_SETTINGS_SERVICE_ID };
const json = (body: unknown, status = 200) => withPartnerNoStore(NextResponse.json(body, { status }));
export type SettingsDependencies = {
  verify: (request: NextRequest) => Promise<Response | null>;
  repository: PartnerOperationsRepository;
  origins: ReadonlySet<string>;
  accessRepository?: PartnerAccountAccessRepository;
  sendAccountMail?: AccountAccessDependencies["sendMail"];
  portalOrigin?: string;
  notificationRepository?:PartnerNotificationSettingsRepository;
};
const fixedDefaults = () => ({
  wallRateCents: PRODUCT_QUOTE_DEFAULTS.wallRateCents, ceilingRateCents: PRODUCT_QUOTE_DEFAULTS.ceilingRateCents,
  depositBasisPoints: 0, consentFeeCents: 0, extras: PRODUCT_QUOTE_DEFAULTS.extras.map(extra => ({ ...extra })),
});

/** Deliberately exposes company + partner-user management only, never jobs/finance. */
export async function partnerSettingsRoute(request: Request, companyId?: string, userId?: string, users = false, injected?: SettingsDependencies, accessAction?: "invite" | "access",notificationSettings=false): Promise<Response> {
  try {
    const origins = injected?.origins ?? allowedPartnerOrigins();
    const url = new URL(request.url);
    // Next may expose its internal localhost URL behind a configured public host.
    // Resolve only against explicit server-configured origins, never arbitrary
    // forwarded hosts or the caller's Origin. Old operations guards stay strict.
    const host = request.headers.get("host")?.toLowerCase() ?? url.host.toLowerCase();
    const forwardedHost = request.headers.get("x-forwarded-host")?.toLowerCase();
    const canonicalOrigin = [...origins].find(origin => new URL(origin).host.toLowerCase() === host);
    if (!canonicalOrigin || (forwardedHost && forwardedHost !== host) || (!injected && !verifyPartnerRequestHost(request.headers)) ||
      (request.method !== "GET" && !origins.has(request.headers.get("origin") ?? ""))) return json({ error: "Forbidden" }, 403);
    const canonicalUrl = new URL(url.pathname + url.search, canonicalOrigin);
    request = new Request(canonicalUrl, request);
    const denied = await (injected?.verify ?? requireInsulhubAuth)(new NextRequest(request.url, { headers: request.headers }));
    if (denied) return withPartnerNoStore(denied);
    if (!injected) await ensurePartnerOpsRole();
    const repository = injected?.repository ?? new PartnerOperationsRepository(getPartnerOpsPool());
    const deps: OpsRouteDependencies = { repository, origins, getPrincipal: async () => actor };
    if(notificationSettings){
      const settings=injected?.notificationRepository??new PartnerNotificationSettingsRepository(getPartnerOpsPool());
      if(request.method==="GET")return json({settings:await settings.read(actor)});
      if(request.method!=="PUT")return json({error:"Method not allowed"},405);
      const raw=await readBody(request);
      if(!raw||Object.keys(raw).sort().join("|")!=="recipientEmail|revision"||!isOpsRevision(raw.revision)||typeof raw.recipientEmail!=="string")return json({error:"Enter a valid notification email."},400);
      const email=raw.recipientEmail.trim().toLowerCase();if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))return json({error:"Enter a valid notification email."},400);
      return await settings.update(actor,raw.revision,email)?json({settings:await settings.read(actor)}):json({error:"Settings changed. Reload and try again."},409);
    }
    if (companyId && !isUuid(companyId)) return json({ error: "Not found" }, 404);
    if (accessAction && companyId) {
      if (request.method !== "POST") return json({error:"Method not allowed"},405);
      if (userId && (userId.length>200 || !userId.trim())) return json({error:"Not found"},404);
      return staffAccountAccess(request,companyId,userId,accessAction,{repository:injected?.accessRepository ?? new PartnerAccountAccessRepository(getPartnerOpsPool()), origins, portalOrigin:injected?.portalOrigin ?? process.env.PARTNER_APP_ORIGIN!, sendMail:injected?.sendAccountMail});
    }
    const management=injected?.accessRepository ?? (!injected?new PartnerAccountAccessRepository(getPartnerOpsPool()):null);
    if(companyId&&!users&&request.method==="PATCH"){
      const raw=await readBody(request);
      if(!raw||Object.keys(raw).sort().join("|")!=="isActive|revision"||!isOpsRevision(raw.revision)||typeof raw.isActive!=="boolean")return json({error:"Check the company change."},400);
      if(!management)return json({error:"Unavailable"},503);
      try{return await management.companyActive(companyId,raw.revision,raw.isActive)?json({ok:true}):json({error:"Company changed. Reload and try again."},409);}catch(error){return managementError(error);}
    }
    if(users&&companyId&&management)return manageUsers(request,companyId,userId,management);
    if (users && companyId) {
      if (userId && request.method === "DELETE") return deleteOpsPartnerUser(request, companyId, userId, deps);
      if (!userId && request.method === "GET") {
        const response=await getOpsPartnerUsers(request, companyId, deps);
        const access=injected?.accessRepository ?? (!injected ? new PartnerAccountAccessRepository(getPartnerOpsPool()) : null);
        if (!response.ok || !access) return response;
        const body=await response.json();const states=new Map((await access.userStates(companyId)).map(row=>[row.id,row.invitation_pending]));
        return json({...body,users:body.users.map((user:{id:string})=>({...user,invitationPending:states.get(user.id)??false}))});
      }
      if (!userId && request.method === "POST") return postOpsPartnerUser(request, companyId, deps);
      return json({ error: "Method not allowed" }, 405);
    }
    if (request.method === "GET" && !companyId) {
      const companies = await repository.listCompanies(actor);
      return json({ companies: companies.map(({ id, name, revision, isActive }) => ({ id, name, revision, isActive })) });
    }
    if (request.method !== (companyId ? "PUT" : "POST")) return json({ error: "Method not allowed" }, 405);
    const raw = await readBody(request);
    const keys = companyId ? ["revision","name"] : ["creationKey","name"];
    if (!raw || Object.keys(raw).some(key => !keys.includes(key)) || typeof raw.name !== "string" || !raw.name.trim() || raw.name.trim().length > 160 ||
      (companyId ? !isOpsRevision(raw.revision) : typeof raw.creationKey !== "string" || !isUuid(raw.creationKey))) return json({ error: "Check the company name." }, 400);
    const existing = companyId ? (await repository.listCompanies(actor)).find(company => company.id === companyId) : null;
    if (companyId && !existing) return json({ error: "Not found" }, 404);
    // The legacy storage column remains fixed only for migration compatibility;
    // it is not accepted from callers or used by the active product workflow.
    const company = { slug: existing?.slug ?? `partner-${raw.creationKey}`, name: raw.name.trim(), billingModel: "INSULHUB_BILLED" as const, quoteDefaults: fixedDefaults() };
    const headers = new Headers(request.headers); headers.delete("content-length"); headers.set("content-type","application/json");
    const forwarded = new Request(request.url, { method: request.method, headers, body: JSON.stringify(companyId ? { revision: raw.revision, company } : company) });
    return companyId ? putOpsCompany(forwarded, companyId, deps) : postOpsCompany(forwarded, deps);
  } catch { return json({ error: "Partner settings are unavailable. Check the server configuration and try again." }, 503); }
}
