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

const QUOTE_SUB_TABS = [
  { label: "All", value: "ALL" },
  { label: "Open", value: "NEW" },
  { label: "Callback", value: "CALLBACK" },
  { label: "Dead", value: "DEAD" },
];

interface StageTabsProps {
  activeStage: string;
  onStageChange: (stage: string) => void;
  subTab: string;
  onSubTabChange: (tab: string) => void;
  counts?: Record<string, number>;
  searchMode?: boolean;
}

export default function StageTabs({
  activeStage,
  onStageChange,
  subTab,
  onSubTabChange,
  counts,
  searchMode,
}: StageTabsProps) {
  const subTabs = activeStage === "LEAD" ? LEAD_SUB_TABS : activeStage === "QUOTE" ? QUOTE_SUB_TABS : null;

  return (
    <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
      {/* Stage tabs */}
      <div className="flex overflow-x-auto no-scrollbar">
        {!searchMode && STAGES.map((s) => (
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
        {searchMode && (
          <div className="px-4 py-3 text-sm font-medium text-[#e85d04] border-b-2 border-[#e85d04]">
            🔍 Search Results
          </div>
        )}
      </div>

      {/* Sub-tabs */}
      {subTabs && !searchMode && (
        <div className="flex px-3 pb-2 gap-2 overflow-x-auto no-scrollbar">
          {subTabs.map((t) => (
            <button
              key={t.value}
              onClick={() => onSubTabChange(t.value)}
              className={`flex-shrink-0 px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                subTab === t.value
                  ? "bg-[#e85d04] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {t.label}
              {counts && (
                <span className="ml-1 opacity-70">({counts[t.value] ?? 0})</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
