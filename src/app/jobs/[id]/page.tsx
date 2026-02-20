"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { gql } from "@/lib/graphql";
import { JOB_QUERY } from "@/lib/queries";
import PipelineBreadcrumb from "@/components/PipelineBreadcrumb";

interface ContactDetails {
  name?: string;
  email?: string;
  mobilePhone?: string;
  phone?: string;
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
    status?: string;
    sources?: string[];
    allocatedTo?: { _id: string; name: string };
    callbackDate?: string;
    quoteBooking?: string;
  };
  quote?: {
    quoteNumber?: string;
    quoteDate?: string;
    c_total?: number;
    c_deposit?: number;
    depositPercentage?: number;
    consentFee?: number;
    quoteComments?: string;
    wallInsulation?: boolean;
    wallSQMPrice?: number;
    wallSQM?: number;
    wallCavityDepth?: number;
    wallRValue?: number;
    wallBags?: number;
    ceilingInsulation?: boolean;
    ceilingSQMPrice?: number;
    ceilingSQM?: number;
    ceilingRValue?: number;
    ceilingDownlights?: number;
    ceilingBags?: number;
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

function formatCurrency(n?: number) {
  if (!n && n !== 0) return "-";
  return `$${n.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_BADGE: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-700",
  CALLBACK: "bg-orange-100 text-orange-700",
  DEAD: "bg-red-100 text-red-700",
};

function InfoRow({ label, value }: { label: string; value?: string }) {
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
        <div className="bg-[#1a3a4a] px-4 py-4">
          <div className="h-6 bg-teal-700 rounded w-1/3 animate-pulse" />
        </div>
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
  const addressParts = [c?.streetAddress, c?.suburb, c?.city, c?.postCode].filter(Boolean).join(", ");
  const phone = c?.mobilePhone || c?.phone;
  const status = job.lead?.status || "NEW";

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-8">
      {/* Header */}
      <div className="bg-[#1a3a4a] px-4 pt-3 pb-4">
        <button
          onClick={() => router.back()}
          className="text-gray-300 hover:text-white text-sm mb-2 flex items-center gap-1"
        >
          ← Back
        </button>
        <h1 className="text-white font-bold text-lg leading-tight">{c?.name || "Unknown"}</h1>
        {addressParts && <p className="text-gray-300 text-sm mt-0.5">{addressParts}</p>}
        <div className="mt-2">
          <PipelineBreadcrumb currentStage={job.stage} />
        </div>
      </div>

      <div className="px-4 pt-4">
        {/* Quick contact actions */}
        <div className="flex gap-3 mb-4">
          {phone && (
            <a
              href={`tel:${phone}`}
              className="flex-1 bg-[#e85d04] text-white font-semibold py-3 rounded-xl text-center text-sm active:bg-[#d45403] transition-colors"
            >
              📞 Call
            </a>
          )}
          {c?.email && (
            <a
              href={`mailto:${c.email}`}
              className="flex-1 bg-[#1a3a4a] text-white font-semibold py-3 rounded-xl text-center text-sm active:bg-[#142e3e] transition-colors"
            >
              ✉️ Email
            </a>
          )}
        </div>

        {/* Status + job info */}
        <Section title="Job Info">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded font-medium">
              Job #{job.jobNumber}
            </span>
            {status && (
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_BADGE[status] || "bg-gray-100 text-gray-600"}`}>
                {status.charAt(0) + status.slice(1).toLowerCase()}
              </span>
            )}
          </div>
          <InfoRow label="Salesperson" value={job.lead?.allocatedTo?.name || "Unallocated"} />
          <InfoRow label="Updated" value={formatDate(job.updatedAt)} />
          {job.lead?.callbackDate && (
            <InfoRow label="Callback Date" value={formatDate(job.lead.callbackDate)} />
          )}
          {job.lead?.quoteBooking && (
            <InfoRow label="Quote Booking" value={formatDate(job.lead.quoteBooking)} />
          )}
        </Section>

        {/* Contact details */}
        <Section title="Contact">
          <InfoRow label="Name" value={c?.name} />
          <InfoRow label="Mobile" value={c?.mobilePhone} />
          {c?.phone && c?.phone !== c?.mobilePhone && (
            <InfoRow label="Phone" value={c.phone} />
          )}
          <InfoRow label="Email" value={c?.email} />
          <InfoRow label="Address" value={addressParts} />
        </Section>

        {/* Lead sources */}
        {job.lead?.sources && job.lead.sources.length > 0 && (
          <Section title="Lead Source">
            <div className="flex flex-wrap gap-2">
              {job.lead.sources.map((s) => (
                <span
                  key={s}
                  className="text-xs bg-teal-50 text-teal-700 px-3 py-1 rounded-full font-medium"
                >
                  {s}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* Quote details (if in quote stage) */}
        {job.stage === "QUOTE" && job.quote && (
          <>
            <Section title="Quote">
              <div className="mb-3">
                {job.quote.c_total && (
                  <div className="text-3xl font-bold text-green-600 mb-1">
                    {formatCurrency(job.quote.c_total)}
                  </div>
                )}
                {job.quote.quoteNumber && (
                  <p className="text-sm text-gray-500">Quote #{job.quote.quoteNumber}</p>
                )}
                {job.quote.quoteDate && (
                  <p className="text-sm text-gray-500">{formatDate(job.quote.quoteDate)}</p>
                )}
              </div>
              <InfoRow label="Consent Fee" value={job.quote.consentFee ? formatCurrency(job.quote.consentFee) : undefined} />
              <InfoRow label="Deposit" value={
                job.quote.depositPercentage
                  ? `${job.quote.depositPercentage}% — ${formatCurrency(job.quote.c_deposit)}`
                  : undefined
              } />
              {job.quote.quoteComments && (
                <div className="mt-2">
                  <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">Comments</span>
                  <p className="text-sm text-gray-700 mt-1">{job.quote.quoteComments}</p>
                </div>
              )}
            </Section>

            {job.quote.wallInsulation && (
              <Section title="Wall Insulation">
                <InfoRow label="SQM" value={job.quote.wallSQM ? `${job.quote.wallSQM} m²` : undefined} />
                <InfoRow label="Price" value={job.quote.wallSQMPrice ? `${formatCurrency(job.quote.wallSQMPrice)} / m²` : undefined} />
                <InfoRow label="Cavity Depth" value={job.quote.wallCavityDepth ? `${job.quote.wallCavityDepth} cm` : undefined} />
                <InfoRow label="R-Value" value={job.quote.wallRValue ? `R${job.quote.wallRValue}` : undefined} />
                <InfoRow label="Bags" value={job.quote.wallBags ? `${job.quote.wallBags} bags` : undefined} />
              </Section>
            )}

            {job.quote.ceilingInsulation && (
              <Section title="Ceiling Insulation">
                <InfoRow label="SQM" value={job.quote.ceilingSQM ? `${job.quote.ceilingSQM} m²` : undefined} />
                <InfoRow label="Price" value={job.quote.ceilingSQMPrice ? `${formatCurrency(job.quote.ceilingSQMPrice)} / m²` : undefined} />
                <InfoRow label="R-Value" value={job.quote.ceilingRValue ? `R${job.quote.ceilingRValue}` : undefined} />
                <InfoRow label="Downlights" value={job.quote.ceilingDownlights ? `${job.quote.ceilingDownlights}` : undefined} />
                <InfoRow label="Bags" value={job.quote.ceilingBags ? `${job.quote.ceilingBags} bags` : undefined} />
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
