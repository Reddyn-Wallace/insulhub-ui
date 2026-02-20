"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { gql } from "@/lib/graphql";
import { JOB_QUERY } from "@/lib/queries";
import PipelineBreadcrumb from "@/components/PipelineBreadcrumb";

interface ContactDetails {
  name?: string;
  email?: string;
  phoneMobile?: string;
  phoneSecondary?: string;
  streetAddress?: string;
  suburb?: string;
  city?: string;
  postCode?: string;
}

interface Job {
  _id: string;
  jobNumber: number;
  stage: string;
  notes?: string;
  updatedAt: string;
  lead?: {
    leadStatus?: string;
    leadSource?: string[];
    allocatedTo?: { _id: string; firstname: string; lastname: string };
    callbackDate?: string;
    quoteBookingDate?: string;
  };
  quote?: {
    quoteNumber?: string;
    date?: string;
    c_total?: number;
    c_deposit?: number;
    depositPercentage?: number;
    consentFee?: number;
    quoteNote?: string;
    wall?: {
      SQMPrice?: number;
      SQM?: number;
      c_RValue?: number;
      c_bagCount?: number;
    };
    ceiling?: {
      SQMPrice?: number;
      SQM?: number;
      RValue?: number;
      downlights?: number;
      c_bagCount?: number;
    };
  };
  client?: {
    contactDetails?: ContactDetails;
    billingDetails?: ContactDetails;
  };
}

interface JobData {
  job: Job;
}

function formatDate(iso?: string) {
  if (!iso) return "Not set";
  return new Date(iso).toLocaleDateString("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatCurrency(n?: number | null) {
  if (!n && n !== 0) return "-";
  return `$${n.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_BADGE: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-700",
  CALLBACK: "bg-orange-100 text-orange-700",
  DEAD: "bg-red-100 text-red-700",
};

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">{label}</span>
      <span className="text-sm text-gray-800 mt-0.5">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
      <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">{title}</h2>
      {children}
    </div>
  );
}

export default function JobDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { router.push("/login"); return; }

    async function fetchJob() {
      try {
        const data = await gql<JobData>(JOB_QUERY, { _id: id });
        setJob(data.job);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load job";
        if (msg !== "Unauthorized") setError(msg);
      } finally {
        setLoading(false);
      }
    }

    fetchJob();
  }, [id, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-[#1a3a4a] px-4 py-4 h-24 animate-pulse" />
        <div className="px-4 pt-4 space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-4 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/4 mb-3" />
              <div className="h-5 bg-gray-100 rounded w-3/4 mb-2" />
              <div className="h-4 bg-gray-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-[#1a3a4a] px-4 py-4">
          <button onClick={() => router.back()} className="text-white text-sm">← Back</button>
        </div>
        <div className="px-4 pt-4">
          <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">
            {error || "Job not found"}
          </div>
        </div>
      </div>
    );
  }

  const c = job.client?.contactDetails;
  const addressParts = [c?.streetAddress, c?.suburb, c?.city, c?.postCode]
    .filter(Boolean).join(", ");
  const phone = c?.phoneMobile || c?.phoneSecondary;
  const status = job.lead?.leadStatus || "NEW";
  const salesperson = job.lead?.allocatedTo
    ? `${job.lead.allocatedTo.firstname} ${job.lead.allocatedTo.lastname}`
    : "Unallocated";

  const hasWall = !!job.quote?.wall?.SQM;
  const hasCeiling = !!job.quote?.ceiling?.SQM;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-8">
      {/* Header */}
      <div className="bg-[#1a3a4a] px-4 pt-3 pb-2">
        <button
          onClick={() => router.back()}
          className="text-gray-300 hover:text-white text-sm mb-2 flex items-center gap-1"
        >
          ← Back
        </button>
        <h1 className="text-white font-bold text-lg leading-tight">{c?.name || "Unknown"}</h1>
        {addressParts && <p className="text-gray-300 text-sm mt-0.5">{addressParts}</p>}
        <div className="mt-2 -mx-4">
          <PipelineBreadcrumb currentStage={job.stage} />
        </div>
      </div>

      <div className="px-4 pt-4">
        {/* Quick contact actions */}
        <div className="flex gap-3 mb-4">
          {phone && (
            <a
              href={`tel:${phone}`}
              className="flex-1 bg-[#e85d04] text-white font-semibold py-3 rounded-xl text-center text-sm active:opacity-80 transition-opacity"
            >
              📞 Call
            </a>
          )}
          {c?.email && (
            <a
              href={`mailto:${c.email}`}
              className="flex-1 bg-[#1a3a4a] text-white font-semibold py-3 rounded-xl text-center text-sm active:opacity-80 transition-opacity"
            >
              ✉️ Email
            </a>
          )}
        </div>

        {/* Job info */}
        <Section title="Job Info">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded font-medium">
              Job #{job.jobNumber}
            </span>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_BADGE[status] || "bg-gray-100 text-gray-600"}`}>
              {status.charAt(0) + status.slice(1).toLowerCase()}
            </span>
          </div>
          <InfoRow label="Salesperson" value={salesperson} />
          <InfoRow label="Updated" value={formatDate(job.updatedAt)} />
          {job.lead?.callbackDate && (
            <InfoRow label="Callback Date" value={formatDate(job.lead.callbackDate)} />
          )}
          {job.lead?.quoteBookingDate && (
            <InfoRow label="Quote Booking" value={formatDate(job.lead.quoteBookingDate)} />
          )}
        </Section>

        {/* Contact details */}
        <Section title="Contact">
          <InfoRow label="Name" value={c?.name} />
          <InfoRow label="Mobile" value={c?.phoneMobile} />
          {c?.phoneSecondary && c.phoneSecondary !== c.phoneMobile && (
            <InfoRow label="Phone" value={c.phoneSecondary} />
          )}
          <InfoRow label="Email" value={c?.email} />
          {addressParts && <InfoRow label="Address" value={addressParts} />}
        </Section>

        {/* Lead sources */}
        {job.lead?.leadSource && job.lead.leadSource.length > 0 && (
          <Section title="Lead Source">
            <div className="flex flex-wrap gap-2">
              {job.lead.leadSource.map((s) => (
                <span key={s} className="text-xs bg-teal-50 text-teal-700 px-3 py-1 rounded-full font-medium">
                  {s}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* Quote details */}
        {job.stage === "QUOTE" && job.quote && (
          <>
            <Section title="Quote">
              {job.quote.c_total != null && (
                <div className="text-3xl font-bold text-green-600 mb-1">
                  {formatCurrency(job.quote.c_total)}
                </div>
              )}
              <div className="flex gap-2 mb-3 flex-wrap">
                {job.quote.quoteNumber && (
                  <span className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded font-medium">
                    #{job.quote.quoteNumber}
                  </span>
                )}
                {job.quote.date && (
                  <span className="text-xs text-gray-400">{formatDate(job.quote.date)}</span>
                )}
              </div>
              <InfoRow label="Consent Fee" value={job.quote.consentFee ? formatCurrency(job.quote.consentFee) : null} />
              <InfoRow
                label="Deposit"
                value={job.quote.depositPercentage
                  ? `${job.quote.depositPercentage}% — ${formatCurrency(job.quote.c_deposit)}`
                  : null}
              />
              {job.quote.quoteNote && (
                <div className="mt-2 pt-2 border-t border-gray-50">
                  <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">Comments</span>
                  <p className="text-sm text-gray-700 mt-1">{job.quote.quoteNote}</p>
                </div>
              )}
            </Section>

            {hasWall && (
              <Section title="Wall Insulation">
                <InfoRow label="SQM" value={job.quote.wall?.SQM ? `${job.quote.wall.SQM} m²` : null} />
                <InfoRow label="Price / m²" value={job.quote.wall?.SQMPrice ? formatCurrency(job.quote.wall.SQMPrice) : null} />
                <InfoRow label="R-Value" value={job.quote.wall?.c_RValue ? `R${job.quote.wall.c_RValue}` : null} />
                <InfoRow label="Bags" value={job.quote.wall?.c_bagCount ? `${job.quote.wall.c_bagCount} bags` : null} />
              </Section>
            )}

            {hasCeiling && (
              <Section title="Ceiling Insulation">
                <InfoRow label="SQM" value={job.quote.ceiling?.SQM ? `${job.quote.ceiling.SQM} m²` : null} />
                <InfoRow label="Price / m²" value={job.quote.ceiling?.SQMPrice ? formatCurrency(job.quote.ceiling.SQMPrice) : null} />
                <InfoRow label="R-Value" value={job.quote.ceiling?.RValue ? `R${job.quote.ceiling.RValue}` : null} />
                <InfoRow label="Downlights" value={job.quote.ceiling?.downlights ? `${job.quote.ceiling.downlights}` : null} />
                <InfoRow label="Bags" value={job.quote.ceiling?.c_bagCount ? `${job.quote.ceiling.c_bagCount} bags` : null} />
              </Section>
            )}
          </>
        )}

        {/* Notes */}
        {job.notes && (
          <Section title="Notes">
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{job.notes}</p>
          </Section>
        )}
      </div>
    </div>
  );
}
