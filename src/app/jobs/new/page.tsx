"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { gql } from "@/lib/graphql";
import { CREATE_JOB } from "@/lib/mutations";

const LEAD_SOURCES = [
  "Website", "Home Show", "TV", "Social Media", "Radio",
  "Vehicle Signage", "Mailchimp", "Referral", "Printed Media",
  "Door Drop", "Google Ads", "Contact Form",
];

interface CreateJobResponse {
  createJob: { _id: string; jobNumber: number };
}

export default function NewLeadPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    email: "",
    phoneMobile: "",
    streetAddress: "",
    suburb: "",
    city: "",
    postCode: "",
    leadSources: [] as string[],
    notes: "",
  });

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function toggleSource(src: string) {
    setForm((f) => ({
      ...f,
      leadSources: f.leadSources.includes(src)
        ? f.leadSources.filter((s) => s !== src)
        : [...f.leadSources, src],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required"); return; }
    if (!form.phoneMobile.trim() && !form.email.trim()) {
      setError("Phone or email required"); return;
    }

    setSaving(true);
    setError("");
    try {
      const contactDetails = {
        name: form.name,
        email: form.email,
        phoneMobile: form.phoneMobile,
        streetAddress: form.streetAddress,
        suburb: form.suburb,
        city: form.city,
        postCode: form.postCode,
      };
      const data = await gql<CreateJobResponse>(CREATE_JOB, {
        input: {
          notes: form.notes,
          stage: "LEAD",
          lead: {
            leadStatus: "NEW",
            leadSource: form.leadSources,
            allocation: "UNALLOCATED",
          },
          client: {
            name: form.name,
            contactDetails,
            billingDetails: contactDetails,
          },
        },
      });
      router.push(`/jobs/${data.createJob._id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create lead");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-10">
      {/* Header */}
      <div className="bg-[#1a3a4a] px-4 pt-3 pb-4">
        <button onClick={() => router.back()} className="text-gray-300 text-sm mb-2">← Back</button>
        <h1 className="text-white font-bold text-lg">New Lead</h1>
      </div>

      <form onSubmit={handleSubmit} className="px-4 pt-4 space-y-3">
        {/* Contact details */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Contact Details</h2>

          {[
            { label: "Full Name *", field: "name", type: "text", placeholder: "Jane Smith" },
            { label: "Mobile", field: "phoneMobile", type: "tel", placeholder: "021 000 0000" },
            { label: "Email", field: "email", type: "email", placeholder: "jane@example.com" },
            { label: "Street Address", field: "streetAddress", type: "text", placeholder: "12 Example St" },
            { label: "Suburb", field: "suburb", type: "text", placeholder: "Suburb" },
            { label: "City", field: "city", type: "text", placeholder: "Wellington" },
            { label: "Postcode", field: "postCode", type: "text", placeholder: "6011" },
          ].map(({ label, field, type, placeholder }) => (
            <div key={field} className="mb-3">
              <label className="block text-xs text-gray-500 font-medium mb-1">{label}</label>
              <input
                type={type}
                value={(form as unknown as Record<string, string>)[field]}
                onChange={(e) => set(field, e.target.value)}
                placeholder={placeholder}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04]"
              />
            </div>
          ))}
        </div>

        {/* Lead source */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Lead Source</h2>
          <div className="flex flex-wrap gap-2">
            {LEAD_SOURCES.map((src) => (
              <button
                key={src}
                type="button"
                onClick={() => toggleSource(src)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  form.leadSources.includes(src)
                    ? "bg-[#e85d04] text-white"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {src}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Notes</h2>
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Any initial notes..."
            rows={3}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#e85d04] resize-none"
          />
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-[#e85d04] hover:bg-[#d45403] disabled:bg-gray-300 text-white font-semibold py-3.5 rounded-xl text-base transition-colors"
        >
          {saving ? "Creating..." : "Create Lead"}
        </button>
      </form>
    </div>
  );
}
