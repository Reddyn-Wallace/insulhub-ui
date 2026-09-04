import {describe,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {encryptLegacyCredential} from "../legacy-credentials";
import {BoundLegacyCredential} from "./claimed-credential";
import {ActualInsulhubAdapter,exchangeInsulhubLogin,INSULHUB_GRAPHQL_ENDPOINT,INSULHUB_LIVE_CONTRACT,type ActualInsulhubJob} from "./insulhub-live";
import type {LegacyCallContext,LegacyLeadInput} from "./types";
import {createQuoteDraft} from "../quote";

const companyId="11111111-1111-4111-8111-111111111111",requestId="22222222-2222-4222-8222-222222222222";
const keyring={activeVersion:1,keys:new Map([[1,Buffer.alloc(32,7)]])};
const context:LegacyCallContext={signal:new AbortController().signal,remainingMs:()=>20_000};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
function binding(){const encrypted=encryptLegacyCredential({accessToken:"company-token"},{companyId,endpoint:INSULHUB_GRAPHQL_ENDPOINT},keyring);return BoundLegacyCredential.bind({companyId,requestId,adapterMode:"LIVE",contractVersion:INSULHUB_LIVE_CONTRACT,legacyJobPrefix:"RW",legacyBaseUrl:INSULHUB_GRAPHQL_ENDPOINT,legacyCredentialCiphertext:encrypted.ciphertext,legacyCredentialNonce:encrypted.nonce,legacyCredentialKeyVersion:1,legacyCredentialFingerprint:createHash("sha256").update(encrypted.ciphertext).update(encrypted.nonce).digest("hex"),legacyCredentialUpdatedAt:new Date().toISOString()},{env:{NODE_ENV:"test",PARTNER_LEGACY_ALLOWED_ORIGINS:"https://api.insulhub.nz"},keyring})!;}

describe("actual InsulHub live adapter",()=>{
  it("exchanges a password once and derives the existing quote initials",async()=>{
    const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));expect(body.variables).toEqual({email:"reddyn@example.com",password:"not-stored"});return json({data:{loginUser:{token:"token",user:{_id:"64abcdefabcdefabcdefabcd",firstname:"Reddyn",lastname:"Wallace"}}}});});
    await expect(exchangeInsulhubLogin("Reddyn@example.com","not-stored",fetcher as typeof fetch)).resolves.toEqual({kind:"CONFIRMED",accessToken:"token",quotePrefix:"RW",userId:"64abcdefabcdefabcdefabcd"});
  });

  it("uses only the proven create/update/upload/attach shapes and never emails the customer",async()=>{
    const calls:Array<{url:string;init:RequestInit}>=[];
    const fetcher=vi.fn(async(input:URL|RequestInfo,init:RequestInit={})=>{const url=String(input);calls.push({url,init});
      if(url.endsWith("/files/upload"))return json({fileNames:["stored-partner-plan.pdf"]});
      const body=JSON.parse(String(init.body));
      if(body.query.includes("PartnerCreateJob"))return json({data:{createJob:{_id:"64abcdefabcdefabcdefabcd",jobNumber:321,stage:"LEAD",client:{contactDetails:{name:"Test Customer",phoneMobile:"021",email:"test@example.com"}}}}});
      if(body.query.includes("PartnerUpdateQuote"))return json({data:{updateJob:{_id:"64abcdefabcdefabcdefabcd",stage:"QUOTE",quote:{quoteNumber:"RW-321"}}}});
      if(body.query.includes("PartnerAttachPlans"))return json({data:{addFiles:true}});
      throw new Error("unexpected request");
    });
    vi.stubGlobal("fetch",fetcher);
    try{
      const adapter=ActualInsulhubAdapter.from(binding())!;
      const lead:LegacyLeadInput={identity:binding().identity,marker:`PARTNER-SUBMISSION:${companyId}:${requestId}`,canonicalCreateFingerprint:"a".repeat(64),customer:{name:"Test Customer",mobile:"021",email:"test@example.com"},siteAddress:{street:"1 Test Street",suburb:"Test",city:"Auckland",postcode:"1010"},billingModel:"INSULHUB_BILLED",leadSources:["Test Partner"],notes:"One live test"};
      await expect(adapter.createLead(lead,context)).resolves.toEqual({kind:"CONFIRMED",value:{id:"64abcdefabcdefabcdefabcd",jobNumber:321}});
      const quote=createQuoteDraft({wallRateCents:null,ceilingRateCents:null,depositBasisPoints:0,consentFeeCents:0,extras:[],revision:1},"LOCAL","2026-09-01T00:00:00.000Z");
      quote.wall={enabled:true,areaSqm:10,rateCentsPerSqm:10000,cavityDepthCm:10};const intended=adapter.intendedQuote(321,quote);
      expect(intended.quoteNumber).toBe("RW-321");const exactQuote=intended.payload.quote as Record<string,unknown>;expect(exactQuote).toMatchObject({depositPercentage:0,consentFee:0,totalOverridden:false,depositOverridden:false,deferralDate:null,sendFollowupEmail:false,sendFollowupText:false,files_QuoteSitePlan:[],c_contractPrice:1000,c_gst:150,c_total:1150,c_deposit:0});
      const quoteJob={stage:"QUOTE",quote:exactQuote} as ActualInsulhubJob;expect(adapter.quoteMatches(quoteJob,intended)).toBe(true);expect(adapter.quoteMatches({...quoteJob,quote:{...exactQuote,c_contractPrice:999}},intended)).toBe(false);expect(adapter.quoteMatches({...quoteJob,quote:{...exactQuote,sendFollowupEmail:true}},intended)).toBe(false);
      await expect(adapter.updateQuote("64abcdefabcdefabcdefabcd",intended,context)).resolves.toEqual({kind:"CONFIRMED",value:true});
      await expect(adapter.uploadPlan({ordinal:0,artifactId:"33333333-3333-4333-8333-333333333333",remoteFileName:"plan.pdf",contentSha256:"b".repeat(64),byteSize:9,pdfBytes:Buffer.from("%PDF-test"),rendererVersion:"v",templateVersion:"v",templateSha256:"c".repeat(64)},context)).resolves.toEqual({kind:"CONFIRMED",value:"stored-partner-plan.pdf"});
      await expect(adapter.attachPlans("64abcdefabcdefabcdefabcd",["stored-partner-plan.pdf"],context)).resolves.toEqual({kind:"CONFIRMED",value:true});
      const createBody=JSON.parse(String(calls[0].init.body));expect(createBody.variables.input).toMatchObject({stage:"LEAD",lead:{leadSource:["Test Partner"]}});expect(createBody.variables.input).not.toHaveProperty("integrationReference");expect(createBody.variables.input.notes).toContain(lead.marker);
      const updateBody=JSON.parse(String(calls[1].init.body));expect(updateBody.variables.emailQuoteToCustomer).toBe(false);expect(updateBody.variables.input).not.toHaveProperty("expectedVersion");
      expect(new Headers(calls[2].init.headers).get("x-token")).toBe("company-token");expect(calls[2].init.body).toBeInstanceOf(FormData);
      const attachBody=JSON.parse(String(calls[3].init.body));expect(attachBody.variables).toEqual({_id:"64abcdefabcdefabcdefabcd",documentType:"QUOTE_SITE_PLAN",fileNames:["stored-partner-plan.pdf"]});
    }finally{vi.unstubAllGlobals();}
  });

  it("treats any uncertain create response as ambiguous rather than retryable",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("timeout");}));
    try{const adapter=ActualInsulhubAdapter.from(binding())!;const lead={identity:binding().identity,marker:`PARTNER-SUBMISSION:${companyId}:${requestId}`,canonicalCreateFingerprint:"a".repeat(64),customer:{name:"Test",mobile:"021",email:""},siteAddress:{street:"1 Test",suburb:"Test",city:"Auckland",postcode:"1010"},billingModel:"INSULHUB_BILLED" as const,leadSources:["Test Partner"],notes:""};await expect(adapter.createLead(lead,context)).resolves.toMatchObject({kind:"AMBIGUOUS"});}finally{vi.unstubAllGlobals();}
  });
  it("preserves a valid create identity returned alongside GraphQL errors",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>json({data:{createJob:{_id:"64abcdefabcdefabcdefabcd",jobNumber:321}},errors:[{message:"partial"}]})));
    try{const adapter=ActualInsulhubAdapter.from(binding())!;const lead={identity:binding().identity,marker:`PARTNER-SUBMISSION:${companyId}:${requestId}`,canonicalCreateFingerprint:"a".repeat(64),customer:{name:"Test",mobile:"021",email:""},siteAddress:{street:"1 Test",suburb:"Test",city:"Auckland",postcode:"1010"},billingModel:"INSULHUB_BILLED" as const,leadSources:["Test Partner"],notes:""};await expect(adapter.createLead(lead,context)).resolves.toEqual({kind:"CONFIRMED",value:{id:"64abcdefabcdefabcdefabcd",jobNumber:321}});}finally{vi.unstubAllGlobals();}
  });
  it("bounds malformed and oversized mutation responses as ambiguous",async()=>{
    const oversized="x".repeat(129*1024);vi.stubGlobal("fetch",vi.fn(async()=>new Response(oversized,{status:200,headers:{"content-type":"application/json","content-length":String(oversized.length)}})));
    try{const adapter=ActualInsulhubAdapter.from(binding())!;const lead={identity:binding().identity,marker:`PARTNER-SUBMISSION:${companyId}:${requestId}`,canonicalCreateFingerprint:"a".repeat(64),customer:{name:"Test",mobile:"021",email:""},siteAddress:{street:"1 Test",suburb:"Test",city:"Auckland",postcode:"1010"},billingModel:"INSULHUB_BILLED" as const,leadSources:["Test Partner"],notes:""};await expect(adapter.createLead(lead,context)).resolves.toMatchObject({kind:"AMBIGUOUS"});}finally{vi.unstubAllGlobals();}
  });
});
