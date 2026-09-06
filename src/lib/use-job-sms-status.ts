"use client";
import { useEffect, useRef } from "react";

export type SmsStatusUpdate = { id: string; status: string; failureReason?: string | null };
export const smsNeedsStatusCheck = (status: string) => ["sending", "accepted", "sent", "unknown"].includes(status);

// Only queries existing attempts; never submits or retries a send.
export function useJobSmsStatus(jobId: string, messages: SmsStatusUpdate[], onUpdate: (message: SmsStatusUpdate) => void) {
  const latest = useRef({ messages, onUpdate });
  latest.current = { messages, onUpdate };
  useEffect(() => {
    let stopped = false;
    let running = false;
    const controller = new AbortController();
    const checks = new Map<string, { next: number; count: number }>();
    async function tick() {
      if (stopped || running || document.hidden || navigator.onLine === false) return;
      running = true;
      try {
        for (const message of latest.current.messages) {
          if (stopped || document.hidden) break;
          if (!smsNeedsStatusCheck(message.status)) continue;
          const previous = checks.get(message.id);
          if (previous && previous.next > Date.now()) continue;
          const count = (previous?.count || 0) + 1;
          try {
            const response = await fetch(`/api/jobs/${jobId}/sms`, {
              method: "POST", signal: controller.signal,
              headers: { "content-type": "application/json", "x-access-token": localStorage.getItem("token") || "" },
              body: JSON.stringify({ id: message.id, action: "check" }),
            });
            const data = await response.json();
            if (!stopped && response.ok && data.message?.id === message.id) latest.current.onUpdate(data.message);
          } catch { /* Keep the last confirmed status and retry with backoff. */ }
          checks.set(message.id, { count, next: Date.now() + (count < 6 ? 5000 : count < 12 ? 15000 : 60000) });
        }
      } finally { running = false; }
    }
    const timer = setInterval(() => void tick(), 1000);
    const resume = () => { if (!document.hidden) { checks.clear(); void tick(); } };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      stopped = true; controller.abort(); clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [jobId]);
}
