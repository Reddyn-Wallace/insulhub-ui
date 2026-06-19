"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppDialog } from "@/components/AppDialog";

type ContactTemplate = {
  id: string;
  title: string;
  channel: "sms" | "email" | "calendar";
  description: string;
  subject: string;
  body: string;
  sortOrder: number;
};

type CommunicationSender = {
  id: string;
  channel: "email" | "sms";
  label: string;
  senderValue: string;
  provider: "stub" | "gmail" | "smsgate";
  providerConfig: Record<string, string>;
  connectionStatus: string;
  connectedAt?: string | null;
  isDefault: boolean;
  isActive: boolean;
  lastTestedAt?: string | null;
};

type CommunicationSettings = {
  campaignSendWindowEnabled: boolean;
  campaignSendWindowStartTime: string;
  campaignSendWindowEndTime: string;
  campaignSmsPerMinute: number;
  campaignEmailDailyLimit: number;
};

const CHANNELS = ["sms", "email", "calendar"] as const;
const SENDER_CHANNELS = ["email", "sms"] as const;

function providerLabel(provider: CommunicationSender["provider"]) {
  if (provider === "gmail") return "Gmail";
  if (provider === "smsgate") return "SMSGate";
  return "Stub";
}

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

function senderChannelLabel(channel: CommunicationSender["channel"]) {
  return channel === "sms" ? "SMS" : "Email";
}

export default function SettingsPage() {
  const router = useRouter();
  const { confirm, dialog } = useAppDialog();
  const [templates, setTemplates] = useState<ContactTemplate[]>([]);
  const [senders, setSenders] = useState<CommunicationSender[]>([]);
  const [activeSection, setActiveSection] = useState<"templates" | "senders" | "communication-settings">("templates");
  const [activeChannel, setActiveChannel] = useState<ContactTemplate["channel"]>("sms");
  const [senderChannel, setSenderChannel] = useState<CommunicationSender["channel"]>("email");
  const [senderLabel, setSenderLabel] = useState("");
  const [senderProvider, setSenderProvider] = useState<CommunicationSender["provider"]>("gmail");
  const [smsgateBaseUrl, setSmsgateBaseUrl] = useState("");
  const [smsgateUsername, setSmsgateUsername] = useState("");
  const [smsgatePassword, setSmsgatePassword] = useState("");
  const [smsgateDeviceId, setSmsgateDeviceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [sendersLoading, setSendersLoading] = useState(true);
  const [savingSender, setSavingSender] = useState(false);
  const [savingCommunicationSettings, setSavingCommunicationSettings] = useState(false);
  const [gmailConfigured, setGmailConfigured] = useState(false);
  const [communicationSettings, setCommunicationSettings] = useState<CommunicationSettings>({
    campaignSendWindowEnabled: true,
    campaignSendWindowStartTime: "08:30",
    campaignSendWindowEndTime: "17:30",
    campaignSmsPerMinute: 30,
    campaignEmailDailyLimit: 100,
  });
  const [editingSenderId, setEditingSenderId] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editSenderValue, setEditSenderValue] = useState("");
  const [editSmsgateBaseUrl, setEditSmsgateBaseUrl] = useState("");
  const [editSmsgateUsername, setEditSmsgateUsername] = useState("");
  const [editSmsgatePassword, setEditSmsgatePassword] = useState("");
  const [editSmsgateDeviceId, setEditSmsgateDeviceId] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedSection = params.get("section");
    if (requestedSection === "communications" || requestedSection === "senders") setActiveSection("senders");
    if (requestedSection === "communication-settings") setActiveSection("communication-settings");
    const requestedChannel = params.get("channel");
    if (requestedChannel === "sms" || requestedChannel === "email" || requestedChannel === "calendar") {
      setActiveChannel(requestedChannel);
    }
    if (requestedChannel === "sms" || requestedChannel === "email") {
      setSenderChannel(requestedChannel);
    }
    if (params.get("connected") === "gmail") {
      const signature = params.get("signature");
      setToast({
        type: signature === "sync_failed" ? "error" : "success",
        text: signature === "synced"
          ? "Gmail connected and signature synced."
          : signature === "empty"
            ? "Gmail connected. No Gmail signature was found for this account."
            : signature === "sync_failed"
              ? "Gmail connected, but the signature could not be synced. Disconnect and connect again after checking the Gmail signature."
              : "Gmail connected.",
      });
    }
  }, []);

  const visibleTemplates = useMemo(
    () => templates.filter((template) => template.channel === activeChannel),
    [templates, activeChannel]
  );

  const visibleSenders = useMemo(
    () => senders.filter((sender) => sender.channel === senderChannel),
    [senderChannel, senders]
  );

  const smsgateReady = senderProvider !== "smsgate" || (
    Boolean(smsgateBaseUrl.trim()) &&
    Boolean(smsgateUsername.trim()) &&
    Boolean(smsgatePassword.trim())
  );
  const canCreateSender = Boolean(
    senderLabel.trim() &&
    smsgateReady &&
    !(senderProvider === "gmail" && !gmailConfigured)
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

  const loadSenders = useCallback(async () => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setSendersLoading(true);
    try {
      const res = await fetch("/api/communication-senders", {
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load senders");
      setSenders(json.senders || []);
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "Failed to load senders" });
    } finally {
      setSendersLoading(false);
    }
  }, [router]);

  const loadSenderStatus = useCallback(async () => {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch("/api/communication-senders/status", {
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (res.ok) setGmailConfigured(Boolean(json.gmail?.configured));
    } catch {
      setGmailConfigured(false);
    }
  }, []);

  const loadCommunicationSettings = useCallback(async () => {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch("/api/communication-settings", {
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load communication settings");
      if (json.settings) setCommunicationSettings(json.settings);
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "Failed to load communication settings" });
    }
  }, []);

  useEffect(() => {
    loadTemplates();
    loadSenders();
    loadSenderStatus();
    loadCommunicationSettings();
  }, [loadCommunicationSettings, loadSenderStatus, loadSenders, loadTemplates]);

  useEffect(() => {
    setSenderProvider(senderChannel === "email" ? "gmail" : "smsgate");
  }, [senderChannel]);

  async function createSender() {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setSavingSender(true);
    try {
      const providerConfig = senderProvider === "gmail"
        ? {}
        : senderProvider === "smsgate"
          ? { smsgateBaseUrl, smsgateUsername, smsgatePassword, smsgateDeviceId }
          : {};
      const res = await fetch("/api/communication-senders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-access-token": token,
        },
        body: JSON.stringify({
          channel: senderChannel,
          label: senderLabel,
          senderValue: "",
          provider: senderProvider,
          providerConfig,
          isDefault: false,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to create sender");
      const createdSender = json.sender as CommunicationSender;
      setSenderLabel("");
      setSenderProvider(senderChannel === "email" ? "gmail" : "smsgate");
      setSmsgateBaseUrl("");
      setSmsgateUsername("");
      setSmsgatePassword("");
      setSmsgateDeviceId("");
      if (createdSender.provider === "gmail") {
        setToast({ type: "success", text: "Sender created. Opening Gmail connection..." });
        setSenders((current) => [createdSender, ...current.filter((sender) => sender.id !== createdSender.id)]);
        await connectGmail(createdSender);
        return;
      }
      setToast({ type: "success", text: "Sender created and connection tested." });
      setSenders((current) => [createdSender, ...current.filter((sender) => sender.id !== createdSender.id)]);
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "Failed to create sender" });
    } finally {
      setSavingSender(false);
    }
  }

  async function saveCommunicationSettings() {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setSavingCommunicationSettings(true);
    try {
      const res = await fetch("/api/communication-settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-access-token": token,
        },
        body: JSON.stringify({ settings: communicationSettings }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to save communication settings");
      setCommunicationSettings(json.settings);
      setToast({ type: "success", text: "Communication delivery settings saved." });
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "Failed to save communication settings" });
    } finally {
      setSavingCommunicationSettings(false);
    }
  }

  async function updateSender(sender: CommunicationSender, input: Partial<CommunicationSender> & { test?: boolean; disconnect?: boolean }) {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    try {
      const res = await fetch(`/api/communication-senders/${sender.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-access-token": token,
        },
        body: JSON.stringify(input),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to update sender");
      const updatedSender = json.sender as CommunicationSender | undefined;
      const testFailed = Boolean(input.test && updatedSender?.connectionStatus === "disconnected");
      setToast({ type: testFailed ? "error" : "success", text: json.testResult || "Sender updated." });
      if (updatedSender) {
        setSenders((current) => current.map((sender) => sender.id === updatedSender.id ? updatedSender : sender));
      }
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "Failed to update sender" });
    }
  }

  async function disconnectSender(sender: CommunicationSender) {
    const confirmed = await confirm({
      title: "Disconnect sender?",
      description: `"${sender.label}" will stay in Configure Senders, but campaigns cannot use it until it is reconnected and tested.`,
      confirmLabel: "Disconnect",
      tone: "warning",
    });
    if (!confirmed) return;

    await updateSender(sender, { disconnect: true });
  }

  function startEditSender(sender: CommunicationSender) {
    setEditingSenderId(sender.id);
    setEditLabel(sender.label);
    setEditSenderValue(sender.senderValue);
    setEditSmsgateBaseUrl(sender.providerConfig?.smsgateBaseUrl || "");
    setEditSmsgateUsername(sender.providerConfig?.smsgateUsername || "");
    setEditSmsgatePassword("");
    setEditSmsgateDeviceId(sender.providerConfig?.smsgateDeviceId || "");
  }

  async function saveSenderEdit(sender: CommunicationSender) {
    const providerConfig = sender.provider === "smsgate"
      ? {
          smsgateBaseUrl: editSmsgateBaseUrl,
          smsgateUsername: editSmsgateUsername,
          smsgateDeviceId: editSmsgateDeviceId,
          ...(editSmsgatePassword ? { smsgatePassword: editSmsgatePassword } : {}),
        }
      : sender.provider === "gmail"
        ? undefined
        : sender.providerConfig;

    await updateSender(sender, {
      label: editLabel,
      senderValue: sender.provider === "gmail" ? sender.senderValue : editSenderValue,
      providerConfig,
      test: sender.provider === "smsgate",
    });
    setEditingSenderId("");
    setEditSmsgatePassword("");
  }

  async function connectGmail(sender: CommunicationSender) {
    if (!gmailConfigured) {
      setToast({ type: "error", text: "Gmail connection is not configured for this app yet. This needs one app-level Google OAuth setup, then users can connect Gmail with one click." });
      return;
    }

    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    try {
      const res = await fetch(`/api/communication-senders/${sender.id}/gmail/connect`, {
        headers: {
          "accept": "application/json",
          "x-access-token": token,
        },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not start Gmail connection");
      if (json.url) window.location.href = json.url;
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "Could not start Gmail connection" });
    }
  }

  async function removeSender(sender: CommunicationSender) {
    const confirmed = await confirm({
      title: "Remove sender?",
      description: `Remove "${sender.label}"? Campaigns that already used it keep their saved sender snapshot.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!confirmed) return;

    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    try {
      const res = await fetch(`/api/communication-senders/${sender.id}`, {
        method: "DELETE",
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to remove sender");
      setToast({ type: "success", text: "Sender removed." });
      setSenders((current) => current.filter((item) => item.id !== sender.id));
    } catch (err) {
      setToast({ type: "error", text: err instanceof Error ? err.message : "Failed to remove sender" });
    }
  }

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <main className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
      {dialog}
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
          <p className="mt-1 text-sm text-gray-600">Manage templates, senders, and communication safety limits.</p>
        </div>

        <div className="grid gap-5 md:grid-cols-[180px_1fr]">
          <aside className="md:border-r md:border-gray-200 md:pr-4">
            <nav className="flex gap-2 overflow-x-auto md:block md:space-y-1 md:overflow-visible">
              <button
                type="button"
                onClick={() => setActiveSection("templates")}
                className={`shrink-0 rounded-lg px-4 py-2.5 text-left text-sm font-semibold md:w-full ${activeSection === "templates" ? "bg-[#1a3a4a] text-white" : "bg-white text-gray-700 ring-1 ring-gray-200"}`}
              >
                Templates
              </button>
              <button
                type="button"
                onClick={() => setActiveSection("senders")}
                className={`shrink-0 rounded-lg px-4 py-2.5 text-left text-sm font-semibold md:w-full ${activeSection === "senders" ? "bg-[#1a3a4a] text-white" : "bg-white text-gray-700 ring-1 ring-gray-200"}`}
              >
                Configure Senders
              </button>
              <button
                type="button"
                onClick={() => setActiveSection("communication-settings")}
                className={`shrink-0 rounded-lg px-4 py-2.5 text-left text-sm font-semibold md:w-full ${activeSection === "communication-settings" ? "bg-[#1a3a4a] text-white" : "bg-white text-gray-700 ring-1 ring-gray-200"}`}
              >
                Communication Settings
              </button>
            </nav>
          </aside>

          {activeSection === "templates" ? (
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
          ) : activeSection === "senders" ? (
          <section className="min-w-0 rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 p-3">
              <div className="grid gap-2 sm:max-w-sm sm:grid-cols-2">
                {SENDER_CHANNELS.map((channel) => (
                  <button
                    key={channel}
                    type="button"
                    onClick={() => setSenderChannel(channel)}
                    className={`rounded-lg border py-2.5 text-sm font-semibold ${senderChannel === channel ? "border-[#e85d04] bg-orange-50 text-[#c2410c]" : "border-gray-200 bg-white text-gray-700"}`}
                  >
                    {senderChannelLabel(channel)}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4 p-3">
              <div className="rounded-lg border border-gray-200 p-4">
                <h2 className="text-sm font-semibold text-gray-900">Add {senderChannelLabel(senderChannel)} sender</h2>
                <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                  <input
                    value={senderLabel}
                    onChange={(event) => setSenderLabel(event.target.value)}
                    placeholder={senderChannel === "email" ? "Office Gmail" : "Main SMS phone"}
                    className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
                  />
                  <button
                    type="button"
                    onClick={createSender}
                    disabled={savingSender || !canCreateSender}
                    className="rounded-lg bg-[#e85d04] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {savingSender ? "Adding..." : "Add Sender"}
                  </button>
                </div>
                {senderProvider === "gmail" && (
                  <p className={`mt-3 text-xs ${gmailConfigured ? "text-gray-500" : "font-semibold text-amber-700"}`}>
                    {gmailConfigured
                      ? "Adding a Gmail sender will immediately open Google so you can approve access."
                      : "Gmail one-click connection needs app-level Google OAuth configured once before users can connect accounts."}
                  </p>
                )}
                {senderProvider === "smsgate" && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <input
                      value={smsgateBaseUrl}
                      onChange={(event) => setSmsgateBaseUrl(event.target.value)}
                      placeholder="Server address"
                      className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
                    />
                    <input
                      value={smsgateUsername}
                      onChange={(event) => setSmsgateUsername(event.target.value)}
                      placeholder="Username"
                      className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
                    />
                    <input
                      value={smsgatePassword}
                      onChange={(event) => setSmsgatePassword(event.target.value)}
                      placeholder="Password"
                      type="password"
                      className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
                    />
                    <input
                      value={smsgateDeviceId}
                      onChange={(event) => setSmsgateDeviceId(event.target.value)}
                      placeholder="Device ID"
                      className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
                    />
                    <p className="text-xs text-gray-500 md:col-span-2">
                      Use the Server address, username, password, and device ID shown in the SMSGate phone app.
                    </p>
                  </div>
                )}
              </div>

              {sendersLoading ? (
                <div className="py-8 text-center text-sm text-gray-500">Loading senders...</div>
              ) : visibleSenders.length ? (
                <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                  {visibleSenders.map((sender) => (
                    <div key={sender.id} className="p-4">
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900">{sender.label}</span>
                          <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{providerLabel(sender.provider)}</span>
                          {sender.provider !== "stub" && (
                            <span className={`rounded-md px-2 py-1 text-xs font-semibold ${sender.connectionStatus === "connected" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                              {sender.connectionStatus === "connected" ? "Connected" : "Needs connection"}
                            </span>
                          )}
                        </div>
                        {sender.senderValue && sender.senderValue !== sender.label && (
                          <div className="mt-1 text-xs text-gray-500">{sender.senderValue}</div>
                        )}
                        {sender.provider === "smsgate" && (
                          <div className="mt-1 text-xs text-gray-400">
                            {sender.providerConfig?.smsgateBaseUrl || "No server address saved"}
                            {sender.providerConfig?.smsgateDeviceId ? ` · Device ${sender.providerConfig.smsgateDeviceId}` : ""}
                          </div>
                        )}
                        {sender.provider === "gmail" && (
                          <div className="mt-1 text-xs text-gray-400">
                            {sender.providerConfig?.gmailSignature
                              ? `Gmail signature synced${sender.providerConfig.gmailSignatureSyncedAt ? ` · ${new Date(sender.providerConfig.gmailSignatureSyncedAt).toLocaleString("en-NZ")}` : ""}`
                              : "No Gmail signature synced yet"}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        {sender.provider === "gmail" && (
                          sender.connectionStatus === "connected" ? (
                            <button
                              type="button"
                              onClick={() => disconnectSender(sender)}
                              className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 ring-1 ring-amber-200"
                            >
                              Disconnect
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => connectGmail(sender)}
                              className="rounded-lg bg-[#e85d04] px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                              disabled={!gmailConfigured}
                            >
                              Connect
                            </button>
                          )
                        )}
                        {sender.provider === "smsgate" && (
                          sender.connectionStatus === "connected" ? (
                            <button
                              type="button"
                              onClick={() => disconnectSender(sender)}
                              className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 ring-1 ring-amber-200"
                            >
                              Disconnect
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => updateSender(sender, { test: true })}
                              className="rounded-lg bg-[#e85d04] px-3 py-2 text-sm font-semibold text-white"
                            >
                              Connect
                            </button>
                          )
                        )}
                        {sender.provider === "stub" && (
                          <button
                            type="button"
                            onClick={() => updateSender(sender, { test: true })}
                            className="rounded-lg bg-[#1a3a4a] px-3 py-2 text-sm font-semibold text-white"
                          >
                            Test
                          </button>
                        )}
                        {(sender.provider === "smsgate" || sender.provider === "gmail") && (
                          <button
                            type="button"
                            onClick={() => editingSenderId === sender.id ? setEditingSenderId("") : startEditSender(sender)}
                            className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700"
                          >
                            {editingSenderId === sender.id ? "Cancel Edit" : "Edit"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeSender(sender)}
                          className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 ring-1 ring-rose-200"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {editingSenderId === sender.id && sender.provider !== "stub" && (
                      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <p className="mb-3 text-xs text-gray-600">
                          {sender.provider === "smsgate"
                            ? "Saving SMSGate details also tests the connection."
                            : "The sender name is used as the email display name. The signature is synced from Gmail and appended to Gmail test and campaign emails."}
                        </p>
                        <div className="grid gap-3 md:grid-cols-2">
                          <input
                            value={editLabel}
                            onChange={(event) => setEditLabel(event.target.value)}
                            placeholder="Sender label"
                            className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
                          />
                          {sender.provider === "gmail" ? (
                            <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-600">
                              Gmail account: <span className="font-semibold text-gray-900">{sender.senderValue || "Connect Gmail to set account"}</span>
                            </div>
                          ) : (
                            <input
                              value={editSenderValue}
                              onChange={(event) => setEditSenderValue(event.target.value)}
                              placeholder="Optional display number"
                              className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
                            />
                          )}
                          {sender.provider === "smsgate" ? (
                            <>
                              <input
                                value={editSmsgateBaseUrl}
                                onChange={(event) => setEditSmsgateBaseUrl(event.target.value)}
                                placeholder="Server address"
                                className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
                              />
                              <input
                                value={editSmsgateUsername}
                                onChange={(event) => setEditSmsgateUsername(event.target.value)}
                                placeholder="Username"
                                className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
                              />
                              <input
                                value={editSmsgatePassword}
                                onChange={(event) => setEditSmsgatePassword(event.target.value)}
                                placeholder="New password (leave blank to keep existing)"
                                type="password"
                                className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
                              />
                              <input
                                value={editSmsgateDeviceId}
                                onChange={(event) => setEditSmsgateDeviceId(event.target.value)}
                                placeholder="Device ID"
                                className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900"
                              />
                            </>
                          ) : (
                            <div className="rounded-lg border border-gray-200 bg-white p-3 md:col-span-2">
                              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                  Gmail Signature
                                </div>
                              </div>
                              {sender.providerConfig?.gmailSignature ? (
                                <div
                                  className="max-h-72 overflow-auto rounded-md border border-gray-100 bg-white p-3 text-sm text-gray-900"
                                  dangerouslySetInnerHTML={{ __html: sender.providerConfig.gmailSignature }}
                                />
                              ) : (
                                <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
                                  No Gmail signature has been synced for this sender yet. Connect Gmail to approve signature access and sync automatically.
                                </div>
                              )}
                              {sender.providerConfig?.gmailSignatureEmail && (
                                <div className="mt-2 text-xs text-gray-500">
                                  Source: {sender.providerConfig.gmailSignatureEmail}
                                </div>
                              )}
                              {sender.providerConfig?.gmailSignatureSyncError && (
                                <div className="mt-2 text-xs font-semibold text-amber-700">
                                  Last sync issue: {sender.providerConfig.gmailSignatureSyncError}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingSenderId("")}
                            className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-200"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => saveSenderEdit(sender)}
                            disabled={!editLabel.trim() || (sender.provider === "smsgate" && (!editSmsgateBaseUrl.trim() || !editSmsgateUsername.trim()))}
                            className="rounded-lg bg-[#1a3a4a] px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                          >
                            Save Sender
                          </button>
                        </div>
                      </div>
                    )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-gray-200 p-5 text-center">
                  <div className="text-sm font-semibold text-gray-800">No {senderChannelLabel(senderChannel)} senders</div>
                  <p className="mt-1 text-sm text-gray-500">Add a sender so campaigns can select it before sending.</p>
                </div>
              )}
            </div>
          </section>
          ) : (
          <section className="min-w-0 rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-gray-900">Communication Settings</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Safety limits for campaign delivery timing. These apply to real campaign sends, not one-off test sends.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={saveCommunicationSettings}
                  disabled={savingCommunicationSettings}
                  className="rounded-lg bg-[#1a3a4a] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {savingCommunicationSettings ? "Saving..." : "Save Settings"}
                </button>
              </div>
            </div>

            <div className="space-y-4 p-4">
              <div className="rounded-lg border border-gray-200 p-4">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <input
                    type="checkbox"
                    checked={communicationSettings.campaignSendWindowEnabled}
                    onChange={(event) => setCommunicationSettings((current) => ({
                      ...current,
                      campaignSendWindowEnabled: event.target.checked,
                    }))}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  Enforce allowed send hours
                </label>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-gray-600">
                    Send window starts
                    <input
                      type="time"
                      value={communicationSettings.campaignSendWindowStartTime}
                      onChange={(event) => setCommunicationSettings((current) => ({
                        ...current,
                        campaignSendWindowStartTime: event.target.value,
                      }))}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-normal text-gray-900"
                    />
                  </label>
                  <label className="text-xs font-semibold text-gray-600">
                    Send window ends
                    <input
                      type="time"
                      value={communicationSettings.campaignSendWindowEndTime}
                      onChange={(event) => setCommunicationSettings((current) => ({
                        ...current,
                        campaignSendWindowEndTime: event.target.value,
                      }))}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-normal text-gray-900"
                    />
                  </label>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-gray-200 p-4">
                  <label className="text-sm font-semibold text-gray-900">
                    SMS rate limit
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={communicationSettings.campaignSmsPerMinute}
                      onChange={(event) => setCommunicationSettings((current) => ({
                        ...current,
                        campaignSmsPerMinute: Number(event.target.value),
                      }))}
                      className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-normal text-gray-900"
                    />
                  </label>
                  <p className="mt-2 text-xs text-gray-500">Maximum texts per minute during campaign delivery.</p>
                </div>

                <div className="rounded-lg border border-gray-200 p-4">
                  <label className="text-sm font-semibold text-gray-900">
                    Email daily limit per sender
                    <input
                      type="number"
                      min={1}
                      max={2000}
                      value={communicationSettings.campaignEmailDailyLimit}
                      onChange={(event) => setCommunicationSettings((current) => ({
                        ...current,
                        campaignEmailDailyLimit: Number(event.target.value),
                      }))}
                      className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-normal text-gray-900"
                    />
                  </label>
                  <p className="mt-2 text-xs text-gray-500">
                    Each sender can send up to this many campaign emails per day across all campaigns.
                  </p>
                </div>
              </div>
            </div>
          </section>
          )}
        </div>
      </div>
    </main>
  );
}
