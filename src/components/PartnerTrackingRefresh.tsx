"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
export default function PartnerTrackingRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())} className="inline-flex min-h-11 items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-[#1a3a4a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e85d04] disabled:opacity-50">{pending ? "Refreshing…" : "Refresh job updates"}</button>;
}
