"use client";

export default function OperationsError({reset}:{reset:()=>void}) {
  return <main className="flex min-h-screen items-center justify-center bg-[#f6f8f9] p-4"><section role="alert" className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-sm"><h1 className="text-xl font-bold text-[#1a3a4a]">Settings could not be opened</h1><p className="mt-3 text-sm leading-6 text-gray-600">Partner companies and users are now managed in InsulHub Settings.</p><button type="button" onClick={reset} className="mt-5 min-h-11 rounded-lg bg-[#1a3a4a] px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e85d04]">Try again</button></section></main>;
}
