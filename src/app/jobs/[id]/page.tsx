"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { gql } from "@/lib/graphql";
import { JOB_QUERY, USERS_QUERY } from "@/lib/queries";
import {
  UPDATE_JOB_LEAD, UPDATE_JOB_NOTES,
  UPDATE_JOB_QUOTE, ARCHIVE_JOB, UPDATE_CLIENT, SEND_EBA, ADD_FILES, REMOVE_FILE,
} from "@/lib/mutations";
import PipelineBreadcrumb from "@/components/PipelineBreadcrumb";
import BottomSheet from "@/components/BottomSheet";
import AddressAutocomplete from "@/components/AddressAutocomplete";

// ── Types ──────────────────────────────────────────────────────────
interface User { _id: string; firstname: string; lastname: string; email: string; role?: string; }
interface ContactDetails {
  name?: string; email?: string; phoneMobile?: string; phoneSecondary?: string;
  streetAddress?: string; suburb?: string; city?: string; postCode?: string;
}
interface Job {
  _id: string; jobNumber: number; stage: string; notes?: string; updatedAt: string; archivedAt?: string;
  lead?: {
    leadStatus?: string; leadSource?: string[];
    allocatedTo?: { _id: string; firstname: string; lastname: string };
    callbackDate?: string; quoteBookingDate?: string;
  };
  quote?: {
    quoteNumber?: string; date?: string; c_total?: number; c_deposit?: number;
    depositPercentage?: number; consentFee?: number; quoteNote?: string; quoteResultNote?: string;
    status?: string;
    deferralDate?: string;
    wall?: { SQMPrice?: number; SQM?: number; c_RValue?: number; c_bagCount?: number; cavityDepthMeters?: number };
    ceiling?: { SQMPrice?: number; SQM?: number; RValue?: number; downlights?: number; c_bagCount?: number };
    extras?: { name?: string; price?: number }[];
    files_QuoteSitePlan?: string[];
  };
  ebaForm?: { complete?: boolean; signature_assessor?: { fileName?: string } | null };
  client?: {
    _id?: string;
    contactDetails?: ContactDetails;
    billingDetails?: ContactDetails;
  };
}

// ── Helpers ────────────────────────────────────────────────────────
function fmt(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
}
function fmtCurrency(n?: number | null) {
  if (!n && n !== 0) return "-";
  return `$${n.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function toDatetimeLocal(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 16);
}
function fromDatetimeLocal(val: string) {
  return val ? new Date(val).toISOString() : null;
}

const API_BASE = "https://api.insulhub.nz";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("token") || "" : "";
}

function fileUrl(fileName: string) {
  return `${API_BASE}/files/documents/${encodeURIComponent(fileName)}?token=${getToken()}`;
}

const STATUS_COLORS: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-700",
  CALLBACK: "bg-orange-100 text-orange-700",
  DEAD: "bg-red-100 text-red-700",
};

// ── Sub-components ─────────────────────────────────────────────────
function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">{label}</span>
      <span className="text-sm text-gray-800 mt-0.5">{value}</span>
    </div>
  );
}
function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}
function EditBtn({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="text-xs text-[#e85d04] font-medium">Edit</button>;
}

// ── Main Component ─────────────────────────────────────────────────
export default function JobDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [job, setJob] = useState<Job | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingSitePlan, setUploadingSitePlan] = useState(false);
  const [error, setError] = useState("");

  // Sheet visibility
  const [sheet, setSheet] = useState<string | null>(null);
  const openSheet = (name: string) => setSheet(name);
  const closeSheet = () => setSheet(null);

  // Note form
  const [noteText, setNoteText] = useState("");
  const [fullNoteText, setFullNoteText] = useState("");

  // Contact edit form
  const [contactForm, setContactForm] = useState<ContactDetails>({});

  // Quote form
  const [quoteForm, setQuoteForm] = useState({
    quoteNumber: "", date: "", consentFee: "", depositPercentage: "25",
    wallSQMPrice: "", wallSQM: "", wallCavityDepth: "0.1",
    ceilingSQMPrice: "", ceilingSQM: "", ceilingRValue: "", ceilingDownlights: "",
    hasWall: false, hasCeiling: false,
    extras: [] as { name: string; price: string }[],
    totalManual: "",
    depositManual: "",
    quoteNote: "", quoteResultNote: "",
  });

  // Callback / booking dates
  const [callbackDate, setCallbackDate] = useState("");
  const [quoteBookingDate, setQuoteBookingDate] = useState("");

  // Selected salesperson
  const [selectedUserId, setSelectedUserId] = useState("");
  const [leadSourceForm, setLeadSourceForm] = useState<string[]>([]);

  // Load job + users
  const load = useCallback(async () => {
    try {
      const [jobData, usersData] = await Promise.all([
        gql<{ job: Job }>(JOB_QUERY, { _id: id }),
        gql<{ users: { results: User[] } }>(USERS_QUERY),
      ]);
      setJob(jobData.job);
      setUsers(usersData.users.results);

      // Prefill forms
      const j = jobData.job;
      const c = j.client?.contactDetails;
      setContactForm({
        name: c?.name || "", email: c?.email || "",
        phoneMobile: c?.phoneMobile || "", phoneSecondary: c?.phoneSecondary || "",
        streetAddress: c?.streetAddress || "", suburb: c?.suburb || "",
        city: c?.city || "", postCode: c?.postCode || "",
      });
      setCallbackDate(toDatetimeLocal(j.lead?.callbackDate));
      setQuoteBookingDate(toDatetimeLocal(j.lead?.quoteBookingDate));
      setSelectedUserId(j.lead?.allocatedTo?._id || "");
      setLeadSourceForm(j.lead?.leadSource || []);

      const me = JSON.parse(localStorage.getItem("me") || "{}");
      const initials = ((me.firstname?.[0] || "") + (me.lastname?.[0] || "")).toUpperCase();
      const autoQuoteNum = initials ? `${initials}${j.jobNumber}` : `${j.jobNumber}`;

      if (j.quote) {
        setQuoteForm({
          quoteNumber: j.quote.quoteNumber || autoQuoteNum,
          date: toDatetimeLocal(j.quote.date),
          consentFee: j.quote.consentFee?.toString() || "",
          depositPercentage: j.quote.depositPercentage?.toString() || "25",
          wallSQMPrice: j.quote.wall?.SQMPrice?.toString() || "",
          wallSQM: j.quote.wall?.SQM?.toString() || "",
          wallCavityDepth: (j.quote.wall?.cavityDepthMeters ?? 0.1).toString(),
          ceilingSQMPrice: j.quote.ceiling?.SQMPrice?.toString() || "",
          ceilingSQM: j.quote.ceiling?.SQM?.toString() || "",
          ceilingRValue: j.quote.ceiling?.RValue?.toString() || "",
          ceilingDownlights: j.quote.ceiling?.downlights?.toString() || "",
          hasWall: !!j.quote.wall?.SQM,
          hasCeiling: !!j.quote.ceiling?.SQM,
          extras: (j.quote.extras && j.quote.extras.length ? j.quote.extras : []).map((x) => ({ name: x.name || "", price: x.price?.toString() || "" })),
          totalManual: j.quote.c_total?.toString() || "",
          depositManual: j.quote.c_deposit?.toString() || "",
          quoteNote: j.quote.quoteNote || "",
          quoteResultNote: j.quote.quoteResultNote || "",
        });
      } else {
        setQuoteForm(prev => ({ ...prev, quoteNumber: autoQuoteNum, consentFee: "380", depositManual: "" }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load";
      if (msg !== "Unauthorized") setError(msg);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!localStorage.getItem("token")) { router.push("/login"); return; }
    load();
  }, [load, router]);

  // Removed sessionStorage handling. Next.js router.back() maintains URL query appropriately.


  // ── Helper: build LeadInput from current job state ─────────────
  type LeadInput = {
    leadStatus: "NEW" | "ON_HOLD" | "DEAD" | string;
    leadSource: string[];
    allocation: "ALLOCATED" | "UNALLOCATED";
    allocatedTo: { _id: string } | null;
    callbackDate: string | null;
    quoteBookingDate: string | null;
  };

  function buildLeadInput(overrides: Partial<LeadInput> = {}) {
    const lead: LeadInput = {
      leadStatus: job?.lead?.leadStatus || "NEW",
      leadSource: job?.lead?.leadSource || [],
      allocation: job?.lead?.allocatedTo ? "ALLOCATED" : "UNALLOCATED",
      allocatedTo: job?.lead?.allocatedTo?._id ? { _id: job.lead.allocatedTo._id } : null,
      callbackDate: job?.lead?.callbackDate || null,
      quoteBookingDate: job?.lead?.quoteBookingDate || null,
      ...overrides,
    };
    return lead;
  }

  // ── Helper: build QuoteInput from current job state ─────────────
  function buildQuoteInput(overrides: Record<string, unknown> = {}) {
    const q = job?.quote;
    return {
      quoteNote: q?.quoteNote || "",
      quoteResultNote: q?.quoteResultNote || "",
      extras: [],
      wall: { SQMPrice: q?.wall?.SQMPrice, SQM: q?.wall?.SQM, c_RValue: q?.wall?.c_RValue, c_bagCount: q?.wall?.c_bagCount },
      ceiling: { SQMPrice: q?.ceiling?.SQMPrice, SQM: q?.ceiling?.SQM, RValue: q?.ceiling?.RValue, downlights: q?.ceiling?.downlights, c_bagCount: q?.ceiling?.c_bagCount },
      quoteNumber: q?.quoteNumber,
      date: q?.date,
      consentFee: q?.consentFee,
      depositPercentage: q?.depositPercentage,
      ...overrides,
    };
  }

  async function run<T>(fn: () => Promise<T>, onSuccess?: (r: T) => void) {
    setSaving(true);
    try {
      const result = await fn();
      await load();
      closeSheet();
      if (onSuccess) onSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }


  const quoteCalc = useMemo(() => {
    const n = (v: string) => parseFloat(v || "0") || 0;
    const wallSQM = n(quoteForm.wallSQM);
    const wallPrice = n(quoteForm.wallSQMPrice);
    const cavity = n(quoteForm.wallCavityDepth) || 0.1;
    const wallR = Math.round((28 * cavity) * 10) / 10;
    const wallBagsRaw = cavity === 0.1 ? wallSQM / 6.5 : wallSQM / 5;
    const wallBags = Math.round(wallBagsRaw * 10) / 10;

    const ceilingSQM = n(quoteForm.ceilingSQM);
    const ceilingPrice = n(quoteForm.ceilingSQMPrice);
    const ceilingR = n(quoteForm.ceilingRValue);
    const ceilingBagsRaw = ceilingR * ceilingSQM * 0.0405;
    const ceilingBags = Math.round(ceilingBagsRaw * 10) / 10;
    const ceilingThickness = ceilingR * 42;

    const extrasTotal = (quoteForm.extras || []).reduce((acc, e) => acc + n(e.price), 0);
    const contractPrice = (quoteForm.hasWall ? wallSQM * wallPrice : 0) + (quoteForm.hasCeiling ? ceilingSQM * ceilingPrice : 0) + extrasTotal;
    const consentFee = n(quoteForm.consentFee);
    const gst = contractPrice * 0.15;
    const autoTotal = contractPrice + gst + consentFee;
    const total = n(quoteForm.totalManual) > 0 ? n(quoteForm.totalManual) : autoTotal;
    const depositPct = n(quoteForm.depositPercentage) || 25;
    const autoDeposit = (total * depositPct) / 100;
    const deposit = n(quoteForm.depositManual) > 0 ? n(quoteForm.depositManual) : autoDeposit;

    return { wallR, wallBags, ceilingBags, ceilingThickness, contractPrice, gst, autoTotal, total, autoDeposit, deposit };
  }, [quoteForm]);

  // ── Actions ────────────────────────────────────────────────────
  async function saveNote() {
    if (!noteText.trim()) return;
    const me = JSON.parse(localStorage.getItem("me") || "{}");
    const name = me.firstname ? `${me.firstname} ${me.lastname}` : "Me";
    const date = new Date().toLocaleDateString("en-NZ", { day: "2-digit", month: "2-digit", year: "2-digit" });
    const prefix = `${date} - ${noteText.trim()} - ${name}`;
    const existing = job?.notes || "";
    const combined = existing ? `${existing}\n\n${prefix}` : prefix;
    await run(() => gql(UPDATE_JOB_NOTES, { input: { _id: id, notes: combined } }));
    setNoteText("");
  }

  async function saveFullNote() {
    await run(() => gql(UPDATE_JOB_NOTES, { input: { _id: id, notes: fullNoteText } }));
  }

  async function saveContact() {
    if (!job?.client?._id) return;
    await run(() => gql(UPDATE_CLIENT, {
      _id: job.client!._id,
      input: { _id: job.client!._id, billingSameAsPhysical: true, contactDetails: contactForm, billingDetails: contactForm },
    }));
  }

  async function saveAllocate() {
    const user = users.find((u) => u._id === selectedUserId);
    await run(() => gql(UPDATE_JOB_LEAD, {
      input: { _id: id, lead: buildLeadInput({ allocatedTo: selectedUserId ? { _id: selectedUserId } : null, allocation: selectedUserId ? "ALLOCATED" : "UNALLOCATED" }) },
    }));
    void user;
  }

  async function saveLeadStatus(status: string) {
    const apiStatus = status === "CALLBACK" ? "ON_HOLD" : status;
    await run(() => gql(UPDATE_JOB_LEAD, {
      input: { _id: id, lead: buildLeadInput({ leadStatus: apiStatus }) },
    }));
  }


  async function saveLeadSource() {
    setSaving(true);
    setError("");
    try {
      await gql(UPDATE_JOB_LEAD, {
        input: { _id: id, lead: buildLeadInput({ leadSource: leadSourceForm }) },
      });
      setJob((prev) => prev ? ({ ...prev, lead: { ...prev.lead, leadSource: leadSourceForm } }) : prev);
      closeSheet();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save lead source";
      setError(msg || "Could not save lead source");
    } finally {
      setSaving(false);
    }
  }

  async function saveCallbackDate() {
    await run(() => gql(UPDATE_JOB_LEAD, {
      input: { _id: id, lead: buildLeadInput({ callbackDate: fromDatetimeLocal(callbackDate), leadStatus: "ON_HOLD" }) },
    }));
  }

  async function saveQuoteBookingDate() {
    await run(() => gql(UPDATE_JOB_LEAD, {
      input: { _id: id, lead: buildLeadInput({ quoteBookingDate: fromDatetimeLocal(quoteBookingDate) }) },
    }));
  }


  async function markAccepted() {
    await run(() => gql(UPDATE_JOB_QUOTE, {
      input: { _id: id, stage: "SCHEDULED", quote: buildQuoteInput({ status: "ACCEPTED" }) },
    }));
  }

  function buildQuoteUpdateInput(andProgress = false) {
    const q = quoteForm;
    return {
      _id: id,
      ...(andProgress ? { stage: "QUOTE" } : {}),
      quote: {
        quoteNote: q.quoteNote,
        quoteResultNote: q.quoteResultNote,
        extras: (q.extras || []).filter((e) => e.name || e.price).map((e) => ({ name: e.name, price: parseFloat(e.price || "0") || 0 })),
        quoteNumber: q.quoteNumber,
        date: fromDatetimeLocal(q.date),
        consentFee: q.consentFee ? parseFloat(q.consentFee) : undefined,
        depositPercentage: q.depositPercentage ? parseFloat(q.depositPercentage) : 25,
        c_contractPrice: quoteCalc.contractPrice,
        c_gst: quoteCalc.gst,
        c_total: quoteCalc.total,
        c_deposit: quoteCalc.deposit,
        wall: q.hasWall ? {
          SQMPrice: q.wallSQMPrice ? parseFloat(q.wallSQMPrice) : undefined,
          SQM: q.wallSQM ? parseFloat(q.wallSQM) : undefined,
          cavityDepthMeters: q.wallCavityDepth ? parseFloat(q.wallCavityDepth) : 0.1,
          c_RValue: quoteCalc.wallR,
          c_bagCount: quoteCalc.wallBags,
        } : {},
        ceiling: q.hasCeiling ? {
          SQMPrice: q.ceilingSQMPrice ? parseFloat(q.ceilingSQMPrice) : undefined,
          SQM: q.ceilingSQM ? parseFloat(q.ceilingSQM) : undefined,
          RValue: q.ceilingRValue ? parseFloat(q.ceilingRValue) : undefined,
          downlights: q.ceilingDownlights ? parseFloat(q.ceilingDownlights) : undefined,
          c_bagCount: quoteCalc.ceilingBags,
        } : {},
      },
    };
  }

  async function saveQuote(andProgress = false, emailQuoteToCustomer = false) {
    await run(() => gql(UPDATE_JOB_QUOTE, {
      input: buildQuoteUpdateInput(andProgress),
      ...(emailQuoteToCustomer ? { emailQuoteToCustomer: true, quotePDFEmailBodyTemplate: "Please find your insulation quote attached." } : {}),
    }));
  }


  async function downloadQuotePDF() {
    try {
      const input = buildQuoteUpdateInput(false);
      const params = new URLSearchParams({ token: encodeURIComponent(getToken()), input: JSON.stringify(input) });
      window.open(`${API_BASE}/pdf/saveJobAndGetQuotePDF?${params.toString()}`, "_blank");
    } catch {
      alert("Could not open quote PDF.");
    }
  }

  async function printQuoteSitePlanPDF() {
    const quoteDate = fromDatetimeLocal(quoteForm.date);
    if (!quoteDate) {
      alert("Set quote date first.");
      return;
    }
    const params = new URLSearchParams({ jobId: id, quoteDate, token: encodeURIComponent(getToken()) });
    window.open(`${API_BASE}/pdf/quote-siteplan?${params.toString()}`, "_blank");
  }

  async function uploadQuoteSitePlan(files: FileList | null) {
    if (!files || files.length === 0) return;
    try {
      setUploadingSitePlan(true);
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("files", f));
      const res = await fetch(`${API_BASE}/files/upload`, {
        method: "POST",
        headers: { "x-token": getToken() },
        body: form,
      });
      const json = await res.json();
      const fileNames: string[] = json.fileNames || [];
      if (!fileNames.length) throw new Error("Upload failed");
      await gql(ADD_FILES, { _id: id, documentType: "QUOTE_SITE_PLAN", fileNames });
      await load();
    } catch {
      alert("Failed to upload site plan.");
    } finally {
      setUploadingSitePlan(false);
    }
  }

  async function removeQuoteSitePlan(fileName: string) {
    if (!confirm("Remove this uploaded site plan file?")) return;
    await run(() => gql(REMOVE_FILE, { _id: id, documentType: "QUOTE_SITE_PLAN", fileName }));
  }

  async function openEBAClientApprovalPage() {
    // Match legacy internal workflow: open staff EBA editor, not public client approval URL.
    window.open(`https://www.insulhub.nz/job/${id}/eba`, "_blank");
  }

  async function saveQuoteAndOpenEBA() {
    if (!quoteForm.quoteNumber || !quoteForm.date || (!quoteForm.hasWall && !quoteForm.hasCeiling)) {
      alert("Add quote data first (quote number, date, and wall/ceiling values).");
      return;
    }

    setSaving(true);
    try {
      await gql(UPDATE_JOB_QUOTE, { input: buildQuoteUpdateInput(false) });
      await load();
      await openEBAClientApprovalPage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save quote and open EBA");
    } finally {
      setSaving(false);
    }
  }

  async function archiveJob() {
    if (!confirm("Archive this job?")) return;
    await run(() => gql(ARCHIVE_JOB, { _id: id }));
    router.push("/jobs");
  }

  async function sendEBA() {
    if (!job?.ebaForm?.complete) {
      alert("Complete the EBA first before sending.");
      return;
    }
    await run(() => gql(SEND_EBA, { jobId: id }));
    alert("EBA email sent!");
  }

  async function sendQuoteToCustomer() {
    if (!quoteForm.quoteNumber || !quoteForm.date || (!quoteForm.hasWall && !quoteForm.hasCeiling)) {
      alert("Add quote data first (quote number, date, and wall/ceiling values).");
      return;
    }

    let template = "Please find your insulation quote attached.";
    try {
      const input = buildQuoteUpdateInput(false);
      const data = await gql<{ getQuotePDFEmailBody: string }>(
        `query($input: UpdateJobInput!) { getQuotePDFEmailBody(input: $input) }`,
        { input }
      );
      if (data.getQuotePDFEmailBody) template = data.getQuotePDFEmailBody;
    } catch {
      // fallback template kept
    }

    await run(() => gql(UPDATE_JOB_QUOTE, {
      input: buildQuoteUpdateInput(false),
      emailQuoteToCustomer: true,
      quotePDFEmailBodyTemplate: template,
    }));
    alert("Quote sent to customer.");
  }

  // ── Render ─────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#1a3a4a] h-28 animate-pulse" />
      <div className="px-4 pt-4 space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl p-4 animate-pulse h-24" />
        ))}
      </div>
    </div>
  );

  if (!job) return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-[#1a3a4a] px-4 py-4">
        <button onClick={() => router.back()} className="text-white text-sm">← Back</button>
      </div>
      <div className="px-4 pt-4">
        <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">{error || "Job not found"}</div>
      </div>
    </div>
  );

  const c = job.client?.contactDetails;
  const phone = c?.phoneMobile || c?.phoneSecondary;
  const address = [c?.streetAddress, c?.suburb, c?.city, c?.postCode].filter(Boolean).join(", ");
  const statusRaw = (job.lead?.leadStatus || "NEW").toUpperCase();
  const leadStatus = statusRaw === "ON_HOLD" ? "CALLBACK" : statusRaw;
  const quoteStatus = (job.quote?.status || "").toUpperCase();
  const status = job.stage === "QUOTE"
    ? (leadStatus === "DEAD" || quoteStatus === "DECLINED"
      ? "DEAD"
      : quoteStatus === "DEFERRED" || leadStatus === "CALLBACK"
        ? "CALLBACK"
        : "NEW")
    : leadStatus;
  const salesperson = job.lead?.allocatedTo
    ? `${job.lead.allocatedTo.firstname} ${job.lead.allocatedTo.lastname}` : "Unallocated";
  const assignableUsers = users.filter((u) => (u.role || "").toUpperCase() !== "INSTALLER");
  const hasWall = !!job.quote?.wall?.SQM;
  const hasCeiling = !!job.quote?.ceiling?.SQM;
  const displayCallbackDate = job.stage === "QUOTE" ? (job.quote?.deferralDate || job.lead?.callbackDate) : job.lead?.callbackDate;
  const isArchived = !!job.archivedAt;

  const buildGCalUrl = (type: "Callback" | "Quote", dateStr: string, durationMins: number) => {
    if (!dateStr) return "#";

    let title = "";
    let desc = "";
    let attendees = "";

    if (type === "Quote") {
      const street = c?.streetAddress || address || "Unknown Address";
      title = `${street} - Insulmax Quote`;
      desc = [
        c?.name ? `Name: ${c.name}` : "",
        phone ? `Phone: ${phone}` : "",
        address ? `Address: ${address}` : ""
      ].filter(Boolean).join("\n");
      if (c?.email) attendees = c.email;
    } else {
      title = `${c?.name || "Customer"} callback`;
      desc = [
        c?.name ? `Name: ${c.name}` : "",
        phone ? `Phone: ${phone}` : ""
      ].filter(Boolean).join("\n");
    }

    const start = new Date(dateStr);
    const end = new Date(start.getTime() + durationMins * 60000);
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: title,
      dates: `${fmt(start)}/${fmt(end)}`,
      details: desc,
      location: type === "Quote" ? address : "",
    });

    if (attendees) {
      params.append("add", attendees);
    }

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  };

  const buildIcsUrl = (type: "Callback" | "Quote", dateStr: string, durationMins: number) => {
    if (!dateStr) return "#";

    let title = "";
    let desc = "";
    let attendeeLine = "";

    if (type === "Quote") {
      const street = c?.streetAddress || address || "Unknown Address";
      title = `${street} - Insulmax Quote`;
      desc = [
        c?.name ? `Name: ${c.name}` : "",
        phone ? `Phone: ${phone}` : "",
        address ? `Address: ${address}` : ""
      ].filter(Boolean).join("\n");
      if (c?.email) attendeeLine = `\nATTENDEE;RSVP=TRUE:mailto:${c.email}`;
    } else {
      title = `${c?.name || "Customer"} callback`;
      desc = [
        c?.name ? `Name: ${c.name}` : "",
        phone ? `Phone: ${phone}` : ""
      ].filter(Boolean).join("\n");
    }

    const start = new Date(dateStr);
    const end = new Date(start.getTime() + durationMins * 60000);
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

    const locationLine = type === "Quote" && address ? `\nLOCATION:${address}` : "";

    const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:${title}\nDTSTART:${fmt(start)}\nDTEND:${fmt(end)}${locationLine}\nDESCRIPTION:${desc.replace(/\n/g, "\\n")}${attendeeLine}\nEND:VEVENT\nEND:VCALENDAR`;
    return `data:text/calendar;charset=utf8,${encodeURIComponent(ics)}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      {/* Header */}
      <div className="bg-[#1a3a4a] px-4 pt-3 pb-2">
        <button onClick={() => router.back()} className="text-gray-300 text-sm mb-1">← Back</button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-white font-bold text-lg leading-tight">{c?.name || "Unknown"}</h1>
            {address && <p className="text-gray-300 text-xs mt-0.5">{address}</p>}
          </div>
          <span className="text-xs text-gray-400 mt-1">#{job.jobNumber}</span>
        </div>
        <div className="mt-2 -mx-4">
          <PipelineBreadcrumb currentStage={job.stage} />
        </div>
      </div>

      <div className="px-4 pt-3">
        {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-2 rounded-xl mb-3">{error}</div>}
        {isArchived && <div className="bg-yellow-50 text-yellow-700 text-sm px-4 py-2 rounded-xl mb-3">⚠️ This job is archived</div>}

        {/* Quick contact */}
        <div className="flex gap-2 mb-3">
          {phone && <a href={`tel:${phone}`} className="flex-1 bg-[#e85d04] text-white font-semibold py-3 rounded-xl text-center text-sm">📞 Call</a>}
          {phone && <a href={`sms:${phone}`} className="flex-1 bg-teal-700 text-white font-semibold py-3 rounded-xl text-center text-sm">💬 Text</a>}
          {c?.email && <a href={`mailto:${c.email}`} className="flex-1 bg-[#1a3a4a] text-white font-semibold py-3 rounded-xl text-center text-sm">✉️ Email</a>}
        </div>

        {/* Status buttons */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide">Status</h2>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[status] || "bg-gray-100 text-gray-600"}`}>
              {status.charAt(0) + status.slice(1).toLowerCase()}
            </span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {["NEW", "CALLBACK", "DEAD"].map((s) => (
              <button key={s} onClick={() => s === "CALLBACK" ? openSheet("callback") : saveLeadStatus(s)}
                disabled={saving || status === s}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${status === s ? "bg-gray-200 text-gray-500" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}>
                {s === "NEW" ? "New" : s === "CALLBACK" ? "Callback" : "Dead"}
              </button>
            ))}
          </div>
        </div>

        {/* Job info */}
        <Section title="Job Info">
          <div className="flex flex-col py-2 border-b border-gray-50">
            <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">Salesperson</span>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-sm text-gray-800">{salesperson}</span>
              <button onClick={() => openSheet("allocate")} className="text-xs text-[#e85d04] font-medium">Edit</button>
            </div>
          </div>

          <div className="flex flex-col py-2 border-b border-gray-50">
            <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">Quote Booking</span>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-sm text-gray-800">{job.lead?.quoteBookingDate ? fmt(job.lead.quoteBookingDate) : "Not set"}</span>
              <button onClick={() => openSheet("booking")} className="text-xs text-[#e85d04] font-medium">{job.lead?.quoteBookingDate ? "Edit" : "Set"}</button>
            </div>
          </div>

          <div className="flex flex-col py-2">
            <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">Callback</span>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-sm text-gray-800">{displayCallbackDate ? fmt(displayCallbackDate) : "Not set"}</span>
              {displayCallbackDate && (
                <button onClick={() => openSheet("callback")} className="text-xs text-[#e85d04] font-medium">Edit</button>
              )}
            </div>
          </div>
        </Section>

        {/* Contact */}
        <Section title="Contact" action={<EditBtn onClick={() => openSheet("contact")} />}>
          <InfoRow label="Name" value={c?.name} />
          <InfoRow label="Mobile" value={c?.phoneMobile} />
          {c?.phoneSecondary && <InfoRow label="Phone" value={c.phoneSecondary} />}
          <InfoRow label="Email" value={c?.email} />
          {address && <InfoRow label="Address" value={address} />}
        </Section>

        {/* Lead sources */}
        <Section title="Lead Source" action={<EditBtn onClick={() => openSheet("leadSource")} />}>
          {job.lead?.leadSource && job.lead.leadSource.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {job.lead.leadSource.map((s) => (
                <span key={s} className="text-xs bg-teal-50 text-teal-700 px-3 py-1 rounded-full font-medium">{s}</span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No lead source set</p>
          )}
        </Section>

        {/* Site plan */}
        {(job.stage === "QUOTE" || job.stage === "SCHEDULED") && (
          <Section title="Site Plan">
            <div className="flex gap-2 mb-3 flex-wrap">
              <button onClick={printQuoteSitePlanPDF} className="bg-gray-700 text-white text-sm font-semibold px-3 py-2.5 rounded-xl">🖨️ Print Site Plan PDF</button>
            </div>
            <div className="border border-gray-200 rounded-xl p-3">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Completed Site Plan</p>
              <input type="file" onChange={(e) => uploadQuoteSitePlan(e.target.files)} disabled={uploadingSitePlan} className="text-sm mb-2" />
              {uploadingSitePlan && <p className="text-xs text-gray-500">Uploading...</p>}
              <div className="space-y-1">
                {(job.quote?.files_QuoteSitePlan || []).map((f) => (
                  <div key={f} className="flex items-center justify-between text-sm">
                    <a href={fileUrl(f)} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline truncate max-w-[70%]">{f}</a>
                    <button onClick={() => removeQuoteSitePlan(f)} className="text-xs text-red-600">Remove</button>
                  </div>
                ))}
                {(!job.quote?.files_QuoteSitePlan || job.quote.files_QuoteSitePlan.length === 0) && <p className="text-xs text-gray-400">No site plan files uploaded yet.</p>}
              </div>
            </div>
          </Section>
        )}

        {/* Quote details */}
        {job.stage === "QUOTE" || job.stage === "SCHEDULED" ? (
          <Section title="Quote" action={<EditBtn onClick={() => openSheet("quote")} />}>
            {job.quote?.c_total != null && (
              <div className="text-3xl font-bold text-green-600 mb-2">{fmtCurrency(job.quote.c_total)}</div>
            )}
            <div className="flex gap-2 mb-3 flex-wrap">
              {job.quote?.quoteNumber && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded font-medium">#{job.quote.quoteNumber}</span>}
              {job.quote?.date && <span className="text-xs text-gray-400">{fmt(job.quote.date)}</span>}
            </div>
            <InfoRow label="Consent Fee" value={job.quote?.consentFee ? fmtCurrency(job.quote.consentFee) : null} />
            <InfoRow label="Deposit" value={job.quote?.depositPercentage ? `${job.quote.depositPercentage}% — ${fmtCurrency(job.quote.c_deposit)}` : null} />
            {job.quote?.quoteNote && (
              <div className="mt-2 pt-2 border-t border-gray-50">
                <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">Comments</span>
                <p className="text-sm text-gray-700 mt-1">{job.quote.quoteNote}</p>
              </div>
            )}

            {hasWall && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs font-bold text-gray-400 uppercase mb-2">Wall Insulation</p>
                <InfoRow label="SQM" value={job.quote?.wall?.SQM ? `${job.quote.wall.SQM} m²` : null} />
                <InfoRow label="Price / m²" value={job.quote?.wall?.SQMPrice ? fmtCurrency(job.quote.wall.SQMPrice) : null} />
                <InfoRow label="R-Value" value={job.quote?.wall?.c_RValue ? `R${job.quote.wall.c_RValue}` : null} />
                <InfoRow label="Bags" value={job.quote?.wall?.c_bagCount ? `${job.quote.wall.c_bagCount} bags` : null} />
              </div>
            )}
            {hasCeiling && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs font-bold text-gray-400 uppercase mb-2">Ceiling Insulation</p>
                <InfoRow label="SQM" value={job.quote?.ceiling?.SQM ? `${job.quote.ceiling.SQM} m²` : null} />
                <InfoRow label="Price / m²" value={job.quote?.ceiling?.SQMPrice ? fmtCurrency(job.quote.ceiling.SQMPrice) : null} />
                <InfoRow label="R-Value" value={job.quote?.ceiling?.RValue ? `R${job.quote.ceiling.RValue}` : null} />
                <InfoRow label="Bags" value={job.quote?.ceiling?.c_bagCount ? `${job.quote.ceiling.c_bagCount} bags` : null} />
              </div>
            )}

            {/* Quote actions */}
            <div className="flex gap-2 mt-4 flex-wrap">
              {job.stage === "QUOTE" && (
                <button onClick={markAccepted} disabled={saving}
                  className="flex-1 bg-green-600 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                  ✓ Mark Accepted
                </button>
              )}
              <button onClick={sendQuoteToCustomer} disabled={saving}
                className="flex-1 bg-indigo-600 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                ✉️ Send Quote
              </button>
              <button onClick={downloadQuotePDF} className="flex-1 bg-gray-900 text-white text-sm font-semibold py-2.5 rounded-xl">📄 Quote PDF</button>
            </div>
          </Section>
        ) : job.stage === "LEAD" ? (
          <div className="mb-3">
            <button onClick={() => openSheet("quote")}
              className="w-full bg-[#e85d04] text-white font-semibold py-3.5 rounded-xl text-sm">
              📝 Enter Quote Details &amp; Progress
            </button>
          </div>
        ) : null}


        {(job.stage === "QUOTE" || job.stage === "SCHEDULED") && (
          <Section title="EBA">
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={saveQuoteAndOpenEBA}
                disabled={saving}
                className="flex-1 bg-white border border-gray-300 text-gray-700 text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50"
              >
                🧾 {job.ebaForm?.complete || job.ebaForm?.signature_assessor?.fileName ? "Edit EBA" : "Complete EBA"}
              </button>
              <button
                onClick={sendEBA}
                disabled={saving || !job.ebaForm?.complete}
                className="flex-1 bg-[#1a3a4a] text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-40"
              >
                📋 Send EBA
              </button>
            </div>
            {!job.ebaForm?.complete && (
              <p className="text-xs text-gray-400 mt-2">Send EBA becomes available once EBA is completed.</p>
            )}
          </Section>
        )}

        {/* Notes */}
        <Section
          title="Notes"
          action={
            <div className="flex items-center gap-3">
              <button onClick={() => openSheet("addNote")} className="text-xs text-[#e85d04] font-medium">+ Add</button>
              <button onClick={() => { setFullNoteText(job.notes || ""); openSheet("editNote"); }} className="text-xs text-gray-500 font-medium">Edit</button>
            </div>
          }
        >
          {job.notes ? (
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{job.notes}</p>
          ) : (
            <p className="text-sm text-gray-400">No notes yet</p>
          )}
        </Section>

        {/* Danger zone */}
        <div className="mt-4 mb-4">
          {!isArchived && (
            <button onClick={archiveJob} disabled={saving}
              className="w-full text-red-500 border border-red-200 rounded-xl py-3 text-sm font-medium">
              Archive Job
            </button>
          )}
        </div>
      </div>

      {/* ── Bottom Sheets ─────────────────────────────────────────── */}

      {/* Add note */}
      <BottomSheet open={sheet === "addNote"} onClose={closeSheet} title="Add Note">
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Type your note..."
          rows={5}
          className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04] resize-none mb-4"
        />
        <button onClick={saveNote} disabled={saving || !noteText.trim()}
          className="w-full bg-[#e85d04] text-white font-semibold py-3 rounded-xl disabled:opacity-50">
          {saving ? "Saving..." : "Add Note"}
        </button>
      </BottomSheet>

      {/* Edit note */}
      <BottomSheet open={sheet === "editNote"} onClose={closeSheet} title="Edit All Notes">
        <textarea
          value={fullNoteText}
          onChange={(e) => setFullNoteText(e.target.value)}
          placeholder="Edit your notes..."
          rows={10}
          className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04] resize-none mb-4"
        />
        <button onClick={saveFullNote} disabled={saving}
          className="w-full bg-[#1a3a4a] text-white font-semibold py-3 rounded-xl disabled:opacity-50">
          {saving ? "Saving..." : "Save Notes"}
        </button>
      </BottomSheet>

      {/* Edit contact */}
      <BottomSheet open={sheet === "contact"} onClose={closeSheet} title="Edit Contact">
        {(["name", "phoneMobile", "phoneSecondary", "email", "streetAddress", "suburb", "city", "postCode"] as const).map((f) => (
          <div key={f} className="mb-3">
            <label className="block text-xs text-gray-500 font-medium mb-1 capitalize">
              {f.replace(/([A-Z])/g, " $1").replace("phone Secondary", "Phone 2").replace("street Address", "Street Address").replace("post Code", "Post Code")}
            </label>
            {f === "streetAddress" ? (
              <AddressAutocomplete
                value={contactForm[f] || ""}
                onChange={(val) => setContactForm((prev) => ({ ...prev, [f]: val }))}
                onSelectAddress={(details) => setContactForm(prev => ({ ...prev, ...details }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
              />
            ) : (
              <input
                type="text"
                value={contactForm[f] || ""}
                onChange={(e) => setContactForm((prev) => ({ ...prev, [f]: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
              />
            )}
          </div>
        ))}
        <button onClick={saveContact} disabled={saving}
          className="w-full bg-[#e85d04] text-white font-semibold py-3 rounded-xl mt-2 disabled:opacity-50">
          {saving ? "Saving..." : "Save Contact"}
        </button>
      </BottomSheet>


      {/* Edit lead source */}
      <BottomSheet open={sheet === "leadSource"} onClose={closeSheet} title="Lead Source">
        {[
          "Website", "Home Show", "TV", "Social Media", "Radio", "Vehicle Signage", "Mailchimp", "Referral", "Printed Media", "Door Drop", "Google Ads"
        ].map((opt) => {
          const checked = leadSourceForm.includes(opt);
          return (
            <label key={opt} className="flex items-center gap-2 py-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  setLeadSourceForm((prev) => e.target.checked ? [...prev, opt] : prev.filter((x) => x !== opt));
                }}
                className="w-4 h-4 accent-[#e85d04]"
              />
              {opt}
            </label>
          );
        })}
        <button onClick={saveLeadSource} disabled={saving}
          className="w-full bg-[#e85d04] text-white font-semibold py-3 rounded-xl mt-3 disabled:opacity-50">
          {saving ? "Saving..." : "Save Lead Source"}
        </button>
      </BottomSheet>

      {/* Allocate salesperson */}
      <BottomSheet open={sheet === "allocate"} onClose={closeSheet} title="Assign Salesperson">
        <div className="space-y-2 mb-4">
          <button onClick={() => setSelectedUserId("")}
            className={`w-full text-left px-4 py-3 rounded-xl border text-sm ${!selectedUserId ? "border-[#e85d04] bg-orange-50 text-[#e85d04] font-medium" : "border-gray-200 text-gray-700"}`}>
            Unallocated
          </button>
          {assignableUsers.map((u) => (
            <button key={u._id} onClick={() => setSelectedUserId(u._id)}
              className={`w-full text-left px-4 py-3 rounded-xl border text-sm ${selectedUserId === u._id ? "border-[#e85d04] bg-orange-50 text-[#e85d04] font-medium" : "border-gray-200 text-gray-700"}`}>
              {u.firstname} {u.lastname}
              <span className="text-xs text-gray-400 ml-2">{u.email}</span>
            </button>
          ))}
        </div>
        <button onClick={saveAllocate} disabled={saving}
          className="w-full bg-[#e85d04] text-white font-semibold py-3 rounded-xl disabled:opacity-50">
          {saving ? "Saving..." : "Assign"}
        </button>
      </BottomSheet>

      {/* Set callback date */}
      <BottomSheet open={sheet === "callback"} onClose={closeSheet} title="Callback Date">
        <p className="text-sm text-gray-500 mb-3">Sets status to Callback and saves the date.</p>
        <input type="datetime-local" value={callbackDate} onChange={(e) => setCallbackDate(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
        />
        <div className="flex gap-2">
          <button onClick={saveCallbackDate} disabled={saving || !callbackDate}
            className="flex-1 bg-[#e85d04] text-white font-semibold py-3 rounded-xl disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
          <a href={buildGCalUrl("Callback", callbackDate, 30)}
            target="_blank" rel="noopener noreferrer"
            className={`px-4 py-3 bg-blue-50 text-blue-700 rounded-xl text-sm font-medium flex items-center justify-center gap-1 ${!callbackDate ? "opacity-40 pointer-events-none" : ""}`}>
            📅 Google Cal
          </a>
          <a href={buildIcsUrl("Callback", callbackDate, 30)}
            download="callback.ics"
            className={`px-4 py-3 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium flex items-center justify-center gap-1 ${!callbackDate ? "opacity-40 pointer-events-none" : ""}`}>
            ⬇️ .ics
          </a>
        </div>
      </BottomSheet>

      {/* Quote booking date */}
      <BottomSheet open={sheet === "booking"} onClose={closeSheet} title="Quote Booking Date">
        <p className="text-sm text-gray-500 mb-3">When is the quote scheduled for?</p>
        <input type="datetime-local" value={quoteBookingDate} onChange={(e) => setQuoteBookingDate(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
        />
        <div className="flex gap-2">
          <button onClick={saveQuoteBookingDate} disabled={saving || !quoteBookingDate}
            className="flex-1 bg-[#e85d04] text-white font-semibold py-3 rounded-xl disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
          <a href={buildGCalUrl("Quote", quoteBookingDate, 60)}
            target="_blank" rel="noopener noreferrer"
            className={`px-4 py-3 bg-blue-50 text-blue-700 rounded-xl text-sm font-medium flex items-center justify-center gap-1 ${!quoteBookingDate ? "opacity-40 pointer-events-none" : ""}`}>
            📅 Google Cal
          </a>
          <a href={buildIcsUrl("Quote", quoteBookingDate, 60)}
            download="quote-booking.ics"
            className={`px-4 py-3 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium flex items-center justify-center gap-1 ${!quoteBookingDate ? "opacity-40 pointer-events-none" : ""}`}>
            ⬇️ .ics
          </a>
        </div>
      </BottomSheet>

      {/* Quote form */}
      <BottomSheet open={sheet === "quote"} onClose={closeSheet} title={job.stage === "LEAD" ? "Enter Quote Details" : "Edit Quote"}>
        <div className="space-y-4">
          <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold">1) Quote Basics</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Quote Number</label>
              <input type="text" value={quoteForm.quoteNumber} onChange={(e) => setQuoteForm((f) => ({ ...f, quoteNumber: e.target.value }))}
                placeholder="E0001"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#e85d04]" />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Quote Date</label>
              <input type="datetime-local" value={quoteForm.date} onChange={(e) => setQuoteForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#e85d04]" />
            </div>
          </div>

          <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold">2) Insulation Inputs</div>
          <div className="border border-gray-200 rounded-xl p-3">
            <label className="flex items-center gap-2 mb-3 cursor-pointer">
              <input type="checkbox" checked={quoteForm.hasWall} onChange={(e) => setQuoteForm((f) => ({ ...f, hasWall: e.target.checked }))} className="w-4 h-4 accent-[#e85d04]" />
              <span className="text-sm font-semibold text-gray-700">Wall Insulation</span>
            </label>
            {quoteForm.hasWall && (
              <div className="grid grid-cols-2 gap-2">
                {[{ label: "SQM", field: "wallSQM" }, { label: "Price / m²", field: "wallSQMPrice" }].map(({ label, field }) => (
                  <div key={field}>
                    <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                    <input type="number" step="0.1" value={(quoteForm as unknown as Record<string, string>)[field]}
                      onChange={(e) => setQuoteForm((f) => ({ ...f, [field]: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#e85d04]" />
                  </div>
                ))}
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Cavity Depth</label>
                  <select value={quoteForm.wallCavityDepth} onChange={(e) => setQuoteForm((f) => ({ ...f, wallCavityDepth: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#e85d04]">
                    <option value="0.1">10 cm</option>
                    <option value="0.15">15 cm</option>
                  </select>
                </div>
                <div className="text-xs text-gray-500 flex items-end pb-2">Auto R-Value: <span className="ml-1 font-semibold text-gray-700">R{quoteCalc.wallR.toFixed(1)}</span></div>
                <div className="text-xs text-gray-500 flex items-end pb-2">Auto Bags: <span className="ml-1 font-semibold text-gray-700">{quoteCalc.wallBags.toFixed(1)}</span></div>
              </div>
            )}
          </div>

          {/* Ceiling insulation */}
          <div className="border border-gray-200 rounded-xl p-3">
            <label className="flex items-center gap-2 mb-3 cursor-pointer">
              <input type="checkbox" checked={quoteForm.hasCeiling} onChange={(e) => setQuoteForm((f) => ({ ...f, hasCeiling: e.target.checked }))} className="w-4 h-4 accent-[#e85d04]" />
              <span className="text-sm font-semibold text-gray-700">Ceiling Insulation</span>
            </label>
            {quoteForm.hasCeiling && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "SQM", field: "ceilingSQM" }, { label: "Price / m²", field: "ceilingSQMPrice" },
                    { label: "R-Value", field: "ceilingRValue" }, { label: "Downlights", field: "ceilingDownlights" },
                  ].map(({ label, field }) => (
                    <div key={field}>
                      <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                      <input type="number" step="0.1" value={(quoteForm as unknown as Record<string, string>)[field]}
                        onChange={(e) => setQuoteForm((f) => ({ ...f, [field]: e.target.value }))}
                        className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#e85d04]" />
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-500 mt-2">Auto Thickness: <span className="font-semibold text-gray-700">{quoteCalc.ceilingThickness.toFixed(0)} mm</span></div>
                <div className="text-xs text-gray-500 mt-1">Auto Bags: <span className="font-semibold text-gray-700">{quoteCalc.ceilingBags.toFixed(1)}</span></div>
              </>
            )}
          </div>

          <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold">3) Pricing</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Consent Fee</label>
              <input type="number" value={quoteForm.consentFee} onChange={(e) => setQuoteForm((f) => ({ ...f, consentFee: e.target.value }))}
                placeholder="0"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#e85d04]" />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Deposit %</label>
              <input type="number" value={quoteForm.depositPercentage} onChange={(e) => setQuoteForm((f) => ({ ...f, depositPercentage: e.target.value }))}
                placeholder="25"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#e85d04]" />
            </div>
          </div>

          {/* Extras */}
          <div className="border border-gray-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-700">Extra Charges</span>
              <button type="button" onClick={() => setQuoteForm((f) => ({ ...f, extras: [...f.extras, { name: "", price: "" }] }))} className="text-xs text-[#e85d04] font-medium">+ Add</button>
            </div>
            {(quoteForm.extras || []).length === 0 ? (
              <p className="text-xs text-gray-400">No extra charges added</p>
            ) : (quoteForm.extras || []).map((ex, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 mb-2">
                <input type="text" value={ex.name} onChange={(e) => setQuoteForm((f) => ({ ...f, extras: f.extras.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x) }))}
                  placeholder="Extra name" className="col-span-7 border border-gray-200 rounded-lg px-2 py-2 text-sm" />
                <input type="number" value={ex.price} onChange={(e) => setQuoteForm((f) => ({ ...f, extras: f.extras.map((x, idx) => idx === i ? { ...x, price: e.target.value } : x) }))}
                  placeholder="0" className="col-span-4 border border-gray-200 rounded-lg px-2 py-2 text-sm" />
                <button type="button" onClick={() => setQuoteForm((f) => ({ ...f, extras: f.extras.filter((_, idx) => idx !== i) }))}
                  className="col-span-1 text-red-500 text-xs">✕</button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-50 rounded-lg p-2">Contract: <b>{fmtCurrency(quoteCalc.contractPrice)}</b></div>
            <div className="bg-gray-50 rounded-lg p-2">GST: <b>{fmtCurrency(quoteCalc.gst)}</b></div>
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Total (editable)</label>
              <input type="number" value={quoteForm.totalManual} onChange={(e) => setQuoteForm((f) => ({ ...f, totalManual: e.target.value }))}
                placeholder={quoteCalc.autoTotal.toFixed(2)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm" />
              <button type="button" onClick={() => setQuoteForm((f) => ({ ...f, totalManual: "" }))} className="text-xs text-gray-500 mt-1 underline">Recalculate</button>
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Deposit (editable)</label>
              <input type="number" value={quoteForm.depositManual} onChange={(e) => setQuoteForm((f) => ({ ...f, depositManual: e.target.value }))}
                placeholder={quoteCalc.autoDeposit.toFixed(2)} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm" />
              <button type="button" onClick={() => setQuoteForm((f) => ({ ...f, depositManual: "" }))} className="text-xs text-gray-500 mt-1 underline">Recalculate</button>
            </div>
          </div>

          {/* Comments */}
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">Quote Comments</label>
            <textarea value={quoteForm.quoteNote} onChange={(e) => setQuoteForm((f) => ({ ...f, quoteNote: e.target.value }))}
              rows={3} placeholder="Quote details..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#e85d04] resize-none" />
          </div>

          {/* Save buttons */}
          <div className="flex flex-col gap-2 pt-2">
            {job.stage === "LEAD" ? (
              <button onClick={() => saveQuote(true)} disabled={saving}
                className="w-full bg-[#e85d04] text-white font-semibold py-3 rounded-xl disabled:opacity-50">
                {saving ? "Saving..." : "Save & Progress to Quote Stage"}
              </button>
            ) : (
              <button onClick={() => saveQuote(false)} disabled={saving}
                className="w-full bg-[#e85d04] text-white font-semibold py-3 rounded-xl disabled:opacity-50">
                {saving ? "Saving..." : "Save Quote"}
              </button>
            )}
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
