import React from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Pnl, Row, Settings, Week, Snapshot } from "@/lib/gm-report/types";
import { addDays, calculatePnl } from "@/lib/gm-report/model";
import { toNzDateKey } from "@/lib/reports/sales-installs-types";
export const dollars = (cents: number) =>
  new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
export const sqm = (value: number) =>
  new Intl.NumberFormat("en-NZ", { maximumFractionDigits: 2 }).format(value);
export const day = (value: string) =>
  new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-NZ", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
export const button =
  "min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50";
export function Section({
  title,
  kicker,
  children,
}: {
  title: string;
  kicker?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
        {kicker && (
          <p className="mb-1 text-xs font-bold uppercase tracking-widest text-slate-500">
            {kicker}
          </p>
        )}
        <h2 className="text-lg font-bold text-[#1a3a4a]">{title}</h2>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}
export function PnlTable({
  pnl,
  incomplete = false,
  estimated = false,
}: {
  pnl: Pnl;
  incomplete?: boolean;
  estimated?: boolean;
}) {
  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        NZD excluding GST{estimated ? " · Contains estimated costs" : ""}
        {incomplete ? " · Incomplete figures" : ""}
      </p>
      <dl className="divide-y divide-slate-100">
        {(
          [
            ["Revenue", pnl.revenue],
            ["COGS — wall bags", pnl.wallCogs],
            ["COGS — ceiling bags", pnl.ceilingCogs],
            ["Council fees", pnl.council],
            ["Wages", pnl.wages],
            ["Opex", pnl.opex],
          ] as [string, number][]
        ).map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 py-2 text-sm">
            <dt className="text-slate-600">{label}</dt>
            <dd className="font-medium tabular-nums text-slate-900">
              {dollars(value)}
            </dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 py-3 font-bold">
          <dt>Operating profit{incomplete ? " (incomplete)" : ""}</dt>
          <dd className="tabular-nums">{dollars(pnl.profit)}</dd>
        </div>
        <div className="flex justify-between py-2 text-sm text-slate-600">
          <dt>Operating profit budget</dt>
          <dd>{dollars(pnl.budget)}</dd>
        </div>
      </dl>
      <div
        className={`mt-3 flex flex-wrap justify-between gap-2 rounded-lg p-3 text-sm font-bold ${incomplete ? "bg-amber-50 text-amber-900" : pnl.variance >= 0 ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}
      >
        <span>
          {incomplete
            ? "Resolve missing figures"
            : pnl.variance === 0
              ? "On budget"
              : pnl.variance > 0
                ? "Above budget"
                : "Below budget"}
        </span>
        <span>
          {pnl.variance >= 0 ? "+" : ""}
          {dollars(pnl.variance)}
        </span>
      </div>
    </div>
  );
}
function quoteTotal(rows: Row[], field: "grossRevenue" | "calendarRevenue") {
  if (rows.some((row) => row[field] === undefined)) return undefined;
  return rows.reduce((sum, row) => sum + (row[field] ?? 0), 0);
}

export function WeeklyPnl({
  week,
  settings,
}: {
  week: Week;
  settings: Settings;
}) {
  const completed = week.rows.filter((row) => row.completed);
  const full = calculatePnl(week.rows, settings);
  const actual = week.pnl;
  const gross = quoteTotal(week.rows, "grossRevenue");
  const actualGross = quoteTotal(completed, "grossRevenue");
  const calendar = quoteTotal(week.rows, "calendarRevenue");
  const actualCalendar = quoteTotal(completed, "calendarRevenue");
  const quoteChanged = gross !== calendar || actualGross !== actualCalendar;
  const fullIncomplete = week.rows.some((row) => row.issues.length > 0);
  const lines: [string, number, number][] = [
    ["Revenue excl GST", actual.revenue, full.revenue],
    ["COGS — wall bags", actual.wallCogs, full.wallCogs],
    ["COGS — ceiling bags", actual.ceilingCogs, full.ceilingCogs],
    ["Council fees", actual.council, full.council],
    ["Wages", actual.wages, full.wages],
    ["Opex", actual.opex, full.opex],
    ["Operating profit", actual.profit, full.profit],
    ["Operating profit budget", actual.budget, full.budget],
    ["Variance to budget", actual.variance, full.variance],
  ];
  if (quoteChanged && gross !== undefined && actualGross !== undefined)
    lines.unshift(["Latest quote value incl GST", actualGross, gross]);
  if (calendar !== undefined && actualCalendar !== undefined)
    lines.unshift(["Calendar value incl GST", actualCalendar, calendar]);
  return (
    <div>
      <p className="mb-3 text-sm text-slate-600">
        Full schedule includes {week.rows.length - completed.length} planned{" "}
        {week.rows.length - completed.length === 1 ? "visit" : "visits"} with
        estimated costs. P&amp;L figures are NZD excluding GST.
      </p>
      <table
        aria-label="Weekly profit and loss comparison"
        className="w-full text-sm tabular-nums"
      >
        <thead className="border-b border-slate-200 text-slate-700">
          <tr>
            <th scope="col" className="sr-only">
              Measure
            </th>
            <th scope="col" className="px-2 py-2 text-right">
              Completed work
            </th>
            <th scope="col" className="px-2 py-2 text-right">
              Full schedule
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map(([label, completedValue, fullValue]) => (
            <tr
              key={label}
              className={
                label === "Operating profit" ? "bg-slate-50 font-bold" : ""
              }
            >
              <th
                scope="row"
                className="py-2 text-left font-medium text-slate-700"
              >
                {label}
              </th>
              <td className="whitespace-nowrap px-2 py-2 text-right">
                {dollars(completedValue)}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-right">
                {dollars(fullValue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {quoteChanged && calendar !== undefined && (
        <p className="mt-3 text-xs text-slate-600">
          Some split visits use a saved quote value in the calendar. Revenue
          uses the latest quote.
        </p>
      )}
      {week.estimated && (
        <p className="mt-3 text-xs text-amber-800">
          Completed work includes some estimated costs.
        </p>
      )}
      {fullIncomplete && (
        <p className="mt-3 text-xs text-amber-800">
          {week.issues.length
            ? "Completed and full schedule figures are incomplete. Review the highlighted visits."
            : "Full schedule figures are incomplete. Review the highlighted planned visits."}
        </p>
      )}
    </div>
  );
}

export function Schedule({ week }: { week: Week }) {
  const items = [
    ...week.rows.map((r) => ({
      date: r.date,
      key: r.id,
      row: r,
      placeholder: null,
    })),
    ...week.placeholders.map((p) => ({
      date: toNzDateKey(p.startsAt),
      key: `p:${p.id}`,
      row: null,
      placeholder: p,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div
      role="region"
      aria-label={`Calendar for week of ${day(week.week)}`}
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-slate-200 focus-visible:outline-2 focus-visible:outline-[#1a3a4a]"
    >
      <div className="grid min-w-[980px] grid-cols-7 divide-x divide-slate-200 bg-slate-50">
        {Array.from({ length: 7 }, (_, i) => {
          const date = addDays(week.week, i);
          const daily = items.filter((item) => item.date === date);
          return (
            <div key={date} className="min-w-0">
              <h4 className="border-b border-slate-200 bg-white px-2 py-2 text-sm font-bold text-[#1a3a4a]">
                {day(date)}
              </h4>
              <div className="min-h-20 space-y-2 p-2">
                {daily.length === 0 && (
                  <p className="py-2 text-xs text-slate-500">
                    No work scheduled
                  </p>
                )}
                {daily.map((item) => (
                  <div
                    key={item.key}
                    className={`rounded-lg border border-l-4 p-2 break-words ${item.placeholder ? "border-dashed border-violet-300 bg-violet-50" : item.row?.completed ? "border-slate-200 border-l-emerald-600 bg-white" : "border-slate-200 border-l-sky-600 bg-white"}`}
                  >
                    {item.row && (
                      <p className="text-xs text-slate-500">
                        {item.row.completed ? "Completed" : "Planned"}
                        {item.row.percent < 100
                          ? ` · ${item.row.percent}% of job`
                          : ""}
                      </p>
                    )}
                    {item.row ? (
                      <>
                        <Link
                          href={`/jobs/${item.row.jobId}`}
                          className="mt-1 inline-block text-sm font-semibold text-[#1a3a4a] underline decoration-slate-300 underline-offset-4"
                        >
                          #{item.row.number} · {item.row.customer}
                        </Link>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                          <span>
                            {sqm(item.row.sqm)} m²{" "}
                            {item.row.wallSqm > 0 &&
                              item.row.ceilingSqm > 0 && (
                                <span className="text-xs">
                                  ({sqm(item.row.wallSqm)} wall /{" "}
                                  {sqm(item.row.ceilingSqm)} ceiling)
                                </span>
                              )}
                          </span>
                          <span>{dollars(item.row.revenue)}</span>
                        </div>
                        <p
                          className={`mt-1 text-xs ${item.row.estimated ? "font-medium text-amber-800" : "text-slate-500"}`}
                        >
                          {item.row.basis}
                          {item.row.wallBags !== 0 &&
                            ` · Wall bags: ${item.row.wallBags === null ? "Missing" : sqm(item.row.wallBags)}`}
                          {item.row.ceilingBags !== 0 &&
                            ` · Ceiling bags: ${item.row.ceilingBags === null ? "Missing" : sqm(item.row.ceilingBags)}`}
                        </p>
                        {item.row.issues.map((issue, i) => (
                          <p key={i} className="mt-1 text-xs text-red-700">
                            {issue}
                          </p>
                        ))}
                        {item.row.councilLines.length > 0 && (
                          <details className="mt-1 text-xs text-slate-500">
                            <summary className="cursor-pointer">
                              Council extras
                            </summary>
                            <p className="my-1 font-medium">
                              Allocated to this visit:{" "}
                              {dollars(item.row.council)}
                            </p>
                            {item.row.councilLines.map((l, i) => (
                              <p key={i}>
                                {l.name}: {dollars(l.cents)} for whole job
                              </p>
                            ))}
                          </details>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="mt-1 font-medium text-slate-700">
                          {item.placeholder!.title}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Schedule note · excluded from financial and m² totals
                        </p>
                        {item.placeholder!.note && (
                          <p className="mt-1 text-sm text-slate-600">
                            {item.placeholder!.note}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
export function Leads({ snapshot }: { snapshot: Snapshot }) {
  const max = Math.max(1, ...snapshot.leads.map((l) => l.count));
  return (
    <Section title="Leads by day" kicker="01 · New enquiries">
      <div className="mb-5 flex items-baseline gap-2">
        <strong className="text-3xl font-bold text-[#1a3a4a]">
          {snapshot.leads.reduce((s, l) => s + l.count, 0)}
        </strong>
        <span className="text-sm text-slate-500">leads this week</span>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {snapshot.leads.map((l) => (
          <div key={l.date} className="text-center">
            <span className="text-sm font-bold tabular-nums">{l.count}</span>
            <div className="my-2 flex h-20 items-end justify-center rounded-md bg-slate-50">
              <div
                style={{ height: `${Math.max(3, (l.count / max) * 100)}%` }}
                className="w-2/3 rounded-t-md bg-[#1a3a4a]"
              />
            </div>
            <span className="text-xs text-slate-500">
              {new Date(`${l.date}T12:00:00Z`).toLocaleDateString("en-NZ", {
                weekday: "short",
                timeZone: "UTC",
              })}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}
