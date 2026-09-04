import "server-only";
import { createTrustedEmailHtml, deliverCommunication, type DeliveryMessage, type DeliveryResult } from "../communication-delivery";
import { overlaySql } from "../overlay-db";
import { ACCOUNT_SENDER, type AccountLinkIssue } from "./account-access";
import { partnerDemoModeEnabled } from "./demo";

export type AccountMailOutcome = {delivery:"SENT"|"DEMO"|"FAILED";demoUrl?:string;message:string};
type Sender = {id:string;sender_value:string;provider:string;is_active:boolean;connection_status:string;provider_access_token?:string;provider_refresh_token?:string;provider_token_expires_at?:string|Date|null};
export type AccountEmailDependencies = {
  readSenders:()=>Promise<Sender[]>;
  saveTokens:(sender:Sender,result:DeliveryResult)=>Promise<void>;
  deliver:(message:DeliveryMessage)=>Promise<DeliveryResult>;
};
const productionDependencies:AccountEmailDependencies={
  readSenders:async()=>await overlaySql`SELECT id,sender_value,provider,is_active,connection_status,provider_access_token,provider_refresh_token,provider_token_expires_at FROM communication_senders WHERE lower(sender_value)=${ACCOUNT_SENDER} AND channel='email'` as Sender[],
  saveTokens:async(sender,result)=>{
    if(!result.accessToken)return;
    await overlaySql`UPDATE communication_senders SET provider_access_token=${result.accessToken},
      provider_refresh_token=${result.refreshToken||sender.provider_refresh_token||""},
      provider_token_expires_at=${result.tokenExpiresAt||sender.provider_token_expires_at||null},updated_at=now()
      WHERE id=${sender.id} AND provider='gmail' AND provider_refresh_token=${sender.provider_refresh_token||""}`;
  },
  deliver:deliverCommunication,
};
function escapeAccountHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function renderPartnerAccountEmail(issue: AccountLinkIssue, url: string) {
  const invite = issue.purpose === "INVITE";
  const subject = invite ? "Your InsulHub partner portal invitation" : "Reset your InsulHub partner portal password";
  const heading = invite ? "Welcome to the partner portal" : "Reset your password";
  const action = invite ? "Set up your account" : "Reset password";
  const introduction = invite ? `You have been invited to the InsulHub partner portal for ${issue.company_name}.` : "We received a request to reset your InsulHub partner portal password.";
  const expiry = `This link expires in ${invite ? "48 hours" : "one hour"} and can be used once. If you requested more than one link, use the latest email.`;
  const ignore = invite ? "If you weren’t expecting this invitation, you can ignore this email." : "If you didn’t request this, you can ignore this email. Your password won’t change.";
  const body = [`Hi ${issue.name},`, "", introduction, "", `${action}:`, url, "", expiry, "", ignore, "", "Insulmax"].join("\n");
  const h = { subject: escapeAccountHtml(subject), heading: escapeAccountHtml(heading), name: escapeAccountHtml(issue.name), introduction: escapeAccountHtml(introduction), url: escapeAccountHtml(url), expiry: escapeAccountHtml(expiry), ignore: escapeAccountHtml(ignore) };
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h.subject}</title></head>
<body style="margin:0;background:#f1f5f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${action} for the InsulHub partner portal.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
<tr><td style="background:#1a3a4a;padding:22px 28px"><div style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:.2px">Insul<span style="color:#f97316">Hub</span></div><div style="margin-top:4px;color:#cbd5e1;font-size:13px">Partner portal</div></td></tr>
<tr><td style="padding:30px 28px"><h1 style="margin:0 0 22px;color:#1a3a4a;font-size:25px;line-height:32px">${h.heading}</h1>
<p style="margin:0 0 12px;font-size:16px;line-height:24px">Hi ${h.name},</p><p style="margin:0;color:#475569;font-size:16px;line-height:24px">${h.introduction}</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0"><tr><td style="border-radius:9px;background:#e85d04"><a href="${h.url}" style="display:inline-block;padding:13px 22px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">${action}</a></td></tr></table>
<p style="margin:0;color:#475569;font-size:14px;line-height:22px">${h.expiry}</p>
<p style="margin:22px 0 0;color:#64748b;font-size:13px;line-height:20px">Button not working? Copy this link into your browser:<br><a href="${h.url}" style="color:#1a3a4a;word-break:break-all;overflow-wrap:anywhere">${h.url}</a></p>
<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #e2e8f0;color:#64748b;font-size:13px;line-height:20px">${h.ignore}</p><p style="margin:16px 0 0;color:#1a3a4a;font-size:14px;font-weight:700">Insulmax</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, body, html };
}

export async function sendPartnerAccountEmail(issue:AccountLinkIssue,url:string,deps:AccountEmailDependencies=productionDependencies):Promise<AccountMailOutcome>{
  if(partnerDemoModeEnabled())return {delivery:"DEMO",demoUrl:url,message:"Local demo email only. No email was sent."};
  try{
    const matching=(await deps.readSenders()).filter(row=>row.sender_value.trim().toLowerCase()===ACCOUNT_SENDER && row.is_active);
    const sender=matching[0];
    // No arbitrary default sender, stub, environment-token fallback or duplicate choice.
    if(matching.length!==1||sender.provider!=="gmail"||sender.connection_status!=="connected"||!sender.provider_refresh_token?.trim())
      return {delivery:"FAILED",message:"Account email was not sent. Check the connected reddyn@insulmax.co.nz sender in Configure Senders."};
    const invite=issue.purpose==="INVITE";
    const rendered=renderPartnerAccountEmail(issue,url);
    const result=await deps.deliver({
      channel:"email",provider:"gmail",strictGmailConnection:true,from:ACCOUNT_SENDER,fromName:"Insulmax",
      to:issue.email,subject:rendered.subject,body:rendered.body,trustedHtml:createTrustedEmailHtml(rendered.html),
      providerConfig:{gmailUserId:"me"},accessToken:sender.provider_access_token||"",refreshToken:sender.provider_refresh_token,
      tokenExpiresAt:sender.provider_access_token && sender.provider_token_expires_at ? new Date(sender.provider_token_expires_at).toISOString():null,
      signal:AbortSignal.timeout(15_000),
    });
    if(result.accessToken){try{await deps.saveTokens(sender,result);}catch{/* Provider acceptance is independent of token-cache persistence. */}}
    if(result.ok&&typeof result.providerMessageId==="string"&&result.providerMessageId.trim())
      return {delivery:"SENT",message:invite?"Invitation email sent.":"Password-reset email sent."};
  }catch{/* Never surface provider credentials, response bodies or reset links in errors. */}
  return {delivery:"FAILED",message:"Email sending could not be confirmed. Check the inbox before requesting another link."};
}
