"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    installStatus?: string | null;
    checkSheetSignedAsComplete?: boolean | null;
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
          installStatus
          checkSheetSignedAsComplete
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
const UPDATE_INSTALLATION = `
  mutation UpdateInstallation($input: UpdateJobInput!) {
    updateJob(input: $input) {
      _id
      installation {
        installDate
        installNote
        installStatus
        checkSheetSignedAsComplete
      }
    }
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

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
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

function parseInstallMeta(notes?: string | null): { status: "confirmed" | "pencilled"; note: string; scope: "internal" | "external" | "both" | "" } {
  const text = notes || "";
  const start = text.indexOf(INSTALL_META_START);
  const end = text.indexOf(INSTALL_META_END);
  if (start === -1 || end === -1 || end < start) {
    return { status: "confirmed" as "confirmed" | "pencilled", note: "", scope: "" };
  }

  const body = text
    .slice(start + INSTALL_META_START.length, end)
    .trim();

  const statusMatch = body.match(/^status:\s*(.+)$/im);
  const noteMatch = body.match(/^note:\s*([\s\S]*?)(?:\n[a-z_]+:|$)/im);
  const scopeMatch = body.match(/^install_scope:\s*(.+)$/im);
  const rawStatus = (statusMatch?.[1] || "confirmed").trim().toLowerCase();
  const rawScope = (scopeMatch?.[1] || "").trim().toLowerCase();
  return {
    status: rawStatus === "pencilled" ? "pencilled" : "confirmed",
    note: (noteMatch?.[1] || "").trim(),
    scope: rawScope === "internal" || rawScope === "external" || rawScope === "both" ? rawScope : "",
  };
}

function stripInstallMeta(notes?: string | null) {
  const text = notes || "";
  const block = new RegExp(`\n?${INSTALL_META_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\s\\S]*?)${INSTALL_META_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\n?`, "m");
  return text.replace(block, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildNotesWithInstallMeta(existingNotes: string | null | undefined, status: "confirmed" | "pencilled", note: string, scope: "internal" | "external" | "both" | "") {
  const cleaned = stripInstallMeta(existingNotes);
  const block = `${INSTALL_META_START}\nstatus: ${status}\nnote: ${note.trim()}\ninstall_scope: ${scope}\n${INSTALL_META_END}`;
  return cleaned ? `${cleaned}\n\n${block}` : block;
}

function toDatetimeLocal(iso?: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromDatetimeLocal(value: string) {
  if (!value) return null;
  return new Date(value).toISOString();
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
  const [installScope, setInstallScope] = useState<"internal" | "external" | "both" | "">("");
  const [installMetaNote, setInstallMetaNote] = useState("");
  const [installDate, setInstallDate] = useState("");
  const [saving, setSaving] = useState(false);
  const calendarCache = useRef<Map<string, { jobs: CalendarJob[]; ts: number }>>(new Map());
  const CALENDAR_CACHE_TTL_MS = 60_000;

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError("");
    try {
      const monthStart = startOfMonth(monthCursor);
      const monthEnd = endOfMonth(monthCursor);
      const calendarStart = startOfWeekMonday(monthStart);
      const calendarEnd = addDays(startOfWeekMonday(addDays(monthEnd, 1)), 6);
      const cacheKey = `${dateKeyLocal(calendarStart)}_${dateKeyLocal(calendarEnd)}`;
      const installBetween = {
        start: new Date(calendarStart.getFullYear(), calendarStart.getMonth(), calendarStart.getDate(), 0, 0, 0, 0).toISOString(),
        end: new Date(calendarEnd.getFullYear(), calendarEnd.getMonth(), calendarEnd.getDate(), 23, 59, 59, 999).toISOString(),
      };

      if (!force) {
        const now = Date.now();
        const memoryCached = calendarCache.current.get(cacheKey);
        if (memoryCached && now - memoryCached.ts < CALENDAR_CACHE_TTL_MS) {
          setJobs(memoryCached.jobs);
          setLoading(false);
          return;
        }

        if (typeof window !== "undefined") {
          const raw = window.sessionStorage.getItem(`calendar:${cacheKey}`);
          if (raw) {
            try {
              const parsed = JSON.parse(raw) as CalendarJob[] | { jobs: CalendarJob[]; ts?: number };
              const payload = Array.isArray(parsed) ? { jobs: parsed, ts: 0 } : { jobs: parsed.jobs || [], ts: parsed.ts || 0 };
              if (now - payload.ts < CALENDAR_CACHE_TTL_MS) {
                calendarCache.current.set(cacheKey, { jobs: payload.jobs, ts: payload.ts || now });
                setJobs(payload.jobs);
                setLoading(false);
                return;
              }
            } catch {
              // ignore bad cache payload
            }
          }
        }
      }

      let data: JobsData;
      try {
        const monthQuery = `
          query CalendarJobs($stages: [JobStage!], $installBetween: DateRangeInput, $skip: Int, $limit: Int) {
            jobs(stages: $stages, installBetween: $installBetween, skip: $skip, limit: $limit) {
              total
              results {
                _id
                jobNumber
                stage
                notes
                installation {
                  installDate
                  installNote
                  installStatus
                  checkSheetSignedAsComplete
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

        data = await gql<JobsData>(monthQuery, {
          stages: ["SCHEDULED", "INSTALLATION", "INVOICE", "COMPLETED"],
          installBetween,
          skip: 0,
          limit: 2000,
        });
      } catch {
        data = await gql<JobsData>(CALENDAR_JOBS_QUERY, {
          stages: ["SCHEDULED", "INSTALLATION", "INVOICE", "COMPLETED"],
          skip: 0,
          limit: 5000,
        });
      }

      const filtered = (data.jobs.results || []).filter((job) => {
        const key = dateKeyFromIsoNz(job.installation?.installDate);
        if (!key) return false;
        return key >= dateKeyLocal(calendarStart) && key <= dateKeyLocal(calendarEnd);
      });

      const payload = { jobs: filtered, ts: Date.now() };
      calendarCache.current.set(cacheKey, payload);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(`calendar:${cacheKey}`, JSON.stringify(payload));
      }

      setJobs(filtered);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load installation calendar";
      if (msg !== "Unauthorized") setError(msg);
    } finally {
      setLoading(false);
    }
  }, [monthCursor]);

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
    setInstallScope(meta.scope || "");
    setInstallMetaNote(meta.note);
    setInstallDate(toDatetimeLocal(job.installation?.installDate));
    setSheetOpen(true);
  };

  const closeSheet = () => {
    if (saving) return;
    setSheetOpen(false);
    setSelectedJob(null);
  };

  const openJobPage = (jobId: string) => {
    router.push(`/jobs/${jobId}?returnTo=${encodeURIComponent("/jobs/calendar")}`);
  };

  const saveInstallMeta = async () => {
    if (!selectedJob) return;
    if (!installScope) {
      setError("Select install scope: Internal, External, or both.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const nextNotes = buildNotesWithInstallMeta(selectedJob.notes, installStatus, installMetaNote, installScope);
      const nextInstallDate = fromDatetimeLocal(installDate);
      await Promise.all([
        gql(UPDATE_JOB_NOTES, { input: { _id: selectedJob._id, notes: nextNotes } }),
        gql(UPDATE_INSTALLATION, {
          input: {
            _id: selectedJob._id,
            installation: {
              installDate: nextInstallDate,
              installNote: selectedJob.installation?.installNote || "",
              installStatus: selectedJob.installation?.installStatus || "JOB_NOT_STARTED_YET",
              checkSheetSignedAsComplete: selectedJob.installation?.checkSheetSignedAsComplete ?? false,
            },
          },
        }),
      ]);
      setJobs((prev) => prev.map((job) => job._id === selectedJob._id ? {
        ...job,
        notes: nextNotes,
        installation: {
          ...job.installation,
          installDate: nextInstallDate,
        },
      } : job));
      setSheetOpen(false);
      setSelectedJob(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save install planning details");
    } finally {
      setSaving(false);
    }
  };

  const clearInstallDate = async () => {
    if (!selectedJob) return;
    setSaving(true);
    setError("");
    try {
      await gql(UPDATE_INSTALLATION, {
        input: {
          _id: selectedJob._id,
          installation: {
            installDate: null,
            installNote: selectedJob.installation?.installNote || "",
            installStatus: selectedJob.installation?.installStatus || "JOB_NOT_STARTED_YET",
            checkSheetSignedAsComplete: selectedJob.installation?.checkSheetSignedAsComplete ?? false,
          },
        },
      });
      setJobs((prev) => prev.map((job) => job._id === selectedJob._id ? {
        ...job,
        installation: {
          ...job.installation,
          installDate: null,
        },
      } : job));
      setInstallDate("");
      setSheetOpen(false);
      setSelectedJob(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove install date");
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
            <p className="text-sm text-gray-500">Accepted, in-progress, invoice, and completed jobs with install dates.</p>
          </div>
          <button
            onClick={() => load(true)}
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
          <div className="bg-white border border-gray-100 rounded-2xl p-8 flex flex-col items-center justify-center gap-3">
            <div className="h-8 w-8 rounded-full border-2 border-[#e85d04] border-t-transparent animate-spin" />
            <div className="text-sm text-gray-500">Loading calendar</div>
          </div>
        ) : error ? (
          <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">
            {error}
            <button onClick={() => load(true)} className="ml-2 underline">Retry</button>
          </div>
        ) : (
          <div className="space-y-4 overflow-x-auto pb-4">
            <div className="min-w-[1100px]">
              <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_150px] gap-2 mb-3">
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label} className="text-xs font-bold uppercase tracking-wide text-gray-500 px-1">
                    {label}
                  </div>
                ))}
                <div className="text-xs font-bold uppercase tracking-wide text-gray-500 px-1">Week totals</div>
              </div>

              <div className="space-y-3">
                {weeks.map((week) => (
                  <div key={week.weekStart.toISOString()} className="grid grid-cols-[repeat(7,minmax(0,1fr))_150px] gap-2 items-start">
                    {week.days.map((day) => (
                      <div
                        key={day.key}
                        className={`rounded-2xl border min-h-[180px] p-1.5 ${day.inMonth ? "bg-white border-gray-100" : "bg-gray-100/70 border-gray-200"}`}
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
                            const isInstalled = ["INSTALLED_AS_QUOTED", "INSTALLED_WITH_VARIATIONS_FROM_QUOTE"].includes(job.installation?.installStatus || "");
                            const isPencilled = meta.status === "pencilled";
                            const scopeLabel = meta.scope === "internal" ? "Internal" : meta.scope === "external" ? "External" : meta.scope === "both" ? "Internal + External" : "Scope not set";
                            return (
                              <div key={job._id} className={`w-full rounded-xl border p-1.5 shadow-sm border-l-4 ${isInstalled ? "border-emerald-200 bg-emerald-50/60" : "border-orange-100 bg-orange-50/50"} ${isPencilled ? "border-l-amber-500" : "border-l-emerald-500"}`}>
                                <button onClick={() => openJobSheet(job)} className="w-full text-left">
                                  <div className="mb-1.5">
                                    <div className="text-[16px] leading-5 font-semibold text-gray-900 line-clamp-2">{job.client?.contactDetails?.name || `Job #${job.jobNumber}`}</div>
                                  </div>
                                  <div className="text-[12px] text-gray-600 leading-4 mb-2 line-clamp-2">{address(job) || "No address"}</div>

                                  <div className={`text-[11px] mb-1 ${meta.scope ? "text-gray-700" : "text-red-600"}`}>{scopeLabel}</div>

                                  <div className="grid grid-cols-2 gap-1 mb-1.5">
                                    <div className="rounded-lg bg-white/70 border border-white px-1.5 py-0.5">
                                      <div className="text-[9px] uppercase tracking-wide text-gray-500">Area</div>
                                      <div className="text-[13px] leading-tight font-semibold text-gray-800">{formatSqm(combinedSqm(job))}</div>
                                    </div>
                                    <div className="rounded-lg bg-white/70 border border-white px-1.5 py-0.5">
                                      <div className="text-[9px] uppercase tracking-wide text-gray-500">Value</div>
                                      <div className="text-[13px] leading-tight font-semibold text-gray-800 whitespace-nowrap tabular-nums">{formatCurrency(job.quote?.c_total || 0)}</div>
                                    </div>
                                  </div>

                                  {meta.note && (
                                    <div className="text-[11px] text-gray-600 line-clamp-2 rounded-lg bg-white/60 border border-white px-2 py-1.5">
                                      📝 {meta.note}
                                    </div>
                                  )}
                                </button>

                                <div className={`mt-2 pt-2 border-t grid grid-cols-2 gap-1.5 ${isInstalled ? "border-emerald-100" : "border-orange-100"}`}>
                                  <button
                                    onClick={() => openJobSheet(job)}
                                    className="h-8 text-[11px] font-semibold text-[#e85d04] bg-white border border-orange-200 rounded-lg hover:bg-orange-50"
                                  >
                                    Plan install
                                  </button>
                                  <button
                                    onClick={() => openJobPage(job._id)}
                                    className="h-8 text-[11px] font-semibold text-[#1a3a4a] bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                                  >
                                    Open job
                                  </button>
                                </div>
                              </div>
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
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{selectedJob.client?.contactDetails?.name || `Job #${selectedJob.jobNumber}`}</div>
                  <div className="text-xs text-gray-500 mt-1">Job #{selectedJob.jobNumber} • {address(selectedJob) || "No address"}</div>
                </div>
                <button
                  onClick={() => openJobPage(selectedJob._id)}
                  className="text-xs font-semibold text-[#1a3a4a] bg-white border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50"
                >
                  Open job
                </button>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Installation date</div>
              <input
                type="datetime-local"
                value={installDate}
                onChange={(e) => setInstallDate(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
              />
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
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Install scope <span className="text-red-600">*</span></div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setInstallScope("internal")}
                  className={`py-3 rounded-xl text-sm font-semibold border ${installScope === "internal" ? "bg-blue-50 text-blue-700 border-blue-300" : "bg-white text-gray-700 border-gray-200"}`}
                >
                  Internal
                </button>
                <button
                  onClick={() => setInstallScope("external")}
                  className={`py-3 rounded-xl text-sm font-semibold border ${installScope === "external" ? "bg-blue-50 text-blue-700 border-blue-300" : "bg-white text-gray-700 border-gray-200"}`}
                >
                  External
                </button>
                <button
                  onClick={() => setInstallScope("both")}
                  className={`py-3 rounded-xl text-sm font-semibold border ${installScope === "both" ? "bg-blue-50 text-blue-700 border-blue-300" : "bg-white text-gray-700 border-gray-200"}`}
                >
                  Both
                </button>
              </div>
              {!installScope && <div className="text-[11px] text-red-600 mt-1">Required</div>}
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
              {selectedJob?.installation?.installDate && (
                <button onClick={clearInstallDate} disabled={saving} className="bg-red-50 text-red-600 font-semibold py-3 px-4 rounded-xl disabled:opacity-50">
                  Remove date
                </button>
              )}
              <button onClick={closeSheet} className="flex-1 bg-gray-100 text-gray-700 font-semibold py-3 rounded-xl">Cancel</button>
              <button onClick={saveInstallMeta} disabled={saving || !installScope} className="flex-1 bg-[#e85d04] text-white font-semibold py-3 rounded-xl disabled:opacity-50">
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
