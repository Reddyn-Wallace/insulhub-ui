const LEAD_SUB_TABS = [
  { label: "New", value: "NEW" },
  { label: "Quote booked", value: "QUOTE_BOOKED" },
  { label: "Callback", value: "CALLBACK" },
  { label: "Dead", value: "DEAD" },
  { label: "All", value: "ALL" },
];

const QUOTE_SUB_TABS = [
  { label: "Open", value: "OPEN" },
  { label: "Callback", value: "CALLBACK" },
  { label: "Dead", value: "DEAD" },
  { label: "All", value: "ALL" },
];

interface StageTabsProps {
  activeStage: string;
  subTab: string;
  onSubTabChange: (tab: string) => void;
  counts?: Record<string, number>;
  searchMode?: boolean;
}

export default function StageTabs({
  activeStage,
  subTab,
  onSubTabChange,
  counts,
  searchMode,
}: StageTabsProps) {
  const subTabs =
    activeStage === "LEAD"
      ? LEAD_SUB_TABS
      : activeStage === "QUOTE"
      ? QUOTE_SUB_TABS
      : null;

  if (!subTabs && !searchMode) return null;

  return (
    <div
      className="bg-white border-b border-gray-100 sticky z-40 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)]"
      style={{ top: "var(--nav-height, 80px)" }}
    >
      {searchMode ? (
        <div className="px-4 py-2.5 text-sm font-medium text-[#e85d04]">
          🔍 Search Results
        </div>
      ) : subTabs ? (
        <div className="flex px-3 py-2 gap-2 overflow-x-auto no-scrollbar">
          {subTabs.map((t) => (
            <button
              key={t.value}
              onClick={() => onSubTabChange(t.value)}
              className={`flex-shrink-0 px-4 py-1.5 text-xs font-semibold rounded-full transition-all duration-300 ${
                subTab === t.value
                  ? "bg-[#e85d04] text-white shadow-md shadow-orange-500/20"
                  : "bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
              }`}
            >
              {t.label}
              {counts && (
                <span className="ml-1 opacity-70">({counts[t.value] ?? 0})</span>
              )}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
