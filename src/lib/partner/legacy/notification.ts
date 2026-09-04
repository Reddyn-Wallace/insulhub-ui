import "server-only";
import { createTrustedEmailHtml, deliverCommunication, type DeliveryMessage, type DeliveryResult } from "../../communication-delivery";
import { overlaySql } from "../../overlay-db";
import { ACCOUNT_SENDER } from "../account-access";
import { partnerDemoModeEnabled } from "../demo";
import type { LegacyCallContext, LegacyNotificationAdapter } from "./types";

function emailHtml(value:string){return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function addressLine(address:{street:string;suburb:string;city:string;postcode:string}){return [address.street,address.suburb,address.city,address.postcode].map(value=>value.trim()).filter(Boolean).join(", ");}
function currency(cents:number){return new Intl.NumberFormat("en-NZ",{style:"currency",currency:"NZD",minimumFractionDigits:2,maximumFractionDigits:2}).format(cents/100);}

export function renderSubmissionNotificationEmail(target:NonNullable<Parameters<LegacyNotificationAdapter["deliver"]>[0]["delivery"]>){
  const address=addressLine(target.propertyAddress),total=currency(target.quoteTotalCents);
  const subject=`New partner job from ${target.companyName} - #${target.legacyJobNumber}`;
  const body=["New partner job",`${target.companyName} has submitted a new job.`,"",`Customer: ${target.customerName}`,`Property: ${address}`,`Quote total: ${total} NZD, incl. GST`,`InsulHub job: #${target.legacyJobNumber}`,"",`Open job: ${target.jobUrl}`].join("\n");
  const h={company:emailHtml(target.companyName),customer:emailHtml(target.customerName),address:emailHtml(address),total:emailHtml(total),number:emailHtml(String(target.legacyJobNumber)),url:emailHtml(target.jobUrl)};
  const detail=(label:string,value:string)=>`<tr><td style="padding:10px 0;color:#64748b;font-size:13px;line-height:18px;vertical-align:top;width:120px">${label}</td><td style="padding:10px 0;color:#0f172a;font-size:15px;font-weight:600;line-height:20px;vertical-align:top">${value}</td></tr>`;
  const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${emailHtml(subject)}</title></head><body style="margin:0;background:#f1f5f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${h.company} submitted job #${h.number}.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden"><tr><td style="background:#1a3a4a;padding:22px 28px"><div style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:.2px">Insul<span style="color:#f97316">Hub</span></div><div style="margin-top:4px;color:#cbd5e1;font-size:13px">Partner submission</div></td></tr><tr><td style="padding:30px 28px"><h1 style="margin:0;color:#1a3a4a;font-size:25px;line-height:32px">New partner job</h1><p style="margin:10px 0 22px;color:#475569;font-size:16px;line-height:24px"><strong>${h.company}</strong> has submitted a new job.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0">${detail("Customer",h.customer)}${detail("Property",h.address)}${detail("Quote total",`${h.total} <span style="color:#64748b;font-size:12px;font-weight:400">NZD, incl. GST</span>`)}${detail("InsulHub job",`#${h.number}`)}</table><table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:26px"><tr><td style="border-radius:9px;background:#e85d04"><a href="${h.url}" style="display:inline-block;padding:13px 22px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">Open job in InsulHub</a></td></tr></table><p style="margin:24px 0 0;color:#64748b;font-size:12px;line-height:18px">This notification was sent after the partner job was successfully created in InsulHub.</p></td></tr></table></td></tr></table></body></html>`;
  return{subject,body,html};
}

type Sender={id:string;sender_value:string;provider:string;is_active:boolean;connection_status:string;provider_access_token?:string;provider_refresh_token?:string;provider_token_expires_at?:string|Date|null};
export type ProductionNotificationDependencies={readSenders:()=>Promise<Sender[]>;saveTokens:(sender:Sender,result:DeliveryResult)=>Promise<void>;deliver:(message:DeliveryMessage)=>Promise<DeliveryResult>};
const productionDependencies:ProductionNotificationDependencies={
  readSenders:async()=>await overlaySql`SELECT id,sender_value,provider,is_active,connection_status,provider_access_token,provider_refresh_token,provider_token_expires_at FROM communication_senders WHERE lower(sender_value)=${ACCOUNT_SENDER} AND channel='email'` as Sender[],
  saveTokens:async(sender,result)=>{if(!result.accessToken)return;await overlaySql`UPDATE communication_senders SET provider_access_token=${result.accessToken},provider_refresh_token=${result.refreshToken||sender.provider_refresh_token||""},provider_token_expires_at=${result.tokenExpiresAt||sender.provider_token_expires_at||null},updated_at=now() WHERE id=${sender.id} AND provider='gmail' AND provider_refresh_token=${sender.provider_refresh_token||""}`;},
  deliver:deliverCommunication,
};

export function notificationJobOrigin(env:NodeJS.ProcessEnv=process.env):string|null{
  const raw=env.PARTNER_INSULHUB_APP_ORIGIN?.trim();if(!raw)return null;let url:URL;try{url=new URL(raw);}catch{return null;}
  if(url.origin!==raw||url.username||url.password||url.pathname!=="/"||url.search||url.hash)return null;
  if(env.NODE_ENV==="production")return url.protocol==="https:"?url.origin:null;
  return ["127.0.0.1","localhost","[::1]"].includes(url.hostname)&&["http:","https:"].includes(url.protocol)?url.origin:null;
}

class ProductionNotificationAdapter implements LegacyNotificationAdapter{
  constructor(private readonly env:NodeJS.ProcessEnv,private readonly deps:ProductionNotificationDependencies){}
  async deliver(input:Parameters<LegacyNotificationAdapter["deliver"]>[0],context:LegacyCallContext){
    const target=input.delivery,origin=notificationJobOrigin(this.env);
    if(input.fictionalSummary!=="SUBMISSION_COMPLETED"||!target||!origin||target.jobUrl!==new URL(`/jobs/${target.legacyJobId}`,origin).toString()
      ||!/^[a-f0-9]{24}$/.test(target.legacyJobId)||!Number.isSafeInteger(target.legacyJobNumber)||target.legacyJobNumber<1
      ||target.companyName.length<1||target.companyName.length>160||target.companyName.trim()!==target.companyName||/[\r\n]/.test(target.companyName)
      ||target.customerName.length<1||target.customerName.length>200||target.customerName.trim()!==target.customerName||/[\r\n]/.test(target.customerName)
      ||!Number.isSafeInteger(target.quoteTotalCents)||target.quoteTotalCents<0
      ||Object.entries(target.propertyAddress).some(([key,value])=>typeof value!=="string"||value.trim()!==value||/[\r\n]/.test(value)||value.length>(key==="street"?500:key==="postcode"?20:200))
      ||target.recipientEmail!==target.recipientEmail.trim().toLowerCase()||target.recipientEmail.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target.recipientEmail))return{kind:"PERMANENT",code:"NOTIFICATION_REJECTED"} as const;
    if(context.signal.aborted||context.remainingMs()<3_000)return{kind:"FAILED",noEffect:true} as const;
    let started=false;
    try{
      const matches=(await this.deps.readSenders()).filter(row=>row.sender_value.trim().toLowerCase()===ACCOUNT_SENDER&&row.is_active);
      const sender=matches[0];if(matches.length!==1||sender.provider!=="gmail"||sender.connection_status!=="connected"||!sender.provider_refresh_token?.trim())return{kind:"FAILED",noEffect:true} as const;
      started=true;
      const rendered=renderSubmissionNotificationEmail(target);
      const result=await this.deps.deliver({channel:"email",provider:"gmail",strictGmailConnection:true,from:ACCOUNT_SENDER,fromName:"Insulmax",to:target.recipientEmail,
        subject:rendered.subject,body:rendered.body,trustedHtml:createTrustedEmailHtml(rendered.html),providerConfig:{gmailUserId:"me"},
        accessToken:sender.provider_access_token||"",refreshToken:sender.provider_refresh_token,
        tokenExpiresAt:sender.provider_access_token&&sender.provider_token_expires_at?new Date(sender.provider_token_expires_at).toISOString():null,signal:context.signal});
      if(result.accessToken){try{await this.deps.saveTokens(sender,result);}catch{/* Gmail acceptance is independent of token-cache persistence. */}}
      const providerId=result.providerMessageId?.trim();
      if(result.ok&&providerId&&/^[A-Za-z0-9_-]{1,160}$/.test(providerId))return{kind:"DELIVERED",receipt:`gmail:${providerId}`} as const;
      return result.ok?{kind:"AMBIGUOUS"} as const:{kind:"FAILED",noEffect:true} as const;
    }catch{return started?{kind:"AMBIGUOUS"} as const:{kind:"FAILED",noEffect:true} as const;}
  }
  async lookup(receipt:string,context:LegacyCallContext){
    if(context.signal.aborted||context.remainingMs()<=0)return{kind:"FAILED",noEffect:true} as const;
    return /^gmail:[A-Za-z0-9_-]{1,160}$/.test(receipt)?{kind:"DELIVERED"} as const:{kind:"PERMANENT",code:"NOTIFICATION_REJECTED"} as const;
  }
}

export type FictionalNotificationStep = "ENQUEUED" | "DELIVERED" | "AMBIGUOUS" | "FAILED" | "PERMANENT";

export interface FictionalNotificationController extends LegacyNotificationAdapter {
  readonly calls: Array<{ companyId: string; jobId: string; requestId: string; summary: string }>;
  readonly enqueues: Array<{ eventId:string;companyId: string; jobId: string; requestId: string; kind: string }>;
  readonly deliveries: Array<{ eventId:string;companyId: string; jobId: string; requestId: string; kind: string }>;
  queueLookup(receipt:string,...steps:FictionalNotificationStep[]):this;
}

export class FictionalNotificationWorld {
  deliverCalls=0;
  lookupCalls=0;
  readonly enqueues: Array<{ eventId:string;companyId: string; jobId: string; requestId: string; kind: string }> = [];
  readonly deliveries: Array<{ eventId:string;companyId: string; jobId: string; requestId: string; kind: string }> = [];
  readonly outcomes = new Map<string, FictionalNotificationStep>();
  readonly receipts = new Map<string, FictionalNotificationStep>();
  readonly receiptInputs = new Map<string,{eventId:string;companyId:string;jobId:string;requestId:string;kind:string}>();
  readonly lookupScripts = new Map<string,FictionalNotificationStep[]>();
  clear(){this.deliverCalls=0;this.lookupCalls=0;this.enqueues.length=0;this.deliveries.length=0;this.outcomes.clear();this.receipts.clear();this.receiptInputs.clear();this.lookupScripts.clear();}
}

type FictionalNotificationRuntime = NodeJS.Process & { __insulHubFictionalNotificationWorld?: FictionalNotificationWorld };
const notificationRuntime = process as FictionalNotificationRuntime;
const processNotificationWorld = notificationRuntime.__insulHubFictionalNotificationWorld ??= new FictionalNotificationWorld();

export function resetProcessFictionalNotificationWorld():void{processNotificationWorld.clear();}
export function processFictionalNotificationProjection(){return{deliverCalls:processNotificationWorld.deliverCalls,lookupCalls:processNotificationWorld.lookupCalls,enqueues:processNotificationWorld.enqueues.map(value=>({...value})),deliveries:processNotificationWorld.deliveries.map(value=>({...value}))};}

class FictionalNotificationAdapter implements FictionalNotificationController {
  readonly calls: Array<{ companyId: string; jobId: string; requestId: string; summary: string }> = [];
  get enqueues() { return this.world.enqueues; }
  get deliveries() { return this.world.deliveries; }
  private readonly script: FictionalNotificationStep[];
  constructor(private readonly world: FictionalNotificationWorld, script: readonly FictionalNotificationStep[] = ["DELIVERED"]) { this.script = [...script]; }
  queueLookup(receipt:string,...steps:FictionalNotificationStep[]){this.world.lookupScripts.set(receipt,[...(this.world.lookupScripts.get(receipt)??[]),...steps]);return this;}
  async deliver(input: { eventId: string; companyId: string; jobId: string; requestId: string; fictionalSummary: "SUBMISSION_COMPLETED" | "RECONCILIATION_REQUIRED" },context:LegacyCallContext) {
    this.world.deliverCalls+=1;
    if(context.signal.aborted||context.remainingMs()<=0)return {kind:"FAILED",noEffect:true} as const;
    this.calls.push({ companyId: input.companyId, jobId: input.jobId, requestId: input.requestId, summary: `[FICTIONAL] ${input.fictionalSummary}` });
    const key = `${input.eventId}:${input.companyId}:${input.jobId}:${input.requestId}:${input.fictionalSummary}`;
    if (!/^[0-9a-f-]{36}$/i.test(input.eventId)) return { kind: "FAILED", noEffect: true } as const;
    const result = this.world.outcomes.get(key) ?? this.script.shift() ?? "DELIVERED";
    this.world.outcomes.set(key, result);
    if (result === "AMBIGUOUS") return { kind: result } as const;
    if (result === "FAILED") return { kind: result, noEffect: true } as const;
    if (result === "PERMANENT") return { kind: result, code: "NOTIFICATION_REJECTED" } as const;
    const receipt=`fictional:${input.eventId}`;this.world.receipts.set(receipt,result);this.world.receiptInputs.set(receipt,{eventId:input.eventId,companyId:input.companyId,jobId:input.jobId,requestId:input.requestId,kind:input.fictionalSummary});
    if (!this.enqueues.some((entry) => entry.eventId===input.eventId)) this.enqueues.push({ eventId:input.eventId,companyId: input.companyId, jobId: input.jobId, requestId: input.requestId, kind: input.fictionalSummary });
    if (result === "DELIVERED" && !this.deliveries.some((delivery) => delivery.eventId===input.eventId)) this.deliveries.push({ eventId:input.eventId,companyId: input.companyId, jobId: input.jobId, requestId: input.requestId, kind: input.fictionalSummary });
    return context.signal.aborted||context.remainingMs()<=0?{kind:"AMBIGUOUS"} as const:{ kind: result, receipt } as const;
  }
  async lookup(receipt:string,context:LegacyCallContext){this.world.lookupCalls+=1;if(context.signal.aborted||context.remainingMs()<=0)return {kind:"FAILED",noEffect:true} as const;const script=this.world.lookupScripts.get(receipt);const result=script?.shift()??this.world.receipts.get(receipt);if(result==="DELIVERED"){this.world.receipts.set(receipt,result);const input=this.world.receiptInputs.get(receipt);if(input&&!this.deliveries.some((item)=>item.eventId===input.eventId))this.deliveries.push(input);return {kind:"DELIVERED"} as const;}if(result==="ENQUEUED")return {kind:"PENDING"} as const;if(result==="FAILED")return {kind:"FAILED",noEffect:true} as const;if(result==="PERMANENT")return {kind:"PERMANENT",code:"NOTIFICATION_REJECTED"} as const;return {kind:"AMBIGUOUS"} as const;}
}

export function createFictionalNotificationAdapter(env: NodeJS.ProcessEnv, script: readonly FictionalNotificationStep[] = ["DELIVERED"]): FictionalNotificationController | null {
  if (process.env.NODE_ENV === "production") return null;
  try { return partnerDemoModeEnabled(env) ? new FictionalNotificationAdapter(processNotificationWorld, script) : null; } catch { return null; }
}

export function createFictionalNotificationAdapterTestHarness(script: readonly FictionalNotificationStep[] = ["DELIVERED"], world = new FictionalNotificationWorld()): FictionalNotificationController | null {
  return process.env.NODE_ENV === "test" && Boolean(process.env.VITEST) ? new FictionalNotificationAdapter(world, script) : null;
}

export function productionNotificationAdapter(env:NodeJS.ProcessEnv=process.env): LegacyNotificationAdapter | null {
  if(env.NODE_ENV==="test")return null;
  try{if(partnerDemoModeEnabled(env))return null;}catch{/* Non-demo production configuration continues below. */}
  return notificationJobOrigin(env)?new ProductionNotificationAdapter(env,productionDependencies):null;
}

export function createProductionNotificationAdapterTestHarness(env:NodeJS.ProcessEnv,deps:ProductionNotificationDependencies):LegacyNotificationAdapter|null{
  return process.env.NODE_ENV==="test"&&Boolean(process.env.VITEST)&&notificationJobOrigin(env)?new ProductionNotificationAdapter(env,deps):null;
}
