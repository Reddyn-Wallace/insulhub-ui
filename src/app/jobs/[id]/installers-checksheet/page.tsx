"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { gql } from "@/lib/graphql";
import { JOB_QUERY } from "@/lib/queries";

const API_BASE = "https://api.insulhub.nz";

const CHECKSHEET_FIELDS = `
  _id
  complete
  contractNumber
  address
  customerName
  customerTel
  installDate
  cladding
  budgetBags
  actualBags
  wallAreaQuoted
  wallAreaInstalled
  ebaSightedAndPreInstallMaintenanceCompleted
  sampleWallCompletelyFull
  forDevelopmentWeightOfSampleWall
  actionTakenIfNotCompletelyFull
  recordBagIdentificationPhotos { _id thumbnail fileName }
  commentsOrIssues
  q0_installedIRChecked
  q1_underfloorVents
  q2_inWallToilet
  q3_loweredCeilings
  q4_unsealedMasonry
  q5_masonryJoinerySealed
  q6_noEvidenceOfLeak
  ceilingInstall_quotedArea
  ceilingInstall_quotedRValue
  ceilingInstall_quotedThickness
  ceilingInstall_numDownlightsQuoted
  ceilingInstall_numDownlightsInstalled
  ceilingInstall_haveAllDownLightsBeenLocated
  ceilingInstall_bagsRequiredForInstall
  ceilingInstall_bagsInstalled
  installerName
  signature_installer { _id thumbnail fileName }
  date
`;

const GET_OR_CREATE_CHECKSHEET = `
  mutation GetOrCreateEmptyInstallerChecksheet($jobId: ObjectId!) {
    getOrCreateEmptyInstallerChecksheet(jobId: $jobId) {
      ${CHECKSHEET_FIELDS}
    }
  }
`;

const UPDATE_CHECKSHEET = `
  mutation UpdateInstallerChecksheet($input: InstallerChecksheetInput!) {
    updateInstallerChecksheet(input: $input) {
      ${CHECKSHEET_FIELDS}
    }
  }
`;

type Photo = { _id?: string; fileName?: string; thumbnail?: string };
type ContactDetails = {
  name?: string;
  email?: string;
  phoneMobile?: string;
  phoneSecondary?: string;
  streetAddress?: string;
  suburb?: string;
  city?: string;
  postCode?: string;
};

type CheckValue = string | boolean | null | undefined;

type Checksheet = {
  _id?: string;
  complete?: boolean;
  contractNumber?: string | number | null;
  address?: string | null;
  customerName?: string | null;
  customerTel?: string | null;
  installDate?: string | null;
  cladding?: string | null;
  budgetBags?: number | string | null;
  actualBags?: number | string | null;
  wallAreaQuoted?: number | string | null;
  wallAreaInstalled?: number | string | null;
  ebaSightedAndPreInstallMaintenanceCompleted?: CheckValue;
  sampleWallCompletelyFull?: CheckValue;
  forDevelopmentWeightOfSampleWall?: number | string | null;
  actionTakenIfNotCompletelyFull?: string | null;
  recordBagIdentificationPhotos?: Photo[] | null;
  commentsOrIssues?: string | null;
  q0_installedIRChecked?: CheckValue;
  q1_underfloorVents?: CheckValue;
  q2_inWallToilet?: CheckValue;
  q3_loweredCeilings?: CheckValue;
  q4_unsealedMasonry?: CheckValue;
  q5_masonryJoinerySealed?: CheckValue;
  q6_noEvidenceOfLeak?: CheckValue;
  ceilingInstall_quotedArea?: number | string | null;
  ceilingInstall_quotedRValue?: number | string | null;
  ceilingInstall_quotedThickness?: number | string | null;
  ceilingInstall_numDownlightsQuoted?: number | string | null;
  ceilingInstall_numDownlightsInstalled?: number | string | null;
  ceilingInstall_haveAllDownLightsBeenLocated?: CheckValue;
  ceilingInstall_bagsRequiredForInstall?: number | string | null;
  ceilingInstall_bagsInstalled?: number | string | null;
  installerName?: string | null;
  signature_installer?: Photo | null;
  date?: string | null;
};

type Job = {
  _id: string;
  jobNumber?: number;
  stage?: string;
  client?: { name?: string; contactDetails?: ContactDetails; billingDetails?: ContactDetails };
  quote?: {
    quoteNumber?: string;
    wall?: { SQM?: number; c_bagCount?: number; c_RValue?: number; cavityDepthMeters?: number; internal?: boolean };
    ceiling?: { SQM?: number; RValue?: number; downlights?: number; c_bagCount?: number; c_thickness?: number };
  };
  installation?: { installDate?: string; installNote?: string; installStatus?: string; checkSheetSignedAsComplete?: boolean };
  installerChecksheet?: Checksheet | null;
};

type FieldKey = keyof Checksheet;

function dateInputValue(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toISOString().slice(0, 10);
}

function inputDateToIso(value: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(`${value}T00:00:00+12:00`).toISOString();
}

function normalizeEmpty(v: unknown) {
  return v === "" ? null : v;
}

function normalizeNumber(v: unknown) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

function boolSelectValue(v: CheckValue) {
  if (v === true) return "yes";
  if (v === false) return "no";
  if (typeof v === "string" && v.toLowerCase() === "na") return "na";
  return "";
}

function boolFromSelect(v: string): CheckValue {
  if (v === "yes") return true;
  if (v === "no") return false;
  if (v === "na") return "NA";
  return null;
}

function yesNo(v: CheckValue) {
  if (v === null || v === undefined || v === "") return "Not recorded";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const text = String(v);
  if (text.toLowerCase() === "na") return "N/A";
  return text;
}

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("token") || "" : "";
}

function fileUrl(fileName?: string) {
  if (!fileName) return "";
  return `${API_BASE}/files/documents/${encodeURIComponent(fileName)}?token=${getToken()}`;
}

function addressFromContact(contact?: ContactDetails) {
  return [contact?.streetAddress, contact?.city, contact?.suburb, contact?.postCode].filter(Boolean).join(", ");
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-gray-50 p-4 shadow-sm">
      <h2 className="text-base font-semibold text-[#1a3a4a]">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function TextField({ label, value, onChange, disabled, type = "text", suffix, multiline }: { label: string; value: unknown; onChange: (value: string) => void; disabled?: boolean; type?: string; suffix?: string; multiline?: boolean }) {
  const cls = "mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 disabled:bg-gray-100 disabled:text-gray-600";
  return (
    <label className="block rounded-xl border border-gray-200 bg-white px-3 py-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <div className="flex items-center gap-2">
        {multiline ? (
          <textarea className={cls} disabled={disabled} value={String(value ?? "")} rows={2} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <input className={cls} disabled={disabled} type={type} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
        )}
        {suffix && <span className="mt-1 text-sm text-gray-500">{suffix}</span>}
      </div>
    </label>
  );
}

function CheckField({ label, value, onChange, disabled, allowNa = false }: { label: string; value: CheckValue; onChange: (value: CheckValue) => void; disabled?: boolean; allowNa?: boolean }) {
  return (
    <label className="block rounded-xl border border-gray-200 bg-white p-3">
      <span className="text-sm font-medium text-gray-900">{label}</span>
      <select disabled={disabled} className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 disabled:bg-gray-100 disabled:text-gray-600" value={boolSelectValue(value)} onChange={(e) => onChange(boolFromSelect(e.target.value))}>
        <option value="">Not recorded</option>
        {allowNa && <option value="na">N/A</option>}
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
      {disabled && <span className="mt-2 inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">{yesNo(value)}</span>}
    </label>
  );
}

export default function InstallerChecksheetPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const [job, setJob] = useState<Job | null>(null);
  const [form, setForm] = useState<Checksheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savedState, setSavedState] = useState("");
  const [error, setError] = useState("");
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadDone = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const data = await gql<{ job: Job }>(JOB_QUERY, { _id: id }, { cacheKey: `job:${id}:installer-checksheet`, ttlMs: 1, storage: "session" });
      const checksheetData = await gql<{ getOrCreateEmptyInstallerChecksheet: Checksheet }>(GET_OR_CREATE_CHECKSHEET, { jobId: id });
      setJob({ ...data.job, installerChecksheet: checksheetData.getOrCreateEmptyInstallerChecksheet });
      setForm(checksheetData.getOrCreateEmptyInstallerChecksheet);
      initialLoadDone.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load checksheet");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); }, []);

  const contact = job?.client?.contactDetails;
  const quote = job?.quote;
  const installation = job?.installation;
  const wallExists = Boolean(quote?.wall?.SQM);
  const ceilingExists = Boolean(quote?.ceiling?.SQM);
  const complete = Boolean(form?.complete || installation?.checkSheetSignedAsComplete);
  const disabled = complete || saving;
  const completionLabel = complete ? "Complete" : form?._id ? "Draft / not locked" : "No checksheet found";
  const photos = useMemo(() => (form?.recordBagIdentificationPhotos || []).filter((p) => p?.fileName), [form]);

  function updateField(key: FieldKey, value: Checksheet[FieldKey], autosave = true) {
    setForm((prev) => prev ? { ...prev, [key]: value } : prev);
    if (autosave && !complete) {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => {
        setForm((latest) => {
          if (latest && initialLoadDone.current) void save(latest, false, true);
          return latest;
        });
      }, 900);
    }
  }

  function buildInput(source: Checksheet, finalize: boolean) {
    return {
      _id: source._id,
      jobId: job?._id,
      finalize,
      contractNumber: normalizeEmpty(source.contractNumber),
      address: normalizeEmpty(source.address),
      customerName: normalizeEmpty(source.customerName),
      customerTel: normalizeEmpty(source.customerTel),
      installDate: inputDateToIso(String(source.installDate || "")),
      cladding: normalizeEmpty(source.cladding),
      budgetBags: normalizeNumber(source.budgetBags),
      actualBags: normalizeNumber(source.actualBags),
      wallAreaQuoted: normalizeNumber(source.wallAreaQuoted),
      wallAreaInstalled: normalizeNumber(source.wallAreaInstalled),
      ebaSightedAndPreInstallMaintenanceCompleted: source.ebaSightedAndPreInstallMaintenanceCompleted ?? null,
      sampleWallCompletelyFull: source.sampleWallCompletelyFull ?? null,
      forDevelopmentWeightOfSampleWall: normalizeNumber(source.forDevelopmentWeightOfSampleWall),
      actionTakenIfNotCompletelyFull: normalizeEmpty(source.actionTakenIfNotCompletelyFull),
      recordBagIdentificationPhotos: source.recordBagIdentificationPhotos || null,
      commentsOrIssues: normalizeEmpty(source.commentsOrIssues),
      q0_installedIRChecked: source.q0_installedIRChecked ?? null,
      q1_underfloorVents: source.q1_underfloorVents ?? null,
      q2_inWallToilet: source.q2_inWallToilet ?? null,
      q3_loweredCeilings: source.q3_loweredCeilings ?? null,
      q4_unsealedMasonry: source.q4_unsealedMasonry ?? null,
      q5_masonryJoinerySealed: source.q5_masonryJoinerySealed ?? null,
      q6_noEvidenceOfLeak: source.q6_noEvidenceOfLeak ?? null,
      ceilingInstall_quotedArea: normalizeNumber(source.ceilingInstall_quotedArea),
      ceilingInstall_quotedRValue: normalizeNumber(source.ceilingInstall_quotedRValue),
      ceilingInstall_quotedThickness: normalizeNumber(source.ceilingInstall_quotedThickness),
      ceilingInstall_numDownlightsQuoted: normalizeNumber(source.ceilingInstall_numDownlightsQuoted),
      ceilingInstall_numDownlightsInstalled: normalizeNumber(source.ceilingInstall_numDownlightsInstalled),
      ceilingInstall_haveAllDownLightsBeenLocated: source.ceilingInstall_haveAllDownLightsBeenLocated ?? null,
      ceilingInstall_bagsRequiredForInstall: normalizeNumber(source.ceilingInstall_bagsRequiredForInstall),
      ceilingInstall_bagsInstalled: normalizeNumber(source.ceilingInstall_bagsInstalled),
      installerName: normalizeEmpty(source.installerName),
      signature_installer: source.signature_installer || null,
      date: inputDateToIso(String(source.date || "")),
    };
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return [] as string[];
    const formData = new FormData();
    Array.from(files).forEach((f) => formData.append("files", f));
    const res = await fetch(`${API_BASE}/files/upload`, {
      method: "POST",
      headers: { "x-token": getToken() },
      body: formData,
    });
    const json = await res.json();
    return (json.fileNames || []) as string[];
  }

  async function persist(next: Checksheet, quiet = true) {
    setForm(next);
    await save(next, false, quiet);
  }

  async function uploadBagPhotos(files: FileList | null) {
    if (!form || !files?.length) return;
    setUploading(true);
    setSavedState(`Uploading ${files.length} photo${files.length > 1 ? "s" : ""}…`);
    try {
      const fileNames = await uploadFiles(files);
      const uploaded = fileNames.map((fileName) => ({ fileName, thumbnail: fileName }));
      const next = { ...form, recordBagIdentificationPhotos: [...(form.recordBagIdentificationPhotos || []), ...uploaded] };
      await persist(next);
      setSavedState("Photos uploaded");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload photos");
    } finally {
      setUploading(false);
    }
  }

  async function removeBagPhoto(fileName?: string) {
    if (!form || !fileName) return;
    const next = { ...form, recordBagIdentificationPhotos: (form.recordBagIdentificationPhotos || []).filter((p) => p.fileName !== fileName) };
    await persist(next);
    setSavedState("Photo removed");
  }

  async function uploadSignature(files: FileList | null) {
    if (!form || !files?.length) return;
    setUploading(true);
    setSavedState("Uploading signature…");
    try {
      const fileNames = await uploadFiles(files);
      if (!fileNames.length) throw new Error("Signature upload failed");
      const fileName = fileNames[0];
      const next = { ...form, signature_installer: { fileName, thumbnail: fileName } };
      await persist(next);
      setSavedState("Signature uploaded");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload signature");
    } finally {
      setUploading(false);
    }
  }

  function isPresent(value: unknown) {
    return value !== null && value !== undefined && value !== "";
  }

  function validateForLock(source: Checksheet) {
    const errors: Record<string, string> = {};
    const requireValue = (key: FieldKey, label: string) => {
      if (!isPresent(source[key])) errors[String(key)] = `${label} is required`;
    };
    const requireBoolean = (key: FieldKey, label: string) => {
      if (typeof source[key] !== "boolean") errors[String(key)] = `${label} is required`;
    };

    requireValue("contractNumber", "Contract Number");
    requireValue("address", "Address");
    requireValue("customerName", "Customer Name");
    requireValue("customerTel", "Customer Tel");
    requireValue("cladding", "Cladding");
    requireValue("installerName", "Licensed Installer Name");
    requireValue("budgetBags", "Budget bags");
    requireValue("actualBags", "Actual bags");

    requireBoolean("ebaSightedAndPreInstallMaintenanceCompleted", "Existing Building Assessment sighted and pre install maintenance completed");
    requireBoolean("q0_installedIRChecked", "Installed, I.R checked, cladding finished according to I.N.Z procedures");
    requireBoolean("q1_underfloorVents", "Underfloor vents are clear");
    requireBoolean("q2_inWallToilet", "In wall toilet cisterns, water heaters etc. identified and avoided");
    requireBoolean("q3_loweredCeilings", "Lowered ceilings have interior wall lining and down lights not compromised");
    requireBoolean("q6_noEvidenceOfLeak", "No evidence of leaking gutters into soffits / gutters clear");

    if (wallExists) {
      requireValue("wallAreaQuoted", "Quoted Wall Area");
      requireValue("wallAreaInstalled", "Installed Wall Area");
      requireValue("forDevelopmentWeightOfSampleWall", "For development weight of sample wall");
      requireBoolean("sampleWallCompletelyFull", "Sample wall completely full");
      if (source.sampleWallCompletelyFull !== true && !isPresent(source.actionTakenIfNotCompletelyFull)) {
        errors.actionTakenIfNotCompletelyFull = "Action taken if not completely full is required";
      }
    }

    if (ceilingExists) {
      requireValue("ceilingInstall_quotedArea", "Quoted area");
      requireValue("ceilingInstall_quotedRValue", "Quoted R Value");
      requireValue("ceilingInstall_quotedThickness", "Quoted thickness");
      requireValue("ceilingInstall_numDownlightsQuoted", "Number of down lights identified in quote form");
      requireValue("ceilingInstall_numDownlightsInstalled", "Number of down lights identified in install");
      requireValue("ceilingInstall_bagsRequiredForInstall", "Bags required for install");
      requireValue("ceilingInstall_bagsInstalled", "Bags installed");
      requireBoolean("ceilingInstall_haveAllDownLightsBeenLocated", "Have all down lights been located");
    }

    return errors;
  }

  async function save(source: Checksheet, finalize: boolean, quiet = false) {
    if (!job?._id || !source?._id) return;
    if (finalize) {
      const errors = validateForLock(source);
      setValidationErrors(errors);
      if (Object.keys(errors).length) {
        setError("Some required fields are missing before locking.");
        setSavedState("Save and lock blocked");
        return;
      }
    } else {
      setValidationErrors({});
    }
    if (!quiet) setSaving(true);
    setSavedState(quiet ? "Autosaving…" : "Saving…");
    try {
      const data = await gql<{ updateInstallerChecksheet: Checksheet }>(UPDATE_CHECKSHEET, { input: buildInput(source, finalize) });
      setForm(data.updateInstallerChecksheet);
      setJob((prev) => prev ? { ...prev, installerChecksheet: data.updateInstallerChecksheet } : prev);
      setSavedState(quiet ? "Autosaved" : finalize ? "Saved and locked" : "Draft saved");
      if (!quiet) router.push("/jobs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save Installer's Check Sheet");
      setSavedState("Save failed");
    } finally {
      if (!quiet) setSaving(false);
    }
  }

  if (loading) {
    return <main className="min-h-screen bg-[#f6f8f9] p-4"><div className="mx-auto max-w-4xl rounded-2xl bg-white p-6 text-sm text-gray-600 shadow-sm">Loading installer checksheet…</div></main>;
  }

  if (error && !form) {
    return (
      <main className="min-h-screen bg-[#f6f8f9] p-4">
        <div className="mx-auto max-w-4xl rounded-2xl bg-white p-6 shadow-sm">
          <button onClick={() => router.back()} className="text-sm font-semibold text-[#1a3a4a]">← Back</button>
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        </div>
      </main>
    );
  }

  if (!job || !form) return null;

  return (
    <main className="min-h-screen bg-[#f6f8f9] p-3 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-4 pb-28">
        <div className="rounded-2xl bg-[#1a3a4a] p-4 text-white shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Link href={`/jobs/${job._id}`} className="text-sm font-semibold text-white/80 hover:text-white">← Back to job</Link>
              <h1 className="mt-3 text-2xl font-bold">Installer&apos;s Check Sheet</h1>
              <p className="mt-1 text-sm text-white/75">Job #{job.jobNumber ?? "—"} · {completionLabel}</p>
            </div>
            <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${complete ? "bg-emerald-100 text-emerald-800" : "bg-white/15 text-white"}`}>{completionLabel}</span>
          </div>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {Object.keys(validationErrors).length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <div className="font-semibold">Required before Save and lock:</div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {Object.entries(validationErrors).map(([key, message]) => <li key={key}>{message}</li>)}
            </ul>
          </div>
        )}
        {savedState && <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-700">{savedState}</div>}

        <Section title="Customer / job header">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField disabled={disabled} label="Contract Number" value={form.contractNumber ?? quote?.quoteNumber ?? job.jobNumber ?? ""} onChange={(v) => updateField("contractNumber", v)} />
            <TextField disabled={disabled} label="Address" value={form.address ?? addressFromContact(contact)} onChange={(v) => updateField("address", v)} />
            <TextField disabled={disabled} label="Customer Name" value={form.customerName ?? contact?.name ?? job.client?.name ?? ""} onChange={(v) => updateField("customerName", v)} />
            <TextField disabled={disabled} label="Tel" value={form.customerTel ?? contact?.phoneMobile ?? contact?.phoneSecondary ?? ""} onChange={(v) => updateField("customerTel", v)} />
            <TextField disabled={disabled} type="date" label="Install Date" value={dateInputValue(form.installDate ?? installation?.installDate)} onChange={(v) => updateField("installDate", v)} />
            <TextField disabled={disabled} label="Cladding" value={form.cladding ?? ""} onChange={(v) => updateField("cladding", v)} />
          </div>
        </Section>

        <Section title="Usage amounts & wall area">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <TextField disabled={disabled} type="number" label="Bags (budget)" value={form.budgetBags ?? quote?.wall?.c_bagCount ?? ""} onChange={(v) => updateField("budgetBags", v)} />
            <TextField disabled={disabled} type="number" label="Bags (actual)" value={form.actualBags ?? ""} onChange={(v) => updateField("actualBags", v)} />
            <TextField disabled={disabled || !wallExists} type="number" label="Wall area (quoted)" suffix="m²" value={form.wallAreaQuoted ?? quote?.wall?.SQM ?? ""} onChange={(v) => updateField("wallAreaQuoted", v)} />
            <TextField disabled={disabled || !wallExists} type="number" label="Wall area (installed)" suffix="m²" value={form.wallAreaInstalled ?? ""} onChange={(v) => updateField("wallAreaInstalled", v)} />
          </div>
        </Section>

        <Section title="Pre-install checks & sample wall">
          <div className="grid gap-3 sm:grid-cols-2">
            <CheckField disabled={disabled} label="Existing Building Assessment sighted and pre install maintenance completed" value={form.ebaSightedAndPreInstallMaintenanceCompleted} onChange={(v) => updateField("ebaSightedAndPreInstallMaintenanceCompleted", v)} />
            <CheckField disabled={disabled || !wallExists} label="Sample wall completely full" value={form.sampleWallCompletelyFull} onChange={(v) => updateField("sampleWallCompletelyFull", v)} />
            <TextField disabled={disabled || !wallExists} type="number" label="For development weight of sample wall" suffix="kg" value={form.forDevelopmentWeightOfSampleWall ?? ""} onChange={(v) => updateField("forDevelopmentWeightOfSampleWall", v)} />
            <TextField disabled={disabled || !wallExists} multiline label="Action taken if not completely full" value={form.actionTakenIfNotCompletelyFull ?? ""} onChange={(v) => updateField("actionTakenIfNotCompletelyFull", v)} />
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Record bag identification numbers</div>
              {!disabled && (
                <label className="cursor-pointer rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-semibold text-gray-700">
                  {uploading ? "Uploading…" : "Upload photos"}
                  <input type="file" accept="image/*" multiple disabled={uploading} className="hidden" onChange={(e) => void uploadBagPhotos(e.target.files)} />
                </label>
              )}
            </div>
            {photos.length ? (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {photos.map((photo) => (
                  <div key={photo.fileName} className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                    <a href={fileUrl(photo.fileName)} target="_blank" rel="noreferrer" className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={fileUrl(photo.thumbnail || photo.fileName)} alt="Bag identification" className="h-28 w-full object-cover" />
                    </a>
                    {!disabled && <button type="button" onClick={() => void removeBagPhoto(photo.fileName)} className="w-full bg-white px-2 py-1.5 text-xs font-semibold text-red-600">Remove</button>}
                  </div>
                ))}
              </div>
            ) : <div className="mt-1 text-sm font-medium text-gray-900">No photos recorded</div>}
          </div>
          <TextField disabled={disabled} multiline label="Comments / issues" value={form.commentsOrIssues ?? ""} onChange={(v) => updateField("commentsOrIssues", v)} />
        </Section>

        <Section title="Completion checks">
          <div className="grid gap-3 sm:grid-cols-2">
            <CheckField disabled={disabled} label="Installed, I.R checked, cladding finished according to I.N.Z procedures" value={form.q0_installedIRChecked} onChange={(v) => updateField("q0_installedIRChecked", v)} />
            <CheckField disabled={disabled} label="Underfloor vents are clear" value={form.q1_underfloorVents} onChange={(v) => updateField("q1_underfloorVents", v)} />
            <CheckField disabled={disabled} label="In wall toilet cisterns, water heaters etc. identified and avoided" value={form.q2_inWallToilet} onChange={(v) => updateField("q2_inWallToilet", v)} />
            <CheckField disabled={disabled} label="Lowered ceilings have interior wall lining and down lights not compromised" value={form.q3_loweredCeilings} onChange={(v) => updateField("q3_loweredCeilings", v)} />
            <CheckField disabled={disabled} allowNa label="Unsealed masonry cladding has been sealed with surfapore" value={form.q4_unsealedMasonry} onChange={(v) => updateField("q4_unsealedMasonry", v)} />
            <CheckField disabled={disabled} allowNa label="Masonry / joinery joint is sealed" value={form.q5_masonryJoinerySealed} onChange={(v) => updateField("q5_masonryJoinerySealed", v)} />
            <CheckField disabled={disabled} label="No evidence of leaking gutters into soffits / gutters clear" value={form.q6_noEvidenceOfLeak} onChange={(v) => updateField("q6_noEvidenceOfLeak", v)} />
          </div>
        </Section>

        <Section title="Ceiling Installation">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <TextField disabled={disabled || !ceilingExists} type="number" label="Quoted area" suffix="m²" value={form.ceilingInstall_quotedArea ?? quote?.ceiling?.SQM ?? ""} onChange={(v) => updateField("ceilingInstall_quotedArea", v)} />
            <TextField disabled={disabled || !ceilingExists} type="number" label="Quoted R Value" value={form.ceilingInstall_quotedRValue ?? quote?.ceiling?.RValue ?? ""} onChange={(v) => updateField("ceilingInstall_quotedRValue", v)} />
            <TextField disabled={disabled || !ceilingExists} type="number" label="Quoted Thickness" value={form.ceilingInstall_quotedThickness ?? quote?.ceiling?.c_thickness ?? ""} onChange={(v) => updateField("ceilingInstall_quotedThickness", v)} />
            <TextField disabled={disabled || !ceilingExists} type="number" label="Number of down lights identified in quote form" value={form.ceilingInstall_numDownlightsQuoted ?? quote?.ceiling?.downlights ?? ""} onChange={(v) => updateField("ceilingInstall_numDownlightsQuoted", v)} />
            <TextField disabled={disabled || !ceilingExists} type="number" label="Number of down lights identified in install" value={form.ceilingInstall_numDownlightsInstalled ?? ""} onChange={(v) => updateField("ceilingInstall_numDownlightsInstalled", v)} />
            <TextField disabled={disabled || !ceilingExists} type="number" label="Bags required for install" value={form.ceilingInstall_bagsRequiredForInstall ?? quote?.ceiling?.c_bagCount ?? ""} onChange={(v) => updateField("ceilingInstall_bagsRequiredForInstall", v)} />
            <TextField disabled={disabled || !ceilingExists} type="number" label="Bags installed" value={form.ceilingInstall_bagsInstalled ?? ""} onChange={(v) => updateField("ceilingInstall_bagsInstalled", v)} />
          </div>
          <CheckField disabled={disabled || !ceilingExists} label="Have all down lights been located" value={form.ceilingInstall_haveAllDownLightsBeenLocated} onChange={(v) => updateField("ceilingInstall_haveAllDownLightsBeenLocated", v)} />
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">NOTE - Insulation to be kept a minimum of 150mm from sources of heat e.g halogen downlight, flu&apos;s etc.</div>
        </Section>

        <Section title="Installer declaration / signature">
          <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-700">The installation was carried out by a licensed installer according to the pre inspection and installation procedures of Insulmax® N.Z Ltd</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField disabled={disabled} label="Licensed Installer Name" value={form.installerName ?? ""} onChange={(v) => updateField("installerName", v)} />
            <TextField disabled={disabled} type="date" label="Date" value={dateInputValue(form.date)} onChange={(v) => updateField("date", v)} />
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Signature</div>
              {!disabled && (
                <label className="cursor-pointer rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-semibold text-gray-700">
                  {uploading ? "Uploading…" : "Upload signature"}
                  <input type="file" accept="image/*" disabled={uploading} className="hidden" onChange={(e) => void uploadSignature(e.target.files)} />
                </label>
              )}
            </div>
            {form.signature_installer?.fileName ? (
              <a href={fileUrl(form.signature_installer.fileName)} target="_blank" rel="noreferrer" className="mt-2 inline-block rounded-lg border border-gray-200 bg-gray-50 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl(form.signature_installer.thumbnail || form.signature_installer.fileName)} alt="Installer signature" className="max-h-36 max-w-full" />
              </a>
            ) : <div className="mt-1 text-sm font-medium text-gray-900">No signature recorded</div>}
          </div>
        </Section>

        <div className="sticky bottom-3 z-10 rounded-2xl border border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur">
          {complete ? (
            <div className="flex justify-end">
              <button type="button" onClick={() => router.push("/jobs")} className="rounded-xl bg-[#1a3a4a] px-4 py-3 text-sm font-semibold text-white">Close</button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" disabled={saving} onClick={() => save(form, false)} className="rounded-xl border border-gray-200 bg-gray-100 px-4 py-3 text-sm font-semibold text-gray-700 disabled:opacity-60">Save as draft and close</button>
              <button type="button" disabled={saving} onClick={() => save(form, true)} className="rounded-xl bg-[#1a3a4a] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">Save and lock</button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
