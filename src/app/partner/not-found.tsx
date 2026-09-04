import Link from "next/link";

export default function PartnerNotFound() {
  return <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4"><section className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm"><h1 className="text-xl font-bold text-[#1a3a4a]">Draft not found</h1><p className="mt-2 text-sm text-gray-600">It may belong to another company or no longer be available.</p><Link href="/partner" className="mt-5 inline-flex rounded-lg bg-[#1a3a4a] px-4 py-2.5 text-sm font-semibold text-white">Back to dashboard</Link></section></main>;
}
