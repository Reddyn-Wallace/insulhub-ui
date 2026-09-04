"use client";

import Link from "next/link";
import {partnerJobReference} from "@/lib/partner/job-reference";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  decodeDraftRecovery, draftRecoveryKey, EMPTY_LEAD_DRAFT, encodeDraftRecovery,
  partnerDraftReadiness, readDraftRecovery, removeDraftRecovery,
  validatePartnerDraft, writeDraftRecovery, type DraftRecoveryStorage, type LeadDraftFields,
  type PartnerDraftFieldErrors, type PartnerDraftFields, type DraftCreationRequest,
} from "@/lib/partner/draft";
import {
  partnerQuoteTerms, calculateQuote, createQuoteDraft, dollarsFromCents, moneyFromDollars,
  PRODUCT_QUOTE_DEFAULTS, setQuoteProductEnabled, type QuoteDraft,
} from "@/lib/partner/quote";
import type { PartnerJobView } from "@/lib/partner/repository";
import AddressAutocomplete from "./AddressAutocomplete";
import PartnerFloorPlanList from "./PartnerFloorPlanList";
import PartnerSubmissionPanel from "./PartnerSubmissionPanel";
import { floorPlanReadiness, type FloorPlanCollectionClient } from "@/lib/partner/site-plan-client";
import { registerPartnerSaveGuard } from "@/lib/partner/navigation-save";
import PartnerAmendments from "./PartnerAmendments";
import { summariseDraftErrors } from "@/lib/partner/draft-error-summary";

type Product = "wall" | "ceiling";
interface MoneyInputs { wallRate: string; ceilingRate: string; extras: Record<string, string> }

const nzMoney = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });

function fieldsFromJob(job: PartnerJobView | undefined, fallback: QuoteDraft): PartnerDraftFields {
  return job
    ? { customerName: job.customerName, customerMobile: job.customerMobile, customerEmail: job.customerEmail, siteAddress: job.siteAddress, leadSources: job.leadSources, notes: job.notes, quote: job.submissionState === "DRAFT" ? partnerQuoteTerms(job.quote) : job.quote }
    : { ...EMPTY_LEAD_DRAFT, siteAddress: { ...EMPTY_LEAD_DRAFT.siteAddress }, leadSources: [], quote: fallback };
}

function moneyInputsFromQuote(quote: QuoteDraft): MoneyInputs {
  return {
    wallRate: dollarsFromCents(quote.wall.rateCentsPerSqm),
    ceilingRate: dollarsFromCents(quote.ceiling.rateCentsPerSqm),
    extras: Object.fromEntries(quote.extras.map((extra) => [extra.id, dollarsFromCents(extra.priceCents)])),
  };
}

function quoteWithMoneyInputs(quote: QuoteDraft, inputs: MoneyInputs): QuoteDraft {
  return {
    ...quote,
    wall: { ...quote.wall, rateCentsPerSqm: quote.wall.enabled ? moneyFromDollars(inputs.wallRate) : null },
    ceiling: { ...quote.ceiling, rateCentsPerSqm: quote.ceiling.enabled ? moneyFromDollars(inputs.ceilingRate) : null },
    consentFeeCents: 0,
    depositBasisPoints: 0,
    extras: quote.extras.map((extra) => ({ ...extra, priceCents: moneyFromDollars(inputs.extras[extra.id] ?? "") })),
  };
}

function storage(): DraftRecoveryStorage | null { try { return window.sessionStorage; } catch { return null; } }
function nullableNumber(value: string): number | null { if (!value.trim()) return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function fieldId(path: string): string { return `draft-${path.replace(/[^a-zA-Z0-9_-]/g, "-")}`; }
function errorId(path: string): string { return `${fieldId(path)}-error`; }
function fieldLabel(path: string): string {
  const labels: Record<string, string> = {
    form: "Draft", customerName: "Customer name", customerMobile: "Mobile", customerEmail: "Email",
    street: "Street address", suburb: "Suburb", city: "City", postcode: "Postcode", leadSources: "Lead source", notes: "Notes",
    floorPlan: "Floor plans", quote: "Quote", wall: "Wall insulation", ceiling: "Ceiling insulation", "wall.areaSqm": "Wall area", "wall.rateCentsPerSqm": "Wall rate",
    "wall.cavityDepthCm": "Wall cavity depth", "ceiling.areaSqm": "Ceiling area", "ceiling.rateCentsPerSqm": "Ceiling rate",
    "ceiling.rValue": "Ceiling R-value", "ceiling.downlights": "Ceiling downlights", consentFeeCents: "Consent fee",
    depositBasisPoints: "Deposit", extras: "Extras", comments: "Quote comments", defaultsSnapshot: "Quote defaults", quoteNumber: "Quote number", quoteDate: "Quote date",
  };
  if (labels[path]) return labels[path];
  const extra = /^extras\.(\d+)\.(name|priceCents|id)$/.exec(path);
  if (extra) return `Extra ${Number(extra[1]) + 1} ${extra[2] === "priceCents" ? "price" : extra[2]}`;
  return path;
}

const EDITABLE_ERROR_PATHS = new Set([
  "customerName", "customerMobile", "customerEmail", "street", "suburb", "city", "postcode", "leadSources", "notes",
  "wall", "ceiling", "wall.areaSqm", "wall.rateCentsPerSqm", "wall.cavityDepthCm", "ceiling.areaSqm",
  "ceiling.rateCentsPerSqm", "ceiling.rValue", "ceiling.downlights", "consentFeeCents", "depositBasisPoints", "extras", "comments",
]);

function errorTarget(path: string, extraCount: number): { id: string; link: boolean } | null {
  if (path === "address") return { id: fieldId("street"), link: true };
  if (path === "contact") return { id: fieldId("customerMobile"), link: true };
  if (path === "products") return { id: "quote-details", link: true };
  if (EDITABLE_ERROR_PATHS.has(path)) return { id: fieldId(path), link: true };
  if (path === "floorPlan") return { id: "floor-plans", link: true };
  if (path === "form") return { id: "partner-draft-form", link: false };
  if (path === "quote" || path === "quoteNumber" || path === "quoteDate" || path === "defaultsSnapshot") return { id: "quote-details", link: false };
  const extra = /^extras\.(\d+)(?:\.(name|priceCents|id))?$/.exec(path);
  if (!extra) return null;
  const index = Number(extra[1]);
  const suffix = extra[2];
  if (index >= extraCount) return { id: fieldId("extras"), link: false };
  if (suffix === "name" || suffix === "priceCents") return { id: fieldId(path), link: true };
  return { id: fieldId(`extras.${index}`), link: false };
}

export default function PartnerDraftForm({ initialJob: providedJob, initialQuote, recoveryScope, initialFloorPlans, readOnly = false }: { readOnly?: boolean; initialJob?: PartnerJobView; initialQuote?: QuoteDraft; recoveryScope: string; initialFloorPlans?: FloorPlanCollectionClient }) {
  const router = useRouter();
  const [createdJob, setCreatedJob] = useState<PartnerJobView>();
  const initialJob = providedJob ?? createdJob;
  const [confirmedSaveRevision, setConfirmedSaveRevision] = useState<number | null>(null);
  const fallback = useMemo(() => partnerQuoteTerms(initialQuote ?? createQuoteDraft(PRODUCT_QUOTE_DEFAULTS)), [initialQuote]);
  const recoveryId = initialJob?.id ?? "new";
  const initialFields = useMemo(() => fieldsFromJob(initialJob, fallback), [fallback, initialJob]);
  const recoveryKey = draftRecoveryKey(recoveryScope, recoveryId);
  const [draft, setDraft] = useState<PartnerDraftFields>(initialFields);
  const [moneyInputs, setMoneyInputs] = useState<MoneyInputs>(() => moneyInputsFromQuote(initialFields.quote));
  const [revision, setRevision] = useState(initialJob?.revision ?? 0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openingCreatedDraft, setOpeningCreatedDraft] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<PartnerDraftFieldErrors>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [stale, setStale] = useState(false);
  const [latestRevision, setLatestRevision] = useState<number | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [conflictingEdits, setConflictingEdits] = useState("");
  const [extraAnnouncement, setExtraAnnouncement] = useState("");
  const [floorPlans, setFloorPlans] = useState<FloorPlanCollectionClient | null>(initialFloorPlans ?? null);
  const [savedAddress, setSavedAddress] = useState(initialFields.siteAddress);
  const [plansBusy, setPlansBusy] = useState(false);
  const [submissionLocked, setSubmissionLocked] = useState(false);
  const [lockedElsewhere, setLockedElsewhere] = useState(false);
  const [submissionRecoveryChecked, setSubmissionRecoveryChecked] = useState(readOnly || !initialJob || !initialFloorPlans);
  const recoveryLoaded = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const pendingExtraFocus = useRef<string | null>(null);
  const creation = useRef<DraftCreationRequest | undefined>(undefined);
  const serverJob = useRef(initialJob);
  const saveInFlight = useRef<Promise<boolean> | null>(null);
  const navigating = useRef(false);
  const live = useRef({ draft, moneyInputs, dirty, revision, stale, submissionLocked, plansBusy, submissionRecoveryChecked, openingCreatedDraft });
  live.current = { draft, moneyInputs, dirty, revision, stale, submissionLocked, plansBusy, submissionRecoveryChecked, openingCreatedDraft };
  const calculation = useMemo(() => calculateQuote(readOnly ? draft.quote : quoteWithMoneyInputs(draft.quote, moneyInputs)), [draft.quote, moneyInputs, readOnly]);
  const readiness = useMemo(() => partnerDraftReadiness(draft, floorPlans ? floorPlanReadiness(floorPlans) : undefined), [draft, floorPlans]);
  const errorEntries = Object.entries(fieldErrors).filter((entry): entry is [string, string] => typeof entry[1] === "string");

  useEffect(() => {
    if (readOnly || recoveryLoaded.current) return;
    recoveryLoaded.current = true;
    const conflict = decodeDraftRecovery(readDraftRecovery(storage(), `${recoveryKey}:conflict`), recoveryScope, recoveryId);
    if (conflict) setConflictingEdits(JSON.stringify({ ...conflict.draft, enteredAmounts: conflict.moneyInputs }, null, 2));
    const recoveredValue = decodeDraftRecovery(readDraftRecovery(storage(), recoveryKey), recoveryScope, recoveryId);
    if (recoveredValue?.revision === revision) {
      const value = { ...recoveredValue.draft, quote: partnerQuoteTerms(recoveredValue.draft.quote ?? fallback) } as PartnerDraftFields;
      if (JSON.stringify(value) !== JSON.stringify(initialFields) || (recoveredValue.moneyInputs && JSON.stringify(recoveredValue.moneyInputs) !== JSON.stringify(moneyInputsFromQuote(initialFields.quote))) || recoveredValue.creation) {
        setDraft(value);
        setMoneyInputs(recoveredValue.moneyInputs ?? moneyInputsFromQuote(value.quote));
        setDirty(true);
        setRecovered(true);
      }
      creation.current = recoveredValue.creation;
    }
  }, [fallback, initialFields, readOnly, recoveryId, recoveryKey, recoveryScope, revision]);

  useEffect(() => {
    if (readOnly || !dirty || stale || submissionLocked) return;
    const recoveryDraft = { ...draft, quote: quoteWithMoneyInputs(draft.quote, moneyInputs) };
    writeDraftRecovery(storage(), recoveryKey, encodeDraftRecovery({ scope: recoveryScope, jobId: recoveryId, revision, draft: recoveryDraft, moneyInputs, creation: creation.current, savedAt: new Date().toISOString() }));
  }, [readOnly, dirty, draft, moneyInputs, recoveryId, recoveryKey, recoveryScope, revision, stale, submissionLocked]);

  useEffect(() => {
    if (!stale || latestRevision === null || !initialJob || initialJob.revision < latestRevision) return;
    removeDraftRecovery(storage(), recoveryKey);
    setDraft(initialFields);
    setMoneyInputs(moneyInputsFromQuote(initialFields.quote));
    setRevision(initialJob.revision);
    serverJob.current = initialJob;
    setDirty(false);
    setRecovered(false);
    setStale(false);
    setLatestRevision(null);
    setFieldErrors({});
    setError("");
    setMessage("Latest draft loaded.");
  }, [initialFields, initialJob, latestRevision, recoveryKey, stale]);

  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  useEffect(() => {
    const extraId = pendingExtraFocus.current;
    if (!extraId) return;
    pendingExtraFocus.current = null;
    if (extraId === "add-extra") { document.getElementById("add-extra")?.focus(); return; }
    const index = draft.quote.extras.findIndex((extra) => extra.id === extraId);
    if (index >= 0) document.getElementById(fieldId(`extras.${index}.name`))?.focus();
  }, [draft.quote.extras]);


  function change(next: PartnerDraftFields) { if (readOnly || stale || submissionLocked) return; setDraft(next); setDirty(true); setMessage(""); setError(""); }
  function clearFieldError(path: string) { setFieldErrors((current) => ({ ...current, [path]: undefined, form: undefined })); }
  function update<K extends keyof LeadDraftFields>(field: K, value: LeadDraftFields[K]) { change({ ...draft, [field]: value }); clearFieldError(field); }
  function updateAddress(field: keyof LeadDraftFields["siteAddress"], value: string) { change({ ...draft, siteAddress: { ...draft.siteAddress, [field]: value } }); clearFieldError(field); }
  function updateQuote(quote: QuoteDraft, path?: string) { change({ ...draft, quote }); if (path) clearFieldError(path); }
  function updateMoneyInput(field: keyof Omit<MoneyInputs, "extras">, value: string, errorPath: string) { if (stale) return; setMoneyInputs((current) => ({ ...current, [field]: value })); setDirty(true); setMessage(""); setError(""); clearFieldError(errorPath); }
  function updateExtraMoneyInput(id: string, value: string, errorPath: string) { if (stale) return; setMoneyInputs((current) => ({ ...current, extras: { ...current.extras, [id]: value } })); setDirty(true); setMessage(""); setError(""); clearFieldError(errorPath); }
  function toggleProduct(product: Product, enabled: boolean) {
    if (stale) return;
    const quote = setQuoteProductEnabled(draft.quote, product, enabled);
    const rateKey = product === "wall" ? "wallRate" : "ceilingRate";
    setMoneyInputs((inputs) => ({ ...inputs, [rateKey]: dollarsFromCents(quote[product].rateCentsPerSqm) }));
    updateQuote(quote, product);
  }
  function addExtra() {
    if (stale) return;
    const id = globalThis.crypto?.randomUUID?.() ?? `extra-${Date.now()}`;
    pendingExtraFocus.current = id;
    setMoneyInputs((current) => ({ ...current, extras: { ...current.extras, [id]: "" } }));
    updateQuote({ ...draft.quote, extras: [...draft.quote.extras, { id, name: "", priceCents: null }] }, "extras");
    setExtraAnnouncement(`Extra ${draft.quote.extras.length + 1} added. Name field focused.`);
  }
  function removeExtra(index: number) {
    if (stale) return;
    const removed = draft.quote.extras[index];
    const remaining = draft.quote.extras.filter((_, itemIndex) => itemIndex !== index);
    pendingExtraFocus.current = remaining[index]?.id ?? remaining[index - 1]?.id ?? "add-extra";
    setMoneyInputs((current) => { const extras = { ...current.extras }; delete extras[removed.id]; return { ...current, extras }; });
    updateQuote({ ...draft.quote, extras: remaining }, "extras");
    setExtraAnnouncement(`${removed.name || `Extra ${index + 1}`} removed.`);
  }
  function moveExtra(index: number, direction: -1 | 1) {
    if (stale) return;
    const target = index + direction;
    if (target < 0 || target >= draft.quote.extras.length) return;
    const extras = [...draft.quote.extras];
    const moved = extras[index];
    [extras[index], extras[target]] = [extras[target], extras[index]];
    pendingExtraFocus.current = moved.id;
    updateQuote({ ...draft.quote, extras }, "extras");
    setExtraAnnouncement(`${moved.name || `Extra ${index + 1}`} moved to position ${target + 1}.`);
  }
  function clearRecovery() { if (stale || saveInFlight.current || creation.current) return; removeDraftRecovery(storage(), recoveryKey); const current = fieldsFromJob(serverJob.current, fallback); setDraft(current); setMoneyInputs(moneyInputsFromQuote(current.quote)); setDirty(false); setRecovered(false); setMessage("Recovered changes discarded."); }
  function reloadLatest() { removeDraftRecovery(storage(), recoveryKey); setDirty(false); setRecovered(false); const id = serverJob.current?.id ?? recoveryId; router.replace(latestRevision !== null ? `/partner/jobs/${id}?reload=${latestRevision}` : `/partner/jobs/${id}`); router.refresh(); }
  async function goBack() { if (openingCreatedDraft || plansBusy) return; navigating.current = true; setOpeningCreatedDraft(true); if (await save(true)) router.push("/partner"); else setOpeningCreatedDraft(false); navigating.current = false; }
  function submissionFrozen() { setSubmissionLocked(true); removeDraftRecovery(storage(), recoveryKey); setDirty(false); setRecovered(false); router.replace(`/partner/jobs/${recoveryId}?submitted=1`); router.refresh(); }

  function keepConflictingEdits() {
    const current = live.current;
    const id = serverJob.current?.id ?? recoveryId;
    const preserved = { ...current.draft, quote: quoteWithMoneyInputs(current.draft.quote, current.moneyInputs) };
    writeDraftRecovery(storage(), `${draftRecoveryKey(recoveryScope, id)}:conflict`, encodeDraftRecovery({ scope: recoveryScope, jobId: id, revision: current.revision, draft: preserved, moneyInputs: current.moneyInputs, savedAt: new Date().toISOString() }));
    setConflictingEdits(JSON.stringify({ ...preserved, enteredAmounts: current.moneyInputs }, null, 2));
  }

  function save(explicit = false): Promise<boolean> {
    if (saveInFlight.current) return saveInFlight.current;
    const pending = drainSaves(explicit).finally(() => { saveInFlight.current = null; });
    saveInFlight.current = pending;
    return pending;
  }

  async function drainSaves(explicit: boolean): Promise<boolean> {
    if (readOnly) return true;
    if (live.current.submissionLocked) { if (explicit) setError("Submission has started for this job. Reload its status before making any more changes."); return !live.current.dirty; }
    if (live.current.plansBusy) { if (explicit) setError("Wait for the floor plan change to finish."); return false; }
    if (live.current.stale) { if (explicit) setError("This draft changed in another tab. Reload the latest version before saving again."); return false; }
    if (!live.current.dirty) return true;
    setSaving(true);
    try { for (;;) {
    const { draft, moneyInputs } = live.current;
    const sentEdit = JSON.stringify({ draft, moneyInputs });
    setError(""); setMessage(""); setFieldErrors({}); setSessionExpired(false);
    const rawMoneyErrors: PartnerDraftFieldErrors = {};
    const invalidMoney = (path: string, value: string) => { if (value.trim() && moneyFromDollars(value) === null) rawMoneyErrors[path] = "Enter a valid non-negative dollar amount."; };
    if (draft.quote.wall.enabled) invalidMoney("wall.rateCentsPerSqm", moneyInputs.wallRate);
    if (draft.quote.ceiling.enabled) invalidMoney("ceiling.rateCentsPerSqm", moneyInputs.ceilingRate);
    draft.quote.extras.forEach((extra, index) => invalidMoney(`extras.${index}.priceCents`, moneyInputs.extras[extra.id] ?? ""));
    if (Object.keys(rawMoneyErrors).length) { setFieldErrors(rawMoneyErrors); setMessage("Finish the highlighted amount to save automatically."); if (explicit) setError("Check the highlighted fields before leaving."); return false; }
    const candidate = { ...draft, quote: quoteWithMoneyInputs(draft.quote, moneyInputs) };
    const validated = validatePartnerDraft(candidate);
    if (!validated.ok) { setFieldErrors(validated.errors); setMessage("Finish the highlighted fields to save automatically."); if (explicit) setError("Check the highlighted fields before leaving."); return false; }
      const currentJob = serverJob.current;
      if (!currentJob && !creation.current) creation.current = { key: crypto.randomUUID(), draft: validated.value };
      if (!currentJob && !writeDraftRecovery(storage(), recoveryKey, encodeDraftRecovery({ scope: recoveryScope, jobId: recoveryId, revision: 0, draft, moneyInputs, creation: creation.current, savedAt: new Date().toISOString() }))) {
        setError("Enable browser storage to safely create this draft. Your edits are still here."); return false;
      }
      const sentDraft = currentJob ? validated.value : creation.current!.draft;
      const response = await fetch(currentJob ? `/api/partner/jobs/${currentJob.id}` : "/api/partner/jobs", {
        method: currentJob ? "PATCH" : "POST", headers: { "content-type": "application/json", ...(!currentJob ? { "idempotency-key": creation.current!.key } : {}) },
        body: JSON.stringify(currentJob ? { revision: currentJob.revision, draft: sentDraft } : sentDraft),
      });
      const result = await response.json() as { destination?: string; job?: PartnerJobView; error?: string; code?: string; currentRevision?: number; fieldErrors?: PartnerDraftFieldErrors };
      if (response.status === 401) { setSessionExpired(true); setError("Your session expired before this draft could be saved."); return false; }
      if (response.status === 409 && result.code === "DRAFT_LOCKED") {
        removeDraftRecovery(storage(), recoveryKey);
        setDirty(false); setRecovered(false); setFieldErrors({}); setLockedElsewhere(true); setSubmissionLocked(true); setSubmissionRecoveryChecked(true);
        setError("Submission started in another browser or device. This draft is now read-only; reload to view its current status.");
        return false;
      }
      if (response.status === 409 && result.code === "STALE_REVISION") { keepConflictingEdits(); removeDraftRecovery(storage(), recoveryKey); setDirty(false); setRecovered(false); setLatestRevision(Number.isInteger(result.currentRevision) ? result.currentRevision! : live.current.revision + 1); setStale(true); setError("This draft changed in another tab. Reload the latest version before saving again."); return false; }
      if (!response.ok || !result.job) { setFieldErrors(result.fieldErrors ?? {}); setError(result.error ?? "The draft could not be saved. Try again."); return false; }
      if (result.job.submissionState !== "DRAFT") { setSubmissionLocked(true); setLockedElsewhere(true); setError("This draft has already been submitted. Reload its status."); return false; }
      const savedFields = fieldsFromJob(result.job, fallback);
      serverJob.current = result.job;
      if (!currentJob && result.job.revision > 0) { keepConflictingEdits(); setLatestRevision(result.job.revision); setStale(true); setError("This recovered draft changed in another tab. Reload the latest version before continuing."); return false; }
      setSubmissionRecoveryChecked(true); setConfirmedSaveRevision(result.job.revision); setRevision(result.job.revision);
      if (JSON.stringify(savedAddress) !== JSON.stringify(savedFields.siteAddress)) setFloorPlans((current) => current ? { ...current, floors: current.floors.map((floor) => ({ ...floor, pdfReady: false })) } : current);
      setSavedAddress(savedFields.siteAddress);
      // A replay may contain the original create while the user has newer edits.
      // Never adopt an older response over typing; drain those changes next.
      const changedWhileSaving = JSON.stringify({ draft: live.current.draft, moneyInputs: live.current.moneyInputs }) !== sentEdit;
      const replayHasOlderInput = !currentJob && JSON.stringify(sentDraft) !== JSON.stringify(validated.value);
      if (changedWhileSaving || replayHasOlderInput) continue;
      // Keep the live inputs, including edits made while earlier requests drained.
      // Only the server owns these generated quote fields.
      const savedDraft = { ...live.current.draft, quote: { ...live.current.draft.quote,
        quoteNumber: savedFields.quote.quoteNumber,
        quoteDate: savedFields.quote.quoteDate,
        defaultsSnapshot: savedFields.quote.defaultsSnapshot,
      } };
      setDraft(savedDraft); live.current.draft = savedDraft;
      removeDraftRecovery(storage(), recoveryKey);
      setDirty(false); live.current.dirty = false; setRecovered(false); setMessage("All changes saved.");
      if (!initialJob) {
        // Promote a newly created draft in place so typing and focus survive.
        setCreatedJob(result.job);
        setFloorPlans({ revision: 0, floors: [] });
        creation.current = undefined;
        if (!navigating.current) window.history.replaceState(null, "", `/partner/jobs/${result.job.id}`);
      }
      return true;
    } } catch { setError("Changes could not be saved. Check your connection and retry; your edits are still here."); return false; }
    finally { setSaving(false); }
  }

  const saveLatest = useRef(save); saveLatest.current = save;
  useEffect(() => {
    if (readOnly || !dirty || stale || submissionLocked || plansBusy || !submissionRecoveryChecked || error) return;
    const timer = window.setTimeout(() => { void saveLatest.current(); }, 750);
    return () => window.clearTimeout(timer);
  }, [readOnly, dirty, draft, moneyInputs, stale, submissionLocked, plansBusy, submissionRecoveryChecked, error]);
  useEffect(() => {
    if (readOnly) return;
    const unregister = registerPartnerSaveGuard(() => saveLatest.current(true));
    const leave = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search) || url.pathname === "/partner/login") return;
      if (live.current.openingCreatedDraft || live.current.plansBusy) { event.preventDefault(); event.stopPropagation(); return; }
      if (!live.current.dirty && !saveInFlight.current) return;
      event.preventDefault(); event.stopPropagation(); navigating.current = true; setOpeningCreatedDraft(true);
      void saveLatest.current(true).then((ok) => { if (ok) router.push(`${url.pathname}${url.search}${url.hash}`); else setOpeningCreatedDraft(false); navigating.current = false; });
    };
    document.addEventListener("click", leave, true);
    return () => { unregister(); document.removeEventListener("click", leave, true); };
  }, [readOnly, router]);

  const inputClass = "min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-base text-gray-900 outline-none focus:border-transparent focus:ring-2 focus:ring-[#e85d04] disabled:bg-gray-50 disabled:text-gray-900";
  const targetDescription = (targetId: string) => errorEntries.filter(([path]) => errorTarget(path, draft.quote.extras.length)?.id === targetId).map(([path]) => errorId(path)).join(" ") || undefined;
  const described = (path: string) => targetDescription(fieldId(path));
  const fieldError = (path: string) => fieldErrors[path] ? <span id={errorId(path)} className="text-xs text-red-700">{fieldErrors[path]}</span> : null;
  const groupedErrors = (targetId: string) => errorEntries.filter(([path]) => {
    const target = errorTarget(path, draft.quote.extras.length);
    return target?.id === targetId && target.id !== fieldId(path);
  }).map(([path, detail]) => <span key={path} id={errorId(path)} className="block text-xs text-red-700">{detail}</span>);
  const title = initialJob ? readOnly ? partnerJobReference(initialJob) : `Edit ${initialJob.clientReference}` : "New quote / lead";

  return <div className="mx-auto max-w-5xl">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><h1 className="mt-1 text-2xl font-bold text-[#1a3a4a] sm:text-3xl">{title}</h1>{readOnly ? <p className="mt-2 text-sm text-gray-600">Submitted details are read-only. Contact the InsulHub team for changes.</p> : null}</div>
      <button type="button" onClick={goBack} disabled={openingCreatedDraft || plansBusy} className="min-h-11 self-start rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-[#1a3a4a] focus-visible:ring-2 focus-visible:ring-[#e85d04] disabled:opacity-40">Back to dashboard</button>
    </header>
    {recovered ? <div className="mt-5 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 sm:flex-row sm:justify-between"><p><strong>Unsaved changes recovered.</strong> Lead and quote edits were kept in this browser tab.</p><button type="button" disabled={saving || Boolean(creation.current)} onClick={clearRecovery} className="min-h-11 self-start rounded-lg border border-blue-300 bg-white px-3 py-2 font-semibold disabled:opacity-40">Discard recovered changes</button></div> : null}
    {conflictingEdits ? <details className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><summary className="cursor-pointer font-semibold text-amber-900">Earlier unsaved changes kept</summary><p className="my-2">These edits were not applied over a newer saved version. Copy any details you need and re-enter them after loading the latest draft.</p><textarea aria-label="Earlier unsaved changes" readOnly rows={8} value={conflictingEdits} className="w-full rounded-lg border bg-white p-3 font-mono text-xs" /></details> : null}
    {error ? <div ref={errorRef} tabIndex={-1} role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 outline-none">
      <p className="font-semibold">{error}</p>
      {errorEntries.length ? <ul className="mt-2 list-disc space-y-1 pl-5">{summariseDraftErrors(errorEntries).map(({path, message, simple}) => {
        const target = errorTarget(path, draft.quote.extras.length);
        const text = simple ? message : `${fieldLabel(path)}: ${message}`;
        return <li key={path}>{target?.link ? <a className="underline decoration-red-300 underline-offset-2 hover:decoration-red-700" href={`#${target.id}`} onClick={(event) => { event.preventDefault(); const field = document.getElementById(target.id); field?.scrollIntoView({ block: "center", behavior: "smooth" }); field?.focus({ preventScroll: true }); }}>{text}</a> : text}</li>;
      })}</ul> : null}
      {sessionExpired ? <Link href="/partner/login?reason=session-expired" className="mt-2 inline-flex min-h-11 items-center font-semibold underline">Sign in again</Link> : null}
      {dirty && !stale && !lockedElsewhere && !sessionExpired ? <button type="button" onClick={() => void save(true)} className="mt-2 min-h-11 font-semibold underline">Retry automatic save</button> : null}
      {stale ? <button type="button" onClick={reloadLatest} className="mt-2 block min-h-11 rounded-lg bg-[#1a3a4a] px-3 py-2 font-semibold text-white">Reload latest draft</button> : null}
      {lockedElsewhere ? <button type="button" onClick={reloadLatest} className="mt-2 block min-h-11 rounded-lg bg-[#1a3a4a] px-3 py-2 font-semibold text-white">Reload submission status</button> : null}
    </div> : null}

    <p className="sr-only" aria-live="polite" aria-atomic="true">{extraAnnouncement}</p>

    <form id="partner-draft-form" onSubmit={(event) => { event.preventDefault(); void save(true); }} className="mt-5 space-y-5" noValidate aria-describedby={targetDescription("partner-draft-form")}>
      {groupedErrors("partner-draft-form")}
      <fieldset disabled={readOnly || openingCreatedDraft || stale || submissionLocked || !submissionRecoveryChecked} className="contents"><legend className="sr-only">Lead and quote draft</legend>
        <LeadSection draft={draft} update={update} updateAddress={updateAddress} readOnly={readOnly} inputClass={inputClass} fieldErrors={fieldErrors} described={described} fieldError={fieldError} />

        <section id="quote-details" tabIndex={-1} className="scroll-mt-24 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="quote-heading" aria-describedby={targetDescription("quote-details")}>
          <h2 id="quote-heading" className="text-lg font-bold text-[#1a3a4a]">Quote</h2>
          {groupedErrors("quote-details")}
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <ProductCard title="Wall insulation" path="wall" checked={draft.quote.wall.enabled} onToggle={(enabled) => toggleProduct("wall", enabled)} offCopy="Not included. Stored wall inputs are cleared." error={fieldErrors.wall} described={targetDescription(fieldId("wall"))}>
              {draft.quote.wall.enabled ? <div className="grid gap-3 sm:grid-cols-2">
                <NumberField path="wall.areaSqm" label="Area (m²)" value={draft.quote.wall.areaSqm} onChange={(value) => updateQuote({ ...draft.quote, wall: { ...draft.quote.wall, areaSqm: value } }, "wall.areaSqm")} inputClass={inputClass} error={fieldErrors["wall.areaSqm"]} />
                <MoneyField path="wall.rateCentsPerSqm" label="Rate per m² ($)" text={moneyInputs.wallRate} onTextChange={(value) => updateMoneyInput("wallRate", value, "wall.rateCentsPerSqm")} onCommit={(value) => { setMoneyInputs((current) => ({ ...current, wallRate: dollarsFromCents(value) })); updateQuote({ ...draft.quote, wall: { ...draft.quote.wall, rateCentsPerSqm: value } }, "wall.rateCentsPerSqm"); }} inputClass={inputClass} error={fieldErrors["wall.rateCentsPerSqm"]} />
                <label className="grid gap-1 text-sm font-semibold text-gray-700 sm:col-span-2">Cavity depth<select id={fieldId("wall.cavityDepthCm")} value={draft.quote.wall.cavityDepthCm ?? ""} onChange={(event) => updateQuote({ ...draft.quote, wall: { ...draft.quote.wall, cavityDepthCm: event.target.value ? Number(event.target.value) as 10 | 15 : null } }, "wall.cavityDepthCm")} className={inputClass} aria-invalid={Boolean(fieldErrors["wall.cavityDepthCm"])} aria-describedby={described("wall.cavityDepthCm")}><option value="">Choose depth</option><option value="10">10 cm</option><option value="15">15 cm</option></select>{fieldError("wall.cavityDepthCm")}</label>
              </div> : null}
            </ProductCard>
            <ProductCard title="Ceiling insulation" path="ceiling" checked={draft.quote.ceiling.enabled} onToggle={(enabled) => toggleProduct("ceiling", enabled)} offCopy="Not included. Stored ceiling inputs are cleared." error={fieldErrors.ceiling} described={targetDescription(fieldId("ceiling"))}>
              {draft.quote.ceiling.enabled ? <div className="grid gap-3 sm:grid-cols-2">
                <NumberField path="ceiling.areaSqm" label="Area (m²)" value={draft.quote.ceiling.areaSqm} onChange={(value) => updateQuote({ ...draft.quote, ceiling: { ...draft.quote.ceiling, areaSqm: value } }, "ceiling.areaSqm")} inputClass={inputClass} error={fieldErrors["ceiling.areaSqm"]} />
                <MoneyField path="ceiling.rateCentsPerSqm" label="Rate per m² ($)" text={moneyInputs.ceilingRate} onTextChange={(value) => updateMoneyInput("ceilingRate", value, "ceiling.rateCentsPerSqm")} onCommit={(value) => { setMoneyInputs((current) => ({ ...current, ceilingRate: dollarsFromCents(value) })); updateQuote({ ...draft.quote, ceiling: { ...draft.quote.ceiling, rateCentsPerSqm: value } }, "ceiling.rateCentsPerSqm"); }} inputClass={inputClass} error={fieldErrors["ceiling.rateCentsPerSqm"]} />
                <NumberField path="ceiling.rValue" label="R-value" value={draft.quote.ceiling.rValue} onChange={(value) => updateQuote({ ...draft.quote, ceiling: { ...draft.quote.ceiling, rValue: value } }, "ceiling.rValue")} inputClass={inputClass} error={fieldErrors["ceiling.rValue"]} />
                <NumberField path="ceiling.downlights" label="Downlights" value={draft.quote.ceiling.downlights} step="1" onChange={(value) => updateQuote({ ...draft.quote, ceiling: { ...draft.quote.ceiling, downlights: value } }, "ceiling.downlights")} inputClass={inputClass} error={fieldErrors["ceiling.downlights"]} />
              </div> : null}
            </ProductCard>
          </div>

          <div id={fieldId("extras")} className="mt-5" aria-invalid={Boolean(targetDescription(fieldId("extras")))} aria-describedby={targetDescription(fieldId("extras"))}><div className="flex items-center justify-between gap-3"><h3 className="font-bold text-[#1a3a4a]">Extras</h3>{!readOnly && <button id="add-extra" type="button" onClick={addExtra} className="min-h-11 rounded-lg border border-[#1a3a4a] px-3 py-2 text-sm font-semibold text-[#1a3a4a]">Add extra</button>}</div>{fieldError("extras")}{groupedErrors(fieldId("extras"))}
            <div className="mt-3 space-y-3">{draft.quote.extras.map((extra, index) => <fieldset key={extra.id} id={fieldId(`extras.${index}`)} aria-invalid={Boolean(targetDescription(fieldId(`extras.${index}`)))} aria-describedby={targetDescription(fieldId(`extras.${index}`))} className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_10rem_auto]"><legend className="sr-only">Extra {index + 1}</legend>{fieldError(`extras.${index}`)}{groupedErrors(fieldId(`extras.${index}`))}
              <label className="grid gap-1 text-sm font-semibold">Name<input id={fieldId(`extras.${index}.name`)} value={extra.name} maxLength={120} onChange={(event) => updateQuote({ ...draft.quote, extras: draft.quote.extras.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) }, `extras.${index}.name`)} className={inputClass} aria-invalid={Boolean(fieldErrors[`extras.${index}.name`])} aria-describedby={described(`extras.${index}.name`)} />{fieldError(`extras.${index}.name`)}</label>
              <MoneyField path={`extras.${index}.priceCents`} label="Price ($)" text={moneyInputs.extras[extra.id] ?? ""} onTextChange={(value) => updateExtraMoneyInput(extra.id, value, `extras.${index}.priceCents`)} onCommit={(value) => { setMoneyInputs((current) => ({ ...current, extras: { ...current.extras, [extra.id]: dollarsFromCents(value) } })); updateQuote({ ...draft.quote, extras: draft.quote.extras.map((item, itemIndex) => itemIndex === index ? { ...item, priceCents: value } : item) }, `extras.${index}.priceCents`); }} inputClass={inputClass} error={fieldErrors[`extras.${index}.priceCents`]} />
              {!readOnly && <div className="flex flex-wrap items-end gap-1"><button type="button" disabled={index === 0} aria-label={`Move ${extra.name || `extra ${index + 1}`} up`} onClick={() => moveExtra(index, -1)} className="min-h-11 rounded-lg border px-2 text-xs disabled:opacity-40">Up</button><button type="button" disabled={index === draft.quote.extras.length - 1} aria-label={`Move ${extra.name || `extra ${index + 1}`} down`} onClick={() => moveExtra(index, 1)} className="min-h-11 rounded-lg border px-2 text-xs disabled:opacity-40">Down</button><button type="button" aria-label={`Remove ${extra.name || `extra ${index + 1}`}`} onClick={() => removeExtra(index)} className="min-h-11 rounded-lg border border-red-200 px-2 text-red-700">Remove</button></div>}
            </fieldset>)}</div>
          </div>
          <label className="mt-5 grid gap-1 text-sm font-semibold">Quote comments<textarea id={fieldId("comments")} value={draft.quote.comments} maxLength={4000} rows={4} onChange={(event) => updateQuote({ ...draft.quote, comments: event.target.value }, "comments")} className={`${inputClass} resize-y`} aria-invalid={Boolean(fieldErrors.comments)} aria-describedby={described("comments")} />{fieldError("comments")}</label>
          <div className="mt-5 rounded-xl bg-[#1a3a4a] p-5 text-white" aria-label="Quote totals" aria-live="polite" aria-atomic="true"><dl className="grid grid-cols-2 gap-2 text-sm"><Total label="Contract price" value={calculation.contractCents} /><Total label="GST (15%)" value={calculation.gstCents} /><Total label="Total" value={calculation.totalCents} strong /></dl></div>
        </section>

        {!readOnly && <section id="floor-plans" tabIndex={-1} className="scroll-mt-24 rounded-2xl border border-gray-200 bg-[#f6f8f9] p-4 shadow-sm focus:outline-none focus:ring-4 focus:ring-[#1a3a4a]/15 sm:p-6" aria-label="Plans">
          {initialJob && floorPlans ? <PartnerFloorPlanList compact refreshOnMount jobId={initialJob.id} recoveryScope={recoveryScope} initialCollection={floorPlans} submissionJobRevision={revision} onCollectionChange={setFloorPlans} onBusyChange={setPlansBusy} onOpeningChange={setOpeningCreatedDraft} /> : <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center"><h2 className="font-bold text-[#1a3a4a]">Floor plans</h2><p className="mt-2 text-sm text-gray-600">{initialJob ? "Reload to load floor plans." : "Start entering the lead details to unlock floor plans."}</p></div>}
        </section>}



      </fieldset>
      {!readOnly && <div className="flex flex-col gap-4 rounded-2xl border border-orange-200 bg-orange-50/50 p-5 sm:flex-row sm:items-center sm:justify-between"><p role="status" className="text-sm text-gray-600">{stale ? "Reload the latest draft to continue." : saving ? "Saving changes…" : error && dirty ? "Changes not saved." : dirty ? message || "Changes waiting to save…" : message || (initialJob ? "All changes saved." : "Changes save automatically.")}</p>
      {initialJob && floorPlans ? <PartnerSubmissionPanel key={`${recoveryScope}:${initialJob.id}:${revision}:${floorPlans.revision}`} jobId={initialJob.id} recoveryScope={recoveryScope} jobRevision={revision} floorPlanRevision={floorPlans.revision} ready={readiness.length === 0} onNotReady={() => { setFieldErrors(Object.fromEntries(readiness.map((issue) => [issue.path, issue.message]))); setError("Before you submit:"); requestAnimationFrame(() => errorRef.current?.focus()); }} dirty={dirty} saving={saving} plansBusy={plansBusy} stale={stale} frozen={submissionLocked} recoveryChecked={submissionRecoveryChecked} verifiedSave={confirmedSaveRevision === revision} onSuccess={() => { setSubmissionLocked(true); removeDraftRecovery(storage(), recoveryKey); setDirty(false); router.replace("/partner?submitted=1"); router.refresh(); }} onLockChange={setSubmissionLocked} onRecoveryChecked={()=>setSubmissionRecoveryChecked(true)} onFrozen={submissionFrozen} /> : <button type="button" disabled className="min-h-14 w-full rounded-xl bg-gray-200 px-8 py-4 text-base font-bold text-gray-500 sm:w-auto sm:min-w-64">Submit quote</button>}
      </div>}
    </form>
    {readOnly && initialJob && floorPlans ? <><section id="floor-plans" className="mt-5"><PartnerFloorPlanList readOnly compact jobId={initialJob.id} recoveryScope={recoveryScope} initialCollection={floorPlans} /></section><PartnerAmendments jobId={initialJob.id} /></> : null}
  </div>;
}

function LeadSection({ draft, update, updateAddress, readOnly, inputClass, fieldErrors, described, fieldError }: {
  draft: PartnerDraftFields;
  update: <K extends keyof LeadDraftFields>(field: K, value: LeadDraftFields[K]) => void;
  updateAddress: (field: keyof LeadDraftFields["siteAddress"], value: string) => void;
  readOnly: boolean;
  inputClass: string;
  fieldErrors: PartnerDraftFieldErrors;
  described: (path: string) => string | undefined;
  fieldError: (path: string) => React.ReactNode;
}) {
  return <section id="lead-details" className="scroll-mt-24 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="lead-heading">
    <h2 id="lead-heading" className="text-lg font-bold text-[#1a3a4a]">Lead details</h2>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="grid gap-1.5 text-sm font-semibold text-gray-700 sm:col-span-2">Customer name<input id={fieldId("customerName")} value={draft.customerName} onChange={(event) => update("customerName", event.target.value)} maxLength={200} autoComplete="name" className={inputClass} aria-invalid={Boolean(fieldErrors.customerName)} aria-describedby={described("customerName")} />{fieldError("customerName")}</label>
      <label className="grid gap-1.5 text-sm font-semibold text-gray-700">Mobile<input id={fieldId("customerMobile")} value={draft.customerMobile} onChange={(event) => update("customerMobile", event.target.value)} maxLength={40} inputMode="tel" autoComplete="tel" className={inputClass} aria-invalid={Boolean(fieldErrors.customerMobile || fieldErrors.contact)} aria-describedby={described("customerMobile")} />{fieldError("customerMobile")}{fieldError("contact")}</label>
      <label className="grid gap-1.5 text-sm font-semibold text-gray-700">Email<input id={fieldId("customerEmail")} value={draft.customerEmail} onChange={(event) => update("customerEmail", event.target.value)} maxLength={254} type="email" autoComplete="email" className={inputClass} aria-invalid={Boolean(fieldErrors.customerEmail)} aria-describedby={described("customerEmail")} />{fieldError("customerEmail")}</label>
      <div className="grid gap-1.5 text-sm font-semibold text-gray-700 sm:col-span-2"><label htmlFor={fieldId("street")}>Street address</label><AddressAutocomplete id={fieldId("street")} disabled={readOnly} value={draft.siteAddress.street} onChange={(value) => updateAddress("street", value)} onSelectAddress={(address) => update("siteAddress", { street: address.streetAddress, suburb: address.suburb, city: address.city, postcode: address.postCode })} maxLength={200} className={inputClass} aria-invalid={Boolean(fieldErrors.street || fieldErrors.address)} aria-describedby={described("street")} />{fieldError("street")}{fieldError("address")}</div>
      <label className="grid gap-1.5 text-sm font-semibold text-gray-700">Suburb<input id={fieldId("suburb")} value={draft.siteAddress.suburb} onChange={(event) => updateAddress("suburb", event.target.value)} maxLength={100} className={inputClass} aria-invalid={Boolean(fieldErrors.suburb)} aria-describedby={described("suburb")} />{fieldError("suburb")}</label>
      <label className="grid gap-1.5 text-sm font-semibold text-gray-700">City<input id={fieldId("city")} value={draft.siteAddress.city} onChange={(event) => updateAddress("city", event.target.value)} maxLength={100} className={inputClass} aria-invalid={Boolean(fieldErrors.city)} aria-describedby={described("city")} />{fieldError("city")}</label>
      <label className="grid gap-1.5 text-sm font-semibold text-gray-700">Postcode<input id={fieldId("postcode")} value={draft.siteAddress.postcode} onChange={(event) => updateAddress("postcode", event.target.value)} maxLength={20} inputMode="numeric" autoComplete="postal-code" className={inputClass} aria-invalid={Boolean(fieldErrors.postcode)} aria-describedby={described("postcode")} />{fieldError("postcode")}</label>
    </div>
    <label className="mt-5 grid gap-1.5 text-sm font-semibold text-gray-700">Notes<textarea id={fieldId("notes")} value={draft.notes} onChange={(event) => update("notes", event.target.value)} maxLength={4000} rows={4} className={`${inputClass} resize-y`} aria-invalid={Boolean(fieldErrors.notes)} aria-describedby={described("notes")} />{fieldError("notes")}</label>
  </section>;
}

function ProductCard({ title, path, checked, onToggle, offCopy, error, described, children }: { title: string; path: string; checked: boolean; onToggle: (value: boolean) => void; offCopy: string; error?: string; described?: string; children: React.ReactNode }) {
  return <fieldset className="rounded-xl border border-gray-200 p-4" aria-describedby={described}><legend className="px-1 text-base font-bold text-[#1a3a4a]"><label className="flex min-h-11 items-center gap-2"><input id={fieldId(path)} type="checkbox" checked={checked} onChange={(event) => onToggle(event.target.checked)} className="h-5 w-5 accent-[#e85d04]" aria-invalid={Boolean(error)} aria-describedby={described} />{title}</label></legend>{error ? <span id={errorId(path)} className="text-xs text-red-700">{error}</span> : null}{checked ? <div className="mt-3">{children}</div> : <p className="mt-3 text-sm text-gray-500">{offCopy}</p>}</fieldset>;
}

function NumberField({ path, label, value, onChange, inputClass, step = "0.1", error }: { path: string; label: string; value: number | null; onChange: (value: number | null) => void; inputClass: string; step?: string; error?: string }) {
  return <label className="grid gap-1 text-sm font-semibold text-gray-700">{label}<input id={fieldId(path)} type="number" min="0" step={step} value={value ?? ""} onChange={(event) => onChange(nullableNumber(event.target.value))} className={inputClass} aria-invalid={Boolean(error)} aria-describedby={error ? errorId(path) : undefined} />{error ? <span id={errorId(path)} className="text-xs text-red-700">{error}</span> : null}</label>;
}

function MoneyField({ path, label, text, onTextChange, onCommit, inputClass, error }: { path: string; label: string; text: string; onTextChange: (value: string) => void; onCommit: (value: number | null) => void; inputClass: string; error?: string }) {
  return <label className="grid gap-1 text-sm font-semibold text-gray-700">{label}<input id={fieldId(path)} type="text" inputMode="decimal" pattern="[0-9]*[.]?[0-9]*" value={text} onChange={(event) => onTextChange(event.target.value)} onBlur={(event) => { const value = event.target.value; const parsed = moneyFromDollars(value); if (!value.trim() || parsed !== null) onCommit(parsed); }} className={inputClass} aria-invalid={Boolean(error)} aria-describedby={error ? errorId(path) : undefined} />{error ? <span id={errorId(path)} className="text-xs text-red-700">{error}</span> : null}</label>;
}

function Total({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) { return <><dt className={strong ? "border-t border-white/20 pt-2 font-bold" : ""}>{label}</dt><dd className={`${strong ? "border-t border-white/20 pt-2 text-base" : ""} text-right font-semibold`}>{nzMoney.format(value / 100)}</dd></>; }
