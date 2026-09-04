import { partnerDemoModeEnabled } from "@/lib/partner/demo";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import PartnerBrand from "@/components/PartnerBrand";
import PartnerAccountPasswordForm from "@/components/PartnerAccountPasswordForm";
import { verifyPartnerRequestHost } from "@/lib/partner/security";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Set your password | InsulHub", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Page() {
  if (!verifyPartnerRequestHost(await headers())) notFound();
  return <main id="main-content" className="partner-portal flex min-h-screen flex-col bg-gray-50">
    <header className="bg-[#1a3a4a] px-4 py-5"><div className="mx-auto max-w-5xl"><PartnerBrand /></div></header>
    {partnerDemoModeEnabled() ? <p className="bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">Local demo only · no emails are sent</p> : null}
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 shadow-md sm:p-8" aria-labelledby="partner-access-heading">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#e85d04]">Partner portal</p>
        <h1 id="partner-access-heading" className="mt-1 text-2xl font-bold text-[#1a3a4a]">Set your password</h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">Choose a password for your partner account.</p>
        <div className="mt-6"><PartnerAccountPasswordForm /></div>
      </section>
    </div>
  </main>;
}
