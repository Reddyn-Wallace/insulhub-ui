"use client";
import { useCallback, useEffect, useRef } from "react";

export type SmsStatusUpdate = { id: string; status: string; failureReason?: string | null };
type RecordedSms = SmsStatusUpdate & { sentAt?: string | null };
const AUTO_CHECK_WINDOW_MS = 15 * 60_000;
export const smsNeedsStatusCheck = (status: string) => ["sending", "accepted", "sent", "unknown"].includes(status);

async function checkSavedJobSms(jobId: string, id: string, signal?: AbortSignal): Promise<SmsStatusUpdate> {
  const response = await fetch(`/api/jobs/${jobId}/sms`, {
    method: "POST", signal,
    headers: { "content-type": "application/json", "x-access-token": localStorage.getItem("token") || "" },
    body: JSON.stringify({ id, action: "check" }),
  });
  const data = await response.json();
  if (!response.ok || data.message?.id !== id) throw Error(data.error || "Could not check delivery status.");
  return data.message;
}

// Only queries existing attempts; never submits or retries a send.
export function useJobSmsStatus(jobId: string, messages: RecordedSms[], onUpdate: (message: SmsStatusUpdate) => void) {
  const latest = useRef({ messages, onUpdate });
  latest.current = { messages, onUpdate };
  const inFlight = useRef(new Map<string, Promise<SmsStatusUpdate>>());
  const checkStatus = useCallback((id: string, signal?: AbortSignal) => {
    const key = `${jobId}:${id}`;
    const existing = inFlight.current.get(key);
    if (existing) return existing;
    const request = checkSavedJobSms(jobId, id, signal).finally(() => {
      inFlight.current.delete(key);
    });
    inFlight.current.set(key, request);
    return request;
  }, [jobId]);
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
          const age = Date.now() - Date.parse(message.sentAt || "");
          if (!smsNeedsStatusCheck(message.status) || !(age < AUTO_CHECK_WINDOW_MS)) continue;
          const previous = checks.get(message.id);
          if (previous && previous.next > Date.now()) continue;
          const count = (previous?.count || 0) + 1;
          try {
            const update = await checkStatus(message.id, controller.signal);
            if (!stopped && (update.status !== message.status || (update.failureReason || "") !== (message.failureReason || ""))) {
              latest.current.onUpdate(update);
            }
          } catch { /* Keep the last confirmed status and retry with backoff. */ }
          checks.set(message.id, { count, next: Date.now() + (count < 6 ? 5000 : count < 12 ? 15000 : 60000) });
        }
      } finally { running = false; }
    }
    const timer = setInterval(() => void tick(), 1000);
    const resume = () => { void tick(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      stopped = true; controller.abort(); clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [checkStatus]);
  return { checkStatus };
}
