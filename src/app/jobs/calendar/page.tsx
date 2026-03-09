"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { gql } from "@/lib/graphql";
import BottomSheet from "@/components/BottomSheet";

interface CalendarJob {
  _id: string;
  jobNumber: number;
  stage: string;
  notes?: string | null;
  installation?: {
    installDate?: string | null;
    installNote?: string | null;
  };
  client?: {
    contactDetails?: {
      name?: string;
      streetAddress?: string;
      suburb?: string;
      city?: string;
    };
  };
  quote?: {
    c_total?: number | null;
    wall?: { SQM?: number | null };
    ceiling?: { SQM?: number | null };
  };
}

interface JobsData {
  jobs: {
    total: number;
    results: CalendarJob[];
  };
}

const CALENDAR_JOBS_QUERY = `
  query CalendarJobs($stages: [JobStage!], $skip: Int, $limit: Int) {
    jobs(stages: $stages, skip: $skip, limit: $limit) {
      total
      results {
        _id
        jobNumber
        stage
        notes
        installation {
          installDate
          installNote
        }
        client {
          contactDetails {
            name
            streetAddress
            suburb
            city
          }
        }
        quote {
          c_total
          wall { SQM }
          ceiling { SQM }
        }
      }
    }
  }
`;

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const UPDATE_JOB_NOTES = `
  mutation UpdateJobNotes($input: UpdateJobInput!) {
    updateJob(input: $input) { _id notes }
  }
`;
const INSTALL_META_START = "[INSTALL_META]";
const INSTALL_META_END = "[/INSTALL_META]";

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function startOfWeekMonday(date: Date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, amount: number) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + amount);
  return d;
}

function dateKeyLocal(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateKeyFromIsoNz(iso?: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatMonth(date: Date) {
  return new Intl.DateTimeFormat("en-NZ", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatCurrency(value?: number | null) {
  const amount = value || 0;
  return `$${amount.toLocaleString("en-NZ", { maximumFractionDigits: 0 })}`;
}

function formatSqm(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} sqm`;
}

function combinedSqm(job: CalendarJob) {
  return (job.quote?.wall?.SQM || 0) + (job.quote?.ceiling?.SQM || 0);
}

function address(job: CalendarJob) {
  return [
    job.client?.contactDetails?.streetAddress,
    job.client?.contactDetails?.suburb,
    job.client?.contactDetails?.city,
  ].filter(Boolean).join(", ");
}

function parseInstallMeta(notes?: string | null): { status: "confirmed" | "pencilled"; note: string } {
  const text = notes || "";
  const start = text.indexOf(INSTALL_META_START);
  const end = text.indexOf(INSTALL_META_END);
  if (start === -1 || end === -1 || end < start) {
    return { status: "confirmed" as "confirmed" | "pencilled", note: "" };
  }

  const body = text
    .slice(start + INSTALL_META_START.length, end)
    .trim();

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

export default function JobsCalendarPage() {
  const router = useRouter();
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [jobs, setJobs] = useState<CalendarJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<CalendarJob | null>(null);
  const [installStatus, setInstallStatus] = useState<"confirmed" | "pencilled">("confirmed");
  const [installMetaNote, setInstallMetaNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await gql<JobsData>(CALENDAR_JOBS_QUERY, {
        stages: ["SCHEDULED", "INSTALLATION"],
        skip: 0,
        limit: 5000,
      });

      const filtered = (data.jobs.results || []).filter((job) => Boolean(job.installation?.installDate));
      setJobs(filtered);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load installation calendar";
      if (msg !== "Unauthorized") setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) {
      router.push("/login");
      return;
    }
    load();
  }, [load, router]);

  const openJobSheet = (job: CalendarJob) => {
    const meta = parseInstallMeta(job.notes);
    setSelectedJob(job);
    setInstallStatus(meta.status);
    setInstallMetaNote(meta.note);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    if (saving) return;
    setSheetOpen(false);
    setSelectedJob(null);
  };

  const saveInstallMeta = async () => {
    if (!selectedJob) return;
    setSaving(true);
    setError("");
    try {
      const nextNotes = buildNotesWithInstallMeta(selectedJob.notes, installStatus, installMetaNote);
      await gql(UPDATE_JOB_NOTES, { input: { _id: selectedJob._id, notes: nextNotes } });
      setJobs((prev) => prev.map((job) => job._id === selectedJob._id ? { ...job, notes: nextNotes } : job));
      setSheetOpen(false);
      setSelectedJob(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save install planning details");
    } finally {
      setSaving(false);
    }
  };

  const jobsByDay = useMemo(() => {
    const map = new Map<string, CalendarJob[]>();
    for (const job of jobs) {
      const key = dateKeyFromIsoNz(job.installation?.installDate);
      if (!key) continue;
      const arr = map.get(key) || [];
      arr.push(job);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const aTs = new Date(a.installation?.installDate || 0).getTime();
        const bTs = new Date(b.installation?.installDate || 0).getTime();
        return aTs - bTs || a.jobNumber - b.jobNumber;
      });
    }
    return map;
  }, [jobs]);

  const weeks = useMemo(() => {
    const monthStart = startOfMonth(monthCursor);
    const gridStart = startOfWeekMonday(monthStart);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const lastGridDay = addDays(startOfWeekMonday(monthEnd), 6);

    const rows: Array<{
      weekStart: Date;
      days: Array<{ date: Date; key: string; jobs: CalendarJob[]; inMonth: boolean }>;
      totals: { jobs: number; sqm: number; amount: number };
    }> = [];

    let cursor = gridStart;
    while (cursor <= lastGridDay) {
      const days = Array.from({ length: 7 }, (_, idx) => {
        const date = addDays(cursor, idx);
        const key = dateKeyLocal(date);
        const dayJobs = jobsByDay.get(key) || [];
        return {
          date,
          key,
          jobs: dayJobs,
          inMonth: date.getMonth() === monthStart.getMonth(),
        };
      });

      rows.push({
        weekStart: cursor,
        days,
        totals: days.reduce(
          (acc, day) => {
            acc.jobs += day.jobs.length;
            acc.sqm += day.jobs.reduce((sum, job) => sum + combinedSqm(job), 0);
            acc.amount += day.jobs.reduce((sum, job) => sum + (job.quote?.c_total || 0), 0);
            return acc;
          },
          { jobs: 0, sqm: 0, amount: 0 }
        ),
      });

      cursor = addDays(cursor, 7);
    }

    return rows;
  }, [jobsByDay, monthCursor]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="px-4 py-4 border-b border-gray-100 bg-white sticky z-30" style={{ top: "var(--nav-height, 80px)" }}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Installation Calendar</h1>
            <p className="text-sm text-gray-500">Accepted and installation-stage jobs with install dates</p>
          </div>
          <button
            onClick={load}
            className="px-3 py-2 text-xs font-semibold rounded-lg border border-gray-200 bg-white text-gray-700"
          >
            Refresh
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setMonthCursor((curr) => addMonths(curr, -1))}
            className="px-3 py-2 rounded-lg text-sm font-semibold bg-white border border-gray-200 text-gray-700"
          >
            ← Prev month
          </button>
          <div className="text-center">
            <div className="text-lg font-bold text-gray-900">{formatMonth(monthCursor)}</div>
            <div className="text-xs text-gray-500">Monday to Sunday view</div>
          </div>
          <button
            onClick={() => setMonthCursor((curr) => addMonths(curr, 1))}
            className="px-3 py-2 rounded-lg text-sm font-semibold bg-white border border-gray-200 text-gray-700"
          >
            Next month →
          </button>
        </div>
      </div>

      <div className="px-4 py-4">
        {loading ? (
          <div className="text-sm text-gray-500">Loading installation calendar...</div>
        ) : error ? (
          <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">
            {error}
            <button onClick={load} className="ml-2 underline">Retry</button>
          </div>
        ) : (
          <div className="space-y-4 overflow-x-auto pb-4">
            <div className="min-w-[1100px]">
              <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_220px] gap-3 mb-3">
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label} className="text-xs font-bold uppercase tracking-wide text-gray-500 px-1">
                    {label}
                  </div>
                ))}
                <div className="text-xs font-bold uppercase tracking-wide text-gray-500 px-1">Week totals</div>
              </div>

              <div className="space-y-3">
                {weeks.map((week) => (
                  <div key={week.weekStart.toISOString()} className="grid grid-cols-[repeat(7,minmax(0,1fr))_220px] gap-3 items-start">
                    {week.days.map((day) => (
                      <div
                        key={day.key}
                        className={`rounded-2xl border min-h-[220px] p-3 ${day.inMonth ? "bg-white border-gray-100" : "bg-gray-100/70 border-gray-200"}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-sm font-bold ${day.inMonth ? "text-gray-900" : "text-gray-400"}`}>
                            {day.date.getDate()}
                          </span>
                          {day.jobs.length > 0 && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#e85d04]/10 text-[#e85d04]">
                              {day.jobs.length} job{day.jobs.length === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>

                        <div className="space-y-2">
                          {day.jobs.map((job) => {
                            const meta = parseInstallMeta(job.notes);
                            return (
                              <button key={job._id} onClick={() => openJobSheet(job)} className="w-full text-left rounded-xl border border-orange-100 bg-orange-50/40 p-2.5 shadow-sm">
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <div className="text-sm font-semibold text-gray-900 leading-tight">{job.client?.contactDetails?.name || `Job #${job.jobNumber}`}</div>
                                  <div className="flex flex-col items-end gap-1">
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${job.stage === "INSTALLATION" ? "bg-purple-100 text-purple-700" : "bg-green-100 text-green-700"}`}>
                                      {job.stage === "INSTALLATION" ? "Install" : "Accepted"}
                                    </span>
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta.status === "pencilled" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                                      {meta.status === "pencilled" ? "Pencilled" : "Confirmed"}
                                    </span>
                                  </div>
                                </div>
                                <div className="text-xs text-gray-500 mb-2 leading-snug">{address(job) || "No address"}</div>
                                {meta.note && (
                                  <div className="text-[11px] text-gray-600 mb-2 line-clamp-2">
                                    📝 {meta.note}
                                  </div>
                                )}
                                <div className="flex flex-col gap-1 text-xs text-gray-700 font-medium">
                                  <span>{formatSqm(combinedSqm(job))}</span>
                                  <span>{formatCurrency(job.quote?.c_total || 0)}</span>
                                </div>
                              </button>
                            );
                          })}
                          {day.jobs.length === 0 && <div className="text-xs text-gray-300 pt-2">No jobs</div>}
                        </div>
                      </div>
                    ))}

                    <div className="rounded-2xl border border-gray-200 bg-[#1a3a4a] text-white p-4 min-h-[220px]">
                      <div className="text-xs uppercase tracking-wide text-white/60 font-semibold mb-3">Week totals</div>
                      <div className="space-y-3">
                        <div>
                          <div className="text-[11px] text-white/60">Jobs</div>
                          <div className="text-2xl font-bold">{week.totals.jobs}</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-white/60">Square metres</div>
                          <div className="text-xl font-bold">{formatSqm(week.totals.sqm)}</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-white/60">Dollar amount</div>
                          <div className="text-xl font-bold">{formatCurrency(week.totals.amount)}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <BottomSheet open={sheetOpen} onClose={closeSheet} title="Installation planning">
        {selectedJob && (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-semibold text-gray-900">{selectedJob.client?.contactDetails?.name || `Job #${selectedJob.jobNumber}`}</div>
              <div className="text-xs text-gray-500 mt-1">Job #{selectedJob.jobNumber} • {address(selectedJob) || "No address"}</div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Lock-in status</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setInstallStatus("pencilled")}
                  className={`py-3 rounded-xl text-sm font-semibold border ${installStatus === "pencilled" ? "bg-amber-50 text-amber-700 border-amber-300" : "bg-white text-gray-700 border-gray-200"}`}
                >
                  Pencilled
                </button>
                <button
                  onClick={() => setInstallStatus("confirmed")}
                  className={`py-3 rounded-xl text-sm font-semibold border ${installStatus === "confirmed" ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-white text-gray-700 border-gray-200"}`}
                >
                  Confirmed
                </button>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Planning notes</div>
              <textarea
                value={installMetaNote}
                onChange={(e) => setInstallMetaNote(e.target.value)}
                rows={6}
                placeholder="Flexible dates, unavailable days, tentative details, anything the team should know..."
                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04] resize-none"
              />
              <div className="text-[11px] text-gray-400 mt-2">Stored in job notes as structured install metadata.</div>
            </div>

            <div className="flex gap-2">
              <button onClick={closeSheet} className="flex-1 bg-gray-100 text-gray-700 font-semibold py-3 rounded-xl">Cancel</button>
              <button onClick={saveInstallMeta} disabled={saving} className="flex-1 bg-[#e85d04] text-white font-semibold py-3 rounded-xl disabled:opacity-50">
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
