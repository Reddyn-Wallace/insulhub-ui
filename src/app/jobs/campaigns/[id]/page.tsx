"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAppDialog } from "@/components/AppDialog";

type Campaign = {
  id: string;
  name: string;
  channel: "email" | "sms";
  status: "draft" | "pending" | "sending" | "sent" | "failed" | "halted";
  recipientCount: number;
  senderId?: string;
  senderLabel?: string;
  messageSubject?: string;
  messageBody?: string;
  testSentAt?: string | null;
};

type CommunicationSender = {
  id: string;
  channel: "email" | "sms";
  label: string;
  senderValue: string;
  isDefault: boolean;
  isActive: boolean;
};

type CommunicationSettings = {
  campaignSendWindowEnabled: boolean;
  campaignSendWindowStartTime: string;
  campaignSendWindowEndTime: string;
  campaignSmsPerMinute: number;
  campaignEmailDailyLimit: number;
};

type SavedRecipient = {
  id: string;
  jobId: string;
  jobNumber: number;
  contactName: string;
  destination: string;
  status: "pending" | "sent" | "failed" | "skipped";
  renderedSubject?: string;
  renderedBody?: string;
  scheduledAt?: string | null;
  sentAt?: string | null;
  providerMessageId?: string;
  failureReason?: string;
};

const DEFAULT_COMMUNICATION_SETTINGS: CommunicationSettings = {
  campaignSendWindowEnabled: true,
  campaignSendWindowStartTime: "08:30",
  campaignSendWindowEndTime: "17:30",
  campaignSmsPerMinute: 30,
  campaignEmailDailyLimit: 100,
};

function getToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("token") || "";
}

function normalizeDestination(destination: string, channel: Campaign["channel"]) {
  const value = destination.trim().toLowerCase();
  if (channel === "email") return value;
  return value.replace(/[\s().-]/g, "");
}

function duplicateDestinationKeys(recipients: SavedRecipient[], channel: Campaign["channel"]) {
  const counts = new Map<string, number>();
  for (const recipient of recipients) {
    const key = normalizeDestination(recipient.destination, channel);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function statusTone(ok: boolean, blocked = false) {
  if (blocked) return "border-rose-200 bg-rose-50 text-rose-800";
  if (ok) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function senderDisplayLabel(sender: CommunicationSender) {
  return sender.senderValue && sender.senderValue !== sender.label
    ? `${sender.label} (${sender.senderValue})`
    : sender.label;
}

function fmtDateTime(value?: string | null) {
  if (!value) return "Not sent";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not sent";
  return date.toLocaleString("en-NZ", {
    timeZone: "Pacific/Auckland",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function nzMinuteOfDay() {
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function formatDuration(ms: number) {
  if (ms < 60_000) return "under 1 min";
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

function aboutDuration(ms: number) {
  const duration = formatDuration(ms);
  return duration === "under 1 min" ? "Under 1 min" : `About ${duration}`;
}

function estimateDelivery(
  channel: Campaign["channel"],
  recipientCount: number,
  settings: CommunicationSettings
) {
  const sendWindow = settings.campaignSendWindowEnabled
    ? `${settings.campaignSendWindowStartTime}-${settings.campaignSendWindowEndTime} NZ time`
    : "No send-hour window";

  if (recipientCount <= 0) {
    return {
      limits: channel === "sms"
        ? `${settings.campaignSmsPerMinute} texts/min, ${sendWindow}`
        : `${settings.campaignEmailDailyLimit} emails/day per sender, ${sendWindow}`,
      estimate: "No recipients selected.",
      note: "",
    };
  }

  if (channel === "sms") {
    const durationMs = Math.max(0, recipientCount - 1) * Math.ceil(60_000 / settings.campaignSmsPerMinute);
    return {
      limits: `${settings.campaignSmsPerMinute} texts/min, ${sendWindow}`,
      estimate: `${aboutDuration(durationMs)} once delivery starts.`,
      note: settings.campaignSendWindowEnabled ? "Messages outside send hours wait until the next allowed window." : "",
    };
  }

  const sendingDays = Math.max(1, Math.ceil(recipientCount / settings.campaignEmailDailyLimit));
  const startMinute = minutesFromTime(settings.campaignSendWindowStartTime);
  const endMinute = minutesFromTime(settings.campaignSendWindowEndTime);
  const windowMs = Math.max(60_000, (endMinute - startMinute) * 60_000);
  const finalDayCount = ((recipientCount - 1) % settings.campaignEmailDailyLimit) + 1;
  const finalDayMs = Math.max(0, finalDayCount - 1) * Math.ceil(windowMs / settings.campaignEmailDailyLimit);
  const currentMinute = nzMinuteOfDay();
  const startsLater = settings.campaignSendWindowEnabled && (currentMinute < startMinute || currentMinute >= endMinute);

  return {
    limits: `${settings.campaignEmailDailyLimit} emails/day per sender, ${sendWindow}`,
    estimate: recipientCount === 1
      ? "Under 1 min once delivery starts."
      : sendingDays === 1
        ? `${aboutDuration(finalDayMs)} once delivery starts.`
        : `About ${sendingDays} sending days once delivery starts.`,
    note: `${startsLater ? "Delivery will wait for the next allowed send window. " : ""}After the first email, remaining emails are spaced through the send window with random jitter.`,
  };
}

export default function CampaignBuilderPage() {
  const router = useRouter();
  const { confirm, dialog } = useAppDialog();
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<SavedRecipient[]>([]);
  const [senders, setSenders] = useState<CommunicationSender[]>([]);
  const [selectedSenderId, setSelectedSenderId] = useState("");
  const [loading, setLoading] = useState(true);
  const [sendersLoading, setSendersLoading] = useState(false);
  const [savingSender, setSavingSender] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [viewingRecipient, setViewingRecipient] = useState<SavedRecipient | null>(null);
  const [communicationSettings, setCommunicationSettings] = useState<CommunicationSettings>(DEFAULT_COMMUNICATION_SETTINGS);
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
      setSelectedSenderId(json.campaign?.senderId || "");
      setRecipients(json.recipients || []);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to load campaign" });
    } finally {
      setLoading(false);
    }
  }, [campaignId, router]);

  const loadSenders = useCallback(async (channel: Campaign["channel"]) => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setSendersLoading(true);
    try {
      const res = await fetch(`/api/communication-senders?channel=${channel}`, {
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load senders");
      const activeSenders = (json.senders || []).filter((sender: CommunicationSender) => sender.isActive);
      setSenders(activeSenders);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to load senders" });
    } finally {
      setSendersLoading(false);
    }
  }, [router]);

  const loadCommunicationSettings = useCallback(async () => {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch("/api/communication-settings", {
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (res.ok && json.settings) setCommunicationSettings(json.settings);
    } catch {
      setCommunicationSettings(DEFAULT_COMMUNICATION_SETTINGS);
    }
  }, []);

  useEffect(() => {
    loadCampaign();
    loadCommunicationSettings();
  }, [loadCampaign, loadCommunicationSettings]);

  useEffect(() => {
    if (campaign?.channel) loadSenders(campaign.channel);
  }, [campaign?.channel, loadSenders]);

  const duplicateKeys = useMemo(() => (
    campaign ? duplicateDestinationKeys(recipients, campaign.channel) : new Set<string>()
  ), [campaign, recipients]);

  const duplicateRecipientCount = useMemo(() => (
    campaign
      ? recipients.filter((recipient) => duplicateKeys.has(normalizeDestination(recipient.destination, campaign.channel))).length
      : 0
  ), [campaign, duplicateKeys, recipients]);

  const selectedSender = useMemo(() => (
    senders.find((sender) => sender.id === selectedSenderId) || null
  ), [selectedSenderId, senders]);

  const audienceReady = recipients.length > 0 && duplicateRecipientCount === 0;
  const senderHasUnsavedChange = Boolean(selectedSenderId) && selectedSenderId !== (campaign?.senderId || "");
  const senderReady = Boolean(campaign?.senderId && campaign?.senderLabel && !senderHasUnsavedChange);
  const messageReady = Boolean(campaign?.messageBody?.trim()) && (campaign?.channel === "sms" || Boolean(campaign?.messageSubject?.trim()));
  const canConfirm = audienceReady && senderReady && messageReady;
  const isQueued = campaign?.status === "pending" || campaign?.status === "sending";
  const isTerminal = campaign?.status === "sent" || campaign?.status === "failed" || campaign?.status === "halted";
  const isSetupLocked = Boolean(isQueued || isTerminal);
  const deliveryRecipients = isSetupLocked ? recipients : recipients.filter((recipient) => recipient.status !== "pending");
  const pendingRecipientCount = recipients.filter((recipient) => recipient.status === "pending").length;
  const sentRecipientCount = recipients.filter((recipient) => recipient.status === "sent").length;
  const failedRecipientCount = recipients.filter((recipient) => recipient.status === "failed").length;
  const skippedRecipientCount = recipients.filter((recipient) => recipient.status === "skipped").length;
  const deliveryEstimate = campaign
    ? estimateDelivery(campaign.channel, recipients.length, communicationSettings)
    : null;

  async function saveSender() {
    if (!campaign || !selectedSender) return;
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setSavingSender(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-access-token": token,
        },
        body: JSON.stringify({
          senderId: selectedSender.id,
          senderLabel: senderDisplayLabel(selectedSender),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to save sender");
      setCampaign(json.campaign);
      setMessage({ type: "success", text: "Sender saved." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to save sender" });
    } finally {
      setSavingSender(false);
    }
  }

  async function sendCampaign() {
    if (!campaign || !canConfirm) return;
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setSending(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-access-token": token,
        },
        body: JSON.stringify({ sendCampaign: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to send campaign");
      setCampaign(json.campaign);
      setRecipients(json.recipients || []);
      setConfirmOpen(false);
      setMessage({ type: "success", text: json.sendResult || "Campaign queued for delivery." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to send campaign" });
    } finally {
      setSending(false);
    }
  }

  const processQueue = useCallback(async (showResult = false) => {
    if (!campaign || (campaign.status !== "pending" && campaign.status !== "sending")) return;
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/process`, {
        method: "POST",
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to process campaign queue");
      setCampaign(json.campaign);
      setRecipients(json.recipients || []);
      if (showResult && json.processResult) {
        setMessage({ type: "success", text: json.processResult });
      }
    } catch (err) {
      if (showResult) {
        setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to process campaign queue" });
      }
    }
  }, [campaign, router]);

  async function haltCampaign() {
    if (!campaign || !isQueued) return;
    const confirmed = await confirm({
      title: "Halt campaign?",
      description: "Pending recipients will be skipped and no further messages will be sent.",
      confirmLabel: "Halt Campaign",
      tone: "danger",
    });
    if (!confirmed) return;

    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setMessage(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-access-token": token,
        },
        body: JSON.stringify({ haltCampaign: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to halt campaign");
      setCampaign(json.campaign);
      setRecipients(json.recipients || []);
      setMessage({ type: "success", text: json.sendResult || "Campaign halted." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to halt campaign" });
    }
  }

  useEffect(() => {
    if (!isQueued) return;
    const timer = window.setInterval(() => {
      processQueue(false);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isQueued, processQueue]);

  if (loading && !campaign) {
    return (
      <main className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
        <div className="px-4 py-10 text-center text-sm text-gray-500">Loading campaign...</div>
      </main>
    );
  }

  if (!campaign) {
    return (
      <main className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
        <div className="mx-auto max-w-3xl px-4 py-5">
          <Link href="/jobs/campaigns" className="text-sm font-semibold text-[#c2410c]">Back to Campaigns</Link>
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {message?.text || "Campaign could not be loaded."}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
      {dialog}
      <div className="mx-auto max-w-5xl px-4 py-5">
        <div className="mb-5">
          <Link href="/jobs/campaigns" className="text-sm font-semibold text-[#c2410c]">
            Back to Campaigns
          </Link>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{campaign.name}</h1>
              <p className="mt-1 text-sm text-gray-600">
                {campaign.channel === "sms" ? "SMS" : "Email"} {isSetupLocked ? "campaign delivery records" : "campaign builder"}
              </p>
            </div>
            <span className={`rounded-lg border px-3 py-2 text-sm font-semibold ${isSetupLocked ? "border-emerald-200 bg-emerald-50 text-emerald-800" : statusTone(canConfirm)}`}>
              {campaign.status === "sending"
                ? "Sending"
                : campaign.status === "pending"
                  ? "Pending"
                  : campaign.status === "halted"
                    ? "Halted"
                    : campaign.status === "failed"
                      ? "Failed"
                      : campaign.status === "sent"
                        ? "Sent"
                        : canConfirm ? "Ready to confirm" : "Draft setup"}
            </span>
          </div>
        </div>

        {message && (
          <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${message.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
            {message.text}
          </div>
        )}

        <div className="space-y-4">
          {isSetupLocked && deliveryRecipients.length > 0 && (
            <section className="rounded-lg border border-gray-200 bg-white p-4 text-gray-900">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Delivery Records</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    {sentRecipientCount} sent, {pendingRecipientCount} pending, {failedRecipientCount} failed, {skippedRecipientCount} skipped.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {isQueued && (
                    <>
                      <button
                        type="button"
                        onClick={() => processQueue(true)}
                        className="rounded-lg bg-[#1a3a4a] px-3 py-2 text-sm font-semibold text-white"
                      >
                        Process Due
                      </button>
                      <button
                        type="button"
                        onClick={haltCampaign}
                        className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 ring-1 ring-rose-200"
                      >
                        Halt Campaign
                      </button>
                    </>
                  )}
                  {!isQueued && (
                    <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                      Audit ready
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-4 overflow-hidden rounded-lg border border-gray-200">
                <div className="max-h-[420px] overflow-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="sticky top-0 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-3 py-2">Recipient</th>
                        <th className="px-3 py-2">Job</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Timing</th>
                        <th className="px-3 py-2 text-right">Message</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {deliveryRecipients.map((recipient) => (
                        <tr key={recipient.id}>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-gray-900">{recipient.contactName || "Unknown"}</div>
                            <div className="text-xs text-gray-500">{recipient.destination}</div>
                          </td>
                          <td className="px-3 py-2">
                            <Link href={`/jobs/${recipient.jobId}`} className="font-semibold text-[#c2410c]">
                              #{recipient.jobNumber || recipient.jobId}
                            </Link>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                              recipient.status === "sent"
                                ? "bg-emerald-50 text-emerald-700"
                                : recipient.status === "failed"
                                  ? "bg-rose-50 text-rose-700"
                                  : recipient.status === "skipped"
                                    ? "bg-gray-100 text-gray-700"
                                    : "bg-amber-50 text-amber-700"
                            }`}>
                              {recipient.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-600">
                            {recipient.status === "pending" ? fmtDateTime(recipient.scheduledAt) : fmtDateTime(recipient.sentAt)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => setViewingRecipient(recipient)}
                              className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {isSetupLocked ? (
            <section className="rounded-lg border border-gray-200 bg-white p-4 text-gray-900">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Campaign Snapshot</h2>
                  <p className="mt-1 text-sm text-gray-600">Setup is locked because this campaign has been queued or attempted.</p>
                </div>
                <span className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700">
                  Read only
                </span>
              </div>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sender</div>
                  <div className="mt-1 font-semibold text-gray-900">{campaign.senderLabel || "Not recorded"}</div>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Audience</div>
                  <div className="mt-1 font-semibold text-gray-900">{recipients.length} recipient{recipients.length === 1 ? "" : "s"}</div>
                </div>
                {campaign.channel === "email" && (
                  <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 sm:col-span-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Subject</div>
                    <div className="mt-1 font-semibold text-gray-900">{campaign.messageSubject || "No subject recorded"}</div>
                  </div>
                )}
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 sm:col-span-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Message</div>
                  <div className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-gray-800">{campaign.messageBody || "No message recorded"}</div>
                </div>
              </div>
            </section>
          ) : (
            <>
              <section className={`rounded-lg border bg-white p-4 ${statusTone(senderReady)}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">1. Sender</h2>
                    <p className="mt-1 text-sm text-gray-700">
                      {senderReady
                        ? `Saved sender: ${campaign.senderLabel}`
                        : senderHasUnsavedChange
                          ? "Sender change is not saved yet. Click Save Sender before continuing."
                          : `Select and save a ${campaign.channel === "sms" ? "SMS" : "email"} sender.`}
                    </p>
                    {sendersLoading && <p className="mt-2 text-sm font-semibold text-gray-500">Loading senders...</p>}
                    {!sendersLoading && senders.length === 0 && <p className="mt-2 text-sm font-semibold text-rose-700">No active sender is available for this channel.</p>}
                  </div>
                  <Link href={`/jobs/settings?section=senders&channel=${campaign.channel}`} className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-200">
                    Sender Settings
                  </Link>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <select
                    value={selectedSenderId}
                    onChange={(event) => setSelectedSenderId(event.target.value)}
                    disabled={sendersLoading || senders.length === 0}
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 disabled:bg-gray-100 sm:max-w-md"
                  >
                    <option value="">Select sender</option>
                    {senders.map((sender) => (
                      <option key={sender.id} value={sender.id}>
                        {senderDisplayLabel(sender)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={saveSender}
                    disabled={!selectedSender || savingSender || !senderHasUnsavedChange}
                    className="rounded-lg bg-[#1a3a4a] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {savingSender ? "Saving..." : senderReady ? "Sender Saved" : "Save Sender"}
                  </button>
                </div>
              </section>

              <section className={`rounded-lg border bg-white p-4 ${statusTone(audienceReady, duplicateRecipientCount > 0)}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">2. Audience</h2>
                    <p className="mt-1 text-sm text-gray-700">
                      {recipients.length} recipient{recipients.length === 1 ? "" : "s"} saved.
                      {duplicateRecipientCount > 0 ? ` ${duplicateRecipientCount} duplicate recipient rows need attention.` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/jobs/campaigns/${campaign.id}/audience-builder`} className="rounded-lg bg-[#1a3a4a] px-4 py-2.5 text-sm font-semibold text-white">
                      Build Audience
                    </Link>
                    <Link href={`/jobs/campaigns/${campaign.id}/audience`} className={`rounded-lg px-4 py-2.5 text-sm font-semibold text-white ${duplicateRecipientCount > 0 ? "bg-rose-600" : "bg-gray-700"}`}>
                      {duplicateRecipientCount > 0 ? "Resolve Duplicates" : "Review Audience"}
                    </Link>
                  </div>
                </div>
              </section>

              <section className={`rounded-lg border bg-white p-4 ${statusTone(messageReady)}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">3. Message</h2>
                    <p className="mt-1 text-sm text-gray-700">
                      {messageReady ? "Message content is saved." : "Select a template, edit the message, preview it, and send a test."}
                    </p>
                  </div>
                  <Link href={`/jobs/campaigns/${campaign.id}/message`} className="rounded-lg bg-[#1a3a4a] px-4 py-2.5 text-sm font-semibold text-white">
                    Edit Message
                  </Link>
                </div>
              </section>

              <section className={`rounded-lg border bg-white p-4 ${statusTone(canConfirm)}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">4. Confirm</h2>
                    <p className="mt-1 text-sm text-gray-700">
                      {canConfirm ? "Ready for the confirm/send step." : "Complete sender, audience, and message before confirming."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmOpen(true)}
                    disabled={!canConfirm}
                    className="rounded-lg bg-[#e85d04] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    Confirm Campaign
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {confirmOpen && !isSetupLocked && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-base font-bold text-gray-900">Send campaign?</h2>
            </div>
            <div className="space-y-3 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">Channel</span>
                <span className="font-semibold text-gray-900">{campaign.channel === "sms" ? "SMS" : "Email"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">Recipients</span>
                <span className="font-semibold text-gray-900">{recipients.length}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">Sender</span>
                <span className="text-right font-semibold text-gray-900">{campaign.senderLabel}</span>
              </div>
              {deliveryEstimate && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-500">Limits</span>
                    <span className="text-right font-semibold text-gray-900">{deliveryEstimate.limits}</span>
                  </div>
                  <div className="mt-2 flex justify-between gap-4">
                    <span className="text-gray-500">Delivery estimate</span>
                    <span className="text-right font-semibold text-gray-900">{deliveryEstimate.estimate}</span>
                  </div>
                  {deliveryEstimate.note && (
                    <p className="mt-2 text-xs leading-5 text-gray-600">{deliveryEstimate.note}</p>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 px-4 py-3">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={sending}
                className="rounded-lg bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendCampaign}
                disabled={sending}
                className="rounded-lg bg-[#e85d04] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {sending ? "Queuing..." : "Queue Campaign"}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewingRecipient && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
              <div>
                <h2 className="text-base font-bold text-gray-900">Sent message</h2>
                <p className="mt-0.5 text-xs text-gray-500">{viewingRecipient.contactName || "Unknown"} • {viewingRecipient.destination}</p>
              </div>
              <button
                type="button"
                onClick={() => setViewingRecipient(null)}
                className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700"
              >
                Close
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto p-4 text-sm">
              {campaign.channel === "email" && (
                <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Subject</div>
                  <div className="mt-1 font-semibold text-gray-900">{viewingRecipient.renderedSubject || "(No subject)"}</div>
                </div>
              )}
              <div className="rounded-lg border border-gray-200 bg-white px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Body</div>
                <div className="mt-2 whitespace-pre-wrap text-gray-800">{viewingRecipient.renderedBody || "(No body captured)"}</div>
              </div>
              {viewingRecipient.providerMessageId && (
                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Provider message ID</div>
                  <div className="mt-1 break-all font-mono text-xs text-gray-700">{viewingRecipient.providerMessageId}</div>
                </div>
              )}
              {viewingRecipient.failureReason && (
                <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
                  {viewingRecipient.failureReason}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
