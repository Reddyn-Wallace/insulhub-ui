import { useState } from "react";
import Link from "next/link";

interface Job {
  _id: string;
  jobNumber: number;
  stage: string;
  createdAt?: string;
  updatedAt: string;
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
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatCurrency(n?: number) {
  if (!n) return "";
  return `$${n.toLocaleString("en-NZ")}`;
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

  const [now] = useState(() => Date.now());
  const leadStatusRaw = (job.lead?.leadStatus || "NEW").toUpperCase();
  const leadStatus = leadStatusRaw === "ON_HOLD" ? "CALLBACK" : leadStatusRaw;
  const quoteStatus = (job.quote?.status || "UNSET").toUpperCase();
  const hasQuoteBooked = Boolean(job.lead?.quoteBookingDate);

  const quoteState = leadStatus === "DEAD" || quoteStatus === "DECLINED"
    ? "DEAD"
    : quoteStatus === "DEFERRED" || leadStatus === "CALLBACK"
      ? "CALLBACK"
      : "OPEN";

  const cardState = job.stage === "QUOTE"
    ? quoteState
    : hasQuoteBooked
      ? "QUOTE_BOOKED"
      : leadStatus;

  const cardStyle = STATUS_STYLE[cardState] || STATUS_STYLE.NEW;

  const callbackIso = job.stage === "QUOTE" ? (job.quote?.deferralDate || job.lead?.callbackDate) : job.lead?.callbackDate;
  const callbackTime = callbackIso ? new Date(callbackIso).getTime() : null;
  const isCallbackOverdue = (leadStatus === "CALLBACK" || quoteState === "CALLBACK") && Boolean(callbackTime && callbackTime < now);

  const isQuoteSent = Boolean(job.quote?.date && job.quote?.quoteNumber);

  return (
    <Link href={`/jobs/${job._id}`}>
      <div className={`bg-white rounded-xl shadow-sm border border-gray-100 border-l-4 ${cardStyle.border} p-4 mb-3 active:bg-gray-50 transition-colors cursor-pointer`}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="font-semibold text-gray-900 text-base leading-tight">{c?.name || "Unknown"}</p>
          <div className="flex items-center gap-1.5">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cardStyle.pill}`}>{cardStyle.label}</span>
            <span className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${STAGE_BADGE[job.stage] || "bg-gray-100 text-gray-600"}`}>{STAGE_LABEL[job.stage] || job.stage}</span>
          </div>
        </div>

        {addressParts && <p className="text-sm text-gray-500 mb-1">{addressParts}</p>}
        {(c?.phoneMobile || c?.email) && <p className="text-sm text-gray-400 mb-2">{[c?.phoneMobile, c?.email].filter(Boolean).join(" | ")}</p>}

        <div className="flex flex-wrap gap-2 mb-2">
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Job #{job.jobNumber}</span>
          {job.quote?.quoteNumber && <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-medium">#{job.quote.quoteNumber} {job.quote.c_total ? formatCurrency(job.quote.c_total) : ""}</span>}
          {job.stage === "QUOTE" && (
            <span className={`text-xs px-2 py-0.5 rounded ${isQuoteSent ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
              {isQuoteSent ? `Sent to customer${job.quote?.date ? ` • ${formatDate(job.quote.date)}` : ""}` : "Not sent to customer"}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>{job.lead?.allocatedTo ? `${job.lead.allocatedTo.firstname} ${job.lead.allocatedTo.lastname}` : "Unallocated"}</span>
          <span>{job.stage === "QUOTE" ? `Quote: ${formatDate(job.quote?.date) || "Undated"}` : `Created: ${formatDate(job.createdAt || job.updatedAt)}`}</span>
        </div>

        <div className="mt-1.5 flex flex-wrap gap-3 text-xs font-medium">
          {callbackIso && <span className={isCallbackOverdue ? "text-red-600" : "text-orange-600"}>{isCallbackOverdue ? "⚠️ " : ""}Callback: {formatDate(callbackIso)}</span>}
          {job.stage !== "QUOTE" && job.lead?.quoteBookingDate && <span className="text-indigo-600">Quote booked: {formatDate(job.lead.quoteBookingDate)}</span>}
        </div>
      </div>
    </Link>
  );
}
