"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { gql } from "@/lib/graphql";
import { JOB_QUERY, USERS_QUERY } from "@/lib/queries";
import {
  UPDATE_JOB_LEAD, UPDATE_JOB_NOTES,
  UPDATE_JOB_QUOTE, ARCHIVE_JOB, UPDATE_CLIENT, SEND_EBA, ADD_FILES, REMOVE_FILE,
} from "@/lib/mutations";
import BottomSheet from "@/components/BottomSheet";
import AddressAutocomplete from "@/components/AddressAutocomplete";

// ── Types ──────────────────────────────────────────────────────────
interface User { _id: string; firstname: string; lastname: string; email: string; role?: string; }
interface ContactDetails {
  name?: string; email?: string; phoneMobile?: string; phoneSecondary?: string;
  streetAddress?: string; suburb?: string; city?: string; postCode?: string;
}
interface Job {
  _id: string; jobNumber: number; stage: string; notes?: string; updatedAt: string; archivedAt?: string; certificateSentAt?: string;
  installation?: { installDate?: string; installNote?: string; installStatus?: string; checkSheetSignedAsComplete?: boolean };
  installerChecksheet?: {
    _id?: string;
    complete?: boolean;
    budgetBags?: number;
    actualBags?: number;
    wallAreaQuoted?: number;
    wallAreaInstalled?: number;
  };
  council?: { _id?: string; consentNumber?: string; files_Other?: string[]; files_CouncilApprovalLetters?: string[] };
  totalPriceManagerOverride?: number | null;
  additionalInstallments?: { _id?: string; amount?: number; date?: string }[];
  depositInvoice?: { _id?: string; xeroInvoiceNumber?: string; xeroInvoiceId?: string } | null;
  finalInvoice?: { _id?: string; xeroInvoiceNumber?: string; xeroInvoiceId?: string } | null;
  additionalInstallmentInvoices?: { _id?: string; xeroInvoiceNumber?: string; xeroInvoiceId?: string }[];
  lead?: {
    leadStatus?: string; leadSource?: string[];
    allocatedTo?: { _id: string; firstname: string; lastname: string };
    callbackDate?: string; quoteBookingDate?: string;
  };
  quote?: {
    quoteNumber?: string; date?: string; c_total?: number; c_deposit?: number;
    c_contractPrice?: number; c_gst?: number;
    depositPercentage?: number; consentFee?: number; quoteNote?: string; quoteResultNote?: string;
    status?: string;
    deferralDate?: string;
    wall?: { SQMPrice?: number; SQM?: number; c_RValue?: number; c_bagCount?: number; cavityDepthMeters?: number };
    ceiling?: { SQMPrice?: number; SQM?: number; RValue?: number; downlights?: number; c_bagCount?: number };
    extras?: { name?: string; price?: number }[];
    files_QuoteSitePlan?: string[];
  };
  ebaForm?: { complete?: boolean; clientApproved?: boolean; clientApprovedAt?: string; signature_assessor?: { fileName?: string } | null };
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
function fmtDateTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function normalizeEmailHtml(input: string) {
  const fallback = "Please find your insulation quote attached.";
  const raw = (input || "").trim();
  if (!raw) return `<p>${fallback}</p>`;

  // Plain text -> paragraph + line break HTML
  if (!/<[a-z][\s\S]*>/i.test(raw)) {
    return raw
      .split(/\n{2,}/)
      .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
      .join("");
  }

  // HTML path
  let html = raw
    .replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, "")
    .replace(/(?:<br\s*\/?>\s*){3,}/gi, "<br><br>")
    .trim();

  // Tighten spacing so old CRM paragraph-heavy templates render cleaner
  html = html
    .replace(/<p(\s[^>]*)?>/gi, (_m, attrs = "") => {
      if (/style\s*=/.test(attrs)) {
        return `<p${attrs.replace(/style\s*=\s*(["'])/i, 'style=$1margin:0 0 9px 0;line-height:1.25;')}>`;
      }
      return `<p${attrs} style="margin:0 0 9px 0;line-height:1.25;">`;
    })
    .replace(/<li(\s[^>]*)?>/gi, (_m, attrs = "") => {
      if (/style\s*=/.test(attrs)) {
        return `<li${attrs.replace(/style\s*=\s*(["'])/i, 'style=$1margin:0 0 3px 0;line-height:1.2;')}>`;
      }
      return `<li${attrs} style="margin:0 0 3px 0;line-height:1.2;">`;
    })
    .replace(/<h([1-6])(\s[^>]*)?>/gi, (_m, level, attrs = "") => {
      if (/style\s*=/.test(attrs)) {
        return `<h${level}${attrs.replace(/style\s*=\s*(["'])/i, 'style=$1margin:12px 0 4px 0;line-height:1.3;')}>`;
      }
      return `<h${level}${attrs} style="margin:12px 0 4px 0;line-height:1.3;">`;
    });

  // Signature tidy-up:
  // 1) Ensure a visible gap above sign-off.
  // 2) Keep sign-off and name/phone compact together.
  html = html
    .replace(/<p([^>]*)>\s*((?:Warm regards|Kind regards|Regards|Thanks|Thank you),?)\s*<\/p>/gi, (_m, attrs = "", signoffText) => {
      if (/style\s*=/.test(attrs)) {
        return `<p${attrs.replace(/style\s*=\s*(["'])/i, 'style=$1margin-top:20px;margin-bottom:0;line-height:1.5;')}>${signoffText}</p>`;
      }
      return `<p${attrs} style="margin-top:20px;margin-bottom:0;line-height:1.5;">${signoffText}</p>`;
    })
    .replace(/(<p[^>]*>\s*(?:Warm regards|Kind regards|Regards|Thanks|Thank you),?\s*<\/p>)\s*<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, signoff, nameLine) => {
      return signoff.replace(/<\/p>$/i, `<br>${nameLine}</p>`);
    });

  return html || `<p>${fallback}</p>`;
}

function prepareEmailHtmlForSend(input: string) {
  const body = normalizeEmailHtml(input);
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.25;color:#1f2937;">${body}</div>`;
}

function toDatetimeLocal(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Format as NZ local time for the datetime-local input (sv-SE gives "YYYY-MM-DD HH:MM:SS")
  return d.toLocaleString("sv-SE", { timeZone: "Pacific/Auckland" }).slice(0, 16).replace(" ", "T");
}
function fromDatetimeLocal(val: string) {
  if (!val) return null;
  // val is "YYYY-MM-DDTHH:mm" in Pacific/Auckland time — convert to UTC
  const approx = new Date(val + ":00Z"); // treat as UTC temporarily to compute offset
  const nzStr = approx.toLocaleString("sv-SE", { timeZone: "Pacific/Auckland" }).slice(0, 16);
  const offsetMs = new Date(nzStr + ":00Z").getTime() - approx.getTime();
  return new Date(approx.getTime() - offsetMs).toISOString();
}

const API_BASE = "https://api.insulhub.nz";
const JOB_CACHE_TTL_MS = 3 * 60 * 1000;

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

const INSTALL_META_START = "[INSTALL_META]";
const INSTALL_META_END = "[/INSTALL_META]";

function parseInstallMeta(notes?: string | null): { status: "confirmed" | "pencilled"; note: string } {
  const text = notes || "";
  const start = text.indexOf(INSTALL_META_START);
  const end = text.indexOf(INSTALL_META_END);
  if (start === -1 || end === -1 || end < start) return { status: "confirmed", note: "" };
  const body = text.slice(start + INSTALL_META_START.length, end).trim();
  const statusMatch = body.match(/^status:\s*(.+)$/im);
  const noteMatch = body.match(/^note:\s*([\s\S]*)$/im);
  const rawStatus = (statusMatch?.[1] || "confirmed").trim().toLowerCase();
  return {
    status: rawStatus === "pencilled" ? "pencilled" : "confirmed",
    note: (noteMatch?.[1] || "").trim(),
  };
}

function stripInstallMeta(notes?: string | null) {
  const text = notes || "";
  const block = new RegExp(`\n?${INSTALL_META_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\s\\S]*?)${INSTALL_META_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\n?`, "m");
  return text.replace(block, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildNotesWithInstallMeta(existingNotes: string | null | undefined, status: "confirmed" | "pencilled", note: string) {
  const cleaned = stripInstallMeta(existingNotes);
  const block = `${INSTALL_META_START}\nstatus: ${status}\nnote: ${note.trim()}\n${INSTALL_META_END}`;
  return cleaned ? `${cleaned}\n\n${block}` : block;
}

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
  const searchParams = useSearchParams();
  const id = params.id as string;
  const returnTo = searchParams.get("returnTo");

  const handleBack = useCallback(() => {
    if (returnTo && returnTo.startsWith("/jobs")) {
      router.push(returnTo);
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/jobs");
  }, [router, returnTo]);

  const [job, setJob] = useState<Job | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingSitePlan, setUploadingSitePlan] = useState(false);
  const [uploadingCompletionFiles, setUploadingCompletionFiles] = useState(false);
  const [completionUploadProgress, setCompletionUploadProgress] = useState(0);
  const [uploadingCouncilApproval, setUploadingCouncilApproval] = useState(false);
  const [councilApprovalProgress, setCouncilApprovalProgress] = useState(0);
  const [error, setError] = useState("");

  // Sheet visibility
  const [sheet, setSheet] = useState<string | null>(null);
  const openSheet = (name: string) => setSheet(name);
  const closeSheet = () => setSheet(null);
  const [detailTab, setDetailTab] = useState<"job" | "quote">("quote");

  // Note form
  const [noteText, setNoteText] = useState("");
  const [fullNoteText, setFullNoteText] = useState("");
  const [deadNoteText, setDeadNoteText] = useState("");

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
  const [installDate, setInstallDate] = useState("");
  const [consentNumber, setConsentNumber] = useState("");
  const [creatingFinalInvoice, setCreatingFinalInvoice] = useState(false);
  const [managerOverride, setManagerOverride] = useState("");
  const [managerAdjustment, setManagerAdjustment] = useState("");
  const [installPlanningStatus, setInstallPlanningStatus] = useState<"confirmed" | "pencilled">("confirmed");
  const [installPlanningNote, setInstallPlanningNote] = useState("");

  // Selected salesperson
  const [selectedUserId, setSelectedUserId] = useState("");
  const [leadSourceForm, setLeadSourceForm] = useState<string[]>([]);
  const [quoteExpanded, setQuoteExpanded] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [quoteEmailBody, setQuoteEmailBody] = useState("Please find your insulation quote attached.");
  const [loadingQuoteEmailBody, setLoadingQuoteEmailBody] = useState(false);
  const quoteEmailEditorRef = useRef<HTMLDivElement | null>(null);
  const [quoteSentAt, setQuoteSentAt] = useState<string | null>(null);

  // Load job + users
  const load = useCallback(async () => {
    try {
      if (typeof window !== "undefined") {
        const rawJob = sessionStorage.getItem(`job-cache:${id}`);
        const rawUsers = sessionStorage.getItem("users-cache");
        if (rawJob) {
          const parsed = JSON.parse(rawJob) as { ts: number; job: Job };
          if (Date.now() - parsed.ts < JOB_CACHE_TTL_MS) {
            setJob(parsed.job);
            setLoading(false);
          }
        }
        if (rawUsers) {
          const parsed = JSON.parse(rawUsers) as { ts: number; users: User[] };
          if (Date.now() - parsed.ts < JOB_CACHE_TTL_MS) {
            setUsers(parsed.users);
          }
        }
      }

      const [jobData, usersData] = await Promise.all([
        gql<{ job: Job }>(JOB_QUERY, { _id: id }),
        gql<{ users: { results: User[] } }>(USERS_QUERY),
      ]);
      setJob(jobData.job);
      setUsers(usersData.users.results);
      if (typeof window !== "undefined") {
        sessionStorage.setItem(`job-cache:${id}`, JSON.stringify({ ts: Date.now(), job: jobData.job }));
        sessionStorage.setItem("users-cache", JSON.stringify({ ts: Date.now(), users: usersData.users.results }));
      }

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
        setQuoteForm(prev => ({
          ...prev,
          quoteNumber: autoQuoteNum,
          date: toDatetimeLocal(j.lead?.quoteBookingDate),
          consentFee: "380",
          depositManual: "",
        }));
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

  useEffect(() => {
    const email = job?.client?.contactDetails?.email?.trim().toLowerCase();
    if (!email || !(job?.stage === "QUOTE" || job?.stage === "SCHEDULED")) {
      setQuoteSentAt(null);
      return;
    }

    const cacheKey = "quote-sent-email-map-v2";
    const token = typeof window !== "undefined" ? localStorage.getItem("token") || "" : "";
    if (!token) return;

    (async () => {
      try {
        const cachedRaw = sessionStorage.getItem(cacheKey);
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw) as { ts: number; map: Record<string, string> };
          if (Date.now() - parsed.ts < 10 * 60 * 1000 && parsed.map?.[email]) {
            setQuoteSentAt(parsed.map[email]);
            return;
          }
        }

        let skip = 0;
        const limit = 500;
        let total = Number.MAX_SAFE_INTEGER;
        const map: Record<string, string> = {};

        while (skip < total) {
          const res = await fetch("https://api.insulhub.nz/graphql", {
            method: "POST",
            headers: { "content-type": "application/json", "x-access-token": token },
            body: JSON.stringify({
              query: `query($skip:Int,$limit:Int){listEmailLogs(skip:$skip,limit:$limit){total results{createdAt type subject to_email}}}`,
              variables: { skip, limit },
            }),
          });
          const json = await res.json();
          const data = json?.data?.listEmailLogs;
          if (!data) break;

          total = data.total;
          const batch = data.results || [];
          for (const row of batch) {
            const to = (row.to_email || "").trim().toLowerCase();
            const subject = (row.subject || "").toLowerCase();
            const type = (row.type || "").toLowerCase();
            if (!to) continue;
            if (!(subject.includes("quote") || type === "quote")) continue;
            const curr = map[to];
            if (!curr || new Date(row.createdAt).getTime() > new Date(curr).getTime()) map[to] = row.createdAt;
          }

          skip += batch.length;
          if (batch.length === 0) break;
        }

        sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), map }));
        setQuoteSentAt(map[email] || null);
      } catch {
        // best effort only
      }
    })();
  }, [job?.client?.contactDetails?.email, job?.stage]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!job) return;
    setDetailTab(["SCHEDULED", "INSTALLATION", "INVOICE", "COMPLETED"].includes(job.stage) ? "job" : "quote");
  }, [job?._id, job?.stage]);

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
  function buildStampedNote(rawText: string) {
    const me = JSON.parse(localStorage.getItem("me") || "{}");
    const name = me.firstname ? `${me.firstname} ${me.lastname}` : "Me";
    const date = new Date().toLocaleDateString("en-NZ", { day: "2-digit", month: "2-digit", year: "2-digit" });
    return `${date} - ${rawText.trim()} - ${name}`;
  }

  function appendNote(existingNotes: string | undefined, rawText: string) {
    const stamped = buildStampedNote(rawText);
    return existingNotes ? `${existingNotes}\n\n${stamped}` : stamped;
  }

  async function saveNote() {
    if (!noteText.trim()) return;
    const combined = appendNote(job?.notes, noteText);
    await run(() => gql(UPDATE_JOB_NOTES, { input: { _id: id, notes: combined } }));
    setNoteText("");
  }

  async function saveInstallPlanning() {
    setSaving(true);
    try {
      const nextNotes = buildNotesWithInstallMeta(job?.notes, installPlanningStatus, installPlanningNote);
      await gql(UPDATE_JOB_NOTES, { input: { _id: id, notes: nextNotes } });
      await load();
      closeSheet();
      const msg = { type: "success" as const, text: "Install planning details saved." };
      setNotice(msg);
      setToast(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save install planning details");
    } finally {
      setSaving(false);
    }
  }

  async function saveFullNote() {
    const nextNotes = buildNotesWithInstallMeta(fullNoteText, installMeta.status, installMeta.note);
    await run(() => gql(UPDATE_JOB_NOTES, { input: { _id: id, notes: nextNotes } }));
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
    if (status === "DEAD") {
      setDeadNoteText("");
      openSheet("deadConfirm");
      return;
    }

    const apiStatus = status === "CALLBACK" ? "ON_HOLD" : status;
    await run(() => gql(UPDATE_JOB_LEAD, {
      input: {
        _id: id,
        lead: buildLeadInput({
          leadStatus: apiStatus,
          ...(apiStatus === "ON_HOLD" ? {} : { callbackDate: null }),
        }),
      },
    }));
  }

  async function confirmDeadStatus() {
    if (!deadNoteText.trim()) {
      setError("A note is required before marking this as Dead.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const combinedNotes = appendNote(job?.notes, deadNoteText);
      await gql(UPDATE_JOB_LEAD, {
        input: {
          _id: id,
          notes: combinedNotes,
          lead: buildLeadInput({
            leadStatus: "DEAD",
            callbackDate: null,
          }),
        },
      });
      await load();
      setDeadNoteText("");
      closeSheet();
      setNotice({ type: "success", text: "Marked as Dead and note saved." });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark job as Dead");
    } finally {
      setSaving(false);
    }
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

  async function clearQuoteBookingDate() {
    await run(() => gql(UPDATE_JOB_LEAD, {
      input: { _id: id, lead: buildLeadInput({ quoteBookingDate: null }) },
    }));
  }


  async function markAccepted() {
    await run(() => gql(UPDATE_JOB_QUOTE, {
      input: { _id: id, stage: "SCHEDULED", quote: buildQuoteInput({ status: "ACCEPTED" }) },
    }));
  }

  function buildQuoteUpdateInput(andProgress = false, quoteOverrides: Record<string, unknown> = {}) {
    const q = quoteForm;
    const existing = job?.quote || {} as Record<string, unknown>;
    const existingWall = (job?.quote?.wall || {}) as Record<string, unknown>;
    const existingCeiling = (job?.quote?.ceiling || {}) as Record<string, unknown>;

    const quotePayload = {
      ...existing,
      quoteNote: q.quoteNote,
      quoteResultNote: q.quoteResultNote,
      extras: (q.extras || []).filter((e) => e.name || e.price).map((e) => ({
        name: e.name,
        price: parseFloat(e.price || "0") || 0,
      })),
      quoteNumber: q.quoteNumber,
      status: "UNSET",
      date: fromDatetimeLocal(q.date),
      consentFee: q.consentFee ? parseFloat(q.consentFee) : null,
      depositPercentage: q.depositPercentage ? parseFloat(q.depositPercentage) : 25,
      c_contractPrice: quoteCalc.contractPrice,
      c_gst: quoteCalc.gst,
      c_total: quoteCalc.total,
      c_deposit: quoteCalc.deposit,
      totalOverridden: !!(quoteForm.totalManual && parseFloat(quoteForm.totalManual) > 0),
      depositOverridden: !!(quoteForm.depositManual && parseFloat(quoteForm.depositManual) > 0),
      wall: q.hasWall ? {
        ...existingWall,
        SQMPrice: q.wallSQMPrice ? parseFloat(q.wallSQMPrice) : null,
        SQM: q.wallSQM ? parseFloat(q.wallSQM) : null,
        cavityDepthMeters: q.wallCavityDepth ? parseFloat(q.wallCavityDepth) : 0.1,
        c_RValue: quoteCalc.wallR,
        c_bagCount: quoteCalc.wallBags,
      } : {},
      ceiling: q.hasCeiling ? {
        ...existingCeiling,
        SQMPrice: q.ceilingSQMPrice ? parseFloat(q.ceilingSQMPrice) : null,
        SQM: q.ceilingSQM ? parseFloat(q.ceilingSQM) : null,
        RValue: q.ceilingRValue ? parseFloat(q.ceilingRValue) : null,
        downlights: q.ceilingDownlights ? parseFloat(q.ceilingDownlights) : null,
        c_thickness: quoteCalc.ceilingThickness,
        c_bagCount: quoteCalc.ceilingBags,
      } : {},
      ...quoteOverrides,
    };

    return {
      _id: id,
      stage: "QUOTE",
      quote: quotePayload,
      sitePlanNotes: ((job as any)?.sitePlanNotes) || "",
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

  async function uploadTrackedFiles(
    files: FileList | null,
    documentType: "OTHER" | "COUNCIL_APPROVAL_LETTER",
    setUploading: (value: boolean) => void,
    setProgress: (value: number) => void,
    successLabel: string,
  ) {
    if (!files || files.length === 0) return;
    try {
      setUploading(true);
      setProgress(0);
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("files", f));

      const json = await new Promise<{ fileNames?: string[] }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE}/files/upload`);
        xhr.setRequestHeader("x-token", getToken());
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          setProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () => {
          try {
            const body = JSON.parse(xhr.responseText || "{}");
            if (xhr.status >= 200 && xhr.status < 300) resolve(body);
            else reject(new Error(body?.message || "Upload failed"));
          } catch {
            reject(new Error("Upload failed"));
          }
        };
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(form);
      });

      const fileNames: string[] = json.fileNames || [];
      if (!fileNames.length) throw new Error("Upload failed");
      await gql(ADD_FILES, { _id: id, documentType, fileNames });
      setProgress(100);
      await load();
      const msg = { type: "success" as const, text: `Uploaded ${fileNames.length} ${successLabel} file${fileNames.length === 1 ? "" : "s"}.` };
      setNotice(msg);
      setToast(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "File upload failed.");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  async function uploadCompletionFiles(files: FileList | null) {
    await uploadTrackedFiles(files, "OTHER", setUploadingCompletionFiles, setCompletionUploadProgress, "council application");
  }

  async function uploadCouncilApprovalFiles(files: FileList | null) {
    await uploadTrackedFiles(files, "COUNCIL_APPROVAL_LETTER", setUploadingCouncilApproval, setCouncilApprovalProgress, "council approval");
  }

  async function removeCompletionFile(fileName: string) {
    if (!confirm("Remove this council application file?")) return;
    await run(() => gql(REMOVE_FILE, { _id: id, documentType: "OTHER", fileName }));
  }

  async function removeCouncilApprovalFile(fileName: string) {
    if (!confirm("Remove this council approval file?")) return;
    await run(() => gql(REMOVE_FILE, { _id: id, documentType: "COUNCIL_APPROVAL_LETTER", fileName }));
  }

  async function openEBAClientApprovalPage() {
    window.location.href = `/jobs/${id}/eba`;
  }

  function openSignedEBAPdf() {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) {
      setError("Missing auth token");
      return;
    }
    const params = new URLSearchParams({ jobId: id, token });
    window.open(`${API_BASE}/pdf/eba?${params.toString()}`, "_blank");
  }

  function openCompletionCertificatePdf() {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) {
      setError("Missing auth token");
      return;
    }
    const params = new URLSearchParams({ jobId: id, token });
    window.open(`${API_BASE}/pdf/certificate?${params.toString()}`, "_blank");
  }

  function openInstallerChecksheetPdf() {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const installerChecksheetId = job?.installerChecksheet?._id;
    if (!token || !installerChecksheetId) {
      setError("Missing checksheet data");
      return;
    }
    const params = new URLSearchParams({ token, installerChecksheetId });
    window.open(`${API_BASE}/pdf/installer-checksheet?${params.toString()}`, "_blank");
  }

  async function saveQuoteAndOpenEBA() {
    if (job?.ebaForm?.clientApproved) {
      setNotice({ type: "error", text: "EBA is already signed and can no longer be edited." });
      return;
    }

    if (!quoteForm.quoteNumber || !quoteForm.date || (!quoteForm.hasWall && !quoteForm.hasCeiling)) {
      setNotice({ type: "error", text: "Add quote data first (quote number, date, and wall/ceiling values)." });
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
      const msg = { type: "error" as const, text: "Complete the EBA first before sending." };
      setNotice(msg);
      setToast(msg);
      return;
    }
    await run(() => gql(SEND_EBA, { jobId: id }));
    const msg = { type: "success" as const, text: "EBA email sent." };
    setNotice(msg);
    setToast(msg);
  }

  async function saveInstallDate() {
    setSaving(true);
    try {
      const nextNotes = buildNotesWithInstallMeta(job?.notes, installPlanningStatus, installPlanningNote);
      await gql(
        `mutation UpdateInstall($input: UpdateJobInput!) { updateJob(input: $input) { _id installation { installDate installNote installStatus checkSheetSignedAsComplete } notes } }`,
        {
          input: {
            _id: id,
            installation: {
              installDate: fromDatetimeLocal(installDate),
              installNote: job?.installation?.installNote || "",
              installStatus: job?.installation?.installStatus || "JOB_NOT_STARTED_YET",
              checkSheetSignedAsComplete: job?.installation?.checkSheetSignedAsComplete ?? false,
            },
            notes: nextNotes,
          },
        }
      );
      await load();
      closeSheet();
      const msg = { type: "success" as const, text: "Installation date saved." };
      setNotice(msg);
      setToast(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save installation date");
    } finally {
      setSaving(false);
    }
  }

  async function clearInstallDate() {
    setSaving(true);
    try {
      await gql(
        `mutation UpdateInstall($input: UpdateJobInput!) { updateJob(input: $input) { _id installation { installDate installNote installStatus checkSheetSignedAsComplete } } }`,
        {
          input: {
            _id: id,
            installation: {
              installDate: null,
              installNote: job?.installation?.installNote || "",
              installStatus: job?.installation?.installStatus || "JOB_NOT_STARTED_YET",
              checkSheetSignedAsComplete: job?.installation?.checkSheetSignedAsComplete ?? false,
            },
          },
        }
      );
      await load();
      closeSheet();
      const msg = { type: "success" as const, text: "Installation date removed." };
      setNotice(msg);
      setToast(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove installation date");
    } finally {
      setSaving(false);
    }
  }

  async function saveConsentNumber() {
    setSaving(true);
    try {
      await gql(
        `mutation UpdateCouncilConsent($input: UpdateJobInput!) { updateJob(input: $input) { _id council { _id consentNumber } } }`,
        {
          input: {
            _id: id,
            council: {
              _id: job?.council?._id,
              consentNumber: consentNumber.trim(),
            },
          },
        }
      );
      await load();
      closeSheet();
      const msg = { type: "success" as const, text: "Consent number saved." };
      setNotice(msg);
      setToast(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save consent number");
    } finally {
      setSaving(false);
    }
  }

  async function createFinalInvoiceInXero() {
    setCreatingFinalInvoice(true);
    setError("");
    try {
      const finalInvoiceInput: Record<string, unknown> = {
        additionalInstallments: (job?.additionalInstallments || []).map((i) => ({
          amount: i.amount,
          date: i.date,
        })),
      };
      if (managerAdjustment.trim() !== "") {
        const baseTotal = Number(job?.quote?.c_total || 0);
        const adjustment = Number(managerAdjustment);
        if (!Number.isFinite(adjustment)) throw new Error("Manager adjustment must be a valid number");
        finalInvoiceInput.managerOverride = baseTotal + adjustment;
      } else if (managerOverride.trim() !== "") {
        finalInvoiceInput.managerOverride = Number(managerOverride);
      }

      await gql(
        `mutation CreateFinalInvoices($_id: ObjectId!, $finalInvoiceInput: FinalInvoiceInput!, $stepJobStage: Boolean!) {
          createFinalInvoices(_id: $_id, finalInvoiceInput: $finalInvoiceInput, stepJobStage: $stepJobStage) {
            _id
            stage
            finalInvoice { _id xeroInvoiceNumber xeroInvoiceId }
          }
        }`,
        {
          _id: id,
          stepJobStage: false,
          finalInvoiceInput,
        }
      );
      await load();
      closeSheet();
      const msg = { type: "success" as const, text: "Final invoice created in Xero." };
      setNotice(msg);
      setToast(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create final invoice in Xero");
    } finally {
      setCreatingFinalInvoice(false);
    }
  }

  async function sendCompletionPack() {
    setSaving(true);
    setError("");
    try {
      await gql(
        `mutation SendCertificate($jobId: ObjectId!) {
          sendCertificate(jobId: $jobId) {
            _id
            certificateSentAt
          }
        }`,
        { jobId: id }
      );
      await load();
      const msg = { type: "success" as const, text: "Completion pack sent to customer." };
      setNotice(msg);
      setToast(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send completion pack");
    } finally {
      setSaving(false);
    }
  }

  async function markJobCompleted() {
    setSaving(true);
    setError("");
    try {
      await gql(
        `mutation UpdateJobStage($input: UpdateJobInput!) {
          updateJob(input: $input) {
            _id
            stage
          }
        }`,
        { input: { _id: id, stage: "COMPLETED" } }
      );
      await load();
      closeSheet();
      const msg = { type: "success" as const, text: "Job marked as completed." };
      setNotice(msg);
      setToast(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark job as completed");
    } finally {
      setSaving(false);
    }
  }

  async function loadQuoteEmailTemplate() {
    setLoadingQuoteEmailBody(true);
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
    } finally {
      setLoadingQuoteEmailBody(false);
    }
    setQuoteEmailBody(normalizeEmailHtml(template));
  }

  async function openSendQuoteSheet() {
    openSheet("sendQuoteConfirm");
    await loadQuoteEmailTemplate();
  }

  useEffect(() => {
    if (sheet !== "sendQuoteConfirm" || loadingQuoteEmailBody) return;
    if (!quoteEmailEditorRef.current) return;
    if (quoteEmailEditorRef.current.innerHTML !== quoteEmailBody) {
      quoteEmailEditorRef.current.innerHTML = quoteEmailBody;
    }
  }, [sheet, loadingQuoteEmailBody, quoteEmailBody]);

  function applyEmailFormat(command: string) {
    if (!quoteEmailEditorRef.current) return;
    quoteEmailEditorRef.current.focus();
    document.execCommand(command, false);
    setQuoteEmailBody(quoteEmailEditorRef.current.innerHTML);
  }

  async function sendQuoteToCustomerConfirmed(templateOverride?: string) {
    if (!quoteForm.quoteNumber || !quoteForm.date || (!quoteForm.hasWall && !quoteForm.hasCeiling)) {
      const msg = { type: "error" as const, text: "Add quote data first (quote number, date, and wall/ceiling values)." };
      setNotice(msg);
      setToast(msg);
      return;
    }

    const rawTemplate = templateOverride || quoteEmailBody || "Please find your insulation quote attached.";
    const template = prepareEmailHtmlForSend(rawTemplate);

    const sendInput = buildQuoteUpdateInput(false, { status: "UNSET" });
    const statusForSend = (sendInput as { quote?: { status?: string } })?.quote?.status;
    if (statusForSend === "ACCEPTED") {
      const msg = { type: "error" as const, text: "Blocked: Send Quote cannot use ACCEPTED status." };
      setNotice(msg);
      setToast(msg);
      return;
    }

    await run(() => gql(UPDATE_JOB_QUOTE, {
      input: sendInput,
      emailQuoteToCustomer: true,
      quotePDFEmailBodyTemplate: template,
    }));
    setQuoteSentAt(new Date().toISOString());
    const msg = { type: "success" as const, text: "Quote sent to customer." };
    setNotice(msg);
    setToast(msg);
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
        <button onClick={handleBack} className="text-white text-sm">← Back</button>
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
  const displayCallbackDate = status === "CALLBACK" ? (job.stage === "QUOTE" ? (job.quote?.deferralDate || job.lead?.callbackDate) : job.lead?.callbackDate) : null;
  const isArchived = !!job.archivedAt;
  const isPostQuoteStage = ["SCHEDULED", "INSTALLATION", "INVOICE", "COMPLETED"].includes(job.stage);
  const isQuoteInfoStage = ["QUOTE", "SCHEDULED", "INSTALLATION", "INVOICE", "COMPLETED"].includes(job.stage);
  const activeDetailTab = isPostQuoteStage ? detailTab : "quote";
  const installDateDisplay = fmtDateTime(job.installation?.installDate) || "Not set";
  const managerAdjustmentNumber = Number(managerAdjustment);
  const managerAdjustmentValid = managerAdjustment.trim() === "" || Number.isFinite(managerAdjustmentNumber);
  const safeManagerAdjustment = managerAdjustment.trim() === "" ? 0 : (Number.isFinite(managerAdjustmentNumber) ? managerAdjustmentNumber : 0);
  const installStatusLabelMap: Record<string, string> = {
    JOB_NOT_STARTED_YET: "Job not started yet",
    INSTALL_NOT_FINISHED: "Install not finished",
    INSTALLED_AS_QUOTED: "Installed as quoted",
    INSTALLED_WITH_VARIATIONS_FROM_QUOTE: "Installed with variations from quote",
  };
  const installStatusDisplay = installStatusLabelMap[job.installation?.installStatus || ""] || "Job not started yet";
  const installIsInstalled = ["INSTALLED_AS_QUOTED", "INSTALLED_WITH_VARIATIONS_FROM_QUOTE"].includes(job.installation?.installStatus || "");
  const installIsVariation = (job.installation?.installStatus || "") === "INSTALLED_WITH_VARIATIONS_FROM_QUOTE";
  const checksheetBagMetrics = (job.installerChecksheet?.budgetBags != null && job.installerChecksheet?.actualBags != null)
    ? `Budget / actual bags: ${job.installerChecksheet.budgetBags} / ${job.installerChecksheet.actualBags}`
    : null;
  const checksheetWallMetrics = (job.installerChecksheet?.wallAreaQuoted != null && job.installerChecksheet?.wallAreaInstalled != null)
    ? `Wall area quoted / installed: ${job.installerChecksheet.wallAreaQuoted} / ${job.installerChecksheet.wallAreaInstalled}`
    : null;
  const installedMetricsSummary = installIsInstalled
    ? [checksheetBagMetrics, checksheetWallMetrics].filter(Boolean)
    : [];
  const variationMetricsSummary = installIsVariation
    ? [checksheetBagMetrics, checksheetWallMetrics].filter(Boolean)
    : [];
  const installNoteDisplay = job.installation?.installNote?.trim() || "No install notes yet";
  const installMeta = parseInstallMeta(job.notes);
  const visibleJobNotes = stripInstallMeta(job.notes);
  const completionActions = [
    {
      title: "Add installation date",
      description: installDateDisplay,
      status: job.installation?.installDate ? "Recorded" : "Missing",
      wired: true,
      actionLabel: job.installation?.installDate ? "Edit date" : "Set date",
      action: () => {
        setInstallDate(toDatetimeLocal(job.installation?.installDate));
        setInstallPlanningStatus(installMeta.status);
        setInstallPlanningNote(installMeta.note);
        openSheet("installDate");
      },
      disabled: saving,
    },
    {
      title: "Send EBA for signing",
      description: job.ebaForm?.complete ? (job.ebaForm?.clientApproved ? "Already client signed" : "Ready to send") : "Complete the EBA first",
      status: job.ebaForm?.clientApproved ? "Signed" : job.ebaForm?.complete ? "Ready" : "Blocked",
      wired: true,
      actionLabel: job.ebaForm?.clientApproved ? undefined : job.ebaForm?.complete ? "Send EBA" : "Edit EBA",
      action: job.ebaForm?.clientApproved ? undefined : job.ebaForm?.complete ? sendEBA : openEBAClientApprovalPage,
      disabled: job.ebaForm?.clientApproved ? true : saving,
    },
    {
      title: "See signed EBA / download",
      description: job.ebaForm?.clientApproved
        ? `EBA signed ${job.ebaForm?.clientApprovedAt ? fmtDateTime(job.ebaForm.clientApprovedAt) : ""}`.trim()
        : "Waiting for client signature",
      status: job.ebaForm?.clientApproved ? "Signed" : "Pending",
      wired: true,
      actionLabel: job.ebaForm?.clientApproved ? "Open EBA PDF" : "Open EBA",
      action: job.ebaForm?.clientApproved ? openSignedEBAPdf : openEBAClientApprovalPage,
    },
    {
      title: "Upload Council Application",
      description: job.council?.files_Other?.length
        ? `${job.council.files_Other.length} file${job.council.files_Other.length === 1 ? "" : "s"} uploaded`
        : "Upload council application files",
      status: uploadingCompletionFiles ? `Uploading ${completionUploadProgress}%` : job.council?.files_Other?.length ? "Available" : "Empty",
      wired: true,
    },
    {
      title: "Consent Number",
      description: job.council?.consentNumber || "Not set",
      status: job.council?.consentNumber ? "Recorded" : "Missing",
      wired: true,
      actionLabel: job.council?.consentNumber ? "Edit" : "Set",
      action: () => {
        setConsentNumber(job.council?.consentNumber || "");
        openSheet("consentNumber");
      },
      disabled: saving,
    },
    {
      title: "Upload Council Approval",
      description: job.council?.files_CouncilApprovalLetters?.length
        ? `${job.council.files_CouncilApprovalLetters.length} file${job.council.files_CouncilApprovalLetters.length === 1 ? "" : "s"} uploaded`
        : "Upload council approval files",
      status: uploadingCouncilApproval ? `Uploading ${councilApprovalProgress}%` : job.council?.files_CouncilApprovalLetters?.length ? "Available" : "Empty",
      wired: true,
    },
    {
      title: "Install notes & status",
      description: installStatusDisplay,
      status: installIsInstalled ? "Installed" : job.installation?.installNote ? "Available" : "Blank",
      wired: true,
      actionLabel: installIsInstalled && job.installerChecksheet?._id ? "View checksheet" : undefined,
      action: installIsInstalled && job.installerChecksheet?._id ? openInstallerChecksheetPdf : undefined,
      disabled: saving,
    },
    {
      title: "Trigger final invoice creation in Xero",
      description: job.finalInvoice?.xeroInvoiceNumber
        ? `Created in Xero as ${job.finalInvoice.xeroInvoiceNumber}`
        : "Create the final invoice in Xero without progressing the job state",
      status: job.finalInvoice?.xeroInvoiceId ? "Created" : creatingFinalInvoice ? "Creating..." : "Ready",
      wired: true,
      actionLabel: job.finalInvoice?.xeroInvoiceId ? undefined : "Create final invoice",
      action: job.finalInvoice?.xeroInvoiceId ? undefined : () => {
        const baseTotal = Number(job.quote?.c_total || 0);
        const existingOverride = job.totalPriceManagerOverride;
        setManagerOverride(existingOverride != null ? String(existingOverride) : "");
        setManagerAdjustment(existingOverride != null ? String(existingOverride - baseTotal) : "");
        openSheet("finalInvoiceConfirm");
      },
      disabled: creatingFinalInvoice,
    },
    {
      title: "Send completion pack to customer",
      description: job.certificateSentAt
        ? `Sent ${fmtDateTime(job.certificateSentAt)}`
        : !job.installation?.installDate
          ? "Set an installation date first"
          : !job.council?.consentNumber
            ? "Enter a consent number first"
            : !job.council?.files_Other?.length
              ? "Upload a council application first"
              : !job.council?.files_CouncilApprovalLetters?.length
                ? "Upload a council approval first"
                : "Completion certificate, council, acceptance letter, and other customer files",
      status: job.certificateSentAt
        ? "Sent"
        : !job.installation?.installDate || !job.council?.consentNumber || !job.council?.files_Other?.length || !job.council?.files_CouncilApprovalLetters?.length
          ? "Blocked"
          : saving
            ? "Sending..."
            : "Ready",
      wired: true,
      actionLabel: job.certificateSentAt
        ? undefined
        : !job.installation?.installDate || !job.council?.consentNumber || !job.council?.files_Other?.length || !job.council?.files_CouncilApprovalLetters?.length
          ? undefined
          : "Send completion pack",
      action: job.certificateSentAt
        ? undefined
        : !job.installation?.installDate || !job.council?.consentNumber || !job.council?.files_Other?.length || !job.council?.files_CouncilApprovalLetters?.length
          ? undefined
          : sendCompletionPack,
      disabled: saving,
    },
    {
      title: "Mark as completed",
      description: job.stage === "COMPLETED"
        ? "Job is already completed"
        : !job.installation?.installDate
          ? "Set an installation date first"
          : !job.finalInvoice?.xeroInvoiceId
            ? "Create the final invoice in Xero first"
            : !job.certificateSentAt
              ? "Send the completion pack first"
              : "Mark the job as completed",
      status: job.stage === "COMPLETED"
        ? "Completed"
        : !job.installation?.installDate || !job.finalInvoice?.xeroInvoiceId || !job.certificateSentAt
          ? "Blocked"
          : saving
            ? "Completing..."
            : "Ready",
      wired: true,
      actionLabel: job.stage === "COMPLETED"
        ? undefined
        : !job.installation?.installDate || !job.finalInvoice?.xeroInvoiceId || !job.certificateSentAt
          ? undefined
          : "Mark completed",
      action: job.stage === "COMPLETED"
        ? undefined
        : !job.installation?.installDate || !job.finalInvoice?.xeroInvoiceId || !job.certificateSentAt
          ? undefined
          : () => openSheet("markCompletedConfirm"),
      disabled: saving,
    },
  ];

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
        <button onClick={handleBack} className="text-gray-300 text-sm mb-1">← Back</button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-white font-bold text-lg leading-tight">{c?.name || "Unknown"}</h1>
            {address && <p className="text-gray-300 text-xs mt-0.5">{address}</p>}
          </div>
          <span className="text-xs text-gray-400 mt-1">#{job.jobNumber}</span>
        </div>
      </div>

      <div className="px-4 pt-3">
        {error && <div className="bg-red-50 text-red-700 text-sm px-4 py-2 rounded-xl mb-3">{error}</div>}
        {notice && <div className={`text-sm px-4 py-2 rounded-xl mb-3 ${notice.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{notice.text}</div>}
        {isArchived && <div className="bg-yellow-50 text-yellow-700 text-sm px-4 py-2 rounded-xl mb-3">⚠️ This job is archived</div>}

        {isPostQuoteStage && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-1 mb-3 flex gap-1">
            <button
              onClick={() => setDetailTab("job")}
              className={`flex-1 rounded-lg py-2.5 text-sm font-semibold ${activeDetailTab === "job" ? "bg-[#1a3a4a] text-white" : "text-gray-600"}`}
            >
              Job Info
            </button>
            <button
              onClick={() => setDetailTab("quote")}
              className={`flex-1 rounded-lg py-2.5 text-sm font-semibold ${activeDetailTab === "quote" ? "bg-[#1a3a4a] text-white" : "text-gray-600"}`}
            >
              Quote Info
            </button>
          </div>
        )}

        {/* Quick contact */}
        <div className="flex gap-2 mb-3">
          {phone && <a href={`tel:${phone}`} className="flex-1 bg-[#e85d04] text-white font-semibold py-3 rounded-xl text-center text-sm">📞 Call</a>}
          {phone && <a href={`sms:${phone}`} className="flex-1 bg-teal-700 text-white font-semibold py-3 rounded-xl text-center text-sm">💬 Text</a>}
          {c?.email && <a href={`mailto:${c.email}`} className="flex-1 bg-[#1a3a4a] text-white font-semibold py-3 rounded-xl text-center text-sm">✉️ Email</a>}
        </div>

        {activeDetailTab === "job" ? (
          <>
            <Section title="Job checklist">
              <p className="text-xs text-gray-500 mb-3">Complete top to bottom. Each step shows if it is done, ready, in progress, or blocked.</p>
              <div className="space-y-2">
                {completionActions.map((item, index) => {
                  const doneStates = ["Recorded", "Signed", "Available", "Created", "Sent", "Completed"];
                  const blockedStates = ["Blocked", "Missing", "Empty", "Blank"];
                  const isInProgress = /Uploading|Creating|Sending|Completing/.test(item.status);
                  const isDone = doneStates.includes(item.status);
                  const isBlocked = blockedStates.includes(item.status);
                  const isInstallStatusStep = item.title === "Install notes & status";
                  const isInstalledAsQuoted = isInstallStatusStep && (job.installation?.installStatus === "INSTALLED_AS_QUOTED");
                  const isInstalledWithVariation = isInstallStatusStep && (job.installation?.installStatus === "INSTALLED_WITH_VARIATIONS_FROM_QUOTE");

                  const stateTone = isDone || isInstalledAsQuoted || isInstalledWithVariation
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : isInProgress
                      ? "bg-blue-50 text-blue-700 border-blue-200"
                      : isBlocked
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-slate-50 text-slate-700 border-slate-200";
                  const stepTone = isDone || isInstalledAsQuoted || isInstalledWithVariation
                    ? "bg-emerald-100 text-emerald-700"
                    : isBlocked
                      ? "bg-amber-100 text-amber-700"
                      : isInProgress
                        ? "bg-blue-100 text-blue-700"
                        : "bg-slate-100 text-slate-700";

                  return (
                    <div key={item.title} className="border border-gray-100 rounded-xl p-3">
                      <div className="flex items-start gap-3">
                        <div className={`shrink-0 w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center ${stepTone}`}>
                          {index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3 mb-1.5">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-gray-900">{item.title}</div>
                              {item.title !== "Install notes & status" && (
                                <div className="text-xs text-gray-500 mt-1">{item.description}</div>
                              )}
                            </div>
                            <span className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full border ${stateTone}`}>
                              {item.status}
                            </span>
                          </div>

                          {item.title === "Install notes & status" ? (
                            <div className="mt-2 space-y-2">
                              <div className="text-xs text-gray-600">{installStatusDisplay}</div>

                              {installIsInstalled && !installIsVariation && installedMetricsSummary.length > 0 && (
                                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2">
                                  <div className="text-[11px] font-semibold text-emerald-800 mb-1">Install usage</div>
                                  <div className="space-y-1">
                                    {installedMetricsSummary.map((line) => (
                                      <div key={line} className="text-[11px] text-emerald-800">• {line}</div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {installIsVariation && (
                                <div className="rounded-lg border-2 border-amber-300 bg-amber-100 px-3 py-2.5 shadow-sm">
                                  <div className="text-xs font-bold text-amber-900 mb-1">⚠ Variation from quote</div>
                                  {variationMetricsSummary.length > 0 ? (
                                    <div className="space-y-1">
                                      {variationMetricsSummary.map((line) => (
                                        <div key={line} className="text-[12px] font-semibold text-amber-900">• {line}</div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="text-[12px] font-semibold text-amber-900">Installer marked as variation. Check checksheet for details.</div>
                                  )}
                                </div>
                              )}

                              <div className="text-xs text-gray-500">{installNoteDisplay}</div>
                            </div>
                          ) : item.title === "Upload Council Application" ? (
                            <div className="mt-3 border border-gray-200 rounded-xl p-3 space-y-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-xs text-gray-500">Usually one PDF for the council application</div>
                                <label className="inline-flex items-center px-3 py-2 rounded-lg bg-[#1a3a4a] text-white text-sm font-semibold cursor-pointer hover:opacity-95">
                                  <input type="file" onChange={(e) => uploadCompletionFiles(e.target.files)} disabled={uploadingCompletionFiles} className="hidden" />
                                  {uploadingCompletionFiles ? "Uploading..." : "Upload file"}
                                </label>
                              </div>

                              {uploadingCompletionFiles && (
                                <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
                                  <div className="flex items-center gap-3 mb-2">
                                    <div className="h-4 w-4 rounded-full border-2 border-[#e85d04] border-t-transparent animate-spin" />
                                    <div className="text-sm font-semibold text-[#9a3412]">Uploading council application</div>
                                    <div className="ml-auto text-sm font-bold text-[#9a3412]">{completionUploadProgress}%</div>
                                  </div>
                                  <div className="h-2 bg-orange-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-[#e85d04] transition-all duration-200" style={{ width: `${completionUploadProgress}%` }} />
                                  </div>
                                </div>
                              )}

                              <div className="space-y-2">
                                {(job.council?.files_Other || []).map((f) => (
                                  <div key={f} className="flex items-center justify-between gap-3 text-sm">
                                    <a href={fileUrl(f)} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline truncate max-w-[70%]">{f}</a>
                                    <button onClick={() => removeCompletionFile(f)} className="text-xs text-red-600 font-medium">Remove</button>
                                  </div>
                                ))}
                                {(!job.council?.files_Other || job.council.files_Other.length === 0) && (
                                  <p className="text-xs text-gray-400">No council application files uploaded yet.</p>
                                )}
                              </div>
                            </div>
                          ) : item.title === "Upload Council Approval" ? (
                            <div className="mt-3 border border-gray-200 rounded-xl p-3 space-y-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-xs text-gray-500">Usually one council approval PDF</div>
                                <label className="inline-flex items-center px-3 py-2 rounded-lg bg-[#1a3a4a] text-white text-sm font-semibold cursor-pointer hover:opacity-95">
                                  <input type="file" onChange={(e) => uploadCouncilApprovalFiles(e.target.files)} disabled={uploadingCouncilApproval} className="hidden" />
                                  {uploadingCouncilApproval ? "Uploading..." : "Upload file"}
                                </label>
                              </div>

                              {uploadingCouncilApproval && (
                                <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
                                  <div className="flex items-center gap-3 mb-2">
                                    <div className="h-4 w-4 rounded-full border-2 border-[#e85d04] border-t-transparent animate-spin" />
                                    <div className="text-sm font-semibold text-[#9a3412]">Uploading council approval</div>
                                    <div className="ml-auto text-sm font-bold text-[#9a3412]">{councilApprovalProgress}%</div>
                                  </div>
                                  <div className="h-2 bg-orange-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-[#e85d04] transition-all duration-200" style={{ width: `${councilApprovalProgress}%` }} />
                                  </div>
                                </div>
                              )}

                              <div className="space-y-2">
                                {(job.council?.files_CouncilApprovalLetters || []).map((f) => (
                                  <div key={f} className="flex items-center justify-between gap-3 text-sm">
                                    <a href={fileUrl(f)} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline truncate max-w-[70%]">{f}</a>
                                    <button onClick={() => removeCouncilApprovalFile(f)} className="text-xs text-red-600 font-medium">Remove</button>
                                  </div>
                                ))}
                                {(!job.council?.files_CouncilApprovalLetters || job.council.files_CouncilApprovalLetters.length === 0) && (
                                  <p className="text-xs text-gray-400">No council approval files uploaded yet.</p>
                                )}
                              </div>
                            </div>
                          ) : item.actionLabel && item.action ? (
                            <button
                              onClick={item.action}
                              disabled={item.disabled}
                              className="mt-2 bg-[#1a3a4a] text-white text-sm font-semibold px-3 py-2 rounded-lg disabled:opacity-40"
                            >
                              {item.actionLabel}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section
              title="Notes"
              action={
                <div className="flex items-center gap-3">
                  <button onClick={() => openSheet("addNote")} className="text-xs text-[#e85d04] font-medium">+ Add</button>
                  <button onClick={() => { setFullNoteText(visibleJobNotes || ""); openSheet("editNote"); }} className="text-xs text-gray-500 font-medium">Edit</button>
                </div>
              }
            >
              {visibleJobNotes ? (
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{visibleJobNotes}</p>
              ) : (
                <p className="text-sm text-gray-400">No notes yet</p>
              )}
            </Section>

            <div className="mt-1">
              <button
                onClick={openCompletionCertificatePdf}
                disabled={!job.council?.consentNumber || !job.installation?.installDate}
                className="w-full text-blue-700 border border-blue-200 bg-blue-50 rounded-xl py-3 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Download completion certificate
              </button>
            </div>
          </>
        ) : (
          <>
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
              <span className="text-sm text-gray-800">{job.lead?.quoteBookingDate ? fmtDateTime(job.lead.quoteBookingDate) : "Not set"}</span>
              <button onClick={() => openSheet("booking")} className="text-xs text-[#e85d04] font-medium">{job.lead?.quoteBookingDate ? "Edit" : "Set"}</button>
              {job.lead?.quoteBookingDate && (
                <button onClick={clearQuoteBookingDate} className="text-xs text-red-600 font-medium">Remove</button>
              )}
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
        {isQuoteInfoStage && (
          <Section title="Site Plan">
            <div className="flex gap-2 mb-3 flex-wrap">
              <button onClick={printQuoteSitePlanPDF} className="bg-gray-700 text-white text-sm font-semibold px-3 py-2.5 rounded-xl">🖨️ Print Site Plan PDF</button>
              <button onClick={() => router.push(`/jobs/${id}/site-plan-draw`)} className="bg-[#1a3a4a] text-white text-sm font-semibold px-3 py-2.5 rounded-xl">✏️ Draw Site Plan</button>
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
        {isQuoteInfoStage ? (
          <Section
            title="Quote"
            action={
              <div className="flex items-center gap-3">
                <button onClick={() => setQuoteExpanded((v) => !v)} className="text-xs text-gray-500 font-medium">
                  {quoteExpanded ? "Collapse" : "Expand"}
                </button>
                <EditBtn onClick={() => openSheet("quote")} />
              </div>
            }
          >
            {job.quote?.c_total != null && (
              <div className="text-3xl font-bold text-green-600 mb-2">{fmtCurrency(job.quote.c_total)}</div>
            )}
            <div className="flex gap-2 mb-3 flex-wrap">
              {job.quote?.quoteNumber && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded font-medium">#{job.quote.quoteNumber}</span>}
              {job.quote?.date && <span className="text-xs text-gray-400">{fmt(job.quote.date)}</span>}
              {quoteSentAt && <span className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700 font-medium">Sent at {fmtDateTime(quoteSentAt)}</span>}
            </div>

            {quoteExpanded && (
              <>
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
              </>
            )}

            {/* Quote actions */}
            <div className="flex gap-2 mt-4 flex-wrap">
              {job.stage === "QUOTE" && (
                <button onClick={markAccepted} disabled={saving}
                  className="flex-1 bg-green-600 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50">
                  ✓ Mark Accepted
                </button>
              )}
              <button onClick={openSendQuoteSheet} disabled={saving}
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


        {isQuoteInfoStage && (
          <Section title="EBA">
            <div className="mb-2 text-sm">
              <span className={`px-2 py-1 rounded-full text-xs font-semibold ${job.ebaForm?.clientApproved ? "bg-emerald-100 text-emerald-700" : job.ebaForm?.complete ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>
                {job.ebaForm?.clientApproved ? "Client Signed" : job.ebaForm?.complete ? "Finalised" : "Draft In Progress"}
              </span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={saveQuoteAndOpenEBA}
                disabled={saving || !!job.ebaForm?.clientApproved}
                className="flex-1 bg-white border border-gray-300 text-gray-700 text-sm font-semibold py-2.5 rounded-xl disabled:opacity-50"
              >
                🧾 {job.ebaForm?.clientApproved ? "EBA Signed" : job.ebaForm?.complete || job.ebaForm?.signature_assessor?.fileName ? "Edit EBA" : "Complete EBA"}
              </button>
            </div>
          </Section>
        )}

        {/* Notes */}
        <Section
          title="Notes"
          action={
            <div className="flex items-center gap-3">
              <button onClick={() => openSheet("addNote")} className="text-xs text-[#e85d04] font-medium">+ Add</button>
              <button onClick={() => { setFullNoteText(visibleJobNotes || ""); openSheet("editNote"); }} className="text-xs text-gray-500 font-medium">Edit</button>
            </div>
          }
        >
          {visibleJobNotes ? (
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{visibleJobNotes}</p>
          ) : (
            <p className="text-sm text-gray-400">No notes yet</p>
          )}
        </Section>

          </>
        )}

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

      {toast && (
        <div className="fixed z-[70] left-1/2 -translate-x-1/2 bottom-4 md:left-auto md:translate-x-0 md:right-4 md:bottom-5 w-[92vw] md:w-auto md:max-w-md">
          <div className={`rounded-xl shadow-lg border px-4 py-3 text-sm ${toast.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
            <div className="flex items-start justify-between gap-3">
              <span>{toast.text}</span>
              <button onClick={() => setToast(null)} className="text-xs opacity-70 hover:opacity-100">✕</button>
            </div>
          </div>
        </div>
      )}

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

      {/* Dead confirmation */}
      <BottomSheet open={sheet === "deadConfirm"} onClose={closeSheet} title="Mark as Dead">
        <p className="text-sm text-gray-600 mb-3">A note is required before confirming this action.</p>
        <textarea
          value={deadNoteText}
          onChange={(e) => setDeadNoteText(e.target.value)}
          placeholder="Why is this lead/quote dead?"
          rows={5}
          className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04] resize-none mb-4"
        />
        <div className="flex gap-2">
          <button onClick={closeSheet} className="flex-1 bg-gray-100 text-gray-700 font-semibold py-3 rounded-xl">Cancel</button>
          <button
            onClick={confirmDeadStatus}
            disabled={saving || !deadNoteText.trim()}
            className="flex-1 bg-red-600 text-white font-semibold py-3 rounded-xl disabled:opacity-50"
          >
            {saving ? "Saving..." : "Confirm Dead"}
          </button>
        </div>
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

      <BottomSheet open={sheet === "installPlanning"} onClose={closeSheet} title="Lock in status & planning notes">
        <div className="space-y-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Lock in status</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setInstallPlanningStatus("pencilled")}
                className={`py-3 rounded-xl text-sm font-semibold border ${installPlanningStatus === "pencilled" ? "bg-amber-50 text-amber-700 border-amber-300" : "bg-white text-gray-700 border-gray-200"}`}
              >
                Pencilled
              </button>
              <button
                onClick={() => setInstallPlanningStatus("confirmed")}
                className={`py-3 rounded-xl text-sm font-semibold border ${installPlanningStatus === "confirmed" ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-white text-gray-700 border-gray-200"}`}
              >
                Confirmed
              </button>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Planning notes</div>
            <textarea
              value={installPlanningNote}
              onChange={(e) => setInstallPlanningNote(e.target.value)}
              rows={6}
              placeholder="Flexible dates, unavailable days, tentative details, anything the team should know..."
              className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04] resize-none"
            />
          </div>

          <button onClick={saveInstallPlanning} disabled={saving}
            className="w-full bg-[#e85d04] text-white font-semibold py-3 rounded-xl disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
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

      <BottomSheet open={sheet === "installDate"} onClose={closeSheet} title="Installation Date">
        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-500 mb-3">Set or edit the planned installation date/time.</p>
            <input type="datetime-local" value={installDate} onChange={(e) => setInstallDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
            />
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Lock in status</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setInstallPlanningStatus("pencilled")}
                className={`py-3 rounded-xl text-sm font-semibold border ${installPlanningStatus === "pencilled" ? "bg-amber-50 text-amber-700 border-amber-300" : "bg-white text-gray-700 border-gray-200"}`}
              >
                Pencilled
              </button>
              <button
                onClick={() => setInstallPlanningStatus("confirmed")}
                className={`py-3 rounded-xl text-sm font-semibold border ${installPlanningStatus === "confirmed" ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-white text-gray-700 border-gray-200"}`}
              >
                Confirmed
              </button>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Planning notes</div>
            <textarea
              value={installPlanningNote}
              onChange={(e) => setInstallPlanningNote(e.target.value)}
              rows={5}
              placeholder="Flexible dates, unavailable days, tentative details, anything the team should know..."
              className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04] resize-none"
            />
          </div>

          <div className="flex gap-2">
            {job.installation?.installDate && (
              <button onClick={clearInstallDate} disabled={saving}
                className="bg-red-50 text-red-600 font-semibold py-3 px-4 rounded-xl disabled:opacity-50">
                Remove
              </button>
            )}
            <button onClick={closeSheet} className="flex-1 bg-gray-100 text-gray-700 font-semibold py-3 rounded-xl">Cancel</button>
            <button onClick={saveInstallDate} disabled={saving || !installDate}
              className="flex-1 bg-[#e85d04] text-white font-semibold py-3 rounded-xl disabled:opacity-50">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "consentNumber"} onClose={closeSheet} title="Consent Number">
        <p className="text-sm text-gray-500 mb-3">Store the consent/reference number for this job.</p>
        <input value={consentNumber} onChange={(e) => setConsentNumber(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
          placeholder="Enter consent number"
        />
        <div className="flex gap-2">
          <button onClick={closeSheet} className="flex-1 bg-gray-100 text-gray-700 font-semibold py-3 rounded-xl">Cancel</button>
          <button onClick={saveConsentNumber} disabled={saving}
            className="flex-1 bg-[#e85d04] text-white font-semibold py-3 rounded-xl disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "finalInvoiceConfirm"} onClose={closeSheet} title="Create Final Invoice in Xero">
        <div className="space-y-5">
          <div className="text-center space-y-2 text-gray-700">
            <div className="flex justify-center gap-3 text-base">
              <span className="text-gray-500">Contract Price:</span>
              <span className="font-semibold text-gray-900">{fmtCurrency(job.quote?.c_contractPrice)}</span>
            </div>
            <div className="flex justify-center gap-3 text-base">
              <span className="text-gray-500">Consent Fee:</span>
              <span className="font-semibold text-gray-900">{fmtCurrency(job.quote?.consentFee)}</span>
            </div>
            <div className="flex justify-center gap-3 text-base">
              <span className="text-gray-500">GST:</span>
              <span className="font-semibold text-gray-900">{fmtCurrency(job.quote?.c_gst)}</span>
            </div>
            <div className="flex justify-center gap-3 text-xl">
              <span className="text-gray-500">Total:</span>
              <span className="font-bold text-gray-900">= {fmtCurrency(job.quote?.c_total)}</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 text-lg">
            <span className="text-gray-500">Deposit:</span>
            <span className="font-semibold text-gray-900">{fmtCurrency(job.quote?.c_deposit)}</span>
            <span className={`text-xs font-semibold px-3 py-1 rounded-full ${job.depositInvoice?.xeroInvoiceId ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              {job.depositInvoice?.xeroInvoiceId ? "PAID" : "NOT IN XERO"}
            </span>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Manager adjustment (+ / -)</label>
            <input
              value={managerAdjustment}
              onChange={(e) => setManagerAdjustment(e.target.value)}
              inputMode="decimal"
              placeholder="Eg. 250 to increase, -150 to decrease"
              className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-4 text-xl font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
            />

            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700 space-y-1">
              <div className="flex items-center justify-between">
                <span>Base total</span>
                <span className="font-semibold">{fmtCurrency(job.quote?.c_total)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Manager adjustment</span>
                <span className="font-semibold">{fmtCurrency(safeManagerAdjustment)}</span>
              </div>
              <div className="flex items-center justify-between text-base">
                <span>Invoice total to create</span>
                <span className="font-bold">{fmtCurrency(Number(job.quote?.c_total || 0) + safeManagerAdjustment)}</span>
              </div>
            </div>

            {!managerAdjustmentValid && (
              <p className="text-xs text-red-600">Enter a valid number for manager adjustment.</p>
            )}
            <p className="text-xs text-gray-500">Leave adjustment blank for no change. This action creates the final invoice in Xero and keeps the job stage as {job.stage}.</p>
          </div>

          <div className="flex gap-2 mt-2">
            <button onClick={closeSheet} className="flex-1 bg-gray-100 text-gray-700 font-semibold py-3 rounded-xl">Cancel</button>
            <button onClick={createFinalInvoiceInXero} disabled={creatingFinalInvoice || !managerAdjustmentValid}
              className="flex-1 bg-[#e85d04] text-white font-semibold py-3 rounded-xl disabled:opacity-50">
              {creatingFinalInvoice ? "Creating..." : "Create final invoice"}
            </button>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "markCompletedConfirm"} onClose={closeSheet} title="Mark as Completed">
        <div className="space-y-3 text-sm text-gray-600">
          <p>This will move the job to <span className="font-semibold text-gray-900">Completed</span>.</p>
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 space-y-1">
            <div><span className="font-semibold text-gray-800">Job:</span> #{job.jobNumber}</div>
            <div><span className="font-semibold text-gray-800">Current stage:</span> {job.stage}</div>
            <div><span className="font-semibold text-gray-800">Install date:</span> {fmtDateTime(job.installation?.installDate) || "Not set"}</div>
            <div><span className="font-semibold text-gray-800">Final invoice:</span> {job.finalInvoice?.xeroInvoiceNumber || "Not in Xero"}</div>
            <div><span className="font-semibold text-gray-800">Completion pack:</span> {job.certificateSentAt ? `Sent ${fmtDateTime(job.certificateSentAt)}` : "Not sent"}</div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={closeSheet} className="flex-1 bg-gray-100 text-gray-700 font-semibold py-3 rounded-xl">Cancel</button>
          <button onClick={markJobCompleted} disabled={saving}
            className="flex-1 bg-[#e85d04] text-white font-semibold py-3 rounded-xl disabled:opacity-50">
            {saving ? "Completing..." : "Mark completed"}
          </button>
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "sendQuoteConfirm"} onClose={closeSheet} title="Send Quote">
        <p className="text-sm text-gray-600 mb-3">Review and edit the email before sending.</p>
        <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-700 mb-3 space-y-1">
          <p><span className="text-gray-500">Quote #:</span> {quoteForm.quoteNumber || "-"}</p>
          <p><span className="text-gray-500">Quote Date:</span> {quoteForm.date ? fmt(fromDatetimeLocal(quoteForm.date) || "") : "-"}</p>
          <p><span className="text-gray-500">Customer Email:</span> {job.client?.contactDetails?.email || "-"}</p>
        </div>

        <div className="border border-gray-200 rounded-xl p-3 mb-3 bg-white">
          <div className="flex items-center gap-2 mb-2">
            <button type="button" onClick={() => applyEmailFormat("bold")} className="px-2 py-1 text-xs border border-gray-200 rounded">B</button>
            <button type="button" onClick={() => applyEmailFormat("italic")} className="px-2 py-1 text-xs border border-gray-200 rounded italic">I</button>
            <button type="button" onClick={() => applyEmailFormat("insertUnorderedList")} className="px-2 py-1 text-xs border border-gray-200 rounded">• List</button>
            <button type="button" onClick={() => applyEmailFormat("insertOrderedList")} className="px-2 py-1 text-xs border border-gray-200 rounded">1. List</button>
          </div>
          {loadingQuoteEmailBody ? (
            <div className="text-sm text-gray-500 py-6 text-center">Loading email template...</div>
          ) : (
            <div
              ref={quoteEmailEditorRef}
              contentEditable
              suppressContentEditableWarning
              className="min-h-[180px] max-h-[320px] overflow-auto border border-gray-200 rounded-lg p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
            />
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={closeSheet} className="flex-1 bg-gray-100 text-gray-700 font-semibold py-2.5 rounded-xl">Cancel</button>
          <button
            onClick={() => {
              const html = quoteEmailEditorRef.current?.innerHTML || quoteEmailBody;
              closeSheet();
              sendQuoteToCustomerConfirmed(html);
            }}
            disabled={saving || loadingQuoteEmailBody}
            className="flex-1 bg-indigo-600 text-white font-semibold py-2.5 rounded-xl disabled:opacity-50"
          >
            {saving ? "Sending..." : "Send Quote"}
          </button>
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
              <input type="number" value={quoteForm.depositPercentage} onChange={(e) => setQuoteForm((f) => ({ ...f, depositPercentage: e.target.value, depositManual: "" }))}
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
              <input type="number" value={quoteForm.totalManual} onChange={(e) => setQuoteForm((f) => ({ ...f, totalManual: e.target.value, depositManual: "" }))}
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
              <button onClick={() => saveQuote(false)} disabled={saving}
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
