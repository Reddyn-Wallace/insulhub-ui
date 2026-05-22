"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ContactTemplate = {
  id: string;
  title: string;
  channel: "sms" | "email" | "calendar";
  description: string;
  subject: string;
  body: string;
  sortOrder: number;
};

const CHANNELS = ["sms", "email", "calendar"] as const;

function getToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("token") || "";
}

function sortTemplates(templates: ContactTemplate[]) {
  return [...templates].sort((a, b) => (
    a.channel.localeCompare(b.channel) ||
    Number(a.sortOrder || 0) - Number(b.sortOrder || 0) ||
    a.title.localeCompare(b.title)
  ));
}

function channelLabel(channel: ContactTemplate["channel"]) {
  if (channel === "sms") return "SMS";
  if (channel === "email") return "Email";
  return "Calendar";
}

export default function SettingsPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<ContactTemplate[]>([]);
  const [activeChannel, setActiveChannel] = useState<ContactTemplate["channel"]>("sms");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const requestedChannel = new URLSearchParams(window.location.search).get("channel");
    if (requestedChannel === "sms" || requestedChannel === "email" || requestedChannel === "calendar") {
      setActiveChannel(requestedChannel);
    }
  }, []);

  const visibleTemplates = useMemo(
    () => templates.filter((template) => template.channel === activeChannel),
    [templates, activeChannel]
  );

  const loadTemplates = useCallback(async () => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/contact-templates", {
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load templates");
      setTemplates(sortTemplates(json.templates || []));
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "Failed to load templates" });
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <main className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
      {toast && (
        <div className="fixed z-[70] left-1/2 -translate-x-1/2 bottom-4 md:left-auto md:translate-x-0 md:right-4 md:bottom-5 w-[92vw] md:w-auto md:max-w-md">
          <div className={`rounded-xl shadow-lg border px-4 py-3 text-sm ${toast.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
            <div className="flex items-start justify-between gap-3">
              <span>{toast.text}</span>
              <button type="button" onClick={() => setToast(null)} className="text-xs opacity-70 hover:opacity-100">x</button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-5xl px-4 py-5">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <p className="mt-1 text-sm text-gray-600">Manage saved SMS, email, and calendar invite templates.</p>
          </div>
          <Link
            href={`/jobs/settings/templates/new?channel=${activeChannel}`}
            className="shrink-0 rounded-lg bg-[#e85d04] px-4 py-2.5 text-sm font-semibold text-white"
          >
            New Template
          </Link>
        </div>

        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 p-3">
            <div className="grid grid-cols-3 gap-2">
              {CHANNELS.map((channel) => (
                <button
                  key={channel}
                  type="button"
                  onClick={() => setActiveChannel(channel)}
                  className={`rounded-lg border py-2.5 text-sm font-semibold ${activeChannel === channel ? "border-[#e85d04] bg-orange-50 text-[#c2410c]" : "border-gray-200 bg-white text-gray-700"}`}
                >
                  {channelLabel(channel)}
                </button>
              ))}
            </div>
          </div>

          <div className="p-3">
            {loading ? (
              <div className="py-8 text-center text-sm text-gray-500">Loading templates...</div>
            ) : visibleTemplates.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {visibleTemplates.map((template) => (
                  <article key={template.id} className="rounded-lg border border-gray-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-900">{template.title}</div>
                        {template.description && <div className="mt-0.5 truncate text-xs text-gray-500">{template.description}</div>}
                      </div>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-gray-600">
                        {channelLabel(template.channel)}
                      </span>
                    </div>
                    {(template.channel === "email" || template.channel === "calendar") && template.subject && (
                      <div className="mt-2 truncate text-xs font-medium text-gray-600">{template.subject}</div>
                    )}
                    <div className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-gray-500">{template.body}</div>
                    <div className="mt-3 flex justify-end">
                      <Link
                        href={`/jobs/settings/templates/${template.id}`}
                        className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700"
                      >
                        Edit
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-200 p-5 text-center">
                <div className="text-sm font-semibold text-gray-800">No {activeChannel === "sms" ? "SMS" : activeChannel === "email" ? "email" : "calendar"} templates</div>
                <Link
                  href={`/jobs/settings/templates/new?channel=${activeChannel}`}
                  className="mt-3 inline-flex rounded-lg bg-[#e85d04] px-4 py-2.5 text-sm font-semibold text-white"
                >
                  Create Template
                </Link>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
