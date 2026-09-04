import "server-only";
import { NextResponse } from "next/server";
import { getAuthenticatedPrincipal } from "./auth";
import { getPartnerPool } from "./db";
import { PartnerOperationsRepository } from "./operations-repository";
import { isUuid } from "./operations";
import type { AuthenticatedPrincipal } from "./repository";
import { verifyPartnerRequestHost, withPartnerNoStore } from "./security";
import { neutralPartnerTracking } from "./neutral-tracking";

export interface TrackingRouteDependencies { repository: PartnerOperationsRepository; getPrincipal:(headers:Headers)=>Promise<AuthenticatedPrincipal|null>; }
const json=(body:unknown,init?:ResponseInit)=>withPartnerNoStore(NextResponse.json(body,init));
export async function getPartnerTracking(request:Request,jobId:string,depsArg?:TrackingRouteDependencies){
  if(!depsArg&&!verifyPartnerRequestHost(request.headers))return json({error:"Not found."},{status:404});
  const deps=depsArg??{repository:new PartnerOperationsRepository(getPartnerPool()),getPrincipal:getAuthenticatedPrincipal};
  const principal=await deps.getPrincipal(request.headers);
  if(principal?.principalType!=="PARTNER")return json({error:"Not found."},{status:404});
  if(!isUuid(jobId))return json({error:"Not found."},{status:404});
  const tracking=neutralPartnerTracking(await deps.repository.partnerProjection(principal.companyId,jobId,principal.userId));
  return tracking?json({tracking}):json({error:"Not found."},{status:404});
}
