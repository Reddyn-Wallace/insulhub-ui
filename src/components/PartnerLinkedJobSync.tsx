"use client";
import { useEffect, useState } from "react";
import { settingsRequest } from "@/lib/partner/settings-client";

/** Status sync is independent of a successful legacy save. Never fails the save. */
export default function PartnerLinkedJobSync({ jobId, version }: { jobId: string; version: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void settingsRequest("/api/settings/partners/job-status", "POST", { legacyId: jobId })
        .then(() => { if (active) setFailed(false); })
        .catch(() => { if (active) setFailed(true); });
    }, 500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [jobId, version]);
  return failed ? <p role="status" className="px-4 py-2 text-xs text-amber-800">Partner status could not be checked. Your InsulHub job is unchanged. Check its status in Settings → Partners when the connection is available.</p> : null;
}
