import { describe,expect,it,vi } from "vitest";
import { createProductionNotificationAdapterTestHarness,notificationJobOrigin,productionNotificationAdapter,renderSubmissionNotificationEmail,type ProductionNotificationDependencies } from "./notification";
import type { LegacyCallContext,NotificationDeliveryContext } from "./types";

const eventId="11111111-1111-4111-8111-111111111111",companyId="22222222-2222-4222-8222-222222222222",jobId="33333333-3333-4333-8333-333333333333",requestId="44444444-4444-4444-8444-444444444444";
const env={NODE_ENV:"test",PARTNER_INSULHUB_APP_ORIGIN:"http://127.0.0.1:3000"} as NodeJS.ProcessEnv;
const target:NotificationDeliveryContext={recipientEmail:"reddyn.wallace@gmail.com",companyName:"Northwind Insulation",customerName:"Hine Te Rangi",propertyAddress:{street:"14 Rimu Street",suburb:"Te Aro",city:"Wellington",postcode:"6011"},quoteTotalCents:152950,legacyJobId:"6a979ecce193712a011df66d",legacyJobNumber:28859,jobUrl:"http://127.0.0.1:3000/jobs/6a979ecce193712a011df66d"};
const context:LegacyCallContext={signal:new AbortController().signal,remainingMs:()=>30_000};
const message={eventId,companyId,jobId,requestId,fictionalSummary:"SUBMISSION_COMPLETED" as const,delivery:target};
function dependencies(overrides:Partial<ProductionNotificationDependencies>={}):ProductionNotificationDependencies{return{readSenders:vi.fn(async()=>[{id:"sender-1",sender_value:"reddyn@insulmax.co.nz",provider:"gmail",is_active:true,connection_status:"connected",provider_access_token:"access",provider_refresh_token:"refresh",provider_token_expires_at:"2099-01-01T00:00:00.000Z"}]),saveTokens:vi.fn(async()=>undefined),deliver:vi.fn(async()=>({ok:true,providerMessageId:"gmail_message_28859"})),...overrides};}

describe("production partner submission notification",()=>{
  it("accepts only a configured canonical application origin",()=>{
    expect(notificationJobOrigin(env)).toBe("http://127.0.0.1:3000");
    expect(notificationJobOrigin({...env,PARTNER_INSULHUB_APP_ORIGIN:"http://evil.test"})).toBeNull();
    expect(notificationJobOrigin({...env,NODE_ENV:"production",PARTNER_INSULHUB_APP_ORIGIN:"http://127.0.0.1:3000"})).toBeNull();
    expect(notificationJobOrigin({...env,NODE_ENV:"production",PARTNER_INSULHUB_APP_ORIGIN:"https://insulhub.example"})).toBe("https://insulhub.example");
    expect(productionNotificationAdapter(env)).toBeNull();
  });
  it("uses only the connected Insulmax Gmail sender and returns a namespaced acceptance receipt",async()=>{
    const deps=dependencies(),adapter=createProductionNotificationAdapterTestHarness(env,deps)!;
    await expect(adapter.deliver(message,context)).resolves.toEqual({kind:"DELIVERED",receipt:"gmail:gmail_message_28859"});
    expect(deps.deliver).toHaveBeenCalledWith(expect.objectContaining({provider:"gmail",strictGmailConnection:true,from:"reddyn@insulmax.co.nz",to:"reddyn.wallace@gmail.com",subject:"New partner job from Northwind Insulation - #28859"}));
    const sent=(deps.deliver as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sent.body).toContain("Customer: Hine Te Rangi");expect(sent.body).toContain("Property: 14 Rimu Street, Te Aro, Wellington, 6011");expect(sent.body).toContain("Quote total: $1,529.50 NZD, incl. GST");expect(sent.body).toContain(target.jobUrl);expect(sent.body).not.toContain("undefined");
    expect(sent.trustedHtml.html).toContain("Open job in InsulHub");expect(sent.trustedHtml.html).toContain("background:#1a3a4a");
    await expect(adapter.lookup("gmail:gmail_message_28859",context)).resolves.toEqual({kind:"DELIVERED"});
    expect(deps.readSenders).toHaveBeenCalledOnce();
  });
  it("escapes hostile submitted values once and rejects header injection",async()=>{
    const hostile={...target,companyName:`A & B <Partners> \"'`,customerName:`Hine <script>alert(1)</script> & Co`};
    const rendered=renderSubmissionNotificationEmail(hostile);
    expect(rendered.html).toContain("A &amp; B &lt;Partners&gt; &quot;&#39;");expect(rendered.html).not.toContain("<script>");expect(rendered.html).toContain("Hine &lt;script&gt;alert(1)&lt;/script&gt; &amp; Co");
    const deps=dependencies(),adapter=createProductionNotificationAdapterTestHarness(env,deps)!;
    await expect(adapter.deliver({...message,delivery:{...target,companyName:"Northwind\r\nBcc: victim@example.test"}},context)).resolves.toEqual({kind:"PERMANENT",code:"NOTIFICATION_REJECTED"});expect(deps.deliver).not.toHaveBeenCalled();
  });
  it("fails closed before sending for duplicate/wrong senders or a mismatched job link",async()=>{
    const wrong=dependencies({readSenders:vi.fn(async()=>[{id:"x",sender_value:"other@example.test",provider:"gmail",is_active:true,connection_status:"connected",provider_refresh_token:"refresh"}])});
    const adapter=createProductionNotificationAdapterTestHarness(env,wrong)!;
    await expect(adapter.deliver(message,context)).resolves.toEqual({kind:"FAILED",noEffect:true});expect(wrong.deliver).not.toHaveBeenCalled();
    const deps=dependencies(),valid=createProductionNotificationAdapterTestHarness(env,deps)!;
    await expect(valid.deliver({...message,delivery:{...target,jobUrl:"http://127.0.0.1:3000/jobs/aaaaaaaaaaaaaaaaaaaaaaaa"}},context)).resolves.toEqual({kind:"PERMANENT",code:"NOTIFICATION_REJECTED"});expect(deps.deliver).not.toHaveBeenCalled();
  });
  it("treats a thrown post-dispatch result as ambiguous and never claims Gmail lookup scope",async()=>{
    const deps=dependencies({deliver:vi.fn(async()=>{throw new Error("response lost");})}),adapter=createProductionNotificationAdapterTestHarness(env,deps)!;
    await expect(adapter.deliver(message,context)).resolves.toEqual({kind:"AMBIGUOUS"});
    await expect(adapter.lookup("not-gmail",context)).resolves.toEqual({kind:"PERMANENT",code:"NOTIFICATION_REJECTED"});
  });
});
