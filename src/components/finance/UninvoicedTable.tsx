import Link from "next/link";
import type { UninvoicedRow } from "@/lib/finance/uninvoiced";
import { money, when } from "./format";
export function UninvoicedTable({ rows }: { rows: UninvoicedRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            {[
              "Customer / job",
              "Installed",
              "Agreed value",
              "Already invoiced",
              "Awaiting invoice",
            ].map((h) => (
              <th key={h} className="p-4">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.jobId} className="border-t border-slate-100 align-top">
              <td className="p-4">
                <Link
                  className="font-semibold text-teal-800 underline underline-offset-2"
                  href={`/jobs/${r.jobId}`}
                >
                  {r.contact || r.name}
                </Link>
                <p className="mt-1 text-slate-500">{r.name}</p>
                <p className="text-xs text-slate-500">{r.quote}</p>
                {r.issue && (
                  <p className="mt-2 max-w-sm text-xs text-amber-800">
                    {r.issue}
                  </p>
                )}
              </td>
              <td className="p-4">
                {r.installDate ? when(r.installDate) : "Needs checking"}
                <p
                  className={
                    "mt-1 text-xs " +
                    (r.over30
                      ? "font-semibold text-amber-800"
                      : "text-slate-500")
                  }
                >
                  {r.over30
                    ? "Over 30 days — still awaiting invoice"
                    : r.age !== null
                      ? `${r.age} days ago`
                      : ""}
                </p>
              </td>
              <td className="p-4 tabular-nums">
                {r.agreed === null ? "Needs confirmation" : money(r.agreed)}
              </td>
              <td className="p-4 tabular-nums">
                {money(r.invoiced)}
                <p className="mt-1 text-xs text-slate-500">
                  {r.invoices.join(", ") || "No invoices"}
                </p>
              </td>
              <td className="p-4 font-semibold tabular-nums">
                {r.amount === null
                  ? "Amount needs confirmation"
                  : money(r.amount)}
                {r.amount !== null && (
                  <p className="mt-1 text-xs font-normal text-slate-500">
                    Estimate incl. GST
                  </p>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t bg-teal-50">
          <tr>
            <th colSpan={4} className="p-4">
              Total shown · estimates included in net position
            </th>
            <td className="p-4 font-semibold tabular-nums">
              {money(rows.reduce((s, r) => s + (r.amount ?? 0), 0))}
            </td>
          </tr>
        </tfoot>
      </table>
      {!rows.length && (
        <p className="p-6 text-sm text-slate-500">
          No jobs awaiting invoice in this view.
        </p>
      )}
    </div>
  );
}
