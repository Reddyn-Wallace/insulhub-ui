"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Channel = "email" | "sms";

function getToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("token") || "";
}

function getCurrentUserName() {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem("me");
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { firstname?: string; lastname?: string; email?: string };
    const name = [parsed.firstname, parsed.lastname].filter(Boolean).join(" ").trim();
    return name || parsed.email || "";
  } catch {
    return "";
  }
}

export default function NewCampaignPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<Channel>("email");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canSave = useMemo(() => name.trim().length > 0 && !saving, [name, saving]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) return;

    const token = getToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-access-token": token,
        },
        body: JSON.stringify({
          name: name.trim(),
          channel,
          createdBy: getCurrentUserName(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to create campaign");
      router.push(`/jobs/campaigns/${json.campaign.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create campaign");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50" style={{ paddingTop: "var(--nav-height, 80px)" }}>
      <div className="mx-auto max-w-3xl px-4 py-5">
        <div className="mb-5">
          <Link href="/jobs/campaigns" className="text-sm font-semibold text-[#c2410c]">
            Back to Campaigns
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">New Campaign</h1>
          <p className="mt-1 text-sm text-gray-600">
            Create a draft first. Audience, sender, message, preview, and send steps will be added in later chunks.
          </p>
        </div>

        <form onSubmit={submit} className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Campaign basics</h2>
          </div>

          <div className="space-y-5 p-4">
            {error && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {error}
              </div>
            )}

            <label className="block">
              <span className="text-sm font-semibold text-gray-800">Campaign name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Winter quote follow-up"
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-3 text-base text-gray-900 outline-none focus:border-[#e85d04] focus:ring-2 focus:ring-orange-100"
              />
            </label>

            <div>
              <div className="text-sm font-semibold text-gray-800">Channel</div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setChannel("email")}
                  className={`rounded-lg border px-4 py-4 text-left transition-colors ${
                    channel === "email"
                      ? "border-[#e85d04] bg-orange-50 text-[#9a3412]"
                      : "border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
                  }`}
                >
                  <span className="block text-sm font-bold">Email</span>
                  <span className="mt-1 block text-xs text-gray-600">Use job email addresses and email templates.</span>
                </button>
                <button
                  type="button"
                  onClick={() => setChannel("sms")}
                  className={`rounded-lg border px-4 py-4 text-left transition-colors ${
                    channel === "sms"
                      ? "border-[#e85d04] bg-orange-50 text-[#9a3412]"
                      : "border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
                  }`}
                >
                  <span className="block text-sm font-bold">SMS</span>
                  <span className="mt-1 block text-xs text-gray-600">Use job mobile numbers and SMS templates.</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-4 py-3">
            <Link href="/jobs/campaigns" className="rounded-lg bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={!canSave}
              className="rounded-lg bg-[#e85d04] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {saving ? "Creating..." : "Create Draft"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
