import { useState, useRef, useEffect } from "react";

const STAGES = [
  { label: "Leads", value: "LEAD" },
  { label: "Quotes", value: "QUOTE" },
  { label: "Accepted", value: "SCHEDULED" },
  { label: "Installations", value: "INSTALLATION" },
  { label: "Invoice", value: "INVOICE" },
  { label: "Completion", value: "COMPLETED" },
];

const LEAD_SUB_TABS = [
  { label: "New", value: "NEW" },
  { label: "Callback", value: "CALLBACK" },
  { label: "Quote booked", value: "QUOTE_BOOKED" },
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const subTabs = activeStage === "LEAD" ? LEAD_SUB_TABS : activeStage === "QUOTE" ? QUOTE_SUB_TABS : null;

  return (
    <div className="bg-white border-b border-gray-100 sticky top-0 z-40 shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)]">
      {/* Stage tabs */}
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center overflow-x-auto no-scrollbar flex-1">
          {!searchMode && STAGES.map((s) => {
            const isMainTab = s.value === "LEAD" || s.value === "QUOTE";
            const isActive = activeStage === s.value;

            if (!isMainTab) return null;

            return (
              <button
                key={s.value}
                onClick={() => onStageChange(s.value)}
                className={`relative flex-shrink-0 px-4 py-3 text-base font-bold whitespace-nowrap transition-all duration-300 ${isActive
                  ? "text-[#e85d04]"
                  : "text-gray-400 hover:text-gray-700 hover:bg-gray-50/50 rounded-t-xl"
                  }`}
              >
                {s.label}
                {/* Animated active indicator */}
                {isActive && (
                  <span className="absolute bottom-0 left-0 w-full h-[3px] bg-gradient-to-r from-[#e85d04] to-[#f48c06] rounded-t-sm" />
                )}
              </button>
            );
          })}
          {searchMode && (
            <div className="px-4 py-3 text-sm font-medium text-[#e85d04] border-b-[3px] border-[#e85d04]">
              🔍 Search Results
            </div>
          )}
        </div>

        {/* Dropdown Menu for other stages */}
        {!searchMode && (
          <div className="relative flex-shrink-0 ml-2" ref={menuRef}>
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className={`relative flex items-center gap-1.5 px-3 py-2 text-sm font-semibold transition-all duration-300 rounded-lg ${!["LEAD", "QUOTE"].includes(activeStage)
                ? "text-[#e85d04]"
                : isMenuOpen
                  ? "bg-gray-100 text-[#e85d04]"
                  : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                }`}
            >
              {!["LEAD", "QUOTE"].includes(activeStage) ? (
                <span>
                  {STAGES.find((s) => s.value === activeStage)?.label || "More"}
                </span>
              ) : (
                <span>More</span>
              )}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform duration-200 ${isMenuOpen ? "rotate-180" : ""
                  }`}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
              {/* Animated active indicator when a dropdown option is selected */}
              {!["LEAD", "QUOTE"].includes(activeStage) && (
                <span className="absolute -bottom-[9px] left-0 w-full h-[3px] bg-gradient-to-r from-[#e85d04] to-[#f48c06] rounded-t-sm" />
              )}
            </button>

            {/* Dropdown panel */}
            {isMenuOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white/90 backdrop-blur-md border border-gray-100/50 rounded-2xl shadow-xl shadow-gray-200/50 py-2 z-50 transform origin-top-right transition-all">
                {STAGES.filter(s => s.value !== "LEAD" && s.value !== "QUOTE").map(s => {
                  const isSelected = activeStage === s.value;
                  return (
                    <button
                      key={s.value}
                      onClick={() => {
                        onStageChange(s.value);
                        setIsMenuOpen(false);
                      }}
                      className={`w-full text-left px-5 py-2.5 text-sm transition-colors ${isSelected
                        ? "bg-orange-50/80 text-[#e85d04] font-semibold"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium"
                        }`}
                    >
                      {s.label}
                      {isSelected && <span className="float-right">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
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
              className={`flex-shrink-0 px-4 py-1.5 text-xs font-semibold rounded-full transition-all duration-300 ${subTab === t.value
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
      )}
    </div>
  );
}
