import "server-only";
import { createHash } from "node:crypto";
import { mapQuoteToLegacyAdapterShape } from "../quote-adapter";
import { canonicalJson } from "../site-plan-hash";
import { readBoundLegacyCredential, type BoundLegacyCredential } from "./claimed-credential";
import type { LegacyCallContext, LegacyFrozenPlan, LegacyLeadInput, LegacyOutcome } from "./types";
import { ambiguous, conflict, definiteFailure } from "./types";

export const INSULHUB_LIVE_CONTRACT = "insulhub-one-shot-v1";
export const INSULHUB_GRAPHQL_ENDPOINT = "https://api.insulhub.nz/graphql";

const LOGIN = `mutation Login($email:String!,$password:String!){loginUser(email:$email,password:$password){token user{_id email role firstname lastname}}}`;
const CREATE = `mutation PartnerCreateJob($input:CreateJobInput!){createJob(input:$input){_id jobNumber stage client{contactDetails{name phoneMobile email}}}}`;
const READ = `query PartnerReadJob($_id:ObjectId!){job(_id:$_id){_id jobNumber stage notes archivedAt sitePlanNotes lead{leadStatus leadSource} client{contactDetails{name phoneMobile email streetAddress suburb city postCode}} quote{quoteNumber date status c_contractPrice c_gst c_total c_deposit depositPercentage consentFee totalOverridden depositOverridden deferralDate sendFollowupEmail sendFollowupText quoteNote quoteResultNote extras{name price} wall{SQMPrice SQM cavityDepthMeters c_RValue c_bagCount internal} ceiling{SQMPrice SQM RValue downlights c_thickness c_bagCount} files_QuoteSitePlan}}}`;
const UPDATE = `mutation PartnerUpdateQuote($input:UpdateJobInput!,$emailQuoteToCustomer:Boolean){updateJob(input:$input,emailQuoteToCustomer:$emailQuoteToCustomer){_id stage quote{quoteNumber date status c_contractPrice c_gst c_total c_deposit depositPercentage consentFee totalOverridden depositOverridden deferralDate sendFollowupEmail sendFollowupText quoteNote quoteResultNote extras{name price} wall{SQMPrice SQM cavityDepthMeters c_RValue c_bagCount internal} ceiling{SQMPrice SQM RValue downlights c_thickness c_bagCount} files_QuoteSitePlan}}}`;
const ATTACH = `mutation PartnerAttachPlans($_id:ObjectId!,$documentType:UploadedFileType!,$fileNames:[String!]!){addFiles(_id:$_id,documentType:$documentType,fileNames:$fileNames)}`;

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
const objectId = (value: unknown): string | null => typeof value === "string" && /^[0-9a-f]{24}$/.test(value) ? value : null;
const positive = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
const fingerprint = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");

type GraphResult<T> = { kind:"OK"; data:T } | { kind:"REJECTED" } | { kind:"AMBIGUOUS" } | { kind:"UNAVAILABLE" };

async function boundedJson(response:Response,maxBytes=128*1024):Promise<unknown>{
  const type=response.headers.get("content-type")?.split(";",1)[0]?.trim().toLowerCase();
  if(type!=="application/json"&&type!=="application/graphql-response+json")return null;
  const declared=Number(response.headers.get("content-length")??0);if(Number.isFinite(declared)&&declared>maxBytes)return null;
  if(!response.body)return null;const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;if(value){size+=value.byteLength;if(size>maxBytes){await reader.cancel();return null;}chunks.push(value);}}}
  catch{return null;}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{return null;}
}

async function graphql<T>(endpoint:string,token:string|null,query:string,variables:RecordValue,context?:LegacyCallContext,mutation=false,fetchImpl:typeof fetch=fetch):Promise<GraphResult<T>>{
  const timeout=AbortSignal.timeout(Math.max(1,Math.min(context?.remainingMs()??8_000,15_000)));
  const signal=context?AbortSignal.any([context.signal,timeout]):timeout;
  try{
    const response=await fetchImpl(endpoint,{method:"POST",redirect:"error",cache:"no-store",headers:{"content-type":"application/json",...(token?{"x-access-token":token}:{})},body:JSON.stringify({query,variables}),signal});
    if(!response.ok)return mutation?{kind:"AMBIGUOUS"}:response.status>=500?{kind:"UNAVAILABLE"}:{kind:"REJECTED"};
    const body=await boundedJson(response) as {data?:T;errors?:unknown[]}|null;
    if(!body||!body.data)return mutation?{kind:"AMBIGUOUS"}:body?.errors?.length?{kind:"REJECTED"}:{kind:"UNAVAILABLE"};
    // A mutation may return useful identity data alongside GraphQL errors. It
    // is safer to preserve and verify that identity than discard it and risk a
    // second create. Read-only responses with errors remain rejected.
    if(body.errors?.length&&!mutation)return{kind:"REJECTED"};
    return{kind:"OK",data:body.data};
  }catch{return mutation?{kind:"AMBIGUOUS"}:{kind:"UNAVAILABLE"};}
}

export async function exchangeInsulhubLogin(email:string,password:string,fetchImpl:typeof fetch=fetch):Promise<
  {kind:"CONFIRMED";accessToken:string;quotePrefix:string;userId:string}|{kind:"REJECTED"}|{kind:"UNAVAILABLE"}
>{
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||password.length<1||password.length>256)return{kind:"REJECTED"};
  const result=await graphql<{loginUser?:unknown}>(INSULHUB_GRAPHQL_ENDPOINT,null,LOGIN,{email:email.trim().toLowerCase(),password},undefined,false,fetchImpl);
  if(result.kind!=="OK")return{kind:result.kind==="UNAVAILABLE"?"UNAVAILABLE":"REJECTED"};
  const login=record(result.data.loginUser),user=record(login?.user),token=login?.token;
  const first=typeof user?.firstname==="string"?user.firstname.trim():"",last=typeof user?.lastname==="string"?user.lastname.trim():"";
  const prefix=`${first[0]??""}${last[0]??""}`.toUpperCase();
  if(typeof token!=="string"||!token||token.length>8192||/[\r\n]/.test(token)||!objectId(user?._id)||!/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(prefix))return{kind:"REJECTED"};
  return{kind:"CONFIRMED",accessToken:token,quotePrefix:prefix,userId:String(user!._id)};
}

export interface ActualInsulhubJob {
  id:string;jobNumber:number;stage:string;notes:string;archived:boolean;leadSources:string[];
  contact:{name:string;mobile:string;email:string;street:string;suburb:string;city:string;postcode:string};
  quote:RecordValue|null;files:string[];
}

function parseJob(value:unknown):ActualInsulhubJob|null{
  const row=record(value),client=record(row?.client),contact=record(client?.contactDetails),lead=record(row?.lead),quote=record(row?.quote);
  const id=objectId(row?._id),jobNumber=positive(row?.jobNumber);
  if(!row||!id||!jobNumber||typeof row.stage!=="string"||typeof row.notes!=="string"||!contact||!lead||!Array.isArray(lead.leadSource)||lead.leadSource.some(x=>typeof x!=="string"))return null;
  const parts=[contact.name,contact.phoneMobile,contact.email,contact.streetAddress,contact.suburb,contact.city,contact.postCode];
  if(parts.some(x=>typeof x!=="string"))return null;
  const files=quote?.files_QuoteSitePlan==null?[]:quote.files_QuoteSitePlan;
  if(!Array.isArray(files)||files.some(x=>typeof x!=="string"))return null;
  return{id,jobNumber,stage:String(row.stage),notes:String(row.notes),archived:row.archivedAt!=null,leadSources:lead.leadSource as string[],contact:{name:String(contact.name),mobile:String(contact.phoneMobile),email:String(contact.email),street:String(contact.streetAddress),suburb:String(contact.suburb),city:String(contact.city),postcode:String(contact.postCode)},quote,files:files as string[]};
}

export class ActualInsulhubAdapter {
  private constructor(private readonly endpoint:string,private readonly token:string,readonly quotePrefix:string){}
  static from(binding:BoundLegacyCredential):ActualInsulhubAdapter|null{
    const value=readBoundLegacyCredential(binding);
    return value?.identity.adapterMode==="LIVE"&&value.identity.contractVersion===INSULHUB_LIVE_CONTRACT&&value.identity.baseUrl===INSULHUB_GRAPHQL_ENDPOINT&&value.accessToken
      ?new ActualInsulhubAdapter(value.identity.baseUrl,value.accessToken,value.identity.legacyJobPrefix):null;
  }
  async createLead(input:LegacyLeadInput,context:LegacyCallContext):Promise<LegacyOutcome<{id:string;jobNumber:number}>>{
    const markerNote=[input.notes.trim(),input.marker].filter(Boolean).join("\n\n");
    const contactDetails={name:input.customer.name,email:input.customer.email,phoneMobile:input.customer.mobile,streetAddress:input.siteAddress.street,suburb:input.siteAddress.suburb,city:input.siteAddress.city,postCode:input.siteAddress.postcode};
    const payload={notes:markerNote,stage:"LEAD",lead:{leadStatus:"NEW",leadSource:[...input.leadSources],allocation:"UNALLOCATED"},client:{name:input.customer.name,contactDetails,billingDetails:{...contactDetails}}};
    const result=await graphql<{createJob?:unknown}>(this.endpoint,this.token,CREATE,{input:payload},context,true);
    if(result.kind==="AMBIGUOUS"||result.kind==="UNAVAILABLE")return ambiguous();
    if(result.kind==="REJECTED")return definiteFailure("LEGACY_INVALID_INPUT");
    const row=record(result.data.createJob),id=objectId(row?._id),jobNumber=positive(row?.jobNumber);
    return id&&jobNumber?{kind:"CONFIRMED",value:{id,jobNumber}}:ambiguous();
  }
  async readJob(id:string,context:LegacyCallContext):Promise<LegacyOutcome<ActualInsulhubJob>>{
    if(!objectId(id))return definiteFailure("LEGACY_INVALID_INPUT");
    const result=await graphql<{job?:unknown}>(this.endpoint,this.token,READ,{_id:id},context,false);
    if(result.kind==="UNAVAILABLE"||result.kind==="AMBIGUOUS")return ambiguous();
    if(result.kind==="REJECTED")return definiteFailure("LEGACY_NOT_FOUND");
    const job=parseJob(result.data.job);return job&&job.id===id?{kind:"CONFIRMED",value:job}:conflict("LEGACY_READBACK_MISMATCH");
  }
  intendedQuote(jobNumber:number,quoteDraft:Parameters<typeof mapQuoteToLegacyAdapterShape>[0],existingFiles:readonly string[]=[]):{quoteNumber:string;payload:RecordValue;fingerprint:string}{
    const mapped=mapQuoteToLegacyAdapterShape(quoteDraft),quoteNumber=`${this.quotePrefix}-${jobNumber}`;
    const clearedWall={SQMPrice:null,SQM:null,cavityDepthMeters:null,c_RValue:null,c_bagCount:null,internal:null};
    const clearedCeiling={SQMPrice:null,SQM:null,RValue:null,downlights:null,c_thickness:null,c_bagCount:null};
    const quote={...mapped,quoteNumber,status:"UNSET",deferralDate:null,totalOverridden:false,depositOverridden:false,sendFollowupEmail:false,sendFollowupText:false,
      consentFee:0,depositPercentage:0,wall:mapped.wall?{...mapped.wall,internal:false}:clearedWall,ceiling:mapped.ceiling??clearedCeiling,
      files_QuoteSitePlan:[...existingFiles]};
    const payload={stage:"QUOTE",sitePlanNotes:"",quote};
    return{quoteNumber,payload,fingerprint:fingerprint(payload)};
  }
  quoteMatches(job:ActualInsulhubJob,intended:{quoteNumber:string;payload:RecordValue}):boolean{
    const expected=record(intended.payload.quote),actual=job.quote;if(job.stage!=="QUOTE"||!expected||!actual)return false;
    const keys=["quoteNumber","date","status","c_contractPrice","c_gst","c_total","c_deposit","depositPercentage","consentFee","totalOverridden","depositOverridden","deferralDate","sendFollowupEmail","sendFollowupText","quoteNote","quoteResultNote","extras","wall","ceiling"];
    return keys.every(key=>canonicalJson(actual[key]??null)===canonicalJson(expected[key]??null));
  }
  async updateQuote(id:string,intended:{payload:RecordValue},context:LegacyCallContext):Promise<LegacyOutcome<true>>{
    const result=await graphql<{updateJob?:unknown}>(this.endpoint,this.token,UPDATE,{input:{_id:id,...intended.payload},emailQuoteToCustomer:false},context,true);
    if(result.kind==="AMBIGUOUS"||result.kind==="UNAVAILABLE")return ambiguous();
    if(result.kind==="REJECTED")return definiteFailure("LEGACY_INVALID_INPUT");
    return record(result.data.updateJob)?{kind:"CONFIRMED",value:true}:ambiguous();
  }
  async uploadPlan(plan:LegacyFrozenPlan,context:LegacyCallContext):Promise<LegacyOutcome<string>>{
    const url=new URL("/files/upload",this.endpoint);
    const bytes=Uint8Array.from(plan.pdfBytes);const form=new FormData();form.append("files",new Blob([bytes.buffer],{type:"application/pdf"}),plan.remoteFileName);
    try{
      const response=await fetch(url,{method:"POST",redirect:"error",headers:{"x-token":this.token},body:form,signal:AbortSignal.any([context.signal,AbortSignal.timeout(Math.max(1,Math.min(context.remainingMs(),20_000)))])});
      if(!response.ok)return response.status>=500?ambiguous():definiteFailure("LEGACY_UPLOAD_INTEGRITY");
      const body=await boundedJson(response,32*1024) as {fileNames?:unknown}|null;
      const names=body?.fileNames;return Array.isArray(names)&&names.length===1&&typeof names[0]==="string"&&names[0].length<=500?{kind:"CONFIRMED",value:names[0]}:ambiguous();
    }catch{return ambiguous();}
  }
  async attachPlans(id:string,fileNames:readonly string[],context:LegacyCallContext):Promise<LegacyOutcome<true>>{
    const result=await graphql<{addFiles?:unknown}>(this.endpoint,this.token,ATTACH,{_id:id,documentType:"QUOTE_SITE_PLAN",fileNames:[...fileNames]},context,true);
    if(result.kind==="AMBIGUOUS"||result.kind==="UNAVAILABLE")return ambiguous();
    if(result.kind==="REJECTED")return definiteFailure("LEGACY_INVALID_INPUT");
    return{kind:"CONFIRMED",value:true};
  }
}
