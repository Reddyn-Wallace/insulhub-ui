"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";

export default function EbaPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id || "";

  const legacyUrl = useMemo(() => `https://www.insulhub.nz/job/${id}/eba`, [id]);

  return (
    <div className="min-h-screen bg-[#f8f7f4]">
      <div className="sticky top-0 z-20 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <button onClick={() => router.push(`/jobs/${id}`)} className="text-sm text-gray-600">← Back to Job</button>
        <h1 className="text-sm font-semibold text-gray-800">EBA</h1>
        <a href={legacyUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#e85d04] font-medium">Open full page ↗</a>
      </div>

      <div className="p-4">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden" style={{ height: "calc(100vh - 90px)" }}>
          <iframe title="EBA" src={legacyUrl} className="w-full h-full" allow="clipboard-read; clipboard-write" />
        </div>
      </div>
    </div>
  );
}
