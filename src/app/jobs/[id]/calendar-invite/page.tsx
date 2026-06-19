"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type ContactTemplate = {
  id: string;
  title: string;
  channel: "sms" | "email" | "calendar";
  description: string;
  subject: string;
  body: string;
  sortOrder: number;
};

function getToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("token") || "";
}

function fmtDateTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-NZ", {
    timeZone: "Pacific/Auckland",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function applyTemplateFields(template: string, fields: Record<string, string>) {
  return template.replace(/\{([^}]+)\}/g, (_match, key) => {
    const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
    return fields[normalized] ?? "";
  });
}

function googleCalendarUrl(input: {
  start: string;
  title: string;
  details: string;
  address: string;
  email: string;
}) {
  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) return "#";

  const end = new Date(start.getTime() + 8 * 60 * 60000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: input.details,
    location: input.address,
  });
  if (input.email) params.append("add", input.email);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export default function CalendarInviteTemplatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [templates, setTemplates] = useState<ContactTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const start = searchParams.get("start") || "";
  const address = searchParams.get("address") || "";
  const name = searchParams.get("name") || "";
  const phone = searchParams.get("phone") || "";
  const email = searchParams.get("email") || "";
  const scope = searchParams.get("scope") || "";
  const note = searchParams.get("note") || "";
  const jobNumber = searchParams.get("jobNumber") || "";
  const returnTo = searchParams.get("returnTo") || "/jobs";
  const firstName = name.trim().split(/\s+/)[0] || name;

  const fields = useMemo(() => ({
    customername: name,
    name,
    firstname: firstName,
    salesperson: "Insulmax",
    address: address || "your property",
    quotebookingdate: "",
    installdate: fmtDateTime(start).replace(/,?\s*\d{1,2}:\d{2}\s*[ap]m/i, ""),
    installtime: new Date(start).toLocaleTimeString("en-NZ", {
      timeZone: "Pacific/Auckland",
      hour: "numeric",
      minute: "2-digit",
    }),
    jobnumber: jobNumber,
    phone,
    email,
  }), [address, email, firstName, jobNumber, name, phone, start]);

  const fallbackTitle = `${address || "Insulmax"} - installation`;
  const fallbackBody = [
    name ? `Name: ${name}` : "",
    phone ? `Phone: ${phone}` : "",
    address ? `Address: ${address}` : "",
    scope ? `Install scope: ${scope}` : "",
    note ? `Notes: ${note}` : "",
  ].filter(Boolean).join("\n");

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push("/login");
      return;
    }

    let cancelled = false;
    fetch("/api/contact-templates?channel=calendar", {
      headers: { "x-access-token": token },
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load calendar templates");
        if (!cancelled) setTemplates(json.templates || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load calendar templates");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="min-h-screen bg-gray-50 pb-10">
      <header className="bg-[#1a3a4a] px-4 pb-4 pt-3 text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button
            type="button"
            onClick={() => router.push(returnTo)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-xl"
            aria-label="Back"
          >
            ‹
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">Choose invite template</h1>
            <p className="truncate text-sm text-white/75">{address || "Installation invite"}</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-5">
        <section className="mb-4 border-b border-gray-200 pb-4 text-sm text-gray-700">
          <div className="font-semibold text-gray-900">{fmtDateTime(start) || "No install date"}</div>
          {name && <div className="mt-1">{name}</div>}
          {email && <div className="mt-1 truncate text-gray-500">{email}</div>}
        </section>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-10 text-center text-sm text-gray-500">Loading templates...</div>
        ) : error ? null : templates.length ? (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            {templates.map((template) => {
              const title = applyTemplateFields(template.subject || template.title, fields);
              const details = applyTemplateFields(template.body, fields);
              const href = googleCalendarUrl({ start, title, details, address, email });

              return (
                <a
                  key={template.id}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-4 last:border-b-0 hover:bg-gray-50"
                >
                  <span className="min-w-0 truncate text-sm font-semibold text-gray-900">{template.title}</span>
                  <span className="shrink-0 text-lg leading-none text-gray-300">›</span>
                </a>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-200 bg-white p-5 text-center text-sm text-gray-600">
            No calendar templates yet.
          </div>
        )}

        <a
          href={googleCalendarUrl({ start, title: fallbackTitle, details: fallbackBody, address, email })}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-semibold text-[#e85d04]"
        >
          No template
          <span className="text-base leading-none">›</span>
        </a>

        <div className="mt-6">
          <Link href="/jobs/settings?channel=calendar" className="text-sm font-semibold text-gray-500">
            Manage templates
          </Link>
        </div>
      </div>
    </main>
  );
}
