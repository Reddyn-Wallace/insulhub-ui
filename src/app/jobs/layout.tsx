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

  const handleLogout = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
  };

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
      <div className="bg-[#1a3a4a] px-3 py-2 sticky top-0 z-50 border-b border-[#2f4b57]">
        <div className="flex items-center justify-between mb-2 md:mb-0">
          <p className="text-[#e85d04] text-base md:text-lg font-bold tracking-widest leading-tight">INSULHUB</p>
          <button
            onClick={handleLogout}
            className="px-2.5 py-1.5 rounded-lg text-xs md:text-sm font-semibold bg-white/10 text-gray-200"
          >
            Out
          </button>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5 md:pb-0">
          <button
            onClick={() => goStage("LEAD")}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs md:text-sm font-semibold ${stage === "LEAD" ? "bg-[#e85d04] text-white" : "bg-white/10 text-gray-200"}`}
          >
            Leads
          </button>
          <button
            onClick={() => goStage("QUOTE")}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs md:text-sm font-semibold ${stage === "QUOTE" ? "bg-[#e85d04] text-white" : "bg-white/10 text-gray-200"}`}
          >
            Quotes
          </button>
          <button
            onClick={() => router.push("/jobs/new")}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs md:text-sm font-semibold bg-[#e85d04] text-white"
          >
            + Lead
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
