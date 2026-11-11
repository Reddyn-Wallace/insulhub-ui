"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { addDays, weekKey } from "@/lib/gm-report/model";
import {
  request,
  RequestError,
  readRecovery,
  writeRecovery,
  clearRecovery,
} from "@/lib/gm-report/client";
import { refreshReport } from "@/lib/gm-report/refresh-client";
import type { Commentary, Report } from "@/lib/gm-report/types";
import {
  button,
  day,
  dollars,
  Leads,
  PnlTable,
  Schedule,
  Section,
  sqm,
} from "./ReportSections";
const empty: Commentary = { profit: "", upcoming: "", pipeline: "" };
const same = (a: Commentary, b: Commentary) =>
  JSON.stringify(a) === JSON.stringify(b);
export default function WeeklyGmReport() {
  const [week, setWeek] = useState(""),
    [report, setReport] = useState<Report | null>(null),
    [text, setText] = useState<Commentary>(empty),
    [history, setHistory] = useState<{ week: string; status: string }[]>([]),
    [busy, setBusy] = useState("Loading report…"),
    [saveState, setSaveState] = useState("Saved"),
    [error, setError] = useState(""),
    [setup, setSetup] = useState(false),
    [confirm, setConfirm] = useState(false);
  const current = useRef<Report | null>(null),
    draft = useRef(empty),
    saved = useRef(empty),
    saving = useRef<Promise<boolean> | null>(null),
    refreshing = useRef(false),
    cache = useRef(new Map<string, Report>()),
    conflict = useRef(false),
    lastSaveError = useRef<string | null>(null);
  const accept = useCallback((r: Report, preserve = false) => {
    const dirty = !same(draft.current, saved.current);
    current.current = r;
    setReport(r);
    cache.current.set(r.week, r);
    saved.current = r.commentary;
    if (!preserve || !dirty) {
      const recovery = !preserve ? readRecovery(r.week) : null;
      conflict.current = false;
      if (
        recovery &&
        r.status === "draft" &&
        !same(recovery.commentary, r.commentary)
      ) {
        draft.current = recovery.commentary;
        setText(recovery.commentary);
        conflict.current = !same(recovery.base, r.commentary);
        setError(
          conflict.current
            ? "Commentary changed in another window. Your local text has been recovered. Copy it before discarding the local draft and reloading to merge with the saved report."
            : "Unsaved commentary recovered from this browser.",
        );
      } else {
        draft.current = r.commentary;
        setText(r.commentary);
        if (!recovery || same(recovery.commentary, r.commentary))
          clearRecovery(r.week);
        else
          setError(
            "This report was finalised elsewhere. An unsaved local draft is retained in this browser; do not discard it until you have copied any needed text.",
          );
      }
    }
  }, []);
  const save = useCallback(async (): Promise<boolean> => {
    if (saving.current) return saving.current;
    if (conflict.current) return false;
    if (refreshing.current) {
      if (same(draft.current, saved.current)) return true;
      setError(
        "Wait for the refresh to finish. Your commentary is retained and will save afterwards.",
      );
      return false;
    }
    const work = (async () => {
      try {
        while (
          current.current?.status === "draft" &&
          !same(draft.current, saved.current)
        ) {
          const r = current.current,
            captured = { ...draft.current };
          setSaveState("Saving…");
          const data = await request<{ report: Report }>(
            `/api/gm-reports/${r.week}`,
            "POST",
            {
              action: "commentary",
              revision: r.revision,
              commentary: captured,
            },
          );
          accept(data.report, true);
          if (same(draft.current, saved.current)) clearRecovery(r.week);
        }
        setSaveState("Saved");
        const previousSaveError = lastSaveError.current;
        setError((previous) =>
          previous === previousSaveError ||
          previous === "Unsaved commentary recovered from this browser." ||
          previous.startsWith("Wait for the refresh")
            ? ""
            : previous,
        );
        lastSaveError.current = null;
        return true;
      } catch (e) {
        setSaveState("Save failed");
        lastSaveError.current = e instanceof Error ? e.message : "Save failed";
        setError(lastSaveError.current);
        return false;
      }
    })();
    saving.current = work;
    try {
      return await work;
    } finally {
      saving.current = null;
    }
  }, [accept]);
  useEffect(() => {
    try {
      const query = new URLSearchParams(window.location.search).get("week");
      setWeek(
        query ? weekKey(query) : addDays(weekKey(new Date().toISOString()), -7),
      );
    } catch {
      setWeek(addDays(weekKey(new Date().toISOString()), -7));
    }
  }, []);
  useEffect(() => {
    if (!week) return;
    let active = true;
    setError("");
    setSetup(false);
    setConfirm(false);
    const cached = cache.current.get(week);
    if (cached) {
      accept(cached);
      setBusy("");
    } else {
      setBusy("Loading saved report…");
      setReport(null);
      current.current = null;
    }
    void (async () => {
      try {
        const [data, h] = await Promise.all([
          cached
            ? Promise.resolve({ report: cached })
            : request<{ report: Report | null }>(`/api/gm-reports/${week}`),
          request<{ reports: { week: string; status: string }[] }>(
            "/api/gm-reports",
          ),
        ]);
        if (!active) return;
        setHistory(h.reports);
        let r = data.report;
        if (!r?.snapshot || r.refreshing) {
          setBusy("Building the first snapshot — this can take a moment…");
          r = await refreshReport(week, r);
        }
        if (!active) return;
        // Cached content was already accepted synchronously. A slow history read
        // must not replay that older report over edits made in the meantime.
        if (!cached) accept(r);
        setSaveState("Saved");
        for (const adjacent of [addDays(week, -7), addDays(week, 7)])
          if (
            h.reports.some((x) => x.week === adjacent) &&
            !cache.current.has(adjacent)
          )
            void request<{ report: Report | null }>(
              `/api/gm-reports/${adjacent}`,
            )
              .then((d) => {
                if (active && d.report) cache.current.set(adjacent, d.report);
              })
              .catch(() => {});
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : "Report failed to load.");
          setSetup(e instanceof RequestError && e.status === 422);
        }
      } finally {
        if (active) setBusy("");
      }
    })();
    return () => {
      active = false;
    };
  }, [week, accept]);
  useEffect(() => {
    if (same(text, saved.current)) return;
    const timer = setTimeout(() => {
      void save();
    }, 650);
    return () => clearTimeout(timer);
  }, [text, save]);
  useEffect(() => {
    const guard = (event: Event) => {
      if (same(draft.current, saved.current)) return;
      event.preventDefault();
      const href = (event as CustomEvent<{ href: string }>).detail.href;
      void save().then((ok) => {
        if (ok) window.location.href = href;
      });
    };
    const links = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.button !== 0 ||
        same(draft.current, saved.current)
      )
        return;
      const anchor = (event.target as Element)?.closest?.("a");
      if (!anchor || anchor.target === "_blank") return;
      event.preventDefault();
      event.stopPropagation();
      void save().then((ok) => {
        if (ok) window.location.href = anchor.href;
      });
    };
    window.addEventListener("gm-report-navigate", guard);
    document.addEventListener("click", links, true);
    return () => {
      window.removeEventListener("gm-report-navigate", guard);
      document.removeEventListener("click", links, true);
    };
  }, [save]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!same(draft.current, saved.current)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  async function navigate(next: string) {
    if (!(await save())) return;
    const key = weekKey(next);
    window.history.replaceState(window.history.state, "", `?week=${key}`);
    setWeek(key);
  }
  async function refresh() {
    if (!(await save())) return;
    refreshing.current = true;
    setBusy("Refreshing data…");
    setError("");
    try {
      const data = { report: await refreshReport(week, current.current) };
      if (
        !same(draft.current, saved.current) &&
        !same(data.report.commentary, saved.current)
      ) {
        conflict.current = true;
        throw new Error(
          "Commentary changed in another window while you were typing. Your local text is retained. Copy it before discarding the local draft and reloading to merge with the saved report.",
        );
      }
      accept(data.report, true);
      cache.current.clear();
      cache.current.set(week, data.report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed.");
    } finally {
      refreshing.current = false;
      setBusy("");
      await save();
    }
  }
  async function finalise() {
    setConfirm(false);
    if (!(await save())) return;
    setBusy("Finalising…");
    try {
      const d = await request<{ report: Report }>(
        `/api/gm-reports/${week}`,
        "POST",
        { action: "finalise", revision: current.current!.revision },
      );
      accept(d.report);
      setHistory((h) =>
        h.map((x) => (x.week === week ? { ...x, status: "finalised" } : x)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Finalisation failed.");
    } finally {
      setBusy("");
    }
  }
  function comment(field: keyof Commentary, label: string) {
    return (
      <div className="mt-6 border-t border-slate-100 pt-5">
        <label
          htmlFor={`comment-${field}`}
          className="mb-2 block text-sm font-semibold text-slate-700"
        >
          {label}
        </label>
        <textarea
          id={`comment-${field}`}
          value={text[field]}
          onChange={(e) => {
            const next = { ...draft.current, [field]: e.target.value };
            draft.current = next;
            if (current.current)
              writeRecovery(current.current.week, {
                commentary: next,
                base: saved.current,
                revision: current.current.revision,
              });
            setText(next);
            setSaveState("Unsaved changes");
          }}
          onBlur={() => void save()}
          readOnly={report?.status === "finalised" || busy === "Finalising…"}
          maxLength={20000}
          rows={4}
          placeholder="Add your commentary…"
          className="w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-sm leading-6 focus:border-[#1a3a4a] focus:outline-none focus:ring-2 focus:ring-slate-200 read-only:bg-slate-50"
        />
      </div>
    );
  }
  const s = report?.snapshot,
    locked = report?.status === "finalised";
  const retainedLocal = locked && report ? readRecovery(report.week) : null;
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 pb-20 sm:p-6">
      <header className="rounded-2xl bg-[#1a3a4a] p-5 text-white sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.18em] text-slate-300">
              Weekly management report
            </p>
            <h1 className="mt-2 text-2xl font-bold">Weekly GM report</h1>
            <p className="mt-2 text-sm text-slate-200">
              {week
                ? `${day(week)} – ${day(addDays(week, 6))} ${week.slice(0, 4)}`
                : "Loading week…"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
              {locked ? "Finalised" : "Draft"}
            </span>
            <Link
              className="text-sm underline underline-offset-4"
              href={`/jobs/reports/weekly-gm/settings?week=${week}`}
              onClick={(e) => {
                if (!same(draft.current, saved.current)) {
                  e.preventDefault();
                  void save().then((ok) => {
                    if (ok)
                      window.location.href = `/jobs/reports/weekly-gm/settings?week=${week}`;
                  });
                }
              }}
            >
              Report settings
            </Link>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            className={button}
            disabled={!!busy}
            aria-label="Previous week"
            onClick={() => void navigate(addDays(week, -7))}
          >
            ← Previous
          </button>
          <label className="sr-only" htmlFor="report-week">
            Report week
          </label>
          <input
            id="report-week"
            type="date"
            value={week}
            disabled={!!busy}
            onChange={(e) => {
              if (e.target.value) void navigate(e.target.value);
            }}
            className="min-h-11 max-w-full rounded-lg border border-white/30 bg-white px-3 text-sm text-slate-800"
          />
          <button
            className={button}
            disabled={!!busy}
            aria-label="Next week"
            onClick={() => void navigate(addDays(week, 7))}
          >
            Next →
          </button>
          <div className="flex-1" />
          {!locked && (
            <>
              <button
                className={button}
                onClick={() => void refresh()}
                disabled={!!busy || setup || !report}
              >
                Refresh data
              </button>
              <button
                className="min-h-11 rounded-lg bg-[#e85d04] px-5 text-sm font-bold text-white disabled:opacity-50"
                disabled={
                  !!busy || !s || !!s.issues.length || report?.refreshing
                }
                onClick={() => setConfirm(true)}
              >
                Finalise
              </button>
            </>
          )}
        </div>
        <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-slate-300">
          <span>
            {s
              ? `Data refreshed ${new Date(s.builtAt).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland" })} NZ time`
              : "No saved figures yet"}
          </span>
          <span role="status" aria-live="polite">
            {busy || (locked ? "Locked permanent record" : saveState)}
          </span>
        </div>
      </header>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        >
          <p>{error}</p>
          {setup ? (
            <Link
              href={`/jobs/reports/weekly-gm/settings?week=${week}`}
              className="mt-2 inline-block font-bold underline"
            >
              Set up costs and targets
            </Link>
          ) : (
            <div className="mt-2 flex flex-wrap gap-4">
              <button
                className="font-bold underline"
                onClick={() => void save()}
              >
                Retry save
              </button>
              <button
                className="font-bold underline"
                onClick={() => {
                  if (same(draft.current, saved.current)) {
                    cache.current.clear();
                    window.location.reload();
                  } else
                    setError(
                      "Copy your unsaved commentary before reloading, or retry saving it first.",
                    );
                }}
              >
                Reload report
              </button>
              <button
                className="font-bold underline"
                onClick={() => {
                  if (
                    window.confirm(
                      "Discard the unsaved local commentary for this week and reload the saved report? Copy any text you need first.",
                    )
                  ) {
                    clearRecovery(week);
                    conflict.current = false;
                    draft.current = saved.current;
                    window.location.reload();
                  }
                }}
              >
                Discard local draft and reload
              </button>
            </div>
          )}
        </div>
      )}
      {confirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Finalise report"
          className="rounded-xl border border-amber-300 bg-amber-50 p-5"
        >
          <h2 className="font-bold">Finalise this report permanently?</h2>
          <p className="mt-2 text-sm">
            Figures, commentary, costs and targets will be locked. This report
            cannot be reopened.
          </p>
          <div className="mt-4 flex gap-3">
            <button className={button} onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button
              className="min-h-11 rounded-lg bg-[#1a3a4a] px-4 font-semibold text-white"
              onClick={() => void finalise()}
            >
              Finalise permanently
            </button>
          </div>
        </div>
      )}
      {retainedLocal && (
        <Section title="Recovered local commentary">
          <p className="mb-3 text-sm text-amber-900">
            This text was not saved before the report was finalised elsewhere.
            The locked report below is unchanged. Copy anything you need from
            this local draft.
          </p>
          {Object.entries(retainedLocal.commentary).map(([field, value]) => (
            <div key={field} className="mb-3">
              <h3 className="text-sm font-semibold capitalize">{field}</h3>
              <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-sans text-sm">
                {value}
              </pre>
            </div>
          ))}
        </Section>
      )}
      {s && (
        <>
          {s.retrospective && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Created retrospectively from current CRM data. This is not a
              reconstruction of what was known at the time. Pipeline is as at
              the actual refresh date.
            </p>
          )}
          {s.issues.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <strong>
                Figures incomplete — resolve these before finalising.
              </strong>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {[...new Set(s.issues)].map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
          <Leads snapshot={s} />
          <Section title="Installs for the week" kicker="02 · Work delivered">
            <p className="mb-4 text-sm text-slate-500">
              <strong className="text-slate-800">
                {sqm(s.current.sqm)} m² completed
              </strong>{" "}
              · Planned visits are shown but excluded from this week’s P&amp;L.
            </p>
            <Schedule week={s.current} />
          </Section>
          <Section title="Weekly P&L" kicker="03 · Operating performance">
            <PnlTable
              pnl={s.current.pnl}
              incomplete={!!s.current.issues.length}
              estimated={s.current.estimated}
            />
            {comment(
              "profit",
              "Was the week over or under budget? What was this due to?",
            )}
          </Section>
          <Section title="Next two weeks" kicker="04 · Forward schedule">
            <div className="space-y-8">
              {s.upcoming.map((w) => (
                <div key={w.week} className="min-w-0 space-y-4">
                  <div>
                    <h3 className="font-bold text-[#1a3a4a]">
                      {day(w.week)} – {day(addDays(w.week, 6))}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {w.rows.some((row) => row.completed)
                        ? "Scheduled work · actuals where available"
                        : "Forecast · pencilled and confirmed"}
                      {" · "}
                      <strong>{sqm(w.sqm)} m²</strong>
                    </p>
                  </div>
                  <Schedule week={w} />
                  <div className="max-w-xl">
                    <PnlTable
                      pnl={w.pnl}
                      estimated={w.estimated}
                      incomplete={!!w.issues.length}
                    />
                  </div>
                </div>
              ))}
            </div>
            {comment(
              "upcoming",
              "Are the upcoming weeks schedules above budget? If no what is being done?",
            )}
          </Section>
          <Section
            title="Booked pipeline"
            kicker="05 · Remaining scheduled work"
          >
            <div className="grid grid-cols-3 gap-3">
              {[
                [sqm(s.pipeline.sqm), "m² booked"],
                [sqm(s.pipeline.days), "working days"],
                [sqm(s.pipeline.weeks), "working weeks"],
              ].map(([value, label]) => (
                <div key={label} className="rounded-xl bg-slate-50 p-3 sm:p-5">
                  <p className="text-xl font-bold text-[#1a3a4a] sm:text-3xl">
                    {value}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{label}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Pencilled and confirmed combined · 80 m²/day · 5 days/week.
              Pipeline as at{" "}
              {new Date(s.builtAt).toLocaleDateString("en-NZ", {
                timeZone: "Pacific/Auckland",
              })}
              .
              {s.pipeline.unscheduledSqm > 0
                ? ` A further ${sqm(s.pipeline.unscheduledSqm)} m² is unscheduled and excluded.`
                : ""}
            </p>
            {comment(
              "pipeline",
              "How are you feeling about the current levels of pipeline? What are you focusing on in this area?",
            )}
          </Section>
          <Section title="Jobs sold" kicker="06 · Newly accepted work">
            <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
              <p>
                <strong className="text-2xl text-[#1a3a4a]">
                  {sqm(s.sales.sqm)} m²
                </strong>
                {!!s.sales.undatedJobs?.length && (
                  <span className="ml-2 text-sm text-slate-500">
                    known dated sales
                  </span>
                )}
                <span className="ml-2 text-sm text-slate-500">
                  against {sqm(s.sales.budget)} m² budget
                </span>
              </p>
              <p
                className={`text-sm font-bold ${s.sales.variance >= 0 ? "text-emerald-800" : "text-rose-800"}`}
              >
                {s.sales.undatedJobs?.length
                  ? "Sales comparison incomplete"
                  : `${s.sales.variance >= 0 ? "+" : ""}${sqm(s.sales.variance)} m²`}
              </p>
            </div>
            {!!s.sales.undatedJobs?.length && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p>
                  {s.sales.undatedJobs.length} accepted{" "}
                  {s.sales.undatedJobs.length === 1 ? "job has" : "jobs have"}{" "}
                  no acceptance date available from the CRM. These jobs are
                  excluded from weekly sales totals because their sale week is
                  unknown. Installation figures are unaffected.
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer font-semibold">
                    Review undated jobs
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {s.sales.undatedJobs.map((j) => (
                      <li key={j.id}>
                        <Link className="underline" href={`/jobs/${j.id}`}>
                          #{j.number} · {j.customer}
                        </Link>{" "}
                        · {sqm(j.sqm)} m²
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
            <p className="mb-3 text-xs text-slate-500">
              Whole jobs counted once by acceptance date · wall and ceiling
              combined · values exclude GST.
            </p>
            <div className="space-y-2">
              {!s.sales.jobs.length && (
                <p className="text-sm text-slate-500">
                  {s.sales.undatedJobs?.length
                    ? "No dated acceptances recorded for this week."
                    : "No jobs accepted this week."}
                </p>
              )}
              {s.sales.jobs.map((j) => (
                <div
                  key={j.id}
                  className="flex flex-wrap justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm"
                >
                  <div>
                    <Link
                      className="font-semibold text-[#1a3a4a] underline"
                      href={`/jobs/${j.id}`}
                    >
                      #{j.number} · {j.customer}
                    </Link>
                    <p className="mt-1 text-xs text-slate-500">
                      Accepted {day(j.date)} · {sqm(j.wallSqm)} wall /{" "}
                      {sqm(j.ceilingSqm)} ceiling m²
                    </p>
                  </div>
                  <div className="text-right">
                    <strong>{sqm(j.sqm)} m²</strong>
                    <p className="mt-1 text-slate-500">{dollars(j.revenue)}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}
      {history.length > 0 && (
        <nav
          aria-label="Previous weekly reports"
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <label
            htmlFor="report-history"
            className="mr-3 text-sm font-semibold text-slate-600"
          >
            Saved reports
          </label>
          <select
            id="report-history"
            value={history.some((h) => h.week === week) ? week : ""}
            onChange={(e) => {
              if (e.target.value) void navigate(e.target.value);
            }}
            disabled={!!busy}
            className="mt-2 min-h-11 max-w-full rounded-lg border border-slate-300 px-3 text-sm sm:mt-0"
          >
            <option value="">Choose a saved week</option>
            {history.map((h) => (
              <option key={h.week} value={h.week}>
                {day(h.week)} {h.week.slice(0, 4)} · {h.status}
              </option>
            ))}
          </select>
        </nav>
      )}
    </main>
  );
}
