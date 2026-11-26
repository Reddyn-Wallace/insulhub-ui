import { useState } from "react";
import { quoteRangeFields, readQuoteRanges, type QuoteRanges } from "@/lib/crm-read/quote-ranges";

export default function QuoteRangeFilters({ ranges, onApply }: {
  ranges: QuoteRanges;
  onApply: (ranges: QuoteRanges) => void;
}) {
  const [draft, setDraft] = useState(ranges);
  const dateError = draft.quoteDateFrom && draft.quoteDateTo && draft.quoteDateFrom > draft.quoteDateTo;
  const valueError = draft.quoteValueMin && draft.quoteValueMax && Number(draft.quoteValueMin) > Number(draft.quoteValueMax);

  return (
    <form className="space-y-2 border-t border-gray-100 pt-2" onSubmit={(event) => {
      event.preventDefault();
      if (dateError || valueError) return;
      const data = new URLSearchParams();
      for (const { key } of quoteRangeFields) {
        const value = draft[key];
        data.set(key, value && key.startsWith("quoteValue") ? String(Number(value)) : value);
      }
      onApply(readQuoteRanges(data));
    }}>
      <div className="grid grid-cols-2 gap-2">
        {quoteRangeFields.map(({ key, label, type }) => (
          <label key={key} className="min-w-0 space-y-1 text-xs font-medium text-gray-700">
            <span>{label}</span>
            <input
              type={type}
              min={type === "number" ? 0 : undefined}
              step={type === "number" ? "0.01" : undefined}
              value={draft[key]}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
              className="block w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm"
            />
          </label>
        ))}
      </div>
      {dateError && <p className="text-xs text-red-700">The to date must be on or after the from date.</p>}
      {valueError && <p className="text-xs text-red-700">The maximum must be at least the minimum.</p>}
      <button
        type="submit"
        disabled={Boolean(dateError || valueError)}
        className="rounded-lg bg-[#e85d04] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
      >
        Apply ranges
      </button>
    </form>
  );
}
