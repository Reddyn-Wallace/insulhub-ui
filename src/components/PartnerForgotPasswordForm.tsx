"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";

export default function PartnerForgotPasswordForm() {
  const [email, setEmail] = useState(""); const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false); const [error, setError] = useState("");
  const inFlight = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current || sent) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254) { setError("Enter a valid email address."); return; }
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/partner/auth/password/request", { method: "POST", cache: "no-store", credentials: "same-origin", referrerPolicy: "no-referrer", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email.trim().toLowerCase() }) });
      if (response.ok) { setSent(true); setEmail(""); }
      else setError(response.status === 429 ? "Too many attempts. Wait a minute and try again." : "Password reset is temporarily unavailable. Try again shortly.");
    } catch { setError("The request could not be confirmed. Check your email before trying again."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <form onSubmit={submit} className="grid gap-4" noValidate>
    {sent ? <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm leading-6 text-emerald-900">If an eligible account matches that email, we’ll send a password-reset link. Check your inbox and junk folder.</p> : <label className="grid gap-1.5 text-sm font-semibold text-gray-700">Email<input disabled={busy} name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className="min-h-12 rounded-lg border border-gray-200 px-3 py-3 text-base text-gray-900 outline-none focus:ring-2 focus:ring-[#e85d04]" /></label>}
    {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
    {!sent ? <button disabled={busy} className="min-h-12 rounded-lg bg-[#c04e03] px-4 py-3 font-semibold text-white hover:bg-[#a84202] disabled:bg-gray-400">{busy ? "Sending…" : "Send reset link"}</button> : null}
    <Link href="/partner/login" className="text-center text-sm font-semibold text-[#a84202] underline">Back to sign in</Link>
  </form>;
}
