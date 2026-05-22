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

      <div className="mx-auto max-w-6xl px-4 py-5">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-600">Manage saved SMS, email, and calendar invite templates.</p>
        </div>

        <div className="grid gap-5 md:grid-cols-[180px_1fr]">
          <aside className="md:border-r md:border-gray-200 md:pr-4">
            <nav className="flex gap-2 overflow-x-auto md:block md:space-y-1 md:overflow-visible">
              <button
                type="button"
                className="shrink-0 rounded-lg bg-[#1a3a4a] px-4 py-2.5 text-left text-sm font-semibold text-white md:w-full"
              >
                Templates
              </button>
            </nav>
          </aside>

          <section className="min-w-0 rounded-lg border border-gray-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-3">
              <div className="grid flex-1 grid-cols-3 gap-2 sm:max-w-md">
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
              <Link
                href={`/jobs/settings/templates/new?channel=${activeChannel}`}
                className="shrink-0 rounded-lg bg-[#e85d04] px-4 py-2.5 text-sm font-semibold text-white"
              >
                New Template
              </Link>
            </div>

            <div className="p-3">
              {loading ? (
                <div className="py-8 text-center text-sm text-gray-500">Loading templates...</div>
              ) : visibleTemplates.length ? (
                <div className="divide-y divide-gray-100">
                  {visibleTemplates.map((template) => (
                    <Link
                      key={template.id}
                      href={`/jobs/settings/templates/${template.id}`}
                      className="flex items-center justify-between gap-3 px-1 py-3 hover:bg-gray-50 sm:px-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-900">{template.title}</div>
                        {template.description && <div className="mt-0.5 truncate text-xs text-gray-500">{template.description}</div>}
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs text-gray-500">
                        <span className="hidden sm:inline">{channelLabel(template.channel)}</span>
                        <span className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700">Edit</span>
                      </div>
                    </Link>
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
      </div>
    </main>
  );
}
