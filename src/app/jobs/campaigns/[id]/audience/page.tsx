"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Campaign = {
  id: string;
  name: string;
  channel: "email" | "sms";
  recipientCount: number;
};

type SavedRecipient = {
  id: string;
  jobId: string;
  jobNumber: number;
  contactName: string;
  destination: string;
  address: string;
  salespersonName: string;
  jobStage: string;
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

function normalizeDestination(destination: string, channel: Campaign["channel"]) {
  const value = destination.trim().toLowerCase();
  if (channel === "email") return value;
  return value.replace(/[\s().-]/g, "");
}

function duplicateDestinationKeys(recipients: SavedRecipient[], channel?: Campaign["channel"]) {
  if (!channel) return new Set<string>();
  const counts = new Map<string, number>();
  for (const recipient of recipients) {
    const key = normalizeDestination(recipient.destination, channel);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

export default function CampaignAudiencePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const campaignId = params.id;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<SavedRecipient[]>([]);
  const [search, setSearch] = useState("");
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState("");
  const [bulkRemoving, setBulkRemoving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadAudience = useCallback(async () => {
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
      if (!res.ok) throw new Error(json?.error || "Failed to load audience");
      setCampaign(json.campaign);
      setRecipients(json.recipients || []);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to load audience" });
    } finally {
      setLoading(false);
    }
  }, [campaignId, router]);

  useEffect(() => {
    loadAudience();
  }, [loadAudience]);

  const duplicateKeys = useMemo(() => (
    duplicateDestinationKeys(recipients, campaign?.channel)
  ), [campaign?.channel, recipients]);

  const duplicateRecipientCount = useMemo(() => (
    campaign
      ? recipients.filter((recipient) => duplicateKeys.has(normalizeDestination(recipient.destination, campaign.channel))).length
      : 0
  ), [campaign, duplicateKeys, recipients]);

  const filteredRecipients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recipients.filter((recipient) => {
      if (duplicatesOnly && campaign && !duplicateKeys.has(normalizeDestination(recipient.destination, campaign.channel))) return false;
      if (!q) return true;
      return (
        recipient.contactName.toLowerCase().includes(q) ||
        recipient.destination.toLowerCase().includes(q) ||
        recipient.address.toLowerCase().includes(q) ||
        String(recipient.jobNumber).includes(q)
      );
    });
  }, [campaign, duplicateKeys, duplicatesOnly, recipients, search]);

  const selectedVisibleCount = useMemo(() => (
    filteredRecipients.filter((recipient) => selectedRecipientIds.has(recipient.id)).length
  ), [filteredRecipients, selectedRecipientIds]);

  useEffect(() => {
    setSelectedRecipientIds((current) => {
      const validIds = new Set(recipients.map((recipient) => recipient.id));
      const next = new Set([...current].filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [recipients]);

  function toggleRecipient(recipientId: string) {
    setSelectedRecipientIds((current) => {
      const next = new Set(current);
      if (next.has(recipientId)) next.delete(recipientId);
      else next.add(recipientId);
      return next;
    });
  }

  function toggleVisibleRecipients() {
    setSelectedRecipientIds((current) => {
      const next = new Set(current);
      const allVisibleSelected = filteredRecipients.length > 0 && filteredRecipients.every((recipient) => next.has(recipient.id));
      for (const recipient of filteredRecipients) {
        if (allVisibleSelected) next.delete(recipient.id);
        else next.add(recipient.id);
      }
      return next;
    });
  }

  async function removeRecipient(recipient: SavedRecipient) {
    if (!campaign) return;
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setRemovingId(recipient.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}?recipientId=${encodeURIComponent(recipient.id)}`, {
        method: "DELETE",
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to remove recipient");
      setCampaign(json.campaign);
      setRecipients(json.recipients || []);
      setMessage({ type: "success", text: `${recipient.contactName || "Recipient"} removed from the audience.` });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to remove recipient" });
    } finally {
      setRemovingId("");
    }
  }

  async function removeSelectedRecipients() {
    if (!campaign || selectedRecipientIds.size === 0) return;
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    const recipientIds = [...selectedRecipientIds];
    setBulkRemoving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-access-token": token,
        },
        body: JSON.stringify({ recipientIds }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to remove selected recipients");
      setCampaign(json.campaign);
      setRecipients(json.recipients || []);
      setSelectedRecipientIds(new Set());
      setMessage({ type: "success", text: `${recipientIds.length} recipient${recipientIds.length === 1 ? "" : "s"} removed from the audience.` });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to remove selected recipients" });
    } finally {
      setBulkRemoving(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
      <div className="mx-auto max-w-6xl px-4 py-5">
        <div className="mb-5">
          <Link href={`/jobs/campaigns/${campaignId}/audience-builder`} className="text-sm font-semibold text-[#c2410c]">
            Back to Audience Builder
          </Link>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{campaign?.name || "Campaign audience"}</h1>
              <p className="mt-1 text-sm text-gray-600">
                Review and manually remove saved {campaign?.channel === "sms" ? "SMS" : "email"} recipients.
              </p>
            </div>
            <span className="rounded-lg bg-orange-50 px-3 py-2 text-sm font-semibold text-[#c2410c]">
              {recipients.length} recipients
            </span>
          </div>
        </div>

        {message && (
          <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${message.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
            {message.text}
          </div>
        )}

        {duplicateRecipientCount > 0 && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <div className="font-semibold">Duplicates must be resolved before this campaign can continue.</div>
            <div className="mt-1">
              {duplicateRecipientCount} saved recipient{duplicateRecipientCount === 1 ? "" : "s"} share duplicate {campaign?.channel === "sms" ? "phone numbers" : "email addresses"}. Remove the extra rows below until no duplicates remain.
            </div>
          </div>
        )}

        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Saved audience</h2>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <button
                type="button"
                onClick={() => setDuplicatesOnly((value) => !value)}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                  duplicatesOnly ? "border-rose-200 bg-rose-50 text-rose-700" : "border-gray-200 bg-white text-gray-700"
                }`}
              >
                {duplicatesOnly ? "Showing Duplicates" : "Show Duplicates"}
              </button>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search audience"
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 sm:w-72 sm:flex-none"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3">
            <div className="text-sm text-gray-600">
              {filteredRecipients.length} visible · {selectedRecipientIds.size} selected
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={toggleVisibleRecipients}
                disabled={filteredRecipients.length === 0}
                className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-gray-700 ring-1 ring-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {selectedVisibleCount === filteredRecipients.length && filteredRecipients.length > 0 ? "Clear Visible" : "Select Visible"}
              </button>
              <button
                type="button"
                onClick={removeSelectedRecipients}
                disabled={selectedRecipientIds.size === 0 || bulkRemoving}
                className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {bulkRemoving ? "Removing..." : `Remove Selected${selectedRecipientIds.size ? ` (${selectedRecipientIds.size})` : ""}`}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="py-10 text-center text-sm text-gray-500">Loading audience...</div>
          ) : filteredRecipients.length ? (
            <div className="divide-y divide-gray-100">
              {filteredRecipients.map((recipient) => (
                <div
                  key={recipient.id}
                  className={`grid gap-3 px-4 py-4 sm:grid-cols-[auto_1fr_auto] sm:items-center ${
                    campaign && duplicateKeys.has(normalizeDestination(recipient.destination, campaign.channel))
                      ? "bg-rose-50"
                      : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedRecipientIds.has(recipient.id)}
                    onChange={() => toggleRecipient(recipient.id)}
                    className="mt-1 h-5 w-5 rounded border-gray-300 text-[#e85d04] sm:mt-0"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{recipient.contactName || "Unknown customer"}</span>
                      <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">Job #{recipient.jobNumber}</span>
                      <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{recipient.jobStage}</span>
                      {campaign && duplicateKeys.has(normalizeDestination(recipient.destination, campaign.channel)) && (
                        <span className="rounded-md bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-700">Duplicate</span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">{recipient.address || "No address"}</div>
                    <div className="mt-1 text-xs text-gray-500">{recipient.destination}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                    <div className="text-left text-xs text-gray-500 sm:text-right">
                      <div>{recipient.salespersonName || "Unallocated"}</div>
                      <div>Quote: {formatDate(recipient.quoteDate)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRecipient(recipient)}
                      disabled={removingId === recipient.id}
                      className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {removingId === recipient.id ? "Removing..." : "Remove"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-5 text-center">
              <div className="text-sm font-semibold text-gray-900">No recipients found</div>
              <p className="mx-auto mt-1 max-w-md text-sm text-gray-600">
                Add recipients from the campaign builder, or clear the search field.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
