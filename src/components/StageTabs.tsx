const STAGES = [
  { label: "Leads", value: "LEAD" },
  { label: "Quotes", value: "QUOTE" },
  { label: "Accepted", value: "SCHEDULED" },
  { label: "Installations", value: "INSTALLATION" },
  { label: "Invoice", value: "INVOICE" },
  { label: "Completion", value: "COMPLETED" },
];

const LEAD_SUB_TABS = [
  { label: "All", value: "ALL" },
  { label: "New", value: "NEW" },
  { label: "Callback", value: "CALLBACK" },
  { label: "Dead", value: "DEAD" },
];

interface StageTabsProps {
  activeStage: string;
  onStageChange: (stage: string) => void;
  leadSubTab: string;
  onLeadSubTabChange: (tab: string) => void;
  leadCounts?: Record<string, number>;
}

export default function StageTabs({
  activeStage,
  onStageChange,
  leadSubTab,
  onLeadSubTabChange,
  leadCounts,
}: StageTabsProps) {
  return (
    <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
      {/* Stage tabs */}
      <div className="flex overflow-x-auto no-scrollbar">
        {STAGES.map((s) => (
          <button
            key={s.value}
            onClick={() => onStageChange(s.value)}
            className={`flex-shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeStage === s.value
                ? "border-[#e85d04] text-[#e85d04]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Lead sub-tabs */}
      {activeStage === "LEAD" && (
        <div className="flex px-3 pb-2 gap-2 overflow-x-auto no-scrollbar">
          {LEAD_SUB_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => onLeadSubTabChange(t.value)}
              className={`flex-shrink-0 px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                leadSubTab === t.value
                  ? "bg-[#e85d04] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {t.label}
              {leadCounts && (
                <span className="ml-1 opacity-70">({leadCounts[t.value] ?? 0})</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
