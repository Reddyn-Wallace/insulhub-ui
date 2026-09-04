import "server-only";
import { normalizeQuoteDefaults, type QuoteDefaults } from "./quote";

export const OPS_ROLES = ["ADMIN", "OPERATIONS", "FINANCE", "VIEWER"] as const;
export type OpsRole = typeof OPS_ROLES[number];
export type BillingModel = "INSULHUB_BILLED" | "PARTNER_BILLED";
export type OpsFactType = "EBA_COMPLETED" | "INSTALL_DATE_SET" | "JOB_COMPLETED" | "CANCELLED";

const MAX_CENTS = 999_999_999_999;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));
const text = (value: unknown, min: number, max: number, pattern?: RegExp): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max && (!pattern || pattern.test(trimmed)) ? trimmed : null;
};
const cents = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_CENTS ? value : null;
export const isOpsRevision = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2_147_483_647;
export const isOpsRole = (value: unknown): value is OpsRole => typeof value === "string" && (OPS_ROLES as readonly string[]).includes(value);
export const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function calendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Accept explicit-zone timestamps only; never silently normalize an impossible date. */
export function opsTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value) || !calendarDate(value.slice(0, 10))) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export type InvoiceInput = { revision: number; reference: string; amountCents: number; sentAt: string };
export function parseInvoice(value: unknown): InvoiceInput | null {
  if (!record(value) || !exact(value, ["revision", "reference", "amountCents", "sentAt"])) return null;
  const reference = text(value.reference, 1, 120, /^[A-Za-z0-9][A-Za-z0-9._/-]*$/);
  const amountCents = cents(value.amountCents), sentAt = opsTimestamp(value.sentAt);
  return isOpsRevision(value.revision) && reference && amountCents !== null && sentAt ? { revision: value.revision, reference, amountCents, sentAt } : null;
}

export type SettlementInput = { revision: number; grossCents: number; commissionCents: number; status: "PENDING" | "PAID" | "RECEIVED"; settledAt?: string };
export function parseSettlement(value: unknown, model: BillingModel): SettlementInput | null {
  if (!record(value) || !exact(value, ["revision", "grossCents", "commissionCents", "status", "settledAt"])) return null;
  const grossCents = cents(value.grossCents), commissionCents = cents(value.commissionCents);
  const status = value.status, terminal = model === "INSULHUB_BILLED" ? "PAID" : "RECEIVED";
  const settledAt = value.settledAt === undefined ? undefined : opsTimestamp(value.settledAt);
  if (!isOpsRevision(value.revision) || grossCents === null || commissionCents === null || commissionCents > grossCents || (status !== "PENDING" && status !== terminal) || settledAt === null || (status === "PENDING" ? settledAt !== undefined : !settledAt)) return null;
  return { revision: value.revision, grossCents, commissionCents, status: status as SettlementInput["status"], ...(settledAt ? { settledAt } : {}) };
}

export type AmendmentInput = { description: string; contractDeltaCents?: number; requestKey?: string };
export function parseAmendment(value: unknown): AmendmentInput | null {
  if (!record(value) || !exact(value, ["version", "description", "contractDeltaCents"]) || value.version !== 1) return null;
  const description = text(value.description, 1, 1000), delta = value.contractDeltaCents;
  if (!description || (delta !== undefined && (typeof delta !== "number" || !Number.isSafeInteger(delta) || Math.abs(delta) > MAX_CENTS))) return null;
  return delta === undefined ? { description } : { description, contractDeltaCents: delta as number };
}

export function parseOpsFact(value: unknown): { factType: OpsFactType; at: string } | null {
  if (!record(value) || !exact(value, ["factType", "at"]) || !["EBA_COMPLETED", "INSTALL_DATE_SET", "JOB_COMPLETED", "CANCELLED"].includes(String(value.factType))) return null;
  const factType = value.factType as OpsFactType;
  const at = factType === "INSTALL_DATE_SET"
    ? typeof value.at === "string" && calendarDate(value.at) ? `${value.at}T00:00:00.000Z` : null
    : opsTimestamp(value.at);
  return at ? { factType, at } : null;
}

export type CompanyInput = { slug: string; name: string; billingModel: BillingModel; quoteDefaults: Omit<QuoteDefaults, "revision"> };
export function parseCompany(value: unknown): CompanyInput | null {
  if (!record(value) || !exact(value, ["slug", "name", "billingModel", "quoteDefaults"]) || !record(value.quoteDefaults) || !exact(value.quoteDefaults, ["wallRateCents", "ceilingRateCents", "depositBasisPoints", "consentFeeCents", "extras"])) return null;
  const slug = text(value.slug, 1, 80, /^[a-z0-9]+(?:-[a-z0-9]+)*$/), name = text(value.name, 1, 160), billingModel = value.billingModel;
  const defaults = normalizeQuoteDefaults({ ...value.quoteDefaults, revision: 0 });
  if (!slug || !name || (billingModel !== "INSULHUB_BILLED" && billingModel !== "PARTNER_BILLED") || !defaults.ok) return null;
  const quoteDefaults = { wallRateCents: defaults.value.wallRateCents, ceilingRateCents: defaults.value.ceilingRateCents, depositBasisPoints: defaults.value.depositBasisPoints, consentFeeCents: defaults.value.consentFeeCents, extras: defaults.value.extras };
  return { slug, name, billingModel, quoteDefaults };
}

export type PartnerUserInput = { name: string; email: string; initialPassword: string };
export function parsePartnerUser(value: unknown): PartnerUserInput | null {
  if (!record(value) || !exact(value, ["name", "email", "initialPassword"])) return null;
  const name = text(value.name, 1, 160), email = text(value.email, 3, 254, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  const password = typeof value.initialPassword === "string" ? value.initialPassword : "";
  if (!name || !email || email !== email.toLowerCase() || password.length < 12 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[\W_]/.test(password)) return null;
  return { name, email, initialPassword: password };
}

export function requiredRole(action: "read" | "company" | "partner-user" | "fact" | "amendment" | "invoice" | "settlement"): OpsRole[] {
  if (action === "read") return OPS_ROLES.slice();
  if (action === "company" || action === "partner-user") return ["ADMIN"];
  if (action === "settlement") return ["ADMIN", "FINANCE"];
  if (action === "invoice") return ["ADMIN", "OPERATIONS", "FINANCE"];
  return ["ADMIN", "OPERATIONS"];
}
