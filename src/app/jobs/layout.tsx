"use client";

import { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

export default function JobsLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const stage = (() => {
    if (typeof window === "undefined") return "LEAD";
    const sp = new URLSearchParams(window.location.search);
    return sp.get("stage") || "LEAD";
  })();

  const goStage = (next: "LEAD" | "QUOTE") => {
    if (pathname === "/jobs") {
      const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      params.set("stage", next);
      params.set("subTab", next === "LEAD" ? "NEW" : "OPEN");
      router.replace(`/jobs?${params.toString()}`);
      return;
    }
    router.push(`/jobs?stage=${next}&subTab=${next === "LEAD" ? "NEW" : "OPEN"}`);
  };

  return (
    <div>
      <div className="bg-[#1a3a4a] px-4 py-3 flex items-center justify-between sticky top-0 z-50 border-b border-[#2f4b57]">
        <p className="text-[#e85d04] text-lg font-bold tracking-widest leading-tight">INSULHUB</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => goStage("LEAD")}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${stage === "LEAD" ? "bg-[#e85d04] text-white" : "bg-white/10 text-gray-200"}`}
          >
            Leads
          </button>
          <button
            onClick={() => goStage("QUOTE")}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${stage === "QUOTE" ? "bg-[#e85d04] text-white" : "bg-white/10 text-gray-200"}`}
          >
            Quotes
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
