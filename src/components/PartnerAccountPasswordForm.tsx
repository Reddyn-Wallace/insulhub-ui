"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";

const inputClass = "min-h-12 rounded-lg border border-gray-200 px-3 py-3 text-base text-gray-900 outline-none focus:ring-2 focus:ring-[#e85d04]";
const passwordPolicy = "Use 12–128 characters with lowercase, uppercase, a number and a symbol.";

export default function PartnerAccountPasswordForm() {
  const token = useRef("");
  const initialized = useRef(false);
  const inFlight = useRef(false);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState(""); const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [complete, setComplete] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const supplied = fragment.get("token") ?? "";
    // Keep the one-use secret in memory only, never URL history or browser storage.
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    if (fragment.getAll("token").length === 1 && /^[A-Za-z0-9_-]{32,256}$/.test(supplied)) { token.current = supplied; setReady(true); }
    else setError("This link is invalid or has expired. Request a new link.");
  }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!ready || inFlight.current || complete) return;
    if (password.length < 12 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[\W_]/.test(password)) { setError(passwordPolicy); return; }
    if (confirmation !== password) { setError("Passwords do not match."); return; }
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/partner/auth/password/complete", { method: "POST", cache: "no-store", credentials: "same-origin", referrerPolicy: "no-referrer", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: token.current, password }) });
      if (response.ok) { token.current = ""; setPassword(""); setConfirmation(""); setComplete(true); setReady(false); return; }
      if (response.status === 400) { token.current = ""; setReady(false); setError("This link is invalid or has expired. Request a new link."); }
      else if (response.status === 429) setError("Too many attempts. Wait fifteen minutes and try again.");
      else setError("Your password could not be updated. Try again shortly.");
    } catch { setError("The result could not be confirmed. Try signing in with your new password, or request a new link."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (complete) return <div className="grid gap-4"><p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Your password has been set. Sign in to continue.</p><Link href="/partner/login" className="min-h-12 rounded-lg bg-[#c04e03] px-4 py-3 text-center font-semibold text-white">Back to sign in</Link></div>;
  return <form onSubmit={submit} className="grid gap-4" noValidate>
    {ready ? <><label className="grid gap-1.5 text-sm font-semibold text-gray-700">New password<input disabled={busy} type="password" name="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} aria-describedby="partner-password-policy" /></label>
      <label className="grid gap-1.5 text-sm font-semibold text-gray-700">Confirm password<input disabled={busy} type="password" name="confirmation" autoComplete="new-password" minLength={12} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className={inputClass} /></label>
      <p id="partner-password-policy" className="text-xs leading-5 text-gray-600">{passwordPolicy}</p></> : null}
    {error ? <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 outline-none focus:ring-2 focus:ring-red-400">{error}</p> : null}
    {ready ? <button disabled={busy} className="min-h-12 rounded-lg bg-[#c04e03] px-4 py-3 font-semibold text-white hover:bg-[#a84202] disabled:bg-gray-400">{busy ? "Saving…" : "Set password"}</button> : null}
    <Link href="/partner/forgot-password" className="text-center text-sm font-semibold text-[#a84202] underline">Request a new password link</Link>
    <Link href="/partner/login" className="text-center text-sm text-gray-600 underline">Back to sign in</Link>
  </form>;
}
