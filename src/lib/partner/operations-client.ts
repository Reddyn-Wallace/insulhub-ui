import type { CompanyInput, OpsRole } from "./operations";
import type { PartnerTrackingProjection } from "./operations-repository";

export type OpsViewer = { name: string; role: OpsRole };
export type OpsCompanyView = CompanyInput & { id: string; revision: number };
export type OpsJobDetail = PartnerTrackingProjection & {
  companyId: string;
  customerName: string;
  siteAddress: { street?: string; suburb?: string; city?: string; postcode?: string };
  submissionState: string;
  revision: number;
};

const money = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });
const date = new Intl.DateTimeFormat("en-NZ", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Pacific/Auckland" });
export const opsMoney = (cents: number): string => money.format(cents / 100);
/** Empty or imprecise input is invalid, never coerced into a zero-dollar payment. */
export function opsMoneyInput(value: string, signed = false): number | null {
  const cleaned = value.trim();
  if (!(signed ? /^-?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/).test(cleaned)) return null;
  const negative = cleaned.startsWith("-");
  const [whole, fraction = ""] = cleaned.replace(/^-/, "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 999_999_999_999 ? (negative ? -cents : cents) : null;
}
export function opsDateInput(value: string | Date): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "";
  const parts = date.formatToParts(parsed);
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function opsDateTimestamp(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value ? parsed.toISOString() : null;
}
export class OpsRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export async function opsRequest<T = { ok: true }>(url: string, method = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { method, cache: "no-store", credentials: "same-origin", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  } catch { throw new OpsRequestError("Connection lost. Reload to check whether the change was saved before trying again.", 0); }
  if (!response.ok) {
    const message = response.status === 401 ? "Your session expired. Sign in again to continue."
      : response.status === 403 ? "Your account cannot make this change."
      : response.status === 404 ? "This record is no longer available."
      : response.status === 409 ? "The record has changed or this action is already recorded. Reload to review the latest details before trying again."
      : "Unable to save. Check the fields and try again.";
    throw new OpsRequestError(message, response.status);
  }
  try { return await response.json() as T; }
  catch { throw new OpsRequestError("The response could not be confirmed. Reload before trying again.", 0); }
}
export const opsInputClass = "min-h-11 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-base font-normal text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#e85d04] disabled:bg-gray-100";
export const opsButtonClass = "inline-flex min-h-11 items-center justify-center rounded-lg bg-[#1a3a4a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#122b37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e85d04] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
