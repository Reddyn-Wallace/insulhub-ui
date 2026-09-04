import { createHash, randomBytes } from "node:crypto";

export const ACCOUNT_SENDER = "reddyn@insulmax.co.nz";
export const RESET_REQUEST_MESSAGE = "If an eligible partner account exists, an email with a link will be sent. Check your inbox and spam folder.";
export type AccountLinkPurpose = "INVITE" | "RESET";
export type AccountLinkIssue = { user_id: string; email: string; name: string; company_name: string; purpose: AccountLinkPurpose; issued: boolean };
export function accountToken() { const token=randomBytes(32).toString("base64url"); return {token,hash:accountHash(token)}; }
export function accountHash(value:string) { return createHash("sha256").update(value).digest("hex"); }
export function validAccountToken(value:unknown):value is string { return typeof value==="string" && /^[A-Za-z0-9_-]{43}$/.test(value); }
export function validAccountPassword(value:unknown):value is string { return typeof value==="string" && value.length>=12 && value.length<=128 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value) && /[\W_]/.test(value); }
export function accountEmail(value:unknown):string|null { if(typeof value!=="string")return null;const email=value.trim().toLowerCase();return email.length<=320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null; }
export function accountLinkUrl(origin:string,token:string):string {
  const base=new URL(origin);
  if(!validAccountToken(token)||base.origin!==origin||base.username||base.password||!["http:","https:"].includes(base.protocol))throw Error("Account email configuration is invalid");
  if(base.protocol!=="https:"&&!["127.0.0.1","localhost","[::1]"].includes(base.hostname))throw Error("Account email configuration is invalid");
  const url=new URL("/partner/set-password",base);url.hash=new URLSearchParams({token}).toString();return url.toString();
}
