import "server-only";
import { after, NextResponse } from "next/server";
import { hashPassword } from "better-auth/crypto";
import { AccountLinkIssue, accountEmail, accountHash, accountLinkUrl, accountToken, RESET_REQUEST_MESSAGE, validAccountPassword, validAccountToken } from "./account-access";
import { PartnerAccountAccessRepository } from "./account-access-repository";
import { sendPartnerAccountEmail, type AccountMailOutcome } from "./account-email";
import { allowedPartnerOrigins, clientAddress, verifyPartnerRequestHost, withPartnerNoStore } from "./security";
import { ensurePartnerRuntimeRole, getPartnerPool } from "./db";
import { readBody } from "./operations-routes";
import { partnerDemoModeEnabled } from "./demo";

export type AccountAccessDependencies = {
  repository:PartnerAccountAccessRepository;
  origins:ReadonlySet<string>;
  portalOrigin:string;
  deferMail?:(work:()=>Promise<void>)=>void;
  sendMail?:(issue:AccountLinkIssue,url:string)=>Promise<AccountMailOutcome>;
};
const json=(body:unknown,status=200)=>withPartnerNoStore(NextResponse.json(body,{status}));
const throttled=(message:string,seconds:number)=>{const response=json({error:message},429);response.headers.set("Retry-After",String(seconds));return response;};
const invalid=()=>json({error:"Check the account details and password requirements."},400);
async function deliver(issue:AccountLinkIssue,token:{token:string;hash:string},deps:AccountAccessDependencies):Promise<AccountMailOutcome>{
  const outcome=await (deps.sendMail??sendPartnerAccountEmail)(issue,accountLinkUrl(deps.portalOrigin,token.token));
  const recorded=await deps.repository.emailResult(token.hash,outcome.delivery==="SENT"||outcome.delivery==="DEMO");
  if(!recorded)return {delivery:"FAILED",message:"A newer account change replaced this link. Use the most recent email."};
  // Even injected transports cannot leak demo credentials from a live deployment.
  if(outcome.delivery==="DEMO"&&!partnerDemoModeEnabled())return {delivery:"FAILED",message:"Email sending could not be confirmed."};
  return outcome.delivery==="DEMO"?outcome:{delivery:outcome.delivery,message:outcome.message};
}
/** Called only after the normal InsulHub Settings token/Origin gateway. */
export async function staffAccountAccess(request:Request,companyId:string,userId:string|undefined,action:"invite"|"access",deps:AccountAccessDependencies):Promise<Response>{
  try{
    const raw=await readBody(request);if(!raw)return invalid();
    const key=accountHash("staff-access:"+companyId+":"+clientAddress(request.headers));
    if(!await deps.repository.rateLimit(key,30))return throttled("Too many account changes. Wait fifteen minutes and try again.",900);
    if(action==="invite"){
      const email=accountEmail(raw.email),name=typeof raw.name==="string"?raw.name.trim():"";
      if(Object.keys(raw).some(k=>!["name","email","role"].includes(k))||!email||!name||name.length>160||(raw.role!==undefined&&raw.role!=="ADMIN"&&raw.role!=="SALES"))return invalid();
      const token=accountToken(),issue=await deps.repository.invite(companyId,name,email,token.hash,(raw.role??"SALES") as "ADMIN"|"SALES");
      if(!issue)return json({error:"Company not found or inactive."},404);
      if(!issue.issued)return throttled("An invitation was recently requested. Check the inbox or wait a minute before resending.",60);
      return json({ok:true,...await deliver(issue,token,deps)});
    }
    if(!userId||Object.keys(raw).some(k=>!["action","password"].includes(k)))return invalid();
    if(raw.action==="PASSWORD"){
      if(!validAccountPassword(raw.password))return invalid();
      return await deps.repository.setPassword(companyId,userId,await hashPassword(raw.password))?json({ok:true}):json({error:"User not found or inactive."},404);
    }
    if(!["INVITE","RESET"].includes(String(raw.action))||raw.password!==undefined)return invalid();
    const token=accountToken(),issue=await deps.repository.issue(companyId,userId,raw.action as "INVITE"|"RESET",token.hash);
    if(!issue)return json({error:"User not found or inactive."},404);
    if(!issue.issued)return throttled("A link was recently requested. Wait a minute before resending.",60);
    return json({ok:true,...await deliver(issue,token,deps)});
  }catch(error){
    const message=error instanceof Error?error.message:"";
    if(message==="ACCESS_EXISTS"||(error as {code?:string})?.code==="23505")return json({error:"This email already belongs to an account. Reload users to check."},409);
    if(message==="ACCESS_INVALID")return invalid();
    if(message==="ACCESS_FORBIDDEN")return json({error:"Forbidden"},403);
    return json({error:"The account change could not be confirmed. Reload users before trying again."},503);
  }
}

export async function publicAccountPassword(request:Request,action:"request"|"complete",injected?:AccountAccessDependencies):Promise<Response>{
  try{
    if(request.method!=="POST")return json({error:"Method not allowed"},405);
    const origins=injected?.origins??allowedPartnerOrigins();
    const url=new URL(request.url),host=request.headers.get("host")??url.host,forwarded=request.headers.get("x-forwarded-host");
    if(!origins.has(request.headers.get("origin")??"")||![...origins].some(origin=>new URL(origin).host===host)||(forwarded&&forwarded!==host)||(!injected&&!verifyPartnerRequestHost(request.headers)))return json({error:"Forbidden"},403);
    if(!injected)await ensurePartnerRuntimeRole();
    const deps=injected??{repository:new PartnerAccountAccessRepository(getPartnerPool()),origins,portalOrigin:process.env.PARTNER_APP_ORIGIN!};
    const raw=await readBody(request);if(!raw)return invalid();
    if(!await deps.repository.rateLimit(accountHash(action+":ip:"+clientAddress(request.headers)),action==="request"?10:20))return json({error:"Too many requests. Wait fifteen minutes and try again."},429);
    if(action==="request"){
      if(Object.keys(raw).some(key=>key!=="email")||!accountEmail(raw.email))return invalid();
      const email=accountEmail(raw.email)!;
      if(!await deps.repository.rateLimit(accountHash("request:email:"+email),3))return json({message:RESET_REQUEST_MESSAGE});
      const token=accountToken(),issue=await deps.repository.requestReset(email,token.hash);
      if(issue?.issued){
        // Email latency/failure must not reveal account existence to the requester.
        (deps.deferMail ?? after)(async()=>{try{await deliver(issue,token,deps);}catch{/* Never log email links or provider errors. */}});
      }
      return json({message:RESET_REQUEST_MESSAGE});
    }
    if(Object.keys(raw).some(key=>!["token","password"].includes(key))||!validAccountToken(raw.token)||!validAccountPassword(raw.password))return invalid();
    const changed=await deps.repository.complete(accountHash(raw.token),await hashPassword(raw.password));
    return changed?json({ok:true}):json({error:"This link is invalid, expired or already used. Request a new link."},400);
  }catch{return json({error:"Account access is temporarily unavailable. Please try again later."},503);}
}
