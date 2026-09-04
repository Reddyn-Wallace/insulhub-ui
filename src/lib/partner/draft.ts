import { normalizeQuoteDraft, quoteReadiness, type QuoteDraft, type QuoteFieldErrors, type QuoteReadinessIssue } from "./quote";

export const LEAD_SOURCE_OPTIONS = [
  { value: "CONTACT_FORM", label: "Contact Form" },
  { value: "SOCIAL_MEDIA", label: "Social Media" },
  { value: "PHONE_CALL", label: "Phone Call" },
  { value: "REFERRAL", label: "Referral" },
  { value: "HOMESHOW", label: "Homeshow" },
] as const;
export type LeadSource = typeof LEAD_SOURCE_OPTIONS[number]["value"];

export interface LeadDraftFields {
  customerName: string; customerMobile: string; customerEmail: string;
  siteAddress: { street: string; suburb: string; city: string; postcode: string };
  leadSources: LeadSource[]; notes: string;
}

export interface PartnerDraftFields extends LeadDraftFields { quote: QuoteDraft }

export const EMPTY_LEAD_DRAFT: LeadDraftFields = { customerName: "", customerMobile: "", customerEmail: "", siteAddress: { street: "", suburb: "", city: "", postcode: "" }, leadSources: [], notes: "" };
const LIMITS = { customerName: 200, customerMobile: 40, customerEmail: 254, street: 200, suburb: 100, city: 100, postcode: 20, notes: 4000 } as const;
export type DraftFieldErrors = Partial<Record<keyof LeadDraftFields | "street" | "suburb" | "city" | "postcode" | "form", string>>;
export type PartnerDraftFieldErrors = DraftFieldErrors & QuoteFieldErrors;

function stringField(value: unknown, field: keyof typeof LIMITS, errors: DraftFieldErrors): string {
  if (typeof value !== "string") { errors[field] = "Use text for this field."; return ""; }
  if (value.length > LIMITS[field]) errors[field] = `Keep this field to ${LIMITS[field]} characters or fewer.`;
  return value;
}

export function validateLeadDraft(value: unknown): { ok: true; value: LeadDraftFields } | { ok: false; errors: DraftFieldErrors } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, errors: { form: "Draft data is invalid." } };
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set(["customerName", "customerMobile", "customerEmail", "siteAddress", "leadSources", "notes", "quote"]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) return { ok: false, errors: { form: "Draft data is invalid." } };
  const errors: DraftFieldErrors = {};
  const addressInput = input.siteAddress && typeof input.siteAddress === "object" && !Array.isArray(input.siteAddress) ? input.siteAddress as Record<string, unknown> : {};
  if (!input.siteAddress || typeof input.siteAddress !== "object" || Array.isArray(input.siteAddress)) errors.form = "Address data is invalid.";
  if (Object.keys(addressInput).some((key) => !new Set(["street", "suburb", "city", "postcode"]).has(key))) errors.form = "Address data is invalid.";
  const allowedSources = new Set<string>(LEAD_SOURCE_OPTIONS.map((option) => option.value));
  const leadSources = Array.isArray(input.leadSources) ? input.leadSources.filter((source): source is LeadSource => typeof source === "string" && allowedSources.has(source)) : [];
  if (!Array.isArray(input.leadSources) || leadSources.length !== input.leadSources.length || new Set(leadSources).size !== leadSources.length || leadSources.length > 6) errors.leadSources = "Choose only the available lead sources.";
  const draft: LeadDraftFields = {
    customerName: stringField(input.customerName, "customerName", errors), customerMobile: stringField(input.customerMobile, "customerMobile", errors), customerEmail: stringField(input.customerEmail, "customerEmail", errors),
    siteAddress: { street: stringField(addressInput.street, "street", errors), suburb: stringField(addressInput.suburb, "suburb", errors), city: stringField(addressInput.city, "city", errors), postcode: stringField(addressInput.postcode, "postcode", errors) },
    leadSources, notes: stringField(input.notes, "notes", errors),
  };
  if (draft.customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.customerEmail)) errors.customerEmail = "Enter a valid email address.";
  if (draft.customerMobile && !/^[+0-9() .-]+$/.test(draft.customerMobile)) errors.customerMobile = "Use only phone number characters.";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: draft };
}

export function validatePartnerDraft(value: unknown): { ok: true; value: LeadDraftFields & { quote?: QuoteDraft } } | { ok: false; errors: PartnerDraftFieldErrors } {
  const lead = validateLeadDraft(value);
  if (!lead.ok) return lead;
  const input = value as Record<string, unknown>;
  if (!("quote" in input)) return { ok: true, value: lead.value };
  const quote = normalizeQuoteDraft(input.quote);
  if (!quote.ok) return { ok: false, errors: quote.errors };
  return { ok: true, value: { ...lead.value, quote: quote.value } };
}

export function partnerDraftReadiness(draft: PartnerDraftFields, floorPlans?: { ready: boolean; issues: readonly string[] }): QuoteReadinessIssue[] {
  const issues = quoteReadiness(draft.quote).filter((issue) => !floorPlans || issue.path !== "floorPlan");
  if (floorPlans && !floorPlans.ready) issues.push(...floorPlans.issues.map((message) => ({ path: "floorPlan", message })));
  if (!draft.customerName.trim()) issues.unshift({ path: "customerName", message: "Customer name will be required." });
  if (!draft.customerMobile.trim() && !draft.customerEmail.trim()) issues.unshift({ path: "contact", message: "A phone number or email will be required." });
  if (Object.values(draft.siteAddress).some((part) => !part.trim())) issues.unshift({ path: "address", message: "The full site address will be required." });
  return issues;
}

export const DRAFT_RECOVERY_PREFIX = "partner-draft-recovery:v3:";
export const DRAFT_RECOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface DraftMoneyInputs { wallRate: string; ceilingRate: string; extras: Record<string, string> }
export interface DraftCreationRequest { key: string; draft: LeadDraftFields & { quote?: QuoteDraft } }
export interface DraftRecoveryPayload { schema: 3; scope: string; jobId: string; revision: number; draft: LeadDraftFields & { quote?: QuoteDraft }; savedAt: string; moneyInputs?: DraftMoneyInputs; creation?: DraftCreationRequest }
export interface DraftRecoveryStorage {
  readonly length: number;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export function draftRecoveryKey(scope: string, jobId: string): string { return `${DRAFT_RECOVERY_PREFIX}${scope}:${jobId}`; }
export function encodeDraftRecovery(payload: Omit<DraftRecoveryPayload, "schema">): string { return JSON.stringify({ schema: 3, ...payload }); }
export function decodeDraftRecovery(serialized: string | null, expectedScope: string, expectedJobId: string, now = Date.now()): DraftRecoveryPayload | null {
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized) as Partial<DraftRecoveryPayload>;
    // Recovery is allowed to retain partial contact input, unlike API writes.
    const raw = value.draft;
    if (!raw || typeof raw.customerEmail !== "string" || raw.customerEmail.length > LIMITS.customerEmail || typeof raw.customerMobile !== "string" || raw.customerMobile.length > LIMITS.customerMobile) return null;
    const validated = validatePartnerDraft({ ...raw, customerEmail: "", customerMobile: "" });
    const money = value.moneyInputs;
    if (money && (typeof money.wallRate !== "string" || money.wallRate.length > 80 || typeof money.ceilingRate !== "string" || money.ceilingRate.length > 80 || !money.extras || typeof money.extras !== "object" || Array.isArray(money.extras) || Object.keys(money.extras).length > 50 || Object.values(money.extras).some((item) => typeof item !== "string" || item.length > 80))) return null;
    if (value.creation && (!/^[0-9a-f-]{36}$/i.test(value.creation.key) || !validatePartnerDraft(value.creation.draft).ok)) return null;
    const savedAt = typeof value.savedAt === "string" ? Date.parse(value.savedAt) : Number.NaN;
    if (
      value.schema !== 3 || value.scope !== expectedScope || value.jobId !== expectedJobId
      || !Number.isInteger(value.revision) || (value.revision as number) < 0 || !validated.ok
      || !Number.isFinite(savedAt) || savedAt > now + 5 * 60 * 1000 || now - savedAt > DRAFT_RECOVERY_TTL_MS
    ) return null;
    return { schema: 3, scope: expectedScope, jobId: expectedJobId, revision: value.revision as number, draft: { ...validated.value, customerEmail: raw.customerEmail, customerMobile: raw.customerMobile }, savedAt: value.savedAt as string, moneyInputs: money, creation: value.creation };
  } catch { return null; }
}

export function readDraftRecovery(storage: DraftRecoveryStorage | null, key: string): string | null {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}

export function writeDraftRecovery(storage: DraftRecoveryStorage | null, key: string, value: string): boolean {
  try { storage?.setItem(key, value); return Boolean(storage); } catch { return false; }
}

export function removeDraftRecovery(storage: DraftRecoveryStorage | null, key: string): boolean {
  try { storage?.removeItem(key); return Boolean(storage); } catch { return false; }
}

export function clearDraftRecoveryScope(storage: DraftRecoveryStorage | null, scope: string): boolean {
  if (!storage) return false;
  try {
    const prefix = `${DRAFT_RECOVERY_PREFIX}${scope}:`;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
    return true;
  } catch { return false; }
}
