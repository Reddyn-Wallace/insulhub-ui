"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReactNode, useState } from "react";
import { clearDraftRecoveryScope, type DraftRecoveryStorage } from "@/lib/partner/draft";
import type { PartnerViewer } from "@/lib/partner/repository";
import { clearSitePlanRecoveryScope } from "@/lib/partner/site-plan-client";
import { clearPartnerSubmissionScope } from "@/lib/partner/submission-client";
import PartnerBrand from "./PartnerBrand";
import { flushPartnerEdits } from "@/lib/partner/navigation-save";

function browserRecoveryStorage(): DraftRecoveryStorage | null { try { return window.sessionStorage; } catch { return null; } }
function browserSubmissionStorage(): Storage | null { try { return window.localStorage; } catch { return null; } }

export default function PartnerShell({ viewer, demoMode, recoveryScope, children, fullScreen = false }: { viewer: PartnerViewer; demoMode: boolean; recoveryScope: string; children: ReactNode; fullScreen?: boolean }) {
  const router = useRouter();
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  async function logout() {
    setLoggingOut(true);
    setLogoutError("");
    let signedOut = false;
    try {
      if (!await flushPartnerEdits()) { setLogoutError("Finish saving your changes before signing out."); return; }
      const response = await fetch("/api/partner/auth/logout", { method: "POST" });
      if (!response.ok) { setLogoutError("Sign out did not complete. Please try again."); return; }
      clearDraftRecoveryScope(browserRecoveryStorage(), recoveryScope);
      clearSitePlanRecoveryScope(browserRecoveryStorage(), recoveryScope);
      clearPartnerSubmissionScope(recoveryScope, browserSubmissionStorage());
      signedOut = true;
      router.replace("/partner/login");
      router.refresh();
    } catch {
      setLogoutError("Sign out is temporarily unavailable.");
    } finally {
      if (!signedOut) setLoggingOut(false);
    }
  }


  return (
    <div className={`partner-portal bg-[#f6f8f9] text-gray-900 ${fullScreen ? "flex h-dvh flex-col overflow-hidden" : "min-h-screen"}`}>
      <a href="#main-content" className="sr-only z-50 rounded-lg bg-white px-4 py-2 font-semibold text-[#1a3a4a] focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to main content</a>
      <header className={`${fullScreen ? "hidden" : "sticky"} top-0 z-40 shrink-0 border-b border-[#2f4b57] bg-[#1a3a4a] text-white shadow-sm`}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/partner" className="inline-flex min-h-11 items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f97316]" aria-label="InsulHub partner dashboard">
            <PartnerBrand compact />
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden min-w-0 text-right sm:block">
              <p className="truncate text-sm font-semibold">{viewer.userName}</p>
              <p className="truncate text-xs text-gray-300">{viewer.companyName}</p>
            </div>
            {viewer.role === "ADMIN" ? <Link href="/partner/users" className="inline-flex min-h-11 items-center rounded-lg bg-white/10 px-3 text-sm font-semibold hover:bg-white/20">Manage users</Link> : null}
            <button type="button" onClick={logout} disabled={loggingOut} className="min-h-11 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-gray-100 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60">
              {loggingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
        {logoutError ? <p role="alert" className="border-t border-red-300/20 bg-red-950/40 px-4 py-2 text-center text-sm text-red-100">{logoutError}</p> : null}
      </header>
      {demoMode ? <div className="border-b border-orange-200 bg-orange-50 px-4 py-2 text-center text-xs font-semibold text-orange-900">Local demo · fictional data only · changes reset when the server restarts</div> : null}
      <main id="main-content" inert={loggingOut} className={fullScreen ? "min-h-0 w-full flex-1" : "mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8"}>{children}</main>
    </div>
  );
}
