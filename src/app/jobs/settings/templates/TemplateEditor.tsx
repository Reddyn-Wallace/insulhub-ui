"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppDialog } from "@/components/AppDialog";
import { followupTemplateItem, followupTemplateKey } from "@/lib/dead-followups/template-settings";
import { renderTemplate, type OfferTemplate, type TemplateRecord } from "@/lib/dead-followups/templates";

type TemplateChannel = "sms" | "email" | "calendar";

type ContactTemplate = {
  id: string;
  title: string;
  channel: TemplateChannel;
  description: string;
  subject: string;
  body: string;
  sortOrder: number;
};

type TemplateEvent = { revision: number; actorName: string; createdAt: string; templates: OfferTemplate[] };

type TemplateForm = {
  title: string;
  channel: TemplateChannel;
  description: string;
  subject: string;
  body: string;
  sortOrder: string;
};

const CHANNELS: TemplateChannel[] = ["sms", "email", "calendar"];
const FIELD_OPTIONS = ["customer name", "first name", "salesperson", "salesperson first name", "address", "quote booking date", "install date", "install time", "job number", "phone", "email"];
const PREVIEW_FIELDS: Record<string, string> = {
  customername: "Jane Smith",
  name: "Jane Smith",
  firstname: "Jane",
  salesperson: "Reddyn Wallace",
  salespersonname: "Reddyn Wallace",
  salesrep: "Reddyn Wallace",
  salesrepname: "Reddyn Wallace",
  salesconsultant: "Reddyn Wallace",
  salesconsultantname: "Reddyn Wallace",
  salespersonfirstname: "Reddyn",
  salespersonfirst: "Reddyn",
  salesrepfirstname: "Reddyn",
  salesrepfirst: "Reddyn",
  salesconsultantfirstname: "Reddyn",
  salesconsultantfirst: "Reddyn",
  address: "34 Rua Street",
  quotebookingdate: "Tue, 26 May 2026, 10:00 AM",
  installdate: "Tue, 26 May 2026",
  installtime: "8:00 AM",
  jobnumber: "1234",
  phone: "021 123 4567",
  email: "jane@example.com",
};

function getToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("token") || "";
}

function channelLabel(channel: TemplateChannel) {
  if (channel === "sms") return "SMS";
  if (channel === "email") return "Email";
  return "Calendar";
}

function emptyForm(channel: TemplateChannel): TemplateForm {
  return {
    title: "",
    channel,
    description: "",
    subject: "",
    body: "",
    sortOrder: "0",
  };
}

function applyTemplateFields(template: string, fields: Record<string, string>) {
  return template.replace(/\{([^}]+)\}/g, (_match, key) => {
    const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
    return fields[normalized] ?? `{${key}}`;
  });
}

function validChannel(value?: string): TemplateChannel {
  return value === "email" || value === "calendar" ? value : "sms";
}

export default function TemplateEditor({ templateId, initialChannel = "sms" }: { templateId?: string; initialChannel?: string }) {
  const router = useRouter();
  const { confirm, dialog } = useAppDialog();
  const followup = useMemo(() => followupTemplateKey(templateId), [templateId]);
  const [record, setRecord] = useState<TemplateRecord | null>(null);
  const [events, setEvents] = useState<TemplateEvent[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [locked, setLocked] = useState(Boolean(templateId));
  const [isPreview, setIsPreview] = useState(false);
  const requestActive = useRef(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const isEditing = Boolean(templateId);
  const [form, setForm] = useState<TemplateForm>(() => emptyForm(followup?.channel || validChannel(initialChannel)));
  const [loading, setLoading] = useState(Boolean(templateId));
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const readOnly = Boolean(followup && !canManage);
  const fields = followup ? ["discount", "name", "quoteNumber"] : FIELD_OPTIONS;
  const fieldToken = (field: string) => followup ? `{{${field}}}` : `{${field}}`;
  const preview = useMemo(() => followup
    ? renderTemplate({ ...followup, subject: form.subject, body: form.body }, { discountCents: 50000, name: "Alex", quoteNumber: 123 })
    : { subject: applyTemplateFields(form.subject, PREVIEW_FIELDS), body: applyTemplateFields(form.body, PREVIEW_FIELDS) }, [followup, form.subject, form.body]);

  const loadTemplate = useCallback(async () => {
    if (!templateId || requestActive.current) return;
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    requestActive.current = true;
    setLoading(true);
    setLocked(true);
    setToast(null);
    try {
      const res = await fetch(followup ? "/api/dead-followups/templates" : "/api/contact-templates", {
        headers: { "x-access-token": token },
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load templates");
      let template: ContactTemplate | undefined;
      if (followup) {
        const savedRecord = json.record as TemplateRecord;
        const saved = savedRecord.templates.find((item) => item.channel === followup.channel && item.approach === followup.approach);
        if (saved) template = followupTemplateItem(saved);
        setRecord(savedRecord);
        setEvents(json.events || []);
        setCanManage(json.canManage === true);
        setIsPreview(json.preview === true);
      } else {
        template = (json.templates || []).find((item: ContactTemplate) => item.id === templateId);
      }
      if (!template) throw new Error("Template not found");
      setForm({
        title: template.title,
        channel: template.channel,
        description: template.description || "",
        subject: template.subject || "",
        body: template.body,
        sortOrder: String(template.sortOrder || 0),
      });
      setLocked(false);
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "Failed to load template" });
    } finally {
      requestActive.current = false;
      setLoading(false);
    }
  }, [followup, router, templateId]);

  useEffect(() => {
    loadTemplate();
  }, [loadTemplate]);

  useEffect(() => {
    if (!toast || toast.type === "error") return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  function updateForm(patch: Partial<TemplateForm>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function insertField(field: string) {
    const token = fieldToken(field);
    const input = bodyRef.current;
    if (!input) {
      updateForm({ body: `${form.body}${form.body ? " " : ""}${token}` });
      return;
    }

    const start = input.selectionStart ?? form.body.length;
    const end = input.selectionEnd ?? form.body.length;
    const nextBody = `${form.body.slice(0, start)}${token}${form.body.slice(end)}`;
    updateForm({ body: nextBody });
    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function saveTemplate() {
    if (requestActive.current || locked || readOnly) return;
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    const title = form.title.trim();
    const body = form.body.trim();
    if (!title || !body) {
      setToast({ type: "error", text: "Template name and message are required." });
      return;
    }

    requestActive.current = true;
    setSaving(true);
    setToast(null);
    let correctable = false;
    try {
      if (followup) {
        if (!record) throw new Error("Reload the saved template before saving.");
        const templates = record.templates.map((template) => template.channel === followup.channel && template.approach === followup.approach
          ? { ...template, body, subject: followup.channel === "email" ? form.subject.trim() : "" }
          : template);
        const res = await fetch("/api/dead-followups/templates", {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-access-token": token },
          body: JSON.stringify({ revision: record.revision, templates }),
        });
        const json = await res.json();
        if (!res.ok) {
          correctable = res.status === 400;
          throw new Error(json?.error || "Could not save template. Reload before saving again.");
        }
        setRecord(json.record);
        router.push(`/jobs/settings?channel=${followup.channel}`);
        return;
      }
      const res = await fetch(isEditing ? `/api/contact-templates/${templateId}` : "/api/contact-templates", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "content-type": "application/json", "x-access-token": token },
        body: JSON.stringify({
          ...form,
          title,
          body,
          subject: form.channel === "email" || form.channel === "calendar" ? form.subject.trim() : "",
          description: form.description.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not save template");
      const saved = json.template as ContactTemplate;
      router.push(`/jobs/settings?channel=${saved.channel}`);
    } catch (err) {
      if (followup && !correctable) setLocked(true);
      setToast({ type: "error", text: err instanceof Error ? err.message : "Could not save template" });
    } finally {
      requestActive.current = false;
      setSaving(false);
    }
  }

  async function deleteTemplate() {
    if (!templateId || followup) return;
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    const shouldDelete = await confirm({
      title: "Delete template?",
      description: "This template will be removed for everyone using SMS, email, and calendar sending.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!shouldDelete) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/contact-templates/${templateId}`, {
        method: "DELETE",
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not delete template");
      router.push(`/jobs/settings?channel=${form.channel}`);
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
          <div role={toast.type === "error" ? "alert" : "status"} className={`rounded-xl shadow-lg border px-4 py-3 text-sm ${toast.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
            <div className="flex items-start justify-between gap-3">
              <span>{toast.text}</span>
              <button type="button" onClick={() => setToast(null)} className="text-xs opacity-70 hover:opacity-100">x</button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-5xl px-4 py-5">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href={`/jobs/settings?channel=${form.channel}`} className="text-sm font-semibold text-[#c2410c]">
              Settings
            </Link>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">{isEditing ? "Edit Template" : "New Template"}</h1>
            <p className="mt-1 text-sm text-gray-600">{form.title.trim() || "Create and preview one reusable message template."}</p>
          </div>
          {isEditing && !followup && (
            <button
              type="button"
              onClick={deleteTemplate}
              disabled={saving || loading}
              className="rounded-lg bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>

        {isPreview && <p className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">Interactive preview · Sample templates · Changes stay local</p>}
        {isEditing && (followup || locked) && <button type="button" disabled={loading || saving} onClick={() => void loadTemplate()} className="mb-4 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold">Reload saved template</button>}
        {followup && <p className="mb-4 text-sm text-gray-600">Used automatically for the {followup.approach === 1 ? "first" : "second"} quote follow-up by {channelLabel(followup.channel)}. Include {"{{discount}}"} for the saved NZD offer amount. Staff can edit individual messages before sending.</p>}
        {followup && !loading && readOnly && <p className="mb-4 text-sm text-gray-600">Read-only. Shared defaults require an administrator and enabled follow-up controls.</p>}
        {loading ? (
          <section className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">Loading template...</section>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <section className="rounded-lg border border-gray-200 bg-white">
              <fieldset disabled={saving || loading || locked || readOnly} className="space-y-4 p-4">
                {!followup && <>
                <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Type</label>
                    <div className="grid grid-cols-3 gap-2">
                      {CHANNELS.map((channel) => (
                        <button
                          key={channel}
                          type="button"
                          onClick={() => updateForm({ channel, subject: channel === "sms" ? "" : form.subject })}
                          className={`rounded-lg border py-2.5 text-sm font-semibold ${form.channel === channel ? "border-[#e85d04] bg-orange-50 text-[#c2410c]" : "border-gray-200 bg-white text-gray-700"}`}
                        >
                          {channelLabel(channel)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Order</label>
                    <input
                      value={form.sortOrder}
                      onChange={(event) => updateForm({ sortOrder: event.target.value })}
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
                      onChange={(event) => updateForm({ title: event.target.value })}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
                      placeholder="Lead follow-up"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Description</label>
                    <input
                      value={form.description}
                      onChange={(event) => updateForm({ description: event.target.value })}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
                      placeholder="Quick first response"
                    />
                  </div>
                </div>

                </>}

                {(form.channel === "email" || form.channel === "calendar") && (
                  <div>
                    <label htmlFor="template-subject" className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{form.channel === "calendar" ? "Event Title" : "Subject"}</label>
                    <input
                      id="template-subject"
                      maxLength={followup ? 180 : undefined}
                      value={form.subject}
                      onChange={(event) => updateForm({ subject: event.target.value })}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
                      placeholder={form.channel === "calendar" ? "{address} - Insulmax installation" : "Insulmax enquiry #{job number}"}
                    />
                  </div>
                )}

                <div>
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <label htmlFor="template-body" className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Message</label>
                    <span className="text-[11px] text-gray-400">{form.body.length} chars</span>
                  </div>
                  <textarea
                    id="template-body"
                    maxLength={followup ? (followup.channel === "sms" ? 1400 : 18000) : undefined}
                    ref={bodyRef}
                    value={form.body}
                    onChange={(event) => updateForm({ body: event.target.value })}
                    rows={12}
                    className="w-full resize-y rounded-lg border border-gray-200 px-3 py-3 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
                    placeholder="Hi {customer name}, {salesperson} from Insulmax here..."
                  />
                </div>

                <div>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Insert Field</div>
                  <div className="flex flex-wrap gap-2">
                    {fields.map((field) => (
                      <button
                        key={field}
                        type="button"
                        onClick={() => insertField(field)}
                        className="rounded-full bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-700"
                      >
                        {fieldToken(field)}
                      </button>
                    ))}
                  </div>
                </div>
              </fieldset>
            </section>

            <aside className="space-y-3">
              <section className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Preview</div>
                {(form.channel === "email" || form.channel === "calendar") && (
                  <div className="mb-3 text-xs text-gray-600">
                    <span className="font-semibold text-gray-700">{form.channel === "calendar" ? "Title:" : "Subject:"}</span> {preview.subject || "-"}
                  </div>
                )}
                <p className="whitespace-pre-wrap text-sm text-gray-700">{preview.body || "Template body preview will appear here."}</p>
              </section>

              <div className="flex gap-2">
                <Link
                  href={`/jobs/settings?channel=${form.channel}`}
                  className="rounded-lg bg-gray-100 px-4 py-3 text-center font-semibold text-gray-700"
                >
                  Cancel
                </Link>
                <button
                  type="button"
                  onClick={saveTemplate}
                  disabled={saving || loading || locked || readOnly || !form.title.trim() || !form.body.trim()}
                  className="flex-1 rounded-lg bg-[#e85d04] py-3 font-semibold text-white disabled:opacity-50"
                >
                  {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Template"}
                </button>
              </div>
              {followup && events.length > 0 && <details className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
                <summary>Template change history</summary>
                {events.map((event) => {
                  const template = event.templates.find((item) => item.channel === followup.channel && item.approach === followup.approach);
                  return template ? <details key={event.revision} className="mt-3">
                    <summary>Revision {event.revision} · {event.actorName} · {new Date(event.createdAt).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland" })}</summary>
                    {template.subject && <p className="mt-2 break-words">{template.subject}</p>}
                    <p className="mt-2 whitespace-pre-wrap break-words">{template.body}</p>
                  </details> : null;
                })}
              </details>}
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
