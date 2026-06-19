"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Campaign = {
  id: string;
  name: string;
  channel: "email" | "sms";
  templateId?: string;
  messageSubject?: string;
  messageBody?: string;
  testSentAt?: string | null;
};

type ContactTemplate = {
  id: string;
  title: string;
  channel: "email" | "sms" | "calendar";
  description: string;
  subject: string;
  body: string;
};

type SavedRecipient = {
  id: string;
  jobNumber: number;
  contactName: string;
  destination: string;
  address: string;
  salespersonName: string;
  quoteDate?: string | null;
};

function getToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("token") || "";
}

function formatDate(value?: string | null) {
  if (!value) return "No quote date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No quote date";
  return date.toLocaleDateString("en-NZ", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function firstName(name?: string) {
  return (name || "").trim().split(/\s+/)[0] || "";
}

function normalizeNzSmsDestination(destination: string) {
  const compact = destination.replace(/[^\d+]/g, "");
  if (compact.startsWith("+64")) return compact;
  const digits = compact.replace(/\D/g, "");
  if (digits.startsWith("0")) return `+64${digits.slice(1)}`;
  if (digits.startsWith("64")) return `+${digits}`;
  return compact;
}

function renderMergeFields(text: string, recipient?: SavedRecipient | null) {
  if (!recipient) return text;
  const salespersonName = recipient.salespersonName || "";
  const values: Record<string, string> = {
    "customer name": recipient.contactName || "",
    "first name": firstName(recipient.contactName),
    "job number": String(recipient.jobNumber || ""),
    address: recipient.address || "",
    salesperson: salespersonName,
    "salesperson name": salespersonName,
    "sales rep": salespersonName,
    "sales rep name": salespersonName,
    "sales consultant": salespersonName,
    "sales consultant name": salespersonName,
    "salesperson first name": firstName(salespersonName),
    "salesperson first": firstName(salespersonName),
    "sales rep first name": firstName(salespersonName),
    "sales consultant first name": firstName(salespersonName),
    "quote date": formatDate(recipient.quoteDate),
  };
  return text.replace(/\{([^}]+)\}/g, (match, key: string) => {
    const value = values[key.trim().toLowerCase()];
    return value === undefined ? match : value;
  });
}

function smsSegmentCount(body: string) {
  if (!body) return 0;
  return body.length <= 160 ? 1 : Math.ceil(body.length / 153);
}

export default function CampaignMessagePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [templates, setTemplates] = useState<ContactTemplate[]>([]);
  const [recipients, setRecipients] = useState<SavedRecipient[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [messageSubject, setMessageSubject] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [previewRecipientId, setPreviewRecipientId] = useState("");
  const [testDestination, setTestDestination] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingMessage, setSavingMessage] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadCampaign = useCallback(async () => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load campaign");
      setCampaign(json.campaign);
      setSelectedTemplateId(json.campaign?.templateId || "");
      setMessageSubject(json.campaign?.messageSubject || "");
      setMessageBody(json.campaign?.messageBody || "");
      setRecipients(json.recipients || []);
      setPreviewRecipientId((current) => current || json.recipients?.[0]?.id || "");
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to load campaign" });
    } finally {
      setLoading(false);
    }
  }, [campaignId, router]);

  const loadTemplates = useCallback(async (channel: Campaign["channel"]) => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    try {
      const res = await fetch(`/api/contact-templates?channel=${channel}`, {
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load templates");
      setTemplates(json.templates || []);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to load templates" });
    }
  }, [router]);

  useEffect(() => {
    loadCampaign();
  }, [loadCampaign]);

  useEffect(() => {
    if (campaign?.channel) loadTemplates(campaign.channel);
  }, [campaign?.channel, loadTemplates]);

  const previewRecipient = useMemo(() => (
    recipients.find((recipient) => recipient.id === previewRecipientId) || recipients[0] || null
  ), [previewRecipientId, recipients]);

  const renderedSubject = useMemo(() => (
    renderMergeFields(messageSubject, previewRecipient)
  ), [messageSubject, previewRecipient]);

  const renderedBody = useMemo(() => (
    renderMergeFields(messageBody, previewRecipient)
  ), [messageBody, previewRecipient]);

  function applyTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setMessageSubject(template.subject || "");
    setMessageBody(template.body || "");
  }

  async function saveMessage(options: { test?: boolean } = {}) {
    if (!campaign) return;
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    if (campaign.channel === "email" && !messageSubject.trim()) {
      setMessage({ type: "error", text: "Email subject is required." });
      return;
    }
    if (!messageBody.trim()) {
      setMessage({ type: "error", text: `${campaign.channel === "sms" ? "SMS" : "Email"} body is required.` });
      return;
    }
    const normalizedTestDestination = options.test && campaign.channel === "sms"
      ? normalizeNzSmsDestination(testDestination)
      : testDestination.trim();

    if (options.test && !normalizedTestDestination) {
      setMessage({ type: "error", text: `Enter a test ${campaign.channel === "sms" ? "phone number" : "email address"}.` });
      return;
    }
    if (options.test && campaign.channel === "sms" && normalizedTestDestination !== testDestination) {
      setTestDestination(normalizedTestDestination);
    }

    if (options.test) setSendingTest(true);
    else setSavingMessage(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-access-token": token,
        },
        body: JSON.stringify({
          templateId: selectedTemplateId || null,
          messageSubject,
          messageBody,
          test: Boolean(options.test),
          testDestination: options.test ? normalizedTestDestination : undefined,
          testRecipientId: options.test ? previewRecipient?.id : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to save message");
      setCampaign(json.campaign);
      setMessage({ type: "success", text: options.test ? json.testResult || `Test sent to ${testDestination}.` : "Campaign message saved." });
      if (!options.test) router.push(`/jobs/campaigns/${campaign.id}`);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save message" });
    } finally {
      setSavingMessage(false);
      setSendingTest(false);
    }
  }

  if (loading && !campaign) {
    return (
      <main className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
        <div className="px-4 py-10 text-center text-sm text-gray-500">Loading message...</div>
      </main>
    );
  }

  if (!campaign) {
    return (
      <main className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
        <div className="mx-auto max-w-3xl px-4 py-5">
          <Link href={`/jobs/campaigns/${campaignId}`} className="text-sm font-semibold text-[#c2410c]">Back to Builder</Link>
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {message?.text || "Campaign could not be loaded."}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
      <div className="mx-auto max-w-6xl px-4 py-5">
        <div className="mb-5">
          <Link href={`/jobs/campaigns/${campaign.id}`} className="text-sm font-semibold text-[#c2410c]">
            Back to Builder
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Message</h1>
          <p className="mt-1 text-sm text-gray-600">{campaign.name} · {campaign.channel === "sms" ? "SMS" : "Email"} campaign</p>
        </div>

        {message && (
          <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${message.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
            {message.text}
          </div>
        )}

        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="grid gap-5 p-4 lg:grid-cols-[1fr_360px]">
            <div className="space-y-4">
              <label className="block">
                <span className="text-xs font-semibold text-gray-600">Template</span>
                <select
                  value={selectedTemplateId}
                  onChange={(event) => applyTemplate(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900"
                >
                  <option value="">Start without template</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>{template.title}</option>
                  ))}
                </select>
              </label>

              {campaign.channel === "email" && (
                <label className="block">
                  <span className="text-xs font-semibold text-gray-600">Subject</span>
                  <input
                    value={messageSubject}
                    onChange={(event) => setMessageSubject(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
                    placeholder="Email subject"
                  />
                </label>
              )}

              <label className="block">
                <span className="text-xs font-semibold text-gray-600">Body</span>
                <textarea
                  value={messageBody}
                  onChange={(event) => setMessageBody(event.target.value)}
                  rows={12}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
                  placeholder={campaign.channel === "sms" ? "SMS body" : "Email body"}
                />
              </label>

              {campaign.channel === "sms" && (
                <div className="text-xs font-semibold text-gray-500">
                  {messageBody.length} characters · {smsSegmentCount(messageBody)} SMS segment{smsSegmentCount(messageBody) === 1 ? "" : "s"}
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => saveMessage()}
                  disabled={savingMessage}
                  className="rounded-lg bg-[#1a3a4a] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {savingMessage ? "Saving..." : "Save Message"}
                </button>
                <Link href={`/jobs/settings?channel=${campaign.channel}`} className="rounded-lg bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700">
                  Manage Templates
                </Link>
              </div>
            </div>

            <aside className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <label className="block">
                <span className="text-xs font-semibold text-gray-600">Preview recipient</span>
                <select
                  value={previewRecipient?.id || ""}
                  onChange={(event) => setPreviewRecipientId(event.target.value)}
                  disabled={recipients.length === 0}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 disabled:bg-gray-100"
                >
                  {recipients.length === 0 ? (
                    <option value="">Add audience first</option>
                  ) : recipients.slice(0, 200).map((recipient) => (
                    <option key={recipient.id} value={recipient.id}>
                      {recipient.contactName || "Unknown"} · Job #{recipient.jobNumber}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Rendered preview</div>
                {campaign.channel === "email" && (
                  <div className="mt-2 rounded-lg bg-white p-3 text-sm font-semibold text-gray-900 ring-1 ring-gray-200">
                    {renderedSubject || "No subject yet"}
                  </div>
                )}
                <div className="mt-2 whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-gray-800 ring-1 ring-gray-200">
                  {renderedBody || "No body yet"}
                </div>
              </div>

              <div className="border-t border-gray-200 pt-4">
                <label className="block">
                  <span className="text-xs font-semibold text-gray-600">Test {campaign.channel === "sms" ? "phone number" : "email address"}</span>
                  <input
                    value={testDestination}
                    onChange={(event) => setTestDestination(event.target.value)}
                    onBlur={() => {
                      if (campaign.channel === "sms" && testDestination.trim()) {
                        setTestDestination(normalizeNzSmsDestination(testDestination));
                      }
                    }}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
                    placeholder={campaign.channel === "sms" ? "021 123 4567" : "test@example.com"}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => saveMessage({ test: true })}
                  disabled={sendingTest}
                  className="mt-3 w-full rounded-lg bg-[#e85d04] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {sendingTest ? "Sending Test..." : "Send Test"}
                </button>
                <p className="mt-2 text-xs text-gray-500">
                  {campaign.channel === "sms"
                    ? "Sends this draft to one test phone using the selected campaign sender. Local NZ mobile numbers are formatted automatically."
                    : "Sends this draft to one test email using the selected campaign sender."}
                </p>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
