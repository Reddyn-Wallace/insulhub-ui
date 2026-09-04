"use client";

import Link from "next/link";
import { useState } from "react";

export default function PartnerPdfDownloadButton({ href, className, label = "Download PDF" }: { href: string; className: string; label?: string }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [expired, setExpired] = useState(false); const [message, setMessage] = useState("");
  async function download() {
    if (busy) return; setBusy(true); setError(""); setMessage(""); setExpired(false);
    try {
      const response = await fetch(href, { cache: "no-store" });
      if (response.status === 401) { setExpired(true); setError("Your session expired before the PDF could be downloaded."); return; }
      if (!response.ok) { const result = await response.json().catch(() => null) as { error?: string } | null; setError(result?.error ?? "The PDF could not be downloaded."); return; }
      const blob = await response.blob(); const objectUrl = URL.createObjectURL(blob); const disposition = response.headers.get("content-disposition") ?? "";
      const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]; let fileName = "site-plan.pdf";
      try { if (encoded) fileName = decodeURIComponent(encoded); } catch { /* use safe fallback */ }
      const link = document.createElement("a"); link.href = objectUrl; link.download = fileName; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0); setMessage(`${fileName} download started.`);
    } catch { setError("The PDF could not be downloaded. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return <span className="inline-flex flex-col"><button type="button" onClick={() => void download()} disabled={busy} className={className}>{busy ? "Downloading…" : label}</button>{error ? <span role="alert" className="mt-1 max-w-56 text-xs text-red-700">{error}{expired ? <> <Link href="/partner/login?reason=session-expired" className="font-semibold underline">Sign in again</Link></> : null}</span> : null}{message ? <span role="status" className="sr-only">{message}</span> : null}</span>;
}
