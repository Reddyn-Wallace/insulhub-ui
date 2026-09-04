"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

type DemoAccount = { company: string; email: string; password: string };

export function partnerLoginErrorMessage(status: number, code?: string): string {
  if (status === 403 && code === "ACCOUNT_DISABLED") return "Your account is disabled. Contact your administrator.";
  return status === 429 ? "Too many sign-in attempts. Wait a minute and try again." : "Email or password is incorrect";
}

export default function PartnerLoginForm({ surface, demoAccounts = [] }: { surface: "partner" | "partner-ops"; demoAccounts?: readonly DemoAccount[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true); setError("");
    try {
      const response = await fetch(`/api/${surface}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      const result = await response.json() as { destination?: string; code?: string };
      if (!response.ok || !result.destination) {
        setError(partnerLoginErrorMessage(response.status, result.code));
        return;
      }
      router.replace(result.destination); router.refresh();
    } catch {
      setError("Sign in is temporarily unavailable. Try again.");
    } finally { setSubmitting(false); }
  }

  return (
    <div>
      {demoAccounts.length ? <aside className="mb-5 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-950" aria-label="Local demo accounts"><p className="font-bold">Local demo · fictional accounts</p><p className="mt-1 text-xs">Choose a company to fill its documented local-only credentials.</p><div className="mt-3 grid gap-2">{demoAccounts.map((account) => <button key={account.email} type="button" onClick={() => { setEmail(account.email); setPassword(account.password); setError(""); }} className="rounded-lg border border-orange-200 bg-white px-3 py-2 text-left font-semibold hover:border-[#e85d04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e85d04]"><span className="block">{account.company}</span><span className="block text-xs font-normal text-gray-600">{account.email}</span></button>)}</div></aside> : null}
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <label className="grid gap-1.5 text-sm font-semibold text-gray-700">Email<input value={email} onChange={(event) => setEmail(event.target.value)} name="email" type="email" autoComplete="username" required className="min-h-12 rounded-lg border border-gray-200 px-3 py-3 text-base text-gray-900 outline-none focus:border-transparent focus:ring-2 focus:ring-[#e85d04]" placeholder="you@company.co.nz" /></label>
        <label className="grid gap-1.5 text-sm font-semibold text-gray-700">Password<input value={password} onChange={(event) => setPassword(event.target.value)} name="password" type="password" autoComplete="current-password" required className="min-h-12 rounded-lg border border-gray-200 px-3 py-3 text-base text-gray-900 outline-none focus:border-transparent focus:ring-2 focus:ring-[#e85d04]" placeholder="••••••••" /></label>
        <p ref={errorRef} tabIndex={error ? -1 : undefined} role={error ? "alert" : "status"} aria-live="polite" className={`min-h-5 rounded-lg text-sm outline-none ${error ? "bg-red-50 px-3 py-2 text-red-700 focus:ring-2 focus:ring-red-400" : "text-gray-500"}`}>{error}</p>
        <button type="submit" disabled={submitting} className="min-h-12 rounded-lg bg-[#c04e03] px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-[#a84202] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e85d04] focus-visible:ring-offset-2 disabled:cursor-wait disabled:bg-gray-300 motion-reduce:transition-none">{submitting ? "Signing in…" : "Sign in"}</button>
      </form>
      {surface === "partner" ? <Link href="/partner/forgot-password" className="mt-4 block text-center text-sm font-semibold text-[#a84202] underline">Forgot password?</Link> : null}
    </div>
  );
}
