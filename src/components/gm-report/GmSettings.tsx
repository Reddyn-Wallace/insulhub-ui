"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { request } from "@/lib/gm-report/client";
import type { Settings } from "@/lib/gm-report/types";
import { Section, button } from "./ReportSections";
const fields = [
  ["wallBagCost", "Wall bag cost"],
  ["ceilingBagCost", "Ceiling bag cost"],
  ["weeklyWages", "Weekly wages — all inclusive"],
  ["weeklyOpex", "Weekly opex"],
  ["profitBudget", "Weekly operating profit budget"],
  ["salesSqmBudget", "Weekly sales m² budget"],
] as const;
export default function GmSettings() {
  const [values, setValues] = useState<Record<string, string>>({}),
    [aliases, setAliases] = useState(""),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [returnWeek, setReturnWeek] = useState("");
  useEffect(() => {
    let active = true;
    const selected = new URLSearchParams(window.location.search).get("week");
    if (selected && /^\d{4}-\d{2}-\d{2}$/.test(selected))
      setReturnWeek(selected);
    request<{ settings: Settings; revision: number } | null>(
      "/api/gm-reports/settings",
    )
      .then((d) => {
        if (!active) return;
        if (d) {
          setRevision(d.revision);
          setAliases(d.settings.councilAliases.join("\n"));
          setValues(
            Object.fromEntries(
              fields.map(([key]) => [
                key,
                String(
                  key === "salesSqmBudget"
                    ? d.settings[key]
                    : d.settings[key] / 100,
                ),
              ]),
            ),
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const settings = {
        ...Object.fromEntries(
          fields.map(([key]) => [
            key,
            key === "salesSqmBudget"
              ? Number(values[key])
              : Math.round(Number(values[key]) * 100),
          ]),
        ),
        councilAliases: aliases
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      } as Settings;
      const d = await request<{ settings: Settings; revision: number }>(
        "/api/gm-reports/settings",
        "PUT",
        { settings, revision },
      );
      setRevision(d.revision);
      setNotice(
        "Settings saved. Refresh a draft report to apply them. Finalised reports stay unchanged.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 pb-20 sm:p-6">
      <Link
        href={
          returnWeek
            ? `/jobs/reports/weekly-gm?week=${returnWeek}`
            : "/jobs/reports/weekly-gm"
        }
        className="inline-flex min-h-11 items-center text-sm font-semibold text-[#1a3a4a]"
      >
        ← Weekly GM report
      </Link>
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
          Weekly management report
        </p>
        <h1 className="mt-2 text-2xl font-bold text-[#1a3a4a]">
          Costs & targets
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Enter NZD excluding GST. Each refreshed draft saves its own copy of
          these settings.
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm text-red-900"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900"
        >
          {notice}
        </p>
      )}
      <Section title="Weekly report settings">
        <form onSubmit={(e) => void submit(e)} className="space-y-5">
          {loading ? (
            <p role="status">Loading settings…</p>
          ) : (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                {fields.map(([key, label]) => (
                  <div key={key}>
                    <label
                      htmlFor={`setting-${key}`}
                      className="mb-2 block text-sm font-semibold text-slate-700"
                    >
                      {label}
                    </label>
                    <div className="relative">
                      {key !== "salesSqmBudget" && (
                        <span className="absolute left-3 top-3 text-sm text-slate-400">
                          $
                        </span>
                      )}
                      <input
                        id={`setting-${key}`}
                        type="number"
                        inputMode="decimal"
                        required
                        step="0.01"
                        min={key === "profitBudget" ? undefined : 0}
                        value={values[key] ?? ""}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, [key]: e.target.value }))
                        }
                        className={`min-h-11 w-full rounded-lg border border-slate-300 py-2 pr-3 text-sm ${key === "salesSqmBudget" ? "pl-3" : "pl-7"}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                Wages include holiday pay and any GM bonus allowance. Pipeline
                capacity is 80 m² per day, 5 days per week (400 m²/week), for
                wall and ceiling work equally.
              </p>
              <div>
                <label
                  htmlFor="council-aliases"
                  className="mb-2 block text-sm font-semibold text-slate-700"
                >
                  Additional council fee wording
                </label>
                <textarea
                  id="council-aliases"
                  value={aliases}
                  onChange={(e) => setAliases(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 p-3 text-sm"
                  placeholder="One exact extra name per line"
                />
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Council fee, application and exemption wording is recognised
                  automatically. Add other exact names here. The charge is
                  treated as the cost and is already included in quote revenue.
                </p>
              </div>
              <button type="submit" disabled={busy} className={button}>
                {busy ? "Saving…" : "Save settings"}
              </button>
            </>
          )}
        </form>
      </Section>
    </main>
  );
}
