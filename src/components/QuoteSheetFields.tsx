"use client";

import type { Dispatch, ReactNode, Ref, SetStateAction } from "react";
import { DateTimeCalendarField } from "@/components/InstallPlanningForm";

type QuoteSheetForm = {
  quoteNumber: string;
  date: string;
  hasWall: boolean | null;
  wallSQM: string;
  wallSQMPrice: string;
  wallCavityDepth: string;
  hasCeiling: boolean | null;
  ceilingSQM: string;
  ceilingSQMPrice: string;
  ceilingRValue: string;
  ceilingDownlights: string;
  consentFee: string;
  depositPercentage: string;
  depositManual?: string;
  extras: { name: string; price: string }[];
  quoteNote: string;
};

type QuoteSheetTotals = {
  wallR: string;
  wallBags: string;
  ceilingThickness: string;
  ceilingBags: string;
  contract: string;
  gst: string;
  total: string;
  deposit: string;
};

export default function QuoteSheetFields<T extends QuoteSheetForm>({
  quoteForm, setQuoteForm, totals, savedDate, extrasUnavailable, quoteNoteTextareaRef, children,
}: {
  quoteForm: T;
  setQuoteForm?: Dispatch<SetStateAction<T>>;
  totals: QuoteSheetTotals;
  savedDate?: { date: string; time: string };
  extrasUnavailable?: boolean;
  quoteNoteTextareaRef?: Ref<HTMLTextAreaElement>;
  children?: ReactNode;
}) {
  const readOnly = !setQuoteForm;
  return (
    <div className="space-y-4">
      <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold">1) Quote Basics</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">Quote Number</label>
          <input type="text" aria-label="Quote Number" readOnly={readOnly} value={quoteForm.quoteNumber} onChange={(e) => setQuoteForm?.((f) => ({ ...f, quoteNumber: e.target.value }))}
            placeholder={readOnly ? undefined : "E0001"}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#e85d04]" />
        </div>
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">Quote Date</label>
          {savedDate ? <DateTimeCalendarField compact display={savedDate} /> :
            <DateTimeCalendarField compact value={quoteForm.date} onChange={(next) => setQuoteForm?.((f) => ({ ...f, date: next }))} />}
        </div>
      </div>

      <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold">2) Insulation Inputs</div>
      <div className="border border-gray-200 rounded-xl p-3">
        <label className="flex items-center gap-2 mb-3 cursor-pointer">
          <input type="checkbox" checked={quoteForm.hasWall === true} disabled={readOnly} onChange={(e) => setQuoteForm?.((f) => ({ ...f, hasWall: e.target.checked }))} className="w-4 h-4 accent-[#e85d04]" />
          <span className="text-sm font-semibold text-gray-700">Wall Insulation</span>
        </label>
        {quoteForm.hasWall === null && <p className="mb-2 text-xs text-gray-500">Scope unavailable</p>}
        {quoteForm.hasWall !== false && (
          <div className="grid grid-cols-2 gap-2">
            {([{ label: "SQM", field: "wallSQM" }, { label: "Price / m²", field: "wallSQMPrice" }] as const).map(({ label, field }) => (
              <div key={field}>
                <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                <input type={readOnly ? "text" : "number"} step="0.1" aria-label={label} readOnly={readOnly} value={quoteForm[field]}
                  onChange={(e) => setQuoteForm?.((f) => ({ ...f, [field]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#e85d04]" />
              </div>
            ))}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Cavity Depth</label>
              {readOnly ? (
                <input type="text" aria-label="Cavity Depth" value={quoteForm.wallCavityDepth} readOnly
                  className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm" />
              ) : (
                <select aria-label="Cavity Depth" value={quoteForm.wallCavityDepth} onChange={(e) => setQuoteForm?.((f) => ({ ...f, wallCavityDepth: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#e85d04]">
                  <option value="0.1">10 cm</option>
                  <option value="0.15">15 cm</option>
                </select>
              )}
            </div>
            <div className="text-xs text-gray-500 flex items-end pb-2">Auto R-Value: <span className="ml-1 font-semibold text-gray-700">{totals.wallR}</span></div>
            <div className="text-xs text-gray-500 flex items-end pb-2">Auto Bags: <span className="ml-1 font-semibold text-gray-700">{totals.wallBags}</span></div>
          </div>
        )}
      </div>

      {/* Ceiling insulation */}
      <div className="border border-gray-200 rounded-xl p-3">
        <label className="flex items-center gap-2 mb-3 cursor-pointer">
          <input type="checkbox" checked={quoteForm.hasCeiling === true} disabled={readOnly} onChange={(e) => setQuoteForm?.((f) => ({ ...f, hasCeiling: e.target.checked }))} className="w-4 h-4 accent-[#e85d04]" />
          <span className="text-sm font-semibold text-gray-700">Ceiling Insulation</span>
        </label>
        {quoteForm.hasCeiling === null && <p className="mb-2 text-xs text-gray-500">Scope unavailable</p>}
        {quoteForm.hasCeiling !== false && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {([
                { label: "SQM", field: "ceilingSQM" }, { label: "Price / m²", field: "ceilingSQMPrice" },
                { label: "R-Value", field: "ceilingRValue" }, { label: "Downlights", field: "ceilingDownlights" },
              ] as const).map(({ label, field }) => (
                <div key={field}>
                  <label className="text-xs text-gray-500 mb-1 block">{label}</label>
                  <input type={readOnly ? "text" : "number"} step="0.1" aria-label={label} readOnly={readOnly} value={quoteForm[field]}
                    onChange={(e) => setQuoteForm?.((f) => ({ ...f, [field]: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#e85d04]" />
                </div>
              ))}
            </div>
            <div className="text-xs text-gray-500 mt-2">Auto Thickness: <span className="font-semibold text-gray-700">{totals.ceilingThickness}</span></div>
            <div className="text-xs text-gray-500 mt-1">Auto Bags: <span className="font-semibold text-gray-700">{totals.ceilingBags}</span></div>
          </>
        )}
      </div>

      <div className="text-xs uppercase tracking-wide text-gray-400 font-semibold">3) Pricing</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">Consent Fee</label>
          <input type={readOnly ? "text" : "number"} aria-label="Consent Fee" readOnly={readOnly} value={quoteForm.consentFee} onChange={(e) => setQuoteForm?.((f) => ({ ...f, consentFee: e.target.value }))}
            placeholder={readOnly ? undefined : "0"}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#e85d04]" />
        </div>
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">Deposit %</label>
          <input type={readOnly ? "text" : "number"} aria-label="Deposit %" readOnly={readOnly} value={quoteForm.depositPercentage} onChange={(e) => setQuoteForm?.((f) => ({ ...f, depositPercentage: e.target.value, depositManual: "" }))}
            placeholder={readOnly ? undefined : "25"}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#e85d04]" />
        </div>
      </div>

      {/* Extras */}
      <div className="border border-gray-200 rounded-xl p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3">
          <div>
            <p className="text-sm font-semibold text-gray-700">Charges and discounts</p>
            <p className="text-xs text-gray-500">Amounts exclude GST</p>
          </div>
          {!readOnly && <div className="flex flex-wrap gap-x-3">
            <button type="button" onClick={() => setQuoteForm?.((f) => ({ ...f, extras: [...f.extras, { name: "", price: "" }] }))}
              className="min-h-11 text-sm font-medium text-[#e85d04]">+ Add charge</button>
            <button type="button" onClick={() => setQuoteForm?.((f) => ({ ...f, extras: [...f.extras, { name: "Discount", price: "-" }] }))}
              className="min-h-11 text-sm font-medium text-[#e85d04]">+ Add discount</button>
          </div>}
        </div>
        {extrasUnavailable && <p className="text-xs text-gray-500">Unavailable</p>}
        {!extrasUnavailable && quoteForm.extras.length === 0 && <p className="text-xs text-gray-400">No charges or discounts added</p>}
        {quoteForm.extras.map((extra, index) => {
          // Keep the sign in form state even when the discount has no amount yet.
          const isDiscount = extra.price.startsWith("-");
          const kind = isDiscount ? "Discount" : "Charge";
          return (
            <div key={index} className="mb-2 grid grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_2.75rem] gap-2">
              <input type="text" value={extra.name} aria-label={`${kind} name`} readOnly={readOnly}
                onChange={(event) => {
                  const name = event.target.value;
                  setQuoteForm?.((f) => ({ ...f, extras: f.extras.map((item, i) => i === index ? { ...item, name } : item) }));
                }}
                placeholder={`${kind} name`} className="min-w-0 rounded-lg border border-gray-200 px-2 py-2 text-sm" />
              <div className="relative">
                {isDiscount && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-sm text-gray-500">−</span>}
                <input type={readOnly ? "text" : "number"} inputMode="decimal" step="any" readOnly={readOnly} aria-label={`${kind} amount excluding GST`}
                  value={isDiscount ? extra.price.slice(1) : extra.price}
                  onChange={(event) => {
                    const amount = event.target.value;
                    const price = isDiscount ? `-${amount.replace(/^-/, "")}` : amount;
                    setQuoteForm?.((f) => ({ ...f, extras: f.extras.map((item, i) => i === index ? { ...item, price } : item) }));
                  }}
                  placeholder="0" className={`h-full w-full rounded-lg border border-gray-200 py-2 pr-2 text-sm ${isDiscount ? "pl-6" : "pl-2"}`} />
              </div>
              {!readOnly && <button type="button" aria-label={`Remove ${extra.name.trim() || kind.toLowerCase()}`}
                onClick={() => setQuoteForm?.((f) => ({ ...f, extras: f.extras.filter((_, i) => i !== index) }))}
                className="min-h-11 text-xs text-red-500">✕</button>}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-gray-50 rounded-lg p-2">Contract: <b>{totals.contract}</b></div>
        <div className="bg-gray-50 rounded-lg p-2">GST: <b>{totals.gst}</b></div>
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">Total (auto)</label>
          <input type={readOnly ? "text" : "number"} aria-label="Total (auto)" value={totals.total} readOnly
            className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2.5 text-sm text-gray-700" />
        </div>
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">Deposit (auto)</label>
          <input type={readOnly ? "text" : "number"} aria-label="Deposit (auto)" value={totals.deposit} readOnly
            className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2.5 text-sm text-gray-700" />
        </div>
      </div>

      {/* Comments */}
      <div>
        <label className="text-xs text-gray-500 font-medium mb-1 block">Quote Comments</label>
        <textarea aria-label="Quote Comments" readOnly={readOnly} ref={quoteNoteTextareaRef} value={quoteForm.quoteNote} onChange={(e) => setQuoteForm?.((f) => ({ ...f, quoteNote: e.target.value }))}
          rows={3} placeholder={readOnly ? undefined : "Quote details..."}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#e85d04] resize-none" />
      </div>

      {children}
    </div>
  );
}
