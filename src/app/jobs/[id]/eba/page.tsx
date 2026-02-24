"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { gql } from "@/lib/graphql";

type EbaForm = {
  complete?: boolean;
  clientApproved?: boolean;
  assessorName?: string;
  date?: string;
  nameOfOwners?: string;
  proofOfOwnership?: string;
  bcaOrTa?: string;
  lotOrDPNumber?: string;
  approximateYearOfConstruction?: string;
  numberOfStories?: number;
  signature_assessor?: { fileName?: string } | null;
};

type Job = {
  _id: string;
  jobNumber: number;
  ebaForm?: EbaForm;
  client?: {
    contactDetails?: {
      name?: string;
      streetAddress?: string;
      suburb?: string;
      city?: string;
      postCode?: string;
      lotDPNumber?: string;
    };
  };
};

const EBA_JOB_QUERY = `
  query EBAJob($_id: ObjectId!) {
    job(_id: $_id) {
      _id
      jobNumber
      client {
        contactDetails {
          name
          streetAddress
          suburb
          city
          postCode
          lotDPNumber
        }
      }
      ebaForm {
        complete
        clientApproved
        assessorName
        date
        nameOfOwners
        proofOfOwnership
        bcaOrTa
        lotOrDPNumber
        approximateYearOfConstruction
        numberOfStories
        signature_assessor { fileName }
      }
    }
  }
`;

const SAVE_EBA_MUTATION = `
  mutation SaveEBA($input: UpdateJobInput!, $isDraft: Boolean) {
    saveEBA(input: $input, isDraft: $isDraft) {
      _id
      ebaForm {
        complete
        clientApproved
        assessorName
        date
        nameOfOwners
        proofOfOwnership
        bcaOrTa
        lotOrDPNumber
        approximateYearOfConstruction
        numberOfStories
        signature_assessor { fileName }
      }
    }
  }
`;

function toDatetimeLocal(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fromDatetimeLocal(v?: string) {
  return v ? new Date(v).toISOString() : undefined;
}

export default function EbaPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id || "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [job, setJob] = useState<Job | null>(null);

  const [form, setForm] = useState({
    nameOfOwners: "",
    proofOfOwnership: "",
    bcaOrTa: "",
    lotOrDPNumber: "",
    date: "",
    approximateYearOfConstruction: "",
    numberOfStories: "",
    assessorName: "",
  });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const data = await gql<{ job: Job }>(EBA_JOB_QUERY, { _id: id });
      setJob(data.job);
      setForm({
        nameOfOwners: data.job.ebaForm?.nameOfOwners || data.job.client?.contactDetails?.name || "",
        proofOfOwnership: data.job.ebaForm?.proofOfOwnership || "Certificate of Title",
        bcaOrTa: data.job.ebaForm?.bcaOrTa || "",
        lotOrDPNumber: data.job.ebaForm?.lotOrDPNumber || data.job.client?.contactDetails?.lotDPNumber || "",
        date: toDatetimeLocal(data.job.ebaForm?.date),
        approximateYearOfConstruction: data.job.ebaForm?.approximateYearOfConstruction || "",
        numberOfStories: data.job.ebaForm?.numberOfStories?.toString() || "",
        assessorName: data.job.ebaForm?.assessorName || "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load EBA");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const address = useMemo(() => {
    const c = job?.client?.contactDetails;
    return [c?.streetAddress, c?.suburb, c?.city, c?.postCode].filter(Boolean).join(", ");
  }, [job]);

  async function saveEBA(isDraft: boolean) {
    if (!job) return;
    setSaving(true);
    setError("");
    setNotice("");

    try {
      const input = {
        _id: job._id,
        ebaForm: {
          nameOfOwners: form.nameOfOwners,
          proofOfOwnership: form.proofOfOwnership,
          bcaOrTa: form.bcaOrTa,
          lotOrDPNumber: form.lotOrDPNumber,
          date: fromDatetimeLocal(form.date),
          approximateYearOfConstruction: form.approximateYearOfConstruction,
          numberOfStories: form.numberOfStories ? Number(form.numberOfStories) : undefined,
          assessorName: form.assessorName,
        },
      };

      const res = await gql<{ saveEBA: Job }>(SAVE_EBA_MUTATION, { input, isDraft });
      setJob((prev) => prev ? { ...prev, ebaForm: res.saveEBA.ebaForm } : prev);
      setNotice(isDraft ? "EBA draft saved." : "EBA saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save EBA");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f7f4]">
      <div className="sticky top-0 z-20 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <button onClick={() => router.push(`/jobs/${id}`)} className="text-sm text-gray-600">← Back to Job</button>
        <h1 className="text-sm font-semibold text-gray-800">EBA</h1>
        <span className={`text-xs px-2 py-1 rounded-full ${job?.ebaForm?.complete ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
          {job?.ebaForm?.complete ? "Completed" : "In progress"}
        </span>
      </div>

      <div className="p-4 space-y-3 max-w-3xl mx-auto">
        {loading && <div className="bg-white border border-gray-200 rounded-xl p-4 text-sm text-gray-500">Loading EBA...</div>}
        {error && <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl p-3 text-sm">{error}</div>}
        {notice && <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl p-3 text-sm">{notice}</div>}

        {!loading && job && (
          <>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Administrative Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Property Address</label>
                  <div className="text-sm text-gray-800 mt-1">{address || "-"}</div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Name of Owners</label>
                  <input value={form.nameOfOwners} onChange={(e) => setForm((f) => ({ ...f, nameOfOwners: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Proof of Ownership</label>
                  <select value={form.proofOfOwnership} onChange={(e) => setForm((f) => ({ ...f, proofOfOwnership: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1">
                    <option>Certificate of Title</option>
                    <option>Rates</option>
                    <option>Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">BCA / TA</label>
                  <input value={form.bcaOrTa} onChange={(e) => setForm((f) => ({ ...f, bcaOrTa: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Lot / DP Number</label>
                  <input value={form.lotOrDPNumber} onChange={(e) => setForm((f) => ({ ...f, lotOrDPNumber: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Date</label>
                  <input type="datetime-local" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Existing Building Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Approx Year of Construction</label>
                  <input value={form.approximateYearOfConstruction} onChange={(e) => setForm((f) => ({ ...f, approximateYearOfConstruction: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Number of Stories</label>
                  <input type="number" value={form.numberOfStories} onChange={(e) => setForm((f) => ({ ...f, numberOfStories: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Assessor Declaration</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Assessor Name</label>
                  <input value={form.assessorName} onChange={(e) => setForm((f) => ({ ...f, assessorName: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Assessor Signature</label>
                  <div className="text-sm text-gray-700 mt-1">{job.ebaForm?.signature_assessor?.fileName ? "Uploaded" : "Not uploaded"}</div>
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => saveEBA(true)} disabled={saving}
                  className="bg-white border border-gray-300 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                  {saving ? "Saving..." : "Save EBA Draft"}
                </button>
                <button onClick={() => saveEBA(false)} disabled={saving}
                  className="bg-[#1a3a4a] text-white px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                  {saving ? "Saving..." : "Save EBA"}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                We can keep extending this native EBA page to full parity with legacy fields and uploads.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
