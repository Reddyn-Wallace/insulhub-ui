"use client";

import { ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const OTHER_STAGES = [
  { label: "Completion", value: "COMPLETED" },
];

function JobsNav({ headerRef }: { headerRef: React.RefObject<HTMLDivElement | null> }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const menuRef = useRef<HTMLDivElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const returnTo = searchParams.get("returnTo");
  const returnToStage = (() => {
    if (!returnTo) return null;
    const qIndex = returnTo.indexOf("?");
    if (qIndex === -1) return null;
    const qs = returnTo.slice(qIndex + 1);
    return new URLSearchParams(qs).get("stage");
  })();
  const stage = searchParams.get("stage") || returnToStage || "LEAD";
  const isCalendarView = pathname === "/jobs/calendar";
  const isReportsView = pathname === "/jobs/reports";
  const isPrimaryStage = stage === "LEAD" || stage === "QUOTE";
  const activeOtherStage = !isPrimaryStage && !isCalendarView && !isReportsView
    ? OTHER_STAGES.find((s) => s.value === stage)
    : null;

  // Set CSS variable so sub-tabs and full-page views can position themselves
  useEffect(() => {
    const update = () => {
      if (headerRef.current) {
        document.documentElement.style.setProperty(
          "--nav-height",
          `${headerRef.current.offsetHeight}px`
        );
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [headerRef]);

  // Close More dropdown on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const handleLogout = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      localStorage.removeItem("me");
      window.location.href = "/login";
    }
  };

  const goStage = (next: string) => {
    setIsMenuOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    params.set("stage", next);

    if (next === "QUOTE") {
      params.set("subTab", "OPEN");
    } else if (next === "LEAD") {
      params.set("subTab", "NEW");
    } else {
      params.delete("subTab");
    }

    if (pathname === "/jobs") {
      router.replace(`/jobs?${params.toString()}`);
    } else {
      router.push(`/jobs?${params.toString()}`);
    }
  };

  return (
    <div
      ref={headerRef}
      className="bg-[#1a3a4a] sticky top-0 z-50 border-b border-[#2f4b57]"
    >
      {/* Row 1: Brand + actions */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <span className="text-[#e85d04] font-bold tracking-widest text-base leading-none">
          INSULHUB
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/jobs/new")}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#e85d04]/40 text-[#f97316] bg-[#e85d04]/10 active:bg-[#e85d04]/20"
          >
            + Lead
          </button>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 text-gray-300 active:bg-white/20"
          >
            Log out
          </button>
        </div>
      </div>

      {/* Row 2: Stage navigation */}
      <div className="flex items-center gap-1.5 px-3 pb-2.5">
        <button
          onClick={() => goStage("LEAD")}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
            stage === "LEAD" && !isCalendarView
              ? "bg-[#e85d04] text-white shadow-md shadow-orange-500/30 ring-1 ring-orange-300/40"
              : "bg-[#27424d] text-gray-300"
          }`}
        >
          Leads
        </button>
        <button
          onClick={() => goStage("QUOTE")}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
            stage === "QUOTE" && !isCalendarView
              ? "bg-[#e85d04] text-white shadow-md shadow-orange-500/30 ring-1 ring-orange-300/40"
              : "bg-[#27424d] text-gray-300"
          }`}
        >
          Quotes
        </button>
        <button
          onClick={() => goStage("JOBS")}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
            stage === "JOBS" && !isCalendarView
              ? "bg-[#e85d04] text-white shadow-md shadow-orange-500/30 ring-1 ring-orange-300/40"
              : "bg-[#27424d] text-gray-300"
          }`}
        >
          Jobs
        </button>
        <button
          onClick={() => router.push("/jobs/calendar")}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
            isCalendarView
              ? "bg-[#e85d04] text-white shadow-md shadow-orange-500/30 ring-1 ring-orange-300/40"
              : "bg-[#27424d] text-gray-300"
          }`}
        >
          Calendar
        </button>

        {/* More — post-sale stages */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setIsMenuOpen((v) => !v)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              (activeOtherStage || isReportsView)
                ? "bg-[#e85d04] text-white shadow-md shadow-orange-500/30 ring-1 ring-orange-300/40"
                : "bg-[#27424d] text-gray-300"
            }`}
          >
            {isReportsView ? "Reports" : activeOtherStage ? activeOtherStage.label : "More"}
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
              className={`transition-transform duration-200 ${isMenuOpen ? "rotate-180" : ""}`}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {isMenuOpen && (
            <div className="absolute left-0 top-full mt-1.5 w-44 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 z-50">
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  router.push("/jobs/reports");
                }}
                className={`w-full text-left px-4 py-2.5 text-sm font-medium transition-colors ${
                  isReportsView
                    ? "bg-orange-50 text-[#e85d04]"
                    : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                Reports
                {isReportsView && <span className="float-right text-[#e85d04]">✓</span>}
              </button>
              <div className="my-1 border-t border-gray-100" />
              {OTHER_STAGES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => goStage(s.value)}
                  className={`w-full text-left px-4 py-2.5 text-sm font-medium transition-colors ${
                    stage === s.value
                      ? "bg-orange-50 text-[#e85d04]"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {s.label}
                  {stage === s.value && (
                    <span className="float-right text-[#e85d04]">✓</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function JobsLayout({ children }: { children: ReactNode }) {
  const headerRef = useRef<HTMLDivElement>(null);

  return (
    <div>
      <Suspense>
        <JobsNav headerRef={headerRef} />
      </Suspense>
      {children}
    </div>
  );
}
