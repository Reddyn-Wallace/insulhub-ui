const STEPS = [
  { label: "Lead", stage: "LEAD" },
  { label: "Quote", stage: "QUOTE" },
  { label: "Accepted", stage: "SCHEDULED" },
  { label: "Install", stage: "INSTALLATION" },
  { label: "Invoice", stage: "INVOICE" },
  { label: "Done", stage: "COMPLETED" },
];

export default function PipelineBreadcrumb({ currentStage }: { currentStage: string }) {
  const currentIndex = STEPS.findIndex((s) => s.stage === currentStage);

  return (
    <div className="flex items-center overflow-x-auto no-scrollbar py-2 px-4 gap-0">
      {STEPS.map((step, i) => {
        const isActive = step.stage === currentStage;
        const isDone = i < currentIndex;

        return (
          <div key={step.stage} className="flex items-center flex-shrink-0">
            <div
              className={`flex items-center px-3 py-1 rounded text-xs font-semibold ${
                isActive
                  ? "bg-[#e85d04] text-white"
                  : isDone
                  ? "bg-teal-700 text-white"
                  : "bg-gray-200 text-gray-400"
              }`}
            >
              {step.label}
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`w-4 h-0.5 ${
                  i < currentIndex ? "bg-teal-700" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
