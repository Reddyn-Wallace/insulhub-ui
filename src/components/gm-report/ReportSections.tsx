import React, { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Row, Week, Snapshot } from "@/lib/gm-report/types";
import { addDays, money } from "@/lib/gm-report/model";
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
function CogsTooltip({
  share,
  bags,
}: {
  share: string | null;
  bags: number | null;
}) {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const pinned = useRef(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function dismiss() {
      pinned.current = false;
      setOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) dismiss();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span
      ref={root}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!pinned.current && !root.current?.contains(document.activeElement))
          setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label="COGS details"
        aria-expanded={open}
        aria-describedby={id}
        className="-my-0.5 inline-flex size-6 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[#1a3a4a]"
        onFocus={() => setOpen(true)}
        onBlur={() => {
          pinned.current = false;
          setOpen(false);
        }}
        onClick={() => {
          pinned.current = !pinned.current;
          setOpen(pinned.current);
        }}
      >
        <span aria-hidden="true">ⓘ</span>
      </button>
      <span
        id={id}
        role="tooltip"
        hidden={!open}
        className="absolute bottom-full left-0 z-10 whitespace-nowrap rounded-md bg-[#1a3a4a] px-2 py-1 text-xs font-medium text-white shadow-md"
      >
        {share && `${share} of revenue`}
        {share && bags !== null && " · "}
        {bags !== null && `${sqm(bags)} ${bags === 1 ? "bag" : "bags"}`}
      </span>
    </span>
  );
}

export function PnlTable({
  week,
  completedOnly = false,
  estimated = false,
}: {
  week: Week;
  completedOnly?: boolean;
  estimated?: boolean;
}) {
  const { pnl, rows } = week;
  const incomplete = week.issues.length > 0;
  const counted = completedOnly ? rows.filter((row) => row.completed) : rows;
  const bags = counted.every(
    (row) => row.wallBags !== null && row.ceilingBags !== null,
  )
    ? money(
        counted.reduce(
          (total, row) => total + (row.wallBags ?? 0) + (row.ceilingBags ?? 0),
          0,
        ),
      )
    : null;
  const cogs = pnl.wallCogs + pnl.ceilingCogs;
  const cogsShare =
    pnl.revenue > 0 && !incomplete
      ? new Intl.NumberFormat("en-NZ", {
          style: "percent",
          maximumFractionDigits: 1,
        }).format(cogs / pnl.revenue)
      : null;
  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        NZD excluding GST{estimated ? " · Contains estimated costs" : ""}
        {incomplete ? " · Incomplete figures" : ""}
      </p>
      <dl className="divide-y divide-slate-100">
        <div className="flex justify-between gap-4 py-2 text-sm">
          <dt className="text-slate-600">Revenue</dt>
          <dd className="font-medium tabular-nums text-slate-900">
            {dollars(pnl.revenue)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 py-2 text-sm">
          <dt className="flex items-center gap-1 text-slate-600">
            COGS{" "}
            {(cogsShare || (bags !== null && bags > 0)) && (
              <CogsTooltip share={cogsShare} bags={bags} />
            )}
          </dt>
          <dd className="text-right font-medium tabular-nums text-slate-900">
            {dollars(cogs)}
          </dd>
        </div>
        {(
          [
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
function BagVariance({ row }: { row: Row }) {
  const allocated = row.basis.startsWith("Allocated from actual total");
  if (
    (!allocated && !row.basis.startsWith("Actual recorded")) ||
    row.wallBags == null ||
    row.budgetWallBags == null
  )
    return null;
  const variance = money(row.wallBags - row.budgetWallBags);
  const sign = variance > 0 ? "+" : variance < 0 ? "−" : "";
  return (
    <p className="mt-1 text-xs leading-4 text-gray-600">
      Bag variance: {sign}
      {sqm(Math.abs(variance))}
      {allocated && " (allocated)"}
    </p>
  );
}

function InstallCard({ row }: { row: Row }) {
  const status = row.assumedCompleted
    ? "Assumed completed"
    : row.completed
      ? "Completed"
      : row.bookingStatus === "pencilled"
        ? "Pencilled"
        : row.bookingStatus === "confirmed"
          ? "Confirmed"
          : "Planned";
  const colours = row.completed
    ? "border-emerald-200 border-l-emerald-500 bg-emerald-50"
    : row.bookingStatus === "pencilled"
      ? "border-amber-200 border-l-amber-500 bg-amber-50/60"
      : row.bookingStatus === "confirmed"
        ? "border-emerald-200 border-l-emerald-500 bg-white"
        : "border-slate-200 border-l-slate-300 bg-white";
  return (
    <article
      className={`w-full min-w-0 break-words rounded-xl border border-l-4 p-2 shadow-sm ${colours}`}
    >
      <Link
        href={`/jobs/${row.jobId}`}
        className="block text-sm font-semibold leading-5 text-gray-900 hover:underline"
      >
        {row.customer}
      </Link>
      {row.address && (
        <p className="mt-0.5 text-xs font-medium leading-4 text-gray-700">
          {row.address}
        </p>
      )}
      <p className="mt-1 text-[10px] font-bold uppercase leading-4 tracking-wide text-gray-600">
        {status}
        {row.percent < 100 && ` · ${row.percent}%`}
      </p>
      <p className="mt-1 flex flex-wrap gap-x-1 text-xs font-semibold tabular-nums text-gray-800">
        <span>{sqm(row.sqm)} m²</span>
        <span aria-hidden="true">/</span>
        <span>{dollars(row.revenue)}</span>
      </p>
      <BagVariance row={row} />
      {row.issues.map((issue, index) => (
        <p key={index} className="mt-1 text-xs text-red-700">
          {issue}
        </p>
      ))}
    </article>
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
                {daily.map((item) =>
                  item.row ? (
                    <InstallCard key={item.key} row={item.row} />
                  ) : (
                    <div
                      key={item.key}
                      className="w-full break-words rounded-xl border border-dashed border-violet-300 bg-violet-50/70 p-2 shadow-sm"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-wide text-violet-800">
                        Placeholder
                      </p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">
                        {item.placeholder!.title}
                      </p>
                      {item.placeholder!.note && (
                        <p className="mt-1 text-xs text-gray-600">
                          {item.placeholder!.note}
                        </p>
                      )}
                    </div>
                  ),
                )}
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
