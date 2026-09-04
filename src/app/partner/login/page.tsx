import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import PartnerBrand from "@/components/PartnerBrand";
import PartnerLoginForm from "@/components/PartnerLoginForm";
import { requirePartnerPrincipal } from "@/lib/partner/auth";
import { PARTNER_DEMO_ACCOUNTS, partnerDemoModeEnabled } from "@/lib/partner/demo";
import { verifyPartnerRequestHost } from "@/lib/partner/security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PartnerLoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const requestHeaders = await headers();
  if (!verifyPartnerRequestHost(requestHeaders)) notFound();
  const principal = await requirePartnerPrincipal(requestHeaders);
  if (principal) redirect("/partner");
  const demoMode = partnerDemoModeEnabled();
  const reason = (await searchParams).reason;
  return (
    <main id="main-content" className="partner-portal flex min-h-screen flex-col bg-gray-50">
      <a href="#partner-login-heading" className="sr-only z-50 rounded-lg bg-white px-4 py-2 font-semibold text-[#1a3a4a] focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to sign in</a>
      <header className="bg-[#1a3a4a] px-4 py-5"><div className="mx-auto max-w-5xl"><PartnerBrand /></div></header>
      {demoMode ? <div className="border-b border-orange-200 bg-orange-50 px-4 py-2 text-center text-xs font-semibold text-orange-900">Local demo mode · fictional data only</div> : null}
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <section className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 shadow-md sm:p-8" aria-labelledby="partner-login-heading">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#e85d04]">Partner portal</p>
          <h1 id="partner-login-heading" className="mt-1 text-2xl font-bold text-[#1a3a4a]">Sign in</h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">Use the partner account provisioned for you. Company Insul Hub credentials are never used here.</p>
          {reason === "session-expired" ? <p role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Your session expired. Sign in again to continue.</p> : null}
          <div className="mt-6"><PartnerLoginForm surface="partner" demoAccounts={demoMode ? PARTNER_DEMO_ACCOUNTS : []} /></div>
        </section>
      </div>
    </main>
  );
}
