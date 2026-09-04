"use client";

import Link from "next/link";
import {partnerJobReference as jobReference} from "@/lib/partner/job-reference";
import PartnerDeleteDraftButton from "./PartnerDeleteDraftButton";
import PartnerContactStatus from "./PartnerContactStatus";
import { useDeferredValue, useMemo, useState } from "react";
import { formatPartnerDate } from "@/lib/partner/date";
import type { PartnerJobView, PartnerSubmissionState } from "@/lib/partner/repository";

const FILTERS: Array<{ value: "ALL" | PartnerSubmissionState | "NEEDS_ATTENTION"; label: string }> = [
  { value: "ALL", label: "All jobs" }, { value: "DRAFT", label: "Drafts" },
  { value: "SUBMITTED", label: "Submitted" }, { value: "NEEDS_ATTENTION", label: "Needs attention" },
];

const STATUS: Record<PartnerSubmissionState, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-slate-100 text-slate-700" },
  QUEUED: { label: "Queued", className: "bg-blue-50 text-blue-800" },
  CREATING_LEAD: { label: "Creating lead", className: "bg-blue-50 text-blue-800" },
  UPDATING_QUOTE: { label: "Updating quote", className: "bg-blue-50 text-blue-800" },
  ATTACHING_PLANS: { label: "Attaching plans", className: "bg-blue-50 text-blue-800" },
  SUBMITTED: { label: "Submitted", className: "bg-emerald-50 text-emerald-800" },
  FAILED_RETRYABLE: { label: "Contact Insulmax", className: "bg-amber-50 text-amber-900" },
  RECONCILIATION_REQUIRED: { label: "Contact Insulmax", className: "bg-amber-50 text-amber-900" },
};


export function filterPartnerJobs(jobs: PartnerJobView[], search: string, filter: "ALL" | PartnerSubmissionState | "NEEDS_ATTENTION"): PartnerJobView[] {
  const query = search.trim().toLowerCase();
  return jobs.filter((job) => {
    const matchesSearch = !query || job.customerName.toLowerCase().includes(query) || job.clientReference.toLowerCase().includes(query) || jobReference(job).toLowerCase().includes(query) || String(job.legacyJobNumber ?? "").includes(query);
    const matchesFilter = filter === "ALL" || (filter === "NEEDS_ATTENTION" ? ["FAILED_RETRYABLE", "RECONCILIATION_REQUIRED"].includes(job.submissionState) : job.submissionState === filter);
    return matchesSearch && matchesFilter;
  });
}

function milestoneRows(job: PartnerJobView) {
  return [
    { label: "EBA", complete: job.linkedStatus ? job.linkedStatus.ebaCompleted : job.trackingFacts.includes("EBA_COMPLETED") },
    { label: "Install date", complete: job.linkedStatus ? Boolean(job.linkedStatus.installDate) : job.trackingFacts.includes("INSTALL_DATE_SET"), value: job.linkedStatus?.installDate ? formatPartnerDate(job.linkedStatus.installDate) : undefined },
    { label: "Job complete", complete: job.linkedStatus ? job.linkedStatus.jobCompleted : job.trackingFacts.includes("JOB_COMPLETED") },
  ];
}

function JobMilestones({ job }: { job: PartnerJobView }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label={`Milestones for ${jobReference(job)}`}>
      {milestoneRows(job).map((milestone) => (
        <li key={milestone.label} className="inline-flex items-center gap-1">
          <span className="font-medium text-gray-600">{milestone.label}</span>
          <span className={milestone.complete ? "text-emerald-700" : "text-gray-500"}><span aria-label={milestone.complete ? "Recorded" : "Awaiting update"}>{milestone.value ?? (milestone.complete ? "✓" : "—")}</span></span>
        </li>
      ))}
    </ul>
  );
}

function JobRow({ job, recoveryScope, onDeleted }: { job: PartnerJobView; recoveryScope: string; onDeleted: () => void }) {
  const status = STATUS[job.submissionState];
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:gap-6">
      <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{jobReference(job)}</p>
          <h2 className="truncate text-base font-bold text-[#1a3a4a]">{job.customerName || "Customer details pending"}</h2>
          <p className="mt-1 text-sm text-gray-600">{[job.siteAddress.street, job.siteAddress.suburb, job.siteAddress.city, job.siteAddress.postcode].map(part => part.trim()).filter(Boolean).join(", ") || "Site address pending"}</p>
        </div>
        {["FAILED_RETRYABLE", "RECONCILIATION_REQUIRED"].includes(job.submissionState) ? <PartnerContactStatus reference={job.clientReference} /> : <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span>}
      </div>
      <div className="lg:w-64 lg:shrink-0"><JobMilestones job={job} /></div>
      <div className="flex flex-wrap items-center gap-x-2 lg:w-64 lg:shrink-0">
        <div className="mr-auto text-xs leading-5 text-gray-500">
          {job.submittedAt ? <p>Submitted <time dateTime={job.submittedAt}>{formatPartnerDate(job.submittedAt)}</time></p> : null}
          <p>Last updated <time dateTime={job.updatedAt}>{formatPartnerDate(job.updatedAt)}</time></p>
        </div>
        {job.submissionState === "DRAFT" && <PartnerDeleteDraftButton jobId={job.id} revision={job.revision} reference={job.clientReference} recoveryScope={recoveryScope} onDeleted={onDeleted} />}
        {job.submissionState === "DRAFT" ? <Link href={`/partner/jobs/${job.id}`} className="inline-flex min-h-11 items-center rounded-lg bg-[#1a3a4a] px-3 py-2 text-sm font-semibold text-white hover:bg-[#122b37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e85d04] focus-visible:ring-offset-2">Edit draft</Link> : <Link href={`/partner/jobs/${job.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-[#1a3a4a] px-3 py-2 text-sm font-semibold text-[#1a3a4a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e85d04] focus-visible:ring-offset-2">View job</Link>}
      </div>
    </article>
  );
}

export default function PartnerDashboard({ jobs, companyName, errorMessage = "", recoveryScope = "", submitted = false }: { submitted?: boolean; jobs: PartnerJobView[]; companyName: string; errorMessage?: string; recoveryScope?: string }) {
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const remainingJobs = useMemo(() => jobs.filter(job => !deletedIds.has(job.id)), [jobs, deletedIds]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | PartnerSubmissionState | "NEEDS_ATTENTION">("ALL");
  const deferredSearch = useDeferredValue(search);
  const visibleJobs = useMemo(() => filterPartnerJobs(remainingJobs, deferredSearch, filter), [remainingJobs, deferredSearch, filter]);

  if (errorMessage) return <section role="alert" className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm"><h1 className="text-xl font-bold text-[#1a3a4a]">Jobs could not be loaded</h1><p className="mt-2 text-sm text-gray-600">{errorMessage}</p><button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-lg bg-[#1a3a4a] px-4 py-2 text-sm font-semibold text-white">Try again</button></section>;

  return (
    <div>
      {submitted ? <p role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">Quote submitted successfully.</p> : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#e85d04]">Partner dashboard</p><h1 className="mt-1 text-2xl font-bold text-[#1a3a4a] sm:text-3xl">{companyName} jobs</h1></div>
        <Link href="/partner/jobs/new" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#c04e03] px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#a84202] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e85d04] focus-visible:ring-offset-2">New quote / lead</Link>
      </div>


      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Job filters">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label className="grid gap-1.5 text-sm font-semibold text-gray-700">Search customer or reference<input value={search} onChange={(event) => setSearch(event.target.value)} type="search" maxLength={120} placeholder="Search jobs" className="min-h-11 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-base font-normal outline-none focus:border-transparent focus:ring-2 focus:ring-[#e85d04]" /></label>
          <div className="grid grid-cols-2 gap-2 md:flex" role="group" aria-label="Submission state">
            {FILTERS.map((option) => <button key={option.value} type="button" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)} className={`rounded-full border px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e85d04] ${filter === option.value ? "border-[#1a3a4a] bg-[#1a3a4a] text-white" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>{option.label}</button>)}
          </div>
        </div>
      </section>

      <p className="sr-only" role="status" aria-live="polite">Showing {visibleJobs.length} of {remainingJobs.length} jobs.</p>
      <section className="mt-5" aria-label="Company jobs">
        {visibleJobs.length ? <div className="flex flex-col gap-2">{visibleJobs.map((job) => <JobRow key={job.id} job={job} recoveryScope={recoveryScope} onDeleted={() => setDeletedIds(previous => new Set([...previous, job.id]))} />)}</div> : <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center"><h2 className="text-lg font-bold text-[#1a3a4a]">{remainingJobs.length ? "No jobs match these filters" : "No partner jobs yet"}</h2><p className="mt-2 text-sm text-gray-600">{remainingJobs.length ? "Clear the search or choose another status." : "Start a permissive lead draft and add details as they become available."}</p>{remainingJobs.length ? <button type="button" onClick={() => { setSearch(""); setFilter("ALL"); }} className="mt-4 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-[#1a3a4a]">Clear filters</button> : <Link href="/partner/jobs/new" className="mt-4 inline-flex rounded-lg bg-[#c04e03] px-4 py-2 text-sm font-semibold text-white">New quote / lead</Link>}</div>}
      </section>
    </div>
  );
}
