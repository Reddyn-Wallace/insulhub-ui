"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { quoteSortPreference } from "@/lib/crm-read/quotes";
import { checkQuoteFirstPage, quoteFirstPageBudgetMs, type QuoteFirstPageReport } from "@/lib/crm-read/quote-first-page-check";

export default function QuoteFirstPageCheck() {
  const running = useRef<AbortController | null>(null);
  const [report, setReport] = useState<QuoteFirstPageReport | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => () => running.current?.abort(), []);

  async function compare() {
    const token = localStorage.getItem("token");
    if (!token) {
      setStatus("Sign in to the CRM to run this read-only check.");
      return;
    }
    const controller = new AbortController();
    running.current = controller;
    setReport(null);
    setBusy(true);
    setStatus("Checking which requests return the same Open quotes.");
    try {
      const newest = localStorage.getItem(quoteSortPreference) === "newest";
      const result = await checkQuoteFirstPage(token, newest, controller.signal);
      if (controller.signal.aborted) return;
      setReport(result);
      setStatus("Comparison complete.");
    } catch {
      if (!controller.signal.aborted) setStatus("The comparison could not finish. Check your sign-in and retry.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      running.current = null;
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4 text-sm text-gray-800">
      <Link href="/jobs?stage=QUOTE&subTab=OPEN" className="underline">Back to Quotes</Link>
      <h1 className="text-xl font-semibold">Quotes first-page check</h1>
      <p>Compare read-only requests against the existing Open list.</p>
      <button type="button" disabled={busy} onClick={() => void compare()} className="rounded-lg bg-[#1a3a4a] px-3 py-2 font-semibold text-white disabled:opacity-60">
        Run comparison
      </button>
      {status && <p role="status">{status}</p>}
      {report && (
        <div className="space-y-3">
          <p>{report.expected} open quotes from the full list in {report.baselineMs} ms.</p>
          <ul className="space-y-2">
            {report.results.map(result => {
              const p95 = result.samples.length === 20 ? [...result.samples].sort((a, b) => a - b)[18] : undefined;
              return (
                <li key={result.name} className="rounded-lg bg-white p-3">
                  <p className="font-semibold">{result.name}</p>
                  <p>{result.reason || `${result.match ? "Matched" : "Different"} · ${result.returned} source rows · ${result.samples.length} reads · ${result.samples[0]} ms first read`}</p>
                  {p95 !== undefined && <p>95th percentile request time {p95} ms · target {quoteFirstPageBudgetMs} ms</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </main>
  );
}
