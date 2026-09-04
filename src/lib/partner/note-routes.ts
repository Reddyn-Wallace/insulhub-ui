import "server-only";
import { NextResponse } from "next/server";
import { getAuthenticatedPrincipal } from "./auth";
import { getPartnerPool } from "./db";
import { PartnerNoteRepository } from "./note-repository";
import { allowedPartnerOrigins, verifyPartnerRequestHost, withPartnerNoStore } from "./security";
import { isUuid } from "./operations";
import { readBody } from "./operations-routes";
import type { AuthenticatedPrincipal } from "./repository";
export type NoteRouteDependencies = { repository: Pick<PartnerNoteRepository,"feed"|"summaries">; getPrincipal:(headers:Headers)=>Promise<AuthenticatedPrincipal|null>; origins:ReadonlySet<string> };
const json=(body:unknown,status=200)=>withPartnerNoStore(NextResponse.json(body,{status}));
export async function partnerNotesRoute(request: Request, jobId?:string, injected?:NoteRouteDependencies) {
  if(!injected&&!verifyPartnerRequestHost(request.headers))return json({error:"Not found."},404);
  const deps=injected??{repository:new PartnerNoteRepository(getPartnerPool()),getPrincipal:getAuthenticatedPrincipal,origins:allowedPartnerOrigins()};
  if(request.method!=="GET"&&request.method!=="POST")return json({error:"Method not allowed."},405);
  if(request.method==="POST"&&!deps.origins.has(request.headers.get("origin")??""))return json({error:"Forbidden"},403);
  const principal=await deps.getPrincipal(request.headers);
  if(principal?.principalType!=="PARTNER")return json({error:"Not found."},404);
  if(new URL(request.url).search||(jobId&&!isUuid(jobId)))return json({error:"Not found."},404);
  try {
    if(!jobId)return request.method==="GET"?json({jobs:await deps.repository.summaries(principal)}):json({error:"Not found."},404);
    let seen:number|null=null;
    if(request.method==="POST") {const body=await readBody(request);if(!body||Object.keys(body).join()!=="seenSequence"||!Number.isSafeInteger(body.seenSequence)||Number(body.seenSequence)<0||Number(body.seenSequence)>2147483647)return json({error:"Invalid update."},400);seen=Number(body.seenSequence);}
    const feed=await deps.repository.feed(principal,jobId,seen);return feed?json(request.method==="POST"?{ok:true}:{feed}):json({error:"Not found."},404);
  }catch{return json({error:"Updates are temporarily unavailable."},503);}
}
