import "server-only";
import { NextResponse } from "next/server";
import { hashPassword } from "better-auth/crypto";
import { getAuthenticatedPrincipal } from "./auth";
import { ensurePartnerOpsRole, getPartnerOpsPool } from "./db";
import { PartnerAccountAccessRepository } from "./account-access-repository";
import { staffAccountAccess, type AccountAccessDependencies } from "./account-access-routes";
import { parsePartnerUser } from "./operations";
import { readBody } from "./operations-routes";
import { allowedPartnerOrigins, verifyPartnerRequestHost, withPartnerNoStore } from "./security";
import type { AuthenticatedPrincipal } from "./repository";
const json=(value:unknown,status=200)=>withPartnerNoStore(NextResponse.json(value,{status}));
export function managementError(error:unknown):Response{
  const message=error instanceof Error?error.message:"";
  if(message==="ACCESS_FORBIDDEN")return json({error:"Forbidden"},403);
  if(message==="ACCESS_NOT_FOUND")return json({error:"Not found"},404);
  if(message==="ACCESS_ARCHIVED")return json({error:"Unarchive the company before activating or adding employees."},409);
  if(message==="ACCESS_LAST_ADMIN")return json({error:"Assign another active administrator before removing your own access."},409);
  if((error as {code?:string})?.code==="23505")return json({error:"This email already belongs to an account."},409);
  return json({error:"The account change could not be confirmed. Reload users before trying again."},503);
}
export async function manageUsers(request:Request,companyId:string,userId:string|undefined,repository:PartnerAccountAccessRepository):Promise<Response>{
 try{
  if(userId&&(userId.length>200||!userId.trim()))return json({error:"Not found"},404);
  if(request.method==="GET"&&!userId)return json({users:await repository.managedUsers(companyId)});
  if(request.method==="POST"&&!userId){
   const raw=await readBody(request);if(!raw||Object.keys(raw).some(k=>!["name","email","initialPassword","role"].includes(k))||(raw.role!==undefined&&raw.role!=="ADMIN"&&raw.role!=="SALES"))return json({error:"Check the user details."},400);
   const {role,...fields}=raw,input=parsePartnerUser(fields);if(!input)return json({error:"Check the user details and password requirements."},400);
   await repository.managedUsers(companyId);
   const result=await repository.createUser(companyId,{...input,role:role as "ADMIN"|"SALES"|undefined},await hashPassword(input.initialPassword));return json({user:result},201);
  }
  if(userId&&(request.method==="PATCH"||request.method==="DELETE")){
   const raw=request.method==="DELETE"?{isActive:false}:await readBody(request);
   if(!raw||!Object.keys(raw).length||Object.keys(raw).some(k=>!["role","isActive"].includes(k))||(raw.role!==undefined&&raw.role!=="ADMIN"&&raw.role!=="SALES")||(raw.isActive!==undefined&&typeof raw.isActive!=="boolean"))return json({error:"Check the user change."},400);
   return await repository.manageUser(companyId,userId,raw as {role?:"ADMIN"|"SALES";isActive?:boolean})?json({ok:true}):json({error:"Not found"},404);
  }
  return json({error:"Method not allowed"},405);
 }catch(error){return managementError(error);}
}
export type PartnerUserManagementDependencies={origins:ReadonlySet<string>;getPrincipal:(headers:Headers)=>Promise<AuthenticatedPrincipal|null>;repositoryFor:(actorId:string)=>PartnerAccountAccessRepository;sendMail?:AccountAccessDependencies["sendMail"];portalOrigin:string};
export async function partnerUserManagementRoute(request:Request,userId?:string,action?:"invite"|"access",injected?:PartnerUserManagementDependencies):Promise<Response>{
 try{
  const origins=injected?.origins??allowedPartnerOrigins(),url=new URL(request.url),host=request.headers.get("host")??url.host,forwarded=request.headers.get("x-forwarded-host");
  if(![...origins].some(origin=>new URL(origin).host===host)||(forwarded&&forwarded!==host)||(!injected&&!verifyPartnerRequestHost(request.headers))||(request.method!=="GET"&&!origins.has(request.headers.get("origin")??"")))return json({error:"Forbidden"},403);
  const actor=await (injected?.getPrincipal??getAuthenticatedPrincipal)(request.headers);if(!actor||actor.principalType!=="PARTNER")return json({error:"Forbidden"},403);
  if(!injected)await ensurePartnerOpsRole();
  // Pass the authenticated partner identity through to transactional DB checks.
  const repository=injected?.repositoryFor(actor.userId)??new PartnerAccountAccessRepository(getPartnerOpsPool(),undefined,undefined,actor.userId);
  if(action){await repository.managedUsers(actor.companyId);if(request.method!=="POST")return json({error:"Method not allowed"},405);return staffAccountAccess(request,actor.companyId,userId,action,{repository,origins,portalOrigin:injected?.portalOrigin??process.env.PARTNER_APP_ORIGIN!,sendMail:injected?.sendMail});}
  return manageUsers(request,actor.companyId,userId,repository);
 }catch(error){return managementError(error);}
}
