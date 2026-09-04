import { afterEach, describe, expect, it, vi } from "vitest";
import { renderPartnerAccountEmail, sendPartnerAccountEmail, type AccountEmailDependencies } from "./account-email";
import { createTrustedEmailHtml,deliverCommunication } from "../communication-delivery";
import type { AccountLinkIssue } from "./account-access";

const sender={id:"sender",sender_value:"reddyn@insulmax.co.nz",provider:"gmail",is_active:true,connection_status:"connected",provider_access_token:"selected-access",provider_refresh_token:"selected-refresh",provider_token_expires_at:new Date(Date.now()+3_600_000)};
const issue:AccountLinkIssue={user_id:"person",name:"Person",email:"person@example.test",company_name:"Fictional Company",purpose:"INVITE",issued:true};
const link="https://portal.example.test/partner/set-password#token=fictional";
function fixture(){
  const readSenders=vi.fn(async()=>[sender]);
  const saveTokens=vi.fn(async()=>{});
  const deliver=vi.fn(async()=>({ok:true,providerMessageId:"accepted-message-id"}));
  return {readSenders,saveTokens,deliver};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("partner account email",()=>{
  it("renders reset and invitation HTML with escaped values, the correct expiry and a plain-text fallback", () => {
    for (const purpose of ["RESET", "INVITE"] as const) {
      const rendered=renderPartnerAccountEmail({...issue,purpose,name:'Aroha <script>alert(1)</script>',company_name:'Company & Partners'},link);
      expect(rendered.html).toContain('background:#1a3a4a');
      expect(rendered.html).toContain('href="'+link+'"');
      expect(rendered.html).not.toContain('<script>');
      expect(rendered.html).toContain('&lt;script&gt;');
      expect(rendered.html).toContain(purpose==='RESET'?'Reset password':'Set up your account');
      expect(rendered.body).toContain(link);
      expect(rendered.body).toContain(purpose==='RESET'?'one hour':'48 hours');
      expect(rendered.html).toContain('Insulmax');expect(rendered.html).not.toContain('InsulMAX');
    }
  });
  it("sends branded HTML alongside plain text with the Insulmax sender name",async()=>{
    const deps=fixture();await sendPartnerAccountEmail({...issue,purpose:'RESET'},link,deps);
    expect(deps.deliver).toHaveBeenCalledWith(expect.objectContaining({fromName:'Insulmax',trustedHtml:expect.objectContaining({html:expect.stringContaining('Reset password')})}));
  });
  it("requires the unique, active, connected exact Gmail sender and selected credentials",async()=>{
    for(const rows of [[],[{...sender,provider:"stub"}],[{...sender,sender_value:"other@example.test"}],[{...sender,is_active:false}],[{...sender,connection_status:"disconnected"}],[{...sender,provider_refresh_token:""}],[sender,sender]]){
      const deps=fixture();deps.readSenders.mockResolvedValue(rows);
      expect((await sendPartnerAccountEmail(issue,link,deps)).delivery).toBe("FAILED");
      expect(deps.deliver).not.toHaveBeenCalled();
    }
    const deps=fixture();expect((await sendPartnerAccountEmail(issue,link,deps)).delivery).toBe("SENT");
    expect(deps.deliver).toHaveBeenCalledWith(expect.objectContaining({strictGmailConnection:true,from:sender.sender_value,to:issue.email,accessToken:"selected-access",refreshToken:"selected-refresh",body:expect.stringContaining(link)}));
  });
  it("does not report accepted without a provider message id or expose private provider errors",async()=>{
    for(const deliver of [async()=>({ok:true}),async()=>({ok:false,failureReason:"private-token-and-link"}),async()=>{throw Error("private-token-and-link");}]){
      const outcome=await sendPartnerAccountEmail(issue,link,{...fixture(),deliver});
      expect(outcome.delivery).toBe("FAILED");expect(JSON.stringify(outcome)).not.toContain("private-token-and-link");
    }
  });
  it("caches refreshed credentials, but cache failure does not change confirmed send acceptance",async()=>{
    const deps=fixture();deps.saveTokens.mockRejectedValue(Error("cache down"));
    const result={ok:true,providerMessageId:"accepted",accessToken:"refreshed"};
    const outcome=await sendPartnerAccountEmail({...issue,purpose:"RESET"},link,{...deps,deliver:async()=>result});
    expect(outcome.delivery).toBe("SENT");expect(outcome.message).toContain("Password-reset");
    expect(deps.saveTokens).toHaveBeenCalledWith(sender,result);
  });
  it("local demo never reads sender credentials or sends email",async()=>{
    vi.stubEnv("PARTNER_DEMO_MODE","true");vi.stubEnv("PARTNER_DEMO_CONFIRM","LOCAL_FICTIONAL_DATA_ONLY");vi.stubEnv("PARTNER_APP_ORIGIN","http://127.0.0.1:3000");
    const deps=fixture();expect(await sendPartnerAccountEmail(issue,link,deps)).toMatchObject({delivery:"DEMO",demoUrl:link});
    expect(deps.readSenders).not.toHaveBeenCalled();expect(deps.deliver).not.toHaveBeenCalled();
  });
});
describe("strict Gmail account sending uses and verifies only the selected connection",()=>{
  const message={channel:"email" as const,provider:"gmail" as const,strictGmailConnection:true,from:sender.sender_value,to:issue.email,subject:"Test",body:"Fictional",accessToken:"selected-access",refreshToken:"selected-refresh",tokenExpiresAt:new Date(Date.now()+3_600_000).toISOString()};
  it("checks the exact authorised send-as identity with the same token before any send",async()=>{
    vi.stubEnv("GMAIL_SEND_ACCESS_TOKEN","wrong-environment-token");vi.stubEnv("GMAIL_SEND_USER_ID","wrong-user");
    const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
      expect(init?.headers).toMatchObject({authorization:"Bearer selected-access"});
      expect(init?.redirect).toBe("error");
      return url.includes("/settings/sendAs/")?Response.json({sendAsEmail:sender.sender_value,verificationStatus:"accepted"}):Response.json({id:"gmail-accepted"});
    });vi.stubGlobal("fetch",fetcher);
    expect(await deliverCommunication(message)).toMatchObject({ok:true,providerMessageId:"gmail-accepted"});
    expect(fetcher.mock.calls.map(c=>c[0])).toEqual(["https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs/reddyn%40insulmax.co.nz","https://gmail.googleapis.com/gmail/v1/users/me/messages/send"]);
  });
  it("rejects relabelled accounts, unverified aliases, missing permission and missing identity",async()=>{
    for(const response of [Response.json({sendAsEmail:"different@example.test",isPrimary:true}),Response.json({sendAsEmail:sender.sender_value,verificationStatus:"pending"}),Response.json({}, {status:403}),Response.json({})]){
      const fetcher=vi.fn(async()=>response);vi.stubGlobal("fetch",fetcher);
      await expect(deliverCommunication(message)).rejects.toThrow("not authorised");expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it("cannot use an environment token when selected access and OAuth client configuration are missing",async()=>{
    for(const key of ["GMAIL_CLIENT_ID","GOOGLE_CLIENT_ID","GMAIL_CLIENT_SECRET","GOOGLE_CLIENT_SECRET"])vi.stubEnv(key,"");
    vi.stubEnv("GMAIL_SEND_ACCESS_TOKEN","wrong-environment-token");vi.stubEnv("GMAIL_SEND_REFRESH_TOKEN","wrong-refresh");
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    await expect(deliverCommunication({...message,accessToken:"",tokenExpiresAt:null})).rejects.toThrow("could not be refreshed");expect(fetcher).not.toHaveBeenCalled();
  });
  it("refreshes only the selected token, verifies that refreshed identity, then sends",async()=>{
    vi.stubEnv("GMAIL_CLIENT_ID","client");vi.stubEnv("GMAIL_CLIENT_SECRET","secret");vi.stubEnv("GMAIL_SEND_REFRESH_TOKEN","wrong-refresh");
    const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
      if(url.includes("oauth2.googleapis.com/token")){
        expect(init?.body).toContain("refresh_token=selected-refresh");expect(init?.body).not.toContain("wrong-refresh");
        return Response.json({access_token:"new-selected",expires_in:3600});
      }
      expect(init?.headers).toMatchObject({authorization:"Bearer new-selected"});
      return url.includes("/settings/sendAs/")?Response.json({sendAsEmail:sender.sender_value,isPrimary:true}):Response.json({id:"accepted"});
    });vi.stubGlobal("fetch",fetcher);
    expect(await deliverCommunication({...message,accessToken:"",tokenExpiresAt:null})).toMatchObject({ok:true,accessToken:"new-selected",refreshToken:"selected-refresh"});
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("account sender passes strict verification even when using the real shared delivery adapter",async()=>{
    const fetcher=vi.fn(async(url:string)=>url.includes("/settings/sendAs/")?Response.json({sendAsEmail:"wrong@example.test",isPrimary:true}):Response.json({id:"must-not-send"}));
    vi.stubGlobal("fetch",fetcher);
    const deps:AccountEmailDependencies={...fixture(),deliver:deliverCommunication};
    expect((await sendPartnerAccountEmail(issue,link,deps)).delivery).toBe("FAILED");expect(fetcher).toHaveBeenCalledOnce();
  });
  it("renders trusted branded HTML as UTF-8 multipart and RFC-encodes Unicode subjects",async()=>{
    let raw="";const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
      if(url.includes("/settings/sendAs/"))return Response.json({sendAsEmail:sender.sender_value,isPrimary:true});
      const encoded=JSON.parse(String(init?.body)).raw as string;raw=Buffer.from(encoded.replace(/-/g,"+").replace(/_/g,"/"),"base64").toString("utf8");return Response.json({id:"accepted"});
    });vi.stubGlobal("fetch",fetcher);
    const result=await deliverCommunication({...message,subject:"Māori partner – #28859\r\nBcc: victim@example.test",body:"Plain fallback – Māori",trustedHtml:createTrustedEmailHtml("<main>Branded &amp; safe – Māori</main>")});
    const parts=[...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)(?=\r\n--)/g)].map(match=>Buffer.from(match[1].replace(/\r\n/g,""),"base64").toString("utf8"));
    expect(result.ok).toBe(true);expect(raw).toContain("Content-Type: multipart/alternative");expect(raw).toContain("charset=UTF-8");expect(parts).toEqual(["Plain fallback – Māori","<main>Branded &amp; safe – Māori</main>"]);expect(Math.max(...raw.split("\r\n").map(line=>Buffer.byteLength(line,"utf8")))).toBeLessThanOrEqual(998);
    const subjectLines=raw.split("\r\n").filter(line=>line.startsWith("Subject:")||line.startsWith(" =?UTF-8?B?"));expect(subjectLines.join("\n")).not.toContain("Bcc:");
    for(const word of subjectLines.join(" ").match(/=\?UTF-8\?B\?[^?]+\?=/g)??[])expect(word.length).toBeLessThanOrEqual(75);
  });
  it("keeps existing ASCII text-only MIME output and rejects unbranded HTML objects",async()=>{
    let raw="";const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{if(url.includes("/settings/sendAs/"))return Response.json({sendAsEmail:sender.sender_value,isPrimary:true});raw=Buffer.from((JSON.parse(String(init?.body)).raw as string).replace(/-/g,"+").replace(/_/g,"/"),"base64").toString("utf8");return Response.json({id:"accepted"});});vi.stubGlobal("fetch",fetcher);
    expect((await deliverCommunication({...message,subject:"ASCII subject"})).ok).toBe(true);expect(raw).toContain("Subject: ASCII subject\r\n");expect(raw).toContain("Content-Type: text/plain; charset=UTF-8");expect(raw).not.toContain("multipart/alternative");
    await expect(deliverCommunication({...message,trustedHtml:{html:"<b>forged</b>"} as never})).rejects.toThrow("Trusted email HTML is invalid");
  });
});
