import Link from "next/link";

interface Job {
  _id: string;
  jobNumber: number;
  stage: string;
  updatedAt: string;
  lead?: {
    leadStatus?: string;
    allocatedTo?: { _id: string; firstname: string; lastname: string };
    callbackDate?: string;
  };
  quote?: {
    quoteNumber?: string;
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

function formatDate(iso: string) {
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

export default function JobCard({ job }: { job: Job }) {
  const c = job.client?.contactDetails;
  const addressParts = [c?.streetAddress, c?.suburb, c?.city]
    .filter(Boolean)
    .join(", ");

  return (
    <Link href={`/jobs/${job._id}`}>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3 active:bg-gray-50 transition-colors cursor-pointer">
        {/* Name + stage badge */}
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="font-semibold text-gray-900 text-base leading-tight">
            {c?.name || "Unknown"}
          </p>
          <span
            className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
              STAGE_BADGE[job.stage] || "bg-gray-100 text-gray-600"
            }`}
          >
            {STAGE_LABEL[job.stage] || job.stage}
          </span>
        </div>

        {/* Address */}
        {addressParts && (
          <p className="text-sm text-gray-500 mb-1">{addressParts}</p>
        )}

        {/* Phone | Email */}
        {(c?.phoneMobile || c?.email) && (
          <p className="text-sm text-gray-400 mb-2">
            {[c?.phoneMobile, c?.email].filter(Boolean).join(" | ")}
          </p>
        )}

        {/* Job # + Quote info */}
        <div className="flex flex-wrap gap-2 mb-2">
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
            Job #{job.jobNumber}
          </span>
          {job.quote?.quoteNumber && (
            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-medium">
              #{job.quote.quoteNumber}{" "}
              {job.quote.c_total ? formatCurrency(job.quote.c_total) : ""}
            </span>
          )}
        </div>

        {/* Salesperson + date */}
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>{job.lead?.allocatedTo ? `${job.lead.allocatedTo.firstname} ${job.lead.allocatedTo.lastname}` : "Unallocated"}</span>
          <span>{formatDate(job.updatedAt)}</span>
        </div>

        {/* Callback date for leads */}
        {job.lead?.callbackDate && (
          <div className="mt-1.5 text-xs text-orange-600 font-medium">
            Callback: {formatDate(job.lead.callbackDate)}
          </div>
        )}
      </div>
    </Link>
  );
}
