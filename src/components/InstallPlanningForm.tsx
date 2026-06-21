"use client";

export type InstallPlanningStatus = "confirmed" | "pencilled";
export type InstallPlanningScope = "internal" | "external" | "both" | "";

function fromDatetimeLocal(val: string) {
  if (!val) return null;
  const approx = new Date(val + ":00Z");
  const nzStr = approx.toLocaleString("sv-SE", { timeZone: "Pacific/Auckland" }).slice(0, 16);
  const offsetMs = new Date(nzStr + ":00Z").getTime() - approx.getTime();
  return new Date(approx.getTime() - offsetMs).toISOString();
}

function weekdayLabelFromDatetimeLocal(val?: string | null) {
  if (!val) return "";
  const iso = fromDatetimeLocal(val);
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-NZ", {
    timeZone: "Pacific/Auckland",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function dateFromDatetimeLocal(val?: string | null) {
  if (!val) return undefined;
  const [datePart] = val.split("T");
  if (!datePart) return undefined;
  const [year, month, day] = datePart.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

function timeFromDatetimeLocal(val?: string | null) {
  if (!val || !val.includes("T")) return "09:00";
  return val.split("T")[1]?.slice(0, 5) || "09:00";
}

function mergeDateAndTime(date: Date | undefined, time: string) {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const safeTime = /^\d{2}:\d{2}$/.test(time) ? time : "09:00";
  return `${year}-${month}-${day}T${safeTime}`;
}

export function DateTimeCalendarField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const selectedDate = dateFromDatetimeLocal(value);
  const timeValue = timeFromDatetimeLocal(value);
  const dateValue = value.split("T")[0] || "";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(0,1fr)_168px] gap-2">
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">Date</label>
          <input
            type="date"
            value={dateValue}
            onChange={(e) => {
              if (!e.target.value) onChange("");
              else onChange(`${e.target.value}T${timeValue}`);
            }}
            className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 font-medium mb-1 block">Time</label>
          <input
            type="time"
            value={timeValue}
            onChange={(e) => onChange(mergeDateAndTime(selectedDate || new Date(), e.target.value))}
            className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
          />
        </div>
      </div>
      {value && <p className="text-sm text-gray-600">Selected: <span className="font-medium">{weekdayLabelFromDatetimeLocal(value)}</span></p>}
    </div>
  );
}

export default function InstallPlanningForm({
  installDate,
  onInstallDateChange,
  saving = false,
  canCreateInvite = false,
  hasInstallDate = false,
  onClearDate,
  onCreateInvite,
  status,
  onStatusChange,
  scope,
  onScopeChange,
  note,
  onNoteChange,
}: {
  installDate: string;
  onInstallDateChange: (next: string) => void;
  saving?: boolean;
  canCreateInvite?: boolean;
  hasInstallDate?: boolean;
  onClearDate?: () => void;
  onCreateInvite?: () => void;
  status: InstallPlanningStatus;
  onStatusChange: (next: InstallPlanningStatus) => void;
  scope: InstallPlanningScope;
  onScopeChange: (next: Exclude<InstallPlanningScope, "">) => void;
  note: string;
  onNoteChange: (next: string) => void;
}) {
  const scopeOptions: { value: Exclude<InstallPlanningScope, "">; label: string }[] = [
    { value: "internal", label: "Internal" },
    { value: "external", label: "External" },
    { value: "both", label: "Both" },
  ];

  return (
    <div className="space-y-3">
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Installation date</div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClearDate}
              disabled={!hasInstallDate || saving || !onClearDate}
              className="text-xs font-semibold text-red-600 disabled:text-gray-300 disabled:cursor-not-allowed"
            >
              Clear date
            </button>
            <button
              type="button"
              onClick={onCreateInvite}
              disabled={!canCreateInvite || !onCreateInvite}
              className="text-xs font-semibold text-blue-700 disabled:text-gray-300 disabled:cursor-not-allowed"
            >
              Create Google invite
            </button>
          </div>
        </div>
        <DateTimeCalendarField value={installDate} onChange={onInstallDateChange} />
      </section>

      <section>
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Booking status</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onStatusChange("pencilled")}
            className={`py-2.5 rounded-lg text-sm font-semibold border ${status === "pencilled" ? "bg-amber-50 text-amber-700 border-amber-300" : "bg-white text-gray-700 border-gray-200"}`}
          >
            Pencilled
          </button>
          <button
            type="button"
            onClick={() => onStatusChange("confirmed")}
            className={`py-2.5 rounded-lg text-sm font-semibold border ${status === "confirmed" ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-white text-gray-700 border-gray-200"}`}
          >
            Confirmed
          </button>
        </div>
      </section>

      <section>
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Install scope <span className="text-red-600">*</span></div>
        <div className="grid grid-cols-3 gap-2">
          {scopeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onScopeChange(option.value)}
              className={`py-2.5 rounded-lg text-sm font-semibold border ${scope === option.value ? "bg-blue-50 text-blue-700 border-blue-300" : "bg-white text-gray-700 border-gray-200"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {!scope && <div className="text-[11px] text-red-600 mt-1">Required</div>}
      </section>

      <section>
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Planning notes</div>
        <textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          rows={3}
          placeholder="Flexible dates, unavailable days, tentative details, anything the team should know..."
          className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04] resize-none"
        />
      </section>
    </div>
  );
}

export function InstallPlanningActions({
  saving,
  canSave,
  onCancel,
  onSave,
}: {
  saving: boolean;
  canSave: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 border-t border-gray-100 bg-white px-4 pt-3 pb-1 shadow-[0_-10px_18px_rgba(255,255,255,0.92)]">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="bg-gray-100 text-gray-700 font-semibold py-3 rounded-xl">
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave || saving}
          className="bg-[#e85d04] text-white font-semibold py-3 rounded-xl disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
