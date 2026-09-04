"use client";

import { useEffect, useState } from "react";
import { formatPartnerDate } from "@/lib/partner/date";
import type { NeutralPartnerTracking } from "@/lib/partner/neutral-tracking";

export default function PartnerAmendments({ jobId }: { jobId: string }) {
  const [tracking, setTracking] = useState<NeutralPartnerTracking | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.resolve(fetch(`/api/partner/jobs/${encodeURIComponent(jobId)}/tracking`, { cache: "no-store", credentials: "same-origin" }))
      .then(async (response) => { if (!response?.ok) throw new Error("tracking unavailable"); return response.json() as Promise<{ tracking: NeutralPartnerTracking }>; })
      .then((result) => { if (active) { setTracking(result.tracking); setState("ready"); } })
      .catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [jobId, attempt]);
  if (state === "loading") return <p className="mt-4 text-sm text-slate-500" role="status">Checking for updates…</p>;
  if (state === "error") return <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><span>Updates couldn’t be loaded.</span><button type="button" onClick={() => { setState("loading"); setAttempt((value) => value + 1); }} className="min-h-11 rounded-lg border border-amber-300 bg-white px-3 font-semibold">Try again</button></div>;
  if (!tracking?.amendments.length) return null;
  return <section className="mt-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="partner-updates-heading">
    <h2 id="partner-updates-heading" className="text-lg font-bold text-[#1a3a4a]">Updates from InsulHub</h2>
    <div className="mt-3 space-y-3">{tracking.amendments.map((item) => <article key={item.sequence} className="rounded-xl bg-slate-50 p-3"><p className="text-sm text-slate-800">{item.description}</p><p className="mt-1 text-xs text-slate-500">{formatPartnerDate(item.createdAt)}</p></article>)}</div>
  </section>;
}
