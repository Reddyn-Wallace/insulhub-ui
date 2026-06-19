"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppDialog } from "@/components/AppDialog";

type Campaign = {
  id: string;
  name: string;
  channel: "email" | "sms";
  status: "draft" | "pending" | "sending" | "sent" | "failed" | "halted";
  senderLabel: string;
  recipientCount: number;
  pendingCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  createdBy: string;
  sentBy: string;
  sentAt?: string | null;
  archivedAt?: string | null;
  createdAt?: string;
};

function getToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("token") || "";
}

function formatChannel(channel: Campaign["channel"]) {
  return channel === "sms" ? "SMS" : "Email";
}

function formatStatus(status: Campaign["status"]) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDate(value?: string | null) {
  if (!value) return "Not sent";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not sent";
  return date.toLocaleDateString("en-NZ", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statusClass(status: Campaign["status"]) {
  if (status === "sent") return "bg-emerald-50 text-emerald-700";
  if (status === "failed") return "bg-rose-50 text-rose-700";
  if (status === "pending" || status === "sending") return "bg-amber-50 text-amber-700";
  if (status === "halted") return "bg-gray-100 text-gray-700";
  return "bg-orange-50 text-[#c2410c]";
}

export default function CampaignsPage() {
  const router = useRouter();
  const { confirm, dialog } = useAppDialog();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [actingCampaignId, setActingCampaignId] = useState("");

  const draftCount = useMemo(
    () => campaigns.filter((campaign) => campaign.status === "draft").length,
    [campaigns]
  );

  const sentCount = useMemo(
    () => campaigns.filter((campaign) => campaign.status === "sent").length,
    [campaigns]
  );

  const activeCount = useMemo(
    () => campaigns.filter((campaign) => campaign.status === "pending" || campaign.status === "sending").length,
    [campaigns]
  );

  const loadCampaigns = useCallback(async () => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/campaigns?archived=${showArchived ? "true" : "false"}`, {
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load campaigns");
      setCampaigns(json.campaigns || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }, [router, showArchived]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  async function deleteDraft(campaign: Campaign) {
    if (campaign.status !== "draft") return;
    const confirmed = await confirm({
      title: "Delete draft campaign?",
      description: `This removes "${campaign.name}" and its saved audience.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;

    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setActingCampaignId(campaign.id);
    setError("");
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "DELETE",
        headers: { "x-access-token": token },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to delete campaign");
      setCampaigns((current) => current.filter((item) => item.id !== campaign.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete campaign");
    } finally {
      setActingCampaignId("");
    }
  }

  async function setCampaignArchived(campaign: Campaign, archived: boolean) {
    if (archived && campaign.status === "draft") return;
    const action = archived ? "Archive" : "Unarchive";
    const confirmed = await confirm({
      title: `${action} campaign?`,
      description: archived
        ? `"${campaign.name}" will move out of the active campaign list.`
        : `"${campaign.name}" will move back to the active campaign list.`,
      confirmLabel: action,
      tone: archived ? "warning" : "default",
    });
    if (!confirmed) return;

    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setActingCampaignId(campaign.id);
    setError("");
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-access-token": token,
        },
        body: JSON.stringify(archived ? { archiveCampaign: true } : { unarchiveCampaign: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `Failed to ${action.toLowerCase()} campaign`);
      setCampaigns((current) => current.filter((item) => item.id !== campaign.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action.toLowerCase()} campaign`);
    } finally {
      setActingCampaignId("");
    }
  }

  return (
    <main className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
      {dialog}
      <div className="mx-auto max-w-6xl px-4 py-5">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
            <p className="mt-1 text-sm text-gray-600">
              Create and review bulk email and SMS campaigns built from job records.
            </p>
          </div>
          <Link
            href="/jobs/campaigns/new"
            className="rounded-lg bg-[#e85d04] px-4 py-2.5 text-sm font-semibold text-white"
          >
            New Campaign
          </Link>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{campaigns.length}</div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Drafts</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{draftCount}</div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sent</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{sentCount}</div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Queued</div>
            <div className="mt-1 text-2xl font-bold text-gray-900">{activeCount}</div>
          </div>
        </div>

        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">
              {showArchived ? "Archived campaigns" : "Campaign history"}
            </h2>
            <button
              type="button"
              onClick={() => setShowArchived((current) => !current)}
              className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700"
            >
              {showArchived ? "View Active" : "View Archived"}
            </button>
          </div>

          {loading ? (
            <div className="py-10 text-center text-sm text-gray-500">Loading campaigns...</div>
          ) : error ? (
            <div className="m-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {error}
            </div>
          ) : campaigns.length ? (
            <div className="divide-y divide-gray-100">
              {campaigns.map((campaign) => (
                <div
                  key={campaign.id}
                  className="grid gap-3 px-4 py-4 hover:bg-gray-50 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <Link href={`/jobs/campaigns/${campaign.id}`} className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-sm font-semibold text-gray-900">{campaign.name}</div>
                      <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">
                        {formatChannel(campaign.channel)}
                      </span>
                      <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusClass(campaign.status)}`}>
                        {formatStatus(campaign.status)}
                      </span>
                      {campaign.archivedAt && (
                        <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">Archived</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>Sender: {campaign.senderLabel || "Not selected"}</span>
                      <span>Recipients: {campaign.recipientCount}</span>
                      {(campaign.status !== "draft" || campaign.sentCount > 0 || campaign.pendingCount > 0 || campaign.failedCount > 0 || campaign.skippedCount > 0) && (
                        <span>
                          Delivery: {campaign.sentCount} sent / {campaign.pendingCount} pending / {campaign.failedCount} failed / {campaign.skippedCount} skipped
                        </span>
                      )}
                      <span>Created: {formatDate(campaign.createdAt)}</span>
                      <span>Sent: {formatDate(campaign.sentAt)}</span>
                    </div>
                  </Link>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <Link href={`/jobs/campaigns/${campaign.id}`} className="inline-flex rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700">
                      Open
                    </Link>
                    {!showArchived && campaign.status === "draft" && (
                      <button
                        type="button"
                        onClick={() => deleteDraft(campaign)}
                        disabled={actingCampaignId === campaign.id}
                        className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 ring-1 ring-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {actingCampaignId === campaign.id ? "Deleting..." : "Delete"}
                      </button>
                    )}
                    {!showArchived && campaign.status !== "draft" && (
                      <button
                        type="button"
                        onClick={() => setCampaignArchived(campaign, true)}
                        disabled={actingCampaignId === campaign.id}
                        className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {actingCampaignId === campaign.id ? "Archiving..." : "Archive"}
                      </button>
                    )}
                    {showArchived && (
                      <button
                        type="button"
                        onClick={() => setCampaignArchived(campaign, false)}
                        disabled={actingCampaignId === campaign.id}
                        className="rounded-lg bg-[#1a3a4a] px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
                      >
                        {actingCampaignId === campaign.id ? "Restoring..." : "Unarchive"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-5 text-center">
              <div className="text-sm font-semibold text-gray-900">
                {showArchived ? "No archived campaigns" : "No campaigns yet"}
              </div>
              <p className="mx-auto mt-1 max-w-md text-sm text-gray-600">
                {showArchived
                  ? "Archived approved campaigns will appear here and can be unarchived when needed."
                  : "Start with a draft campaign, build an audience from jobs, choose a sender, write the message, then queue delivery."}
              </p>
              {!showArchived && (
                <Link
                  href="/jobs/campaigns/new"
                  className="mt-4 inline-flex rounded-lg bg-[#e85d04] px-4 py-2.5 text-sm font-semibold text-white"
                >
                  New Campaign
                </Link>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
