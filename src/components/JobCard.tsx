import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

interface Job {
  _id: string;
  jobNumber: number;
  stage: string;
  createdAt?: string;
  updatedAt: string;
  installation?: {
    installDate?: string;
  };
  ebaForm?: {
    complete?: boolean;
    clientApproved?: boolean;
  };
  ebaLastSentAt?: string;
  council?: {
    files_Other?: string[];
    files_CouncilApprovalLetters?: string[];
  };
  finalInvoice?: {
    _id?: string;
    xeroInvoiceNumber?: string;
  } | null;
  certificateSentAt?: string;
  lead?: {
    leadStatus?: string;
    allocatedTo?: { _id: string; firstname: string; lastname: string };
    callbackDate?: string;
    quoteBookingDate?: string;
  };
  quote?: {
    quoteNumber?: string;
    date?: string;
    status?: string;
    deferralDate?: string;
    c_total?: number;
  };
  quoteLastSentAt?: string;
  client?: {
    contactDetails?: {
      name?: string;
      email?: string;
      phoneMobile?: string;
      streetAddress?: string;
      suburb?: string;
      city?: string;
      postCode?: string;
    };
  };
}

function formatDate(iso?: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatCurrency(n?: number) {
  if (!n) return "";
  return `$${n.toLocaleString("en-NZ")}`;
}

function formatDateTime(iso?: string | null) {
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

const STAGE_BADGE: Record<string, string> = {
  LEAD: "bg-orange-100 text-orange-700",
  QUOTE: "bg-blue-100 text-blue-700",
  SCHEDULED: "bg-green-100 text-green-700",
  INSTALLATION: "bg-purple-100 text-purple-700",
  INVOICE: "bg-yellow-100 text-yellow-700",
  COMPLETED: "bg-gray-100 text-gray-600",
};

const STAGE_LABEL: Record<string, string> = {
  LEAD: "Lead",
  QUOTE: "Quote",
  SCHEDULED: "Accepted",
  INSTALLATION: "Installation",
  INVOICE: "Invoice",
  COMPLETED: "Completed",
};

const STATUS_STYLE: Record<string, { pill: string; border: string; label: string }> = {
  NEW: { pill: "bg-sky-50 text-sky-700 border border-sky-100", border: "border-l-sky-300", label: "New" },
  CALLBACK: { pill: "bg-amber-50 text-amber-700 border border-amber-100", border: "border-l-amber-300", label: "Callback" },
  QUOTE_BOOKED: { pill: "bg-indigo-50 text-indigo-700 border border-indigo-100", border: "border-l-indigo-300", label: "Quote booked" },
  OPEN: { pill: "bg-sky-50 text-sky-700 border border-sky-100", border: "border-l-sky-300", label: "Open" },
  DEAD: { pill: "bg-rose-50 text-rose-700 border border-rose-100", border: "border-l-rose-300", label: "Dead" },
};

export default function JobCard({ job }: { job: Job }) {
  const c = job.client?.contactDetails;
  const addressParts = [c?.streetAddress, c?.suburb, c?.city].filter(Boolean).join(", ");
  const searchParams = useSearchParams();
  const returnTo = `/jobs${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
  const isJobsTab = searchParams.get("stage") === "JOBS";

  const [now] = useState(() => Date.now());
  const sentAt = job.quoteLastSentAt || null;

  const leadStatusRaw = (job.lead?.leadStatus || "NEW").toUpperCase();
  const leadStatus = leadStatusRaw === "ON_HOLD" ? "CALLBACK" : leadStatusRaw;
  const quoteStatus = (job.quote?.status || "UNSET").toUpperCase();
  const hasQuoteBooked = Boolean(job.lead?.quoteBookingDate);

  const quoteState = leadStatus === "DEAD" || quoteStatus === "DECLINED"
    ? "DEAD"
    : quoteStatus === "DEFERRED" || leadStatus === "CALLBACK"
      ? "CALLBACK"
      : "OPEN";

  const cardState = isJobsTab
    ? "OPEN"
    : job.stage === "QUOTE"
      ? quoteState
      : hasQuoteBooked
        ? "QUOTE_BOOKED"
        : leadStatus;

  const cardStyle = STATUS_STYLE[cardState] || STATUS_STYLE.NEW;
  const ebaStatus = job.ebaForm?.clientApproved
    ? "Signed"
    : job.ebaLastSentAt
      ? "Sent"
      : job.ebaForm?.complete
        ? "Assessed"
        : "Not started";
  const councilStatus = job.certificateSentAt
    ? "Sent to customer"
    : job.council?.files_CouncilApprovalLetters?.length
      ? "Approved"
      : job.council?.files_Other?.length
        ? "Submitted"
        : "Not started";
  const finalInvoiceStatus = job.finalInvoice?.xeroInvoiceNumber || job.finalInvoice?._id ? "Sent" : "Not sent";

  const workflowTone = {
    eba: job.ebaForm?.clientApproved
      ? "bg-emerald-100 text-emerald-700"
      : job.ebaLastSentAt
        ? "bg-blue-100 text-blue-700"
        : job.ebaForm?.complete
          ? "bg-amber-100 text-amber-700"
          : "bg-slate-100 text-slate-600",
    council: job.certificateSentAt
      ? "bg-emerald-100 text-emerald-700"
      : job.council?.files_CouncilApprovalLetters?.length
        ? "bg-blue-100 text-blue-700"
        : job.council?.files_Other?.length
          ? "bg-amber-100 text-amber-700"
          : "bg-slate-100 text-slate-600",
    invoice: job.finalInvoice?.xeroInvoiceNumber || job.finalInvoice?._id
      ? "bg-emerald-100 text-emerald-700"
      : "bg-slate-100 text-slate-600",
  };

  const callbackIso = (leadStatus === "CALLBACK" || quoteState === "CALLBACK")
    ? (job.stage === "QUOTE" ? (job.quote?.deferralDate || job.lead?.callbackDate) : job.lead?.callbackDate)
    : null;
  const callbackTime = callbackIso ? new Date(callbackIso).getTime() : null;
  const isCallbackOverdue = (leadStatus === "CALLBACK" || quoteState === "CALLBACK") && Boolean(callbackTime && callbackTime < now);
  const quoteBookingTime = job.lead?.quoteBookingDate ? new Date(job.lead.quoteBookingDate).getTime() : null;
  const isQuoteBookingOverdue = Boolean(quoteBookingTime && quoteBookingTime < now);

  return (
    <Link href={{ pathname: `/jobs/${job._id}`, query: returnTo ? { returnTo } : {} }}>
      <div className={`bg-white rounded-xl shadow-sm border border-gray-100 border-l-4 ${cardStyle.border} p-4 mb-3 active:bg-gray-50 transition-colors cursor-pointer`}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="font-semibold text-gray-900 text-base leading-tight">{c?.name || "Unknown"}</p>
          <div className="flex items-center gap-1.5" />
        </div>

        {addressParts && <p className="text-sm text-gray-500 mb-1">{addressParts}</p>}
        {(c?.phoneMobile || c?.email) && <p className="text-sm text-gray-400 mb-2">{[c?.phoneMobile, c?.email].filter(Boolean).join(" | ")}</p>}

        <div className="flex flex-wrap gap-2 mb-2">
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Job #{job.jobNumber}</span>
          {job.quote?.quoteNumber && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-medium">#{job.quote.quoteNumber} {job.quote.c_total ? formatCurrency(job.quote.c_total) : ""}</span>}
          {job.stage === "QUOTE" && sentAt && (
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">Sent at {formatDateTime(sentAt)}</span>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>{job.lead?.allocatedTo ? `${job.lead.allocatedTo.firstname} ${job.lead.allocatedTo.lastname}` : "Unallocated"}</span>
          <span>
            {isJobsTab
              ? `Installation: ${formatDate(job.installation?.installDate) || "Undated"}`
              : job.stage === "QUOTE"
                ? `Quote: ${formatDate(job.quote?.date) || "Undated"}`
                : `Created: ${formatDate(job.createdAt || job.updatedAt)}`}
          </span>
        </div>

        {isJobsTab && (
          <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-gray-600 bg-gray-50 rounded-xl px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-gray-500">EBA status</span>
              <span className={`font-semibold px-2 py-0.5 rounded-full ${workflowTone.eba}`}>{ebaStatus}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-gray-500">Council paperwork status</span>
              <span className={`font-semibold px-2 py-0.5 rounded-full ${workflowTone.council}`}>{councilStatus}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-gray-500">Final invoice</span>
              <span className={`font-semibold px-2 py-0.5 rounded-full ${workflowTone.invoice}`}>{finalInvoiceStatus}</span>
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
