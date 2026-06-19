"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { gql } from "@/lib/graphql";
import { JOBS_QUERY, USERS_QUERY } from "@/lib/queries";

type Campaign = {
  id: string;
  name: string;
  channel: "email" | "sms";
  status: "draft" | "pending" | "sending" | "sent" | "failed" | "halted";
  recipientCount: number;
  templateId?: string;
  testSentAt?: string | null;
};

type SavedRecipient = {
  id: string;
  jobId: string;
  jobNumber: number;
  contactName: string;
  destination: string;
  address: string;
  salespersonName: string;
  jobStage: string;
  quoteDate?: string | null;
};

type User = {
  _id: string;
  firstname: string;
  lastname: string;
  role?: string;
};

type ContactDetails = {
  name?: string;
  email?: string;
  phoneMobile?: string;
  streetAddress?: string;
  suburb?: string;
  city?: string;
  postCode?: string;
};

type Job = {
  _id: string;
  jobNumber: number;
  stage: string;
  createdAt?: string;
  updatedAt: string;
  archivedAt?: string;
  lead?: {
    leadStatus?: string;
    allocatedTo?: { _id: string; firstname: string; lastname: string };
    callbackDate?: string;
    quoteBookingDate?: string;
  };
  quote?: {
    date?: string;
    status?: string;
    deferralDate?: string;
  };
  client?: {
    contactDetails?: ContactDetails;
  };
};

type JobsData = {
  jobs: {
    results: Job[];
  };
};

const JOB_STAGES = [
  { value: "ALL", label: "All statuses" },
  { value: "LEAD", label: "Lead" },
  { value: "QUOTE", label: "Quote" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "INSTALLATION", label: "Installation" },
  { value: "INVOICE", label: "Invoice" },
];

const FETCH_STAGES = ["LEAD", "QUOTE", "SCHEDULED", "INSTALLATION", "INVOICE"];

const LEAD_STATUS_OPTIONS = [
  { value: "ALL", label: "All lead statuses" },
  { value: "NEW", label: "New" },
  { value: "CALLBACK", label: "Callback" },
  { value: "QUOTE_BOOKED", label: "Quote booked" },
  { value: "DEAD", label: "Dead" },
];

const QUOTE_STATUS_OPTIONS = [
  { value: "ALL", label: "All quote statuses" },
  { value: "OPEN", label: "Open" },
  { value: "CALLBACK", label: "Callback" },
  { value: "DEAD", label: "Dead" },
];

function getToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("token") || "";
}

function fullName(user?: { firstname?: string; lastname?: string }) {
  return [user?.firstname, user?.lastname].filter(Boolean).join(" ").trim();
}

function fullAddress(contact?: ContactDetails) {
  if (!contact) return "";
  return [contact.streetAddress, contact.suburb, contact.city, contact.postCode].filter(Boolean).join(", ");
}

function formatDate(value?: string | null) {
  if (!value) return "No quote date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No quote date";
  return date.toLocaleDateString("en-NZ", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function destinationFor(job: Job, channel: Campaign["channel"]) {
  const contact = job.client?.contactDetails;
  return channel === "email" ? contact?.email?.trim() || "" : contact?.phoneMobile?.trim() || "";
}

function normalizeDestination(destination: string, channel: Campaign["channel"]) {
  const value = destination.trim().toLowerCase();
  if (channel === "email") return value;
  return value.replace(/[\s().-]/g, "");
}

function duplicateDestinationKeys(recipients: SavedRecipient[], channel: Campaign["channel"]) {
  const counts = new Map<string, number>();
  for (const recipient of recipients) {
    const key = normalizeDestination(recipient.destination, channel);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function isCallbackLead(job: Job) {
  return ["CALLBACK", "ON_HOLD"].includes((job.lead?.leadStatus || "").toUpperCase());
}

function isQuoteBooked(job: Job) {
  return Boolean(job.lead?.quoteBookingDate);
}

function leadAudienceStatus(job: Job) {
  if (isQuoteBooked(job)) return "QUOTE_BOOKED";
  const status = (job.lead?.leadStatus || "NEW").toUpperCase();
  if (status === "ON_HOLD") return "CALLBACK";
  return status;
}

function quoteAudienceStatus(job: Job) {
  const quoteStatus = (job.quote?.status || "").toUpperCase();
  if (quoteStatus === "DEFERRED" || isCallbackLead(job) || job.lead?.callbackDate) return "CALLBACK";
  if (quoteStatus === "DECLINED" || (job.lead?.leadStatus || "").toUpperCase() === "DEAD") return "DEAD";
  return "OPEN";
}

function toRecipientInput(job: Job, channel: Campaign["channel"]) {
  const contact = job.client?.contactDetails;
  return {
    jobId: job._id,
    jobNumber: job.jobNumber,
    contactName: contact?.name || "",
    destination: destinationFor(job, channel),
    address: fullAddress(contact),
    salespersonName: fullName(job.lead?.allocatedTo) || "Unallocated",
    jobStage: job.stage,
    quoteDate: job.quote?.date || null,
  };
}

export default function CampaignDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [savedRecipients, setSavedRecipients] = useState<SavedRecipient[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [subStatusFilter, setSubStatusFilter] = useState("ALL");
  const [salespersonFilter, setSalespersonFilter] = useState("ALL");
  const [quoteFrom, setQuoteFrom] = useState("");
  const [quoteTo, setQuoteTo] = useState("");
  const [appliedJobs, setAppliedJobs] = useState<Job[]>([]);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [hasApplied, setHasApplied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadCampaign = useCallback(async () => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load campaign");
      setCampaign(json.campaign);
      setSavedRecipients(json.recipients || []);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to load campaign" });
    } finally {
      setLoading(false);
    }
  }, [campaignId, router]);

  const loadJobs = useCallback(async () => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setJobsLoading(true);
    try {
      const [jobsData, usersData] = await Promise.all([
        gql<JobsData>(JOBS_QUERY, {
          stages: FETCH_STAGES,
          skip: 0,
          limit: 5000,
        }, {
          cacheKey: "campaigns:audience-jobs",
          ttlMs: 2 * 60 * 1000,
        }),
        gql<{ users: { results: User[] } }>(USERS_QUERY, undefined, {
          cacheKey: "users",
          ttlMs: 30 * 60 * 1000,
        }),
      ]);
      setJobs((jobsData.jobs?.results || []).filter((job) => !job.archivedAt));
      setUsers((usersData.users?.results || []).filter((user) => (user.role || "").toUpperCase() !== "INSTALLER"));
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to load jobs" });
    } finally {
      setJobsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadCampaign();
    loadJobs();
  }, [loadCampaign, loadJobs]);

  const salespersonOptions = useMemo(() => {
    const jobUserIds = new Set(jobs.map((job) => job.lead?.allocatedTo?._id).filter(Boolean));
    const options = users
      .filter((user) => jobUserIds.has(user._id))
      .map((user) => ({ id: user._id, label: fullName(user) || "Unnamed" }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return options;
  }, [jobs, users]);

  const filteredJobs = useMemo(() => (
    jobs.filter((job) => {
      if (statusFilter !== "ALL" && job.stage !== statusFilter) return false;
      if (statusFilter === "LEAD" && subStatusFilter !== "ALL" && leadAudienceStatus(job) !== subStatusFilter) return false;
      if (statusFilter === "QUOTE" && subStatusFilter !== "ALL" && quoteAudienceStatus(job) !== subStatusFilter) return false;
      if (salespersonFilter === "UNALLOCATED" && job.lead?.allocatedTo?._id) return false;
      if (salespersonFilter !== "ALL" && salespersonFilter !== "UNALLOCATED" && job.lead?.allocatedTo?._id !== salespersonFilter) return false;

      const quoteDate = job.quote?.date ? job.quote.date.slice(0, 10) : "";
      if (quoteFrom && (!quoteDate || quoteDate < quoteFrom)) return false;
      if (quoteTo && (!quoteDate || quoteDate > quoteTo)) return false;
      return true;
    })
  ), [jobs, quoteFrom, quoteTo, salespersonFilter, statusFilter, subStatusFilter]);

  const savedJobIds = useMemo(() => (
    new Set(savedRecipients.map((recipient) => recipient.jobId))
  ), [savedRecipients]);

  const duplicateKeys = useMemo(() => (
    campaign ? duplicateDestinationKeys(savedRecipients, campaign.channel) : new Set<string>()
  ), [campaign, savedRecipients]);

  const duplicateRecipientCount = useMemo(() => (
    campaign
      ? savedRecipients.filter((recipient) => duplicateKeys.has(normalizeDestination(recipient.destination, campaign.channel))).length
      : 0
  ), [campaign, duplicateKeys, savedRecipients]);

  const validAppliedJobs = useMemo(() => (
    campaign ? appliedJobs.filter((job) => Boolean(destinationFor(job, campaign.channel))) : []
  ), [appliedJobs, campaign]);

  const missingContactCount = appliedJobs.length - validAppliedJobs.length;

  const selectedJobs = useMemo(() => (
    validAppliedJobs.filter((job) => selectedJobIds.has(job._id))
  ), [selectedJobIds, validAppliedJobs]);

  const selectedNewJobs = useMemo(() => (
    selectedJobs.filter((job) => !savedJobIds.has(job._id))
  ), [savedJobIds, selectedJobs]);

  function applyFilters() {
    if (!campaign) return;
    const nextJobs = [...filteredJobs].sort((a, b) => {
      const aName = a.client?.contactDetails?.name || "";
      const bName = b.client?.contactDetails?.name || "";
      return aName.localeCompare(bName) || a.jobNumber - b.jobNumber;
    });
    setAppliedJobs(nextJobs);
    setSelectedJobIds(new Set(nextJobs.filter((job) => destinationFor(job, campaign.channel)).map((job) => job._id)));
    setHasApplied(true);
    setMessage(null);
  }

  function toggleJob(jobId: string) {
    setSelectedJobIds((current) => {
      const next = new Set(current);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  function deselectAllJobs() {
    setSelectedJobIds(new Set());
  }

  async function addSelectedToAudience() {
    if (!campaign) return;
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-access-token": token,
        },
        body: JSON.stringify({
          mode: "add",
          recipients: selectedJobs.map((job) => toRecipientInput(job, campaign.channel)),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to save audience");
      setCampaign(json.campaign);
      setSavedRecipients(json.recipients || []);
      setMessage({ type: "success", text: `${selectedNewJobs.length} new recipient${selectedNewJobs.length === 1 ? "" : "s"} added to the audience.` });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save audience" });
    } finally {
      setSaving(false);
    }
  }

  if (loading && !campaign) {
    return (
      <main className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
        <div className="px-4 py-10 text-center text-sm text-gray-500">Loading campaign...</div>
      </main>
    );
  }

  if (!campaign) {
    return (
      <main className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
        <div className="mx-auto max-w-3xl px-4 py-5">
          <Link href={`/jobs/campaigns/${campaignId}`} className="text-sm font-semibold text-[#c2410c]">Back to Builder</Link>
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {message?.text || "Campaign could not be loaded."}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
      <div className="mx-auto max-w-6xl px-4 py-5">
        <div className="mb-5">
          <Link href={`/jobs/campaigns/${campaign.id}`} className="text-sm font-semibold text-[#c2410c]">
            Back to Builder
          </Link>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Build Audience</h1>
              <p className="mt-1 text-sm text-gray-600">
                {campaign.name} · {campaign.channel === "sms" ? "SMS" : "Email"} campaign
              </p>
            </div>
            <span className="rounded-lg bg-orange-50 px-3 py-2 text-sm font-semibold text-[#c2410c]">
              {campaign.recipientCount} saved recipients
            </span>
          </div>
        </div>

        {message && (
          <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${message.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
            {message.text}
          </div>
        )}

        <section className="mb-5 rounded-lg border border-[#1a3a4a]/15 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Saved audience</h2>
              <p className="mt-1 text-sm text-gray-600">
                {savedRecipients.length} recipient{savedRecipients.length === 1 ? "" : "s"} currently saved for this campaign. Open the full list to search and remove people manually.
              </p>
              {duplicateRecipientCount > 0 && (
                <p className="mt-2 text-sm font-semibold text-rose-700">
                  {duplicateRecipientCount} recipient{duplicateRecipientCount === 1 ? "" : "s"} share duplicate {campaign.channel === "sms" ? "phone numbers" : "email addresses"}. Later campaign steps are blocked until this is fixed.
                </p>
              )}
            </div>
            <Link
              href={`/jobs/campaigns/${campaign.id}/audience`}
              className={`rounded-lg px-4 py-2.5 text-sm font-semibold text-white ${duplicateRecipientCount > 0 ? "bg-rose-600" : "bg-[#1a3a4a]"}`}
            >
              {duplicateRecipientCount > 0 ? "Resolve Duplicates" : "Review Audience"}
            </Link>
          </div>
        </section>

        <section className="mb-5 rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Audience filters</h2>
          </div>
          <div className="grid gap-4 p-4 md:grid-cols-4">
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Status</span>
              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  setSubStatusFilter("ALL");
                }}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900"
              >
                {JOB_STAGES.map((stage) => (
                  <option key={stage.value} value={stage.value}>{stage.label}</option>
                ))}
              </select>
            </label>
            {(statusFilter === "LEAD" || statusFilter === "QUOTE") && (
              <label className="block">
                <span className="text-xs font-semibold text-gray-600">
                  {statusFilter === "LEAD" ? "Lead status" : "Quote status"}
                </span>
                <select
                  value={subStatusFilter}
                  onChange={(event) => setSubStatusFilter(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900"
                >
                  {(statusFilter === "LEAD" ? LEAD_STATUS_OPTIONS : QUOTE_STATUS_OPTIONS).map((status) => (
                    <option key={status.value} value={status.value}>{status.label}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Salesperson</span>
              <select
                value={salespersonFilter}
                onChange={(event) => setSalespersonFilter(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900"
              >
                <option value="ALL">All salespeople</option>
                <option value="UNALLOCATED">Unallocated</option>
                {salespersonOptions.map((salesperson) => (
                  <option key={salesperson.id} value={salesperson.id}>{salesperson.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Quote date from</span>
              <input
                type="date"
                value={quoteFrom}
                onChange={(event) => setQuoteFrom(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Quote date to</span>
              <input
                type="date"
                value={quoteTo}
                onChange={(event) => setQuoteTo(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3">
            <div className="text-xs text-gray-500">
              {jobsLoading ? "Loading jobs..." : `${filteredJobs.length} jobs match the current filters.`}
            </div>
            <button
              type="button"
              onClick={applyFilters}
              disabled={jobsLoading}
              className="rounded-lg bg-[#e85d04] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              Apply Filters
            </button>
          </div>
        </section>

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Current results</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{appliedJobs.length}</div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Selected to add</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{selectedJobs.length}</div>
          </div>
        </div>
        <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
          duplicateRecipientCount > 0
            ? "border-rose-200 bg-rose-50 text-rose-800"
            : savedRecipients.length > 0
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-gray-200 bg-white text-gray-600"
        }`}>
          {duplicateRecipientCount > 0
            ? "Audience status: blocked. Resolve duplicate contact details before returning to the builder."
            : savedRecipients.length > 0
              ? "Audience status: ready. Return to the builder when you are done adding recipients."
              : "Audience status: no saved recipients yet. Add selected results to build the campaign audience."}
        </div>
        {hasApplied && missingContactCount > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {missingContactCount} matched job{missingContactCount === 1 ? "" : "s"} missing {campaign.channel === "sms" ? "a mobile number" : "an email address"} and cannot be added.
          </div>
        )}

        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Audience results</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={deselectAllJobs}
                disabled={selectedJobs.length === 0}
                className="rounded-lg bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Deselect All
              </button>
              <button
                type="button"
                onClick={addSelectedToAudience}
                disabled={saving || selectedJobs.length === 0}
                className="rounded-lg bg-[#1a3a4a] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {saving ? "Adding..." : "Add Selected to Audience"}
              </button>
            </div>
          </div>

          {validAppliedJobs.length ? (
            <div className="divide-y divide-gray-100">
              {validAppliedJobs.map((job) => {
                const contact = job.client?.contactDetails;
                const selected = selectedJobIds.has(job._id);
                return (
                  <label key={job._id} className="grid cursor-pointer gap-3 px-4 py-3 hover:bg-gray-50 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleJob(job._id)}
                      className="mt-1 h-5 w-5 rounded border-gray-300 text-[#e85d04] sm:mt-0"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">{contact?.name || "Unknown customer"}</span>
                        <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">Job #{job.jobNumber}</span>
                        <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{job.stage}</span>
                        {savedJobIds.has(job._id) && (
                          <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">Already in audience</span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">{fullAddress(contact) || "No address"}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        {campaign.channel === "sms" ? "Phone" : "Email"}: {destinationFor(job, campaign.channel)}
                      </div>
                    </div>
                    <div className="text-left text-xs text-gray-500 sm:text-right">
                      <div>{fullName(job.lead?.allocatedTo) || "Unallocated"}</div>
                      <div>Quote: {formatDate(job.quote?.date)}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="p-5 text-center">
              <div className="text-sm font-semibold text-gray-900">No selectable recipients yet</div>
              <p className="mx-auto mt-1 max-w-md text-sm text-gray-600">
                Apply filters to generate job results. Jobs missing a {campaign.channel === "sms" ? "mobile number" : "email address"} are excluded from the selectable audience.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
