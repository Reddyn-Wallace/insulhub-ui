"use client";

export default function PartnerError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4"><section role="alert" className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm"><h1 className="text-xl font-bold text-[#1a3a4a]">The partner portal could not be loaded</h1><p className="mt-2 text-sm text-gray-600">We can’t confirm whether your last action finished. Check the dashboard before retrying to avoid duplicate work.</p><button type="button" onClick={reset} className="mt-5 rounded-lg bg-[#1a3a4a] px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e85d04]">Try again</button></section></main>;
}
