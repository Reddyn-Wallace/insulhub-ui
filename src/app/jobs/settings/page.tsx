"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppDialog } from "@/components/AppDialog";

type ContactTemplate = {
  id: string;
  title: string;
  channel: "sms" | "email";
  description: string;
  subject: string;
  body: string;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
};

const EMPTY_FORM = {
  title: "",
  channel: "sms" as "sms" | "email",
  description: "",
  subject: "",
  body: "",
  sortOrder: "0",
};

const FIELD_OPTIONS = ["customer name", "first name", "salesperson", "address", "quote booking date", "job number", "phone", "email"];
const PREVIEW_FIELDS: Record<string, string> = {
  customername: "Jane Smith",
  name: "Jane Smith",
  firstname: "Jane",
  salesperson: "Reddyn",
  address: "34 Rua Street",
  quotebookingdate: "Tue, 26 May 2026, 10:00 AM",
  jobnumber: "1234",
  phone: "021 123 4567",
  email: "jane@example.com",
};

function getToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("token") || "";
}

function applyTemplateFields(template: string, fields: Record<string, string>) {
  return template.replace(/\{([^}]+)\}/g, (_match, key) => {
    const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
    return fields[normalized] ?? `{${key}}`;
  });
}

function sortTemplates(templates: ContactTemplate[]) {
  return [...templates].sort((a, b) => (
    a.channel.localeCompare(b.channel) ||
    Number(a.sortOrder || 0) - Number(b.sortOrder || 0) ||
    a.title.localeCompare(b.title)
  ));
}

export default function SettingsPage() {
  const router = useRouter();
  const { confirm, dialog } = useAppDialog();
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [templates, setTemplates] = useState<ContactTemplate[]>([]);
  const [activeChannel, setActiveChannel] = useState<"sms" | "email">("sms");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const visibleTemplates = useMemo(
    () => templates.filter((template) => template.channel === activeChannel),
    [templates, activeChannel]
  );
  const previewSubject = applyTemplateFields(form.subject || "", PREVIEW_FIELDS);
  const previewBody = applyTemplateFields(form.body || "", PREVIEW_FIELDS);

  const resetForm = useCallback((channel: "sms" | "email" = activeChannel) => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, channel });
  }, [activeChannel]);

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

  function selectTemplate(template: ContactTemplate) {
    setEditingId(template.id);
    setActiveChannel(template.channel);
    setForm({
      title: template.title,
      channel: template.channel,
      description: template.description || "",
      subject: template.subject || "",
      body: template.body,
      sortOrder: String(template.sortOrder || 0),
    });
  }

  function insertField(field: string) {
    const token = `{${field}}`;
    const input = bodyRef.current;
    if (!input) {
      setForm((prev) => ({ ...prev, body: `${prev.body}${prev.body ? " " : ""}${token}` }));
      return;
    }

    const start = input.selectionStart ?? form.body.length;
    const end = input.selectionEnd ?? form.body.length;
    const nextBody = `${form.body.slice(0, start)}${token}${form.body.slice(end)}`;
    setForm((prev) => ({ ...prev, body: nextBody }));
    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function saveTemplate() {
    const token = getToken();
    if (!token) return;

    const title = form.title.trim();
    const body = form.body.trim();
    if (!title || !body) {
      setToast({ type: "error", text: "Template name and message are required." });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(editingId ? `/api/contact-templates/${editingId}` : "/api/contact-templates", {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json", "x-access-token": token },
        body: JSON.stringify({
          ...form,
          title,
          body,
          subject: form.channel === "email" ? form.subject.trim() : "",
          description: form.description.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not save template");

      const saved = json.template as ContactTemplate;
      setTemplates((prev) => sortTemplates([...prev.filter((template) => template.id !== saved.id), saved]));
      setActiveChannel(saved.channel);
      selectTemplate(saved);
      setToast({ type: "success", text: "Template saved." });
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "Could not save template" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate() {
    if (!editingId) return;
    const token = getToken();
    if (!token) return;

    const shouldDelete = await confirm({
      title: "Delete template?",
      description: "This template will be removed for everyone using SMS and email sending.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!shouldDelete) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/contact-templates/${editingId}`, {
        method: "DELETE",
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not delete template");
      setTemplates((prev) => prev.filter((template) => template.id !== editingId));
      resetForm(activeChannel);
      setToast({ type: "success", text: "Template deleted." });
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "Could not delete template" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
      {dialog}
      {toast && (
        <div className="fixed z-[70] left-1/2 -translate-x-1/2 bottom-4 md:left-auto md:translate-x-0 md:right-4 md:bottom-5 w-[92vw] md:w-auto md:max-w-md">
          <div className={`rounded-xl shadow-lg border px-4 py-3 text-sm ${toast.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
            <div className="flex items-start justify-between gap-3">
              <span>{toast.text}</span>
              <button onClick={() => setToast(null)} className="text-xs opacity-70 hover:opacity-100">x</button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl px-4 py-5">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <p className="mt-1 text-sm text-gray-600">Manage the saved SMS and email templates used from job contact actions.</p>
          </div>
          <button
            type="button"
            onClick={() => resetForm(activeChannel)}
            className="shrink-0 rounded-lg bg-[#e85d04] px-4 py-2.5 text-sm font-semibold text-white"
          >
            New Template
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <section className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 p-3">
              <div className="grid grid-cols-2 gap-2">
                {(["sms", "email"] as const).map((channel) => (
                  <button
                    key={channel}
                    type="button"
                    onClick={() => {
                      setActiveChannel(channel);
                      if (!editingId || form.channel !== channel) resetForm(channel);
                    }}
                    className={`rounded-lg border py-2.5 text-sm font-semibold ${activeChannel === channel ? "border-[#e85d04] bg-orange-50 text-[#c2410c]" : "border-gray-200 bg-white text-gray-700"}`}
                  >
                    {channel === "sms" ? "SMS" : "Email"}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[calc(100vh-230px)] overflow-y-auto p-3">
              {loading ? (
                <div className="py-8 text-center text-sm text-gray-500">Loading templates...</div>
              ) : visibleTemplates.length ? (
                <div className="space-y-2">
                  {visibleTemplates.map((template) => {
                    const active = editingId === template.id;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => selectTemplate(template)}
                        className={`w-full rounded-lg border p-3 text-left transition ${active ? "border-[#e85d04] bg-orange-50" : "border-gray-200 bg-white hover:border-gray-300"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-gray-900">{template.title}</div>
                            {template.description && <div className="mt-0.5 truncate text-xs text-gray-500">{template.description}</div>}
                          </div>
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-gray-600">
                            {template.channel === "sms" ? "SMS" : "Email"}
                          </span>
                        </div>
                        <div className="mt-2 line-clamp-2 whitespace-pre-wrap text-xs text-gray-500">{template.body}</div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-gray-200 p-5 text-center">
                  <div className="text-sm font-semibold text-gray-800">No {activeChannel === "sms" ? "SMS" : "email"} templates</div>
                  <div className="mt-1 text-xs text-gray-500">Create one using the form.</div>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{editingId ? "Edit Template" : "New Template"}</div>
                  <h2 className="mt-0.5 text-lg font-bold text-gray-900">{form.title.trim() || "Untitled template"}</h2>
                </div>
                {editingId && (
                  <button
                    type="button"
                    onClick={deleteTemplate}
                    disabled={saving}
                    className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 disabled:opacity-50"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["sms", "email"] as const).map((channel) => (
                      <button
                        key={channel}
                        type="button"
                        onClick={() => {
                          setForm((prev) => ({ ...prev, channel, subject: channel === "sms" ? "" : prev.subject }));
                          setActiveChannel(channel);
                        }}
                        className={`rounded-lg border py-2.5 text-sm font-semibold ${form.channel === channel ? "border-[#e85d04] bg-orange-50 text-[#c2410c]" : "border-gray-200 bg-white text-gray-700"}`}
                      >
                        {channel === "sms" ? "SMS" : "Email"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Order</label>
                  <input
                    value={form.sortOrder}
                    onChange={(event) => setForm((prev) => ({ ...prev, sortOrder: event.target.value }))}
                    inputMode="numeric"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Template Name</label>
                  <input
                    value={form.title}
                    onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
                    placeholder="Lead follow-up"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Description</label>
                  <input
                    value={form.description}
                    onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
                    placeholder="Quick first response"
                  />
                </div>
              </div>

              {form.channel === "email" && (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Subject</label>
                  <input
                    value={form.subject}
                    onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
                    placeholder="Insulmax enquiry #{job number}"
                  />
                </div>
              )}

              <div>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Message</label>
                  <span className="text-[11px] text-gray-400">{form.body.length} chars</span>
                </div>
                <textarea
                  ref={bodyRef}
                  value={form.body}
                  onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
                  rows={9}
                  className="w-full resize-none rounded-lg border border-gray-200 px-3 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
                  placeholder="Hi {customer name}, {salesperson} from Insulmax here..."
                />
              </div>

              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Insert Field</div>
                <div className="flex flex-wrap gap-2">
                  {FIELD_OPTIONS.map((field) => (
                    <button
                      key={field}
                      type="button"
                      onClick={() => insertField(field)}
                      className="rounded-full bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-700"
                    >
                      {`{${field}}`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Preview</div>
                {form.channel === "email" && (
                  <div className="mb-2 text-xs text-gray-600">
                    <span className="font-semibold text-gray-700">Subject:</span> {previewSubject || "-"}
                  </div>
                )}
                <p className="whitespace-pre-wrap text-sm text-gray-700">{previewBody || "Template body preview will appear here."}</p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => resetForm(activeChannel)}
                  className="rounded-lg bg-gray-100 px-4 py-3 font-semibold text-gray-700"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={saveTemplate}
                  disabled={saving || !form.title.trim() || !form.body.trim()}
                  className="flex-1 rounded-lg bg-[#e85d04] py-3 font-semibold text-white disabled:opacity-50"
                >
                  {saving ? "Saving..." : editingId ? "Save Changes" : "Create Template"}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
