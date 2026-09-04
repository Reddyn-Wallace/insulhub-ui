"use client";
import { OpsRequestError } from "./operations-client";
import { JOB_LINK_ERRORS } from "./job-link";

export type PartnerCompanySummary = { id: string; revision: number; name: string; isActive?: boolean };
export async function settingsRequest<T = { ok: true }>(url: string, method = "GET", body?: unknown): Promise<T> {
  let token = "";
  try { if (!url.startsWith("/api/partner/")) token = localStorage.getItem("token") ?? ""; } catch { /* request fails closed */ }
  const headers: Record<string,string> = token ? { "x-access-token": token } : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  let response: Response;
  try { response = await fetch(url, { method, cache: "no-store", credentials: "same-origin", headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  catch { throw new OpsRequestError("Connection lost. Reload to check whether the change was saved before trying again.", 0); }
  if (!response.ok) {
    if (url.startsWith("/api/partner/users") || url.startsWith("/api/settings/partners")) {
      const value=await response.clone().json().catch(()=>null) as {error?:unknown}|null;
      const messages = ["Unarchive the company before activating or adding employees.", "Assign another active administrator before removing your own access."];
      if(typeof value?.error === "string" && messages.includes(value.error)) throw new OpsRequestError(value.error,response.status);
      if(response.status === 403) throw new OpsRequestError("You do not have permission to manage these users. Contact your administrator.",403);
    }
    if (url.endsWith("/connection")) {
      const value=await response.clone().json().catch(()=>null) as {error?:unknown}|null;
      if(typeof value?.error==="string"&&value.error.length<=200)throw new OpsRequestError(value.error,response.status);
    }
    if (url.includes("/jobs/") || url.endsWith("/job-status")) {
      const body = await response.clone().json().catch(() => null);
      if (body && Object.hasOwn(JOB_LINK_ERRORS, body.code)) throw new OpsRequestError(JOB_LINK_ERRORS[body.code as keyof typeof JOB_LINK_ERRORS], response.status);
    }
    throw new OpsRequestError(response.status === 401 ? "Sign in to InsulHub to manage partners." : response.status === 409 ? "This record changed or already exists. Reload before trying again." : response.status === 429 ? response.headers.get("retry-after") === "900" ? "Too many account changes. Wait fifteen minutes and try again." : "A link was recently requested. Check the inbox or wait a minute before resending." : response.status === 503 ? "Partner settings need server setup or are temporarily unavailable." : "The change could not be saved. Check the details and try again.", response.status);
  }
  try { return await response.json() as T; } catch { throw new OpsRequestError("The response could not be confirmed. Reload before trying again.", 0); }
}
