"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { gql } from "@/lib/graphql";

type Job = {
  _id: string;
  jobNumber: number;
  ebaForm?: Record<string, unknown> & {
    complete?: boolean;
    clientApproved?: boolean;
    signature_assessor?: { fileName?: string } | null;
  };
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
        propertySiteSection
        propertySiteExposure
        propertySiteArea
        roofAndEavesCol1
        roofAndEavesCol2
        roofAndEavesCol3
        foundationAndFloor
        framing
        joinery
        lining
        buildingPaper
        exteriorCladding
        claddingType
        claddingTypeInstalledVia
        finishOfCladding
        b131_structure
        b131_structure_priorToInstallationWorkRequired
        b131_structure_priorToCertificationWorkRequired
        c22_preventionOfFireOccuring
        c22_preventionOfFireOccuring_priorToInstallationWorkRequired
        c22_preventionOfFireOccuring_priorToCertificationWorkRequired
        g931_electricity
        g931_electricity_priorToInstallationWorkRequired
        g931_electricity_priorToCertificationWorkRequired
        h131_energyEfficiency
        c22_externalMoisture_paintFinishOfExteriorCladdingAppearsToBeInAnWellMaintainedCondition
        c22_externalMoisture_exteriorCladdingAppearsToHaveDeteriorationToALevelThatMayAllowWaterIngress
        c22_externalMoisture_joineryAppearsToBeInGoodConditionAndNotAllowingWaterIngress
        c22_externalMoisture_flashingsArePresentAndAppearToBeInstalledCorrectly
        c22_externalMoisture_allExistingPenetrationsAreSealed
        c22_externalMoisture_joinBetweenDifferentCladdingTypesSealed
        c22_externalMoisture_guttersAndDownPipesArePresentAndAppearToBeFunctioningCorrectly
        c22_externalMoisture_isWaterAbleToPoolAgainstExteriorWall
        c22_externalMoisture_wallsAreFreeToAir
        c22_externalMoisture_priorToInstallationWorkRequired
        c22_externalMoisture_priorToCertificationWorkRequired
        assessorName
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

function SelectYesNo({ value, onChange }: { value: unknown; onChange: (v: boolean) => void }) {
  const mapped = value === true ? "YES" : value === false ? "NO" : "";
  return (
    <select
      value={mapped}
      onChange={(e) => onChange(e.target.value === "YES")}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1"
    >
      <option value="">Select...</option>
      <option value="YES">Yes</option>
      <option value="NO">No</option>
    </select>
  );
}


function listValue(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") return v.split(",").map((x) => x.trim()).filter(Boolean);
  return [];
}

function toggleList(curr: unknown, item: string): string {
  const arr = listValue(curr);
  const next = arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
  return next.join(", ");
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
  const [form, setForm] = useState<Record<string, unknown>>({});

  const setField = (name: string, value: unknown) => setForm((f) => ({ ...f, [name]: value }));

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const data = await gql<{ job: Job }>(EBA_JOB_QUERY, { _id: id });
      setJob(data.job);
      setForm({
        ...(data.job.ebaForm || {}),
        nameOfOwners: (data.job.ebaForm?.nameOfOwners as string) || data.job.client?.contactDetails?.name || "",
        proofOfOwnership: (data.job.ebaForm?.proofOfOwnership as string) || "Certificate of Title",
        lotOrDPNumber: (data.job.ebaForm?.lotOrDPNumber as string) || data.job.client?.contactDetails?.lotDPNumber || "",
        date: toDatetimeLocal(data.job.ebaForm?.date as string | undefined),
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
      const ebaForm = {
        nameOfOwners: form.nameOfOwners,
        proofOfOwnership: form.proofOfOwnership,
        bcaOrTa: form.bcaOrTa,
        lotOrDPNumber: form.lotOrDPNumber,
        date: fromDatetimeLocal((form.date as string) || ""),
        approximateYearOfConstruction: form.approximateYearOfConstruction,
        numberOfStories: form.numberOfStories,
        propertySiteSection: form.propertySiteSection,
        propertySiteExposure: form.propertySiteExposure,
        propertySiteArea: form.propertySiteArea,
        roofAndEavesCol1: form.roofAndEavesCol1,
        roofAndEavesCol2: form.roofAndEavesCol2,
        roofAndEavesCol3: form.roofAndEavesCol3,
        foundationAndFloor: form.foundationAndFloor,
        framing: form.framing,
        joinery: form.joinery,
        lining: form.lining,
        buildingPaper: form.buildingPaper,
        exteriorCladding: form.exteriorCladding,
        claddingType: form.claddingType,
        claddingTypeInstalledVia: form.claddingTypeInstalledVia,
        finishOfCladding: form.finishOfCladding,
        b131_structure: form.b131_structure,
        b131_structure_priorToInstallationWorkRequired: form.b131_structure_priorToInstallationWorkRequired,
        b131_structure_priorToCertificationWorkRequired: form.b131_structure_priorToCertificationWorkRequired,
        c22_preventionOfFireOccuring: form.c22_preventionOfFireOccuring,
        c22_preventionOfFireOccuring_priorToInstallationWorkRequired: form.c22_preventionOfFireOccuring_priorToInstallationWorkRequired,
        c22_preventionOfFireOccuring_priorToCertificationWorkRequired: form.c22_preventionOfFireOccuring_priorToCertificationWorkRequired,
        g931_electricity: form.g931_electricity,
        g931_electricity_priorToInstallationWorkRequired: form.g931_electricity_priorToInstallationWorkRequired,
        g931_electricity_priorToCertificationWorkRequired: form.g931_electricity_priorToCertificationWorkRequired,
        h131_energyEfficiency: form.h131_energyEfficiency,
        c22_externalMoisture_paintFinishOfExteriorCladdingAppearsToBeInAnWellMaintainedCondition: form.c22_externalMoisture_paintFinishOfExteriorCladdingAppearsToBeInAnWellMaintainedCondition,
        c22_externalMoisture_exteriorCladdingAppearsToHaveDeteriorationToALevelThatMayAllowWaterIngress: form.c22_externalMoisture_exteriorCladdingAppearsToHaveDeteriorationToALevelThatMayAllowWaterIngress,
        c22_externalMoisture_joineryAppearsToBeInGoodConditionAndNotAllowingWaterIngress: form.c22_externalMoisture_joineryAppearsToBeInGoodConditionAndNotAllowingWaterIngress,
        c22_externalMoisture_flashingsArePresentAndAppearToBeInstalledCorrectly: form.c22_externalMoisture_flashingsArePresentAndAppearToBeInstalledCorrectly,
        c22_externalMoisture_allExistingPenetrationsAreSealed: form.c22_externalMoisture_allExistingPenetrationsAreSealed,
        c22_externalMoisture_joinBetweenDifferentCladdingTypesSealed: form.c22_externalMoisture_joinBetweenDifferentCladdingTypesSealed,
        c22_externalMoisture_guttersAndDownPipesArePresentAndAppearToBeFunctioningCorrectly: form.c22_externalMoisture_guttersAndDownPipesArePresentAndAppearToBeFunctioningCorrectly,
        c22_externalMoisture_isWaterAbleToPoolAgainstExteriorWall: form.c22_externalMoisture_isWaterAbleToPoolAgainstExteriorWall,
        c22_externalMoisture_wallsAreFreeToAir: form.c22_externalMoisture_wallsAreFreeToAir,
        c22_externalMoisture_priorToInstallationWorkRequired: form.c22_externalMoisture_priorToInstallationWorkRequired,
        c22_externalMoisture_priorToCertificationWorkRequired: form.c22_externalMoisture_priorToCertificationWorkRequired,
        assessorName: form.assessorName,
      };
      const input = { _id: job._id, ebaForm };
      const res = await gql<{ saveEBA: Job }>(SAVE_EBA_MUTATION, { input, isDraft });
      setJob((prev) => (prev ? { ...prev, ebaForm: { ...(prev.ebaForm || {}), ...(res.saveEBA.ebaForm || {}), ...ebaForm } } : prev));
      setNotice(isDraft ? "EBA draft saved." : "EBA finalised.");
      router.replace(`/jobs/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save EBA");
    } finally {
      setSaving(false);
    }
  }

  const q = [
    ["b131_structure", "Linings/claddings fixed correctly and suitable for install pressure?"],
    ["c22_preventionOfFireOccuring", "Through-wall flu located in installation area?"],
    ["g931_electricity", "Observed wiring is TPS?"],
    ["h131_energyEfficiency", "Can insulation improve thermal resistance and airflow control?"],
    ["c22_externalMoisture_paintFinishOfExteriorCladdingAppearsToBeInAnWellMaintainedCondition", "Paint finish well maintained?"],
    ["c22_externalMoisture_exteriorCladdingAppearsToHaveDeteriorationToALevelThatMayAllowWaterIngress", "Cladding deterioration may allow ingress?"],
    ["c22_externalMoisture_joineryAppearsToBeInGoodConditionAndNotAllowingWaterIngress", "Joinery in good condition and not allowing ingress?"],
    ["c22_externalMoisture_flashingsArePresentAndAppearToBeInstalledCorrectly", "Flashings present and correctly installed?"],
    ["c22_externalMoisture_allExistingPenetrationsAreSealed", "All existing penetrations sealed?"],
    ["c22_externalMoisture_joinBetweenDifferentCladdingTypesSealed", "Join between cladding types sealed?"],
    ["c22_externalMoisture_guttersAndDownPipesArePresentAndAppearToBeFunctioningCorrectly", "Gutters/downpipes present and functioning?"],
    ["c22_externalMoisture_isWaterAbleToPoolAgainstExteriorWall", "Water able to pool against exterior wall?"],
    ["c22_externalMoisture_wallsAreFreeToAir", "Walls free to air?"],
  ] as const;

  return (
    <div className="min-h-screen bg-[#f8f7f4]">
      <div className="sticky top-0 z-20 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between">
        <button onClick={() => router.push(`/jobs/${id}`)} className="text-sm text-gray-600">← Back to Job</button>
        <h1 className="text-sm font-semibold text-gray-800">EBA</h1>
        <span
          className={`text-xs px-2 py-1 rounded-full ${
            job?.ebaForm?.clientApproved
              ? "bg-emerald-100 text-emerald-700"
              : job?.ebaForm?.complete
                ? "bg-blue-100 text-blue-700"
                : "bg-amber-100 text-amber-700"
          }`}
        >
          {job?.ebaForm?.clientApproved ? "Client Signed" : job?.ebaForm?.complete ? "Finalised" : "Draft In Progress"}
        </span>
      </div>

      <div className="p-4 space-y-3 max-w-4xl mx-auto pb-24">
        {loading && <div className="bg-white border border-gray-200 rounded-xl p-4 text-sm text-gray-500">Loading EBA...</div>}
        {error && <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl p-3 text-sm">{error}</div>}
        {notice && <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl p-3 text-sm">{notice}</div>}

        {!loading && job && (
          <>
          <div className={`border rounded-xl p-3 text-sm ${job.ebaForm?.clientApproved ? "bg-emerald-50 border-emerald-200 text-emerald-700" : job.ebaForm?.complete ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
            {job.ebaForm?.clientApproved
              ? "EBA is client signed and complete."
              : job.ebaForm?.complete
                ? "EBA is finalised."
                : "EBA draft in progress. Keep saving draft until assessor is ready to finalise."}
          </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">1) Administrative Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500">Property Address</label><div className="text-sm text-gray-800 mt-1">{address || "-"}</div></div>
                <div><label className="text-xs text-gray-500">Name of Owners</label><input value={(form.nameOfOwners as string) || ""} onChange={(e) => setField("nameOfOwners", e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" /></div>
                <div><label className="text-xs text-gray-500">Proof of Ownership</label><select value={(form.proofOfOwnership as string) || ""} onChange={(e) => setField("proofOfOwnership", e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1"><option>Certificate of Title</option><option>Rates</option><option>Other</option></select></div>
                <div><label className="text-xs text-gray-500">BCA/TA</label><input value={(form.bcaOrTa as string) || ""} onChange={(e) => setField("bcaOrTa", e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" /></div>
                <div><label className="text-xs text-gray-500">Lot / DP Number</label><input value={(form.lotOrDPNumber as string) || ""} onChange={(e) => setField("lotOrDPNumber", e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" /></div>
                <div><label className="text-xs text-gray-500">Date</label><input type="datetime-local" value={(form.date as string) || ""} onChange={(e) => setField("date", e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" /></div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">2) Existing Building Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500">Approx Year of Construction</label><input value={(form.approximateYearOfConstruction as string) || ""} onChange={(e) => setField("approximateYearOfConstruction", e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" /></div>
                <div><label className="text-xs text-gray-500">Number of Stories</label><input type="number" value={(form.numberOfStories as number | undefined)?.toString() || ""} onChange={(e) => setField("numberOfStories", e.target.value ? Number(e.target.value) : undefined)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" /></div>
                <div className="md:col-span-2">
                  <label className="text-xs text-gray-500">Property Site Section</label>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {["Flat Section","Sloping Section","Steep Section"].map((opt) => (
                      <label key={opt} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white cursor-pointer">
                        <input type="radio" name="propertySiteSection" className="mr-1" checked={(form.propertySiteSection as string) === opt} onChange={() => setField("propertySiteSection", opt)} />{opt}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-gray-500">Property Site Exposure</label>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {["Exposed","Semi-Exposed","Sheltered"].map((opt) => (
                      <label key={opt} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white cursor-pointer">
                        <input type="radio" name="propertySiteExposure" className="mr-1" checked={(form.propertySiteExposure as string) === opt} onChange={() => setField("propertySiteExposure", opt)} />{opt}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-gray-500">Property Site Area</label>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {["Urban","Rural"].map((opt) => (
                      <label key={opt} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white cursor-pointer">
                        <input type="radio" name="propertySiteArea" className="mr-1" checked={(form.propertySiteArea as string) === opt} onChange={() => setField("propertySiteArea", opt)} />{opt}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Roof & Eaves</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Roof Type</label>
                  <div className="mt-1 space-y-1">{["Hip Gable","Double Gable","Skillion / Mono pitch","Other"].map((opt)=>(<label key={opt} className="text-sm block"><input type="checkbox" className="mr-2" checked={listValue(form.roofAndEavesCol1).includes(opt)} onChange={() => setField("roofAndEavesCol1", toggleList(form.roofAndEavesCol1, opt))} />{opt}</label>))}</div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Roof Cladding</label>
                  <div className="mt-1 space-y-1">{["Corrugated Steel","Tile","Membrane","Other"].map((opt)=>(<label key={opt} className="text-sm block"><input type="checkbox" className="mr-2" checked={listValue(form.roofAndEavesCol2).includes(opt)} onChange={() => setField("roofAndEavesCol2", toggleList(form.roofAndEavesCol2, opt))} />{opt}</label>))}</div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Eaves</label>
                  <div className="mt-1 space-y-1">{["No eaves","Modest eaves","Generous Eaves"].map((opt)=>(<label key={opt} className="text-sm block"><input type="checkbox" className="mr-2" checked={listValue(form.roofAndEavesCol3).includes(opt)} onChange={() => setField("roofAndEavesCol3", toggleList(form.roofAndEavesCol3, opt))} />{opt}</label>))}</div>
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Foundation & Floor</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {["Ring Perimeter","Piles","Slab","Suspended Floor Timber"].map((opt)=>(
                  <label key={opt} className="text-sm"><input type="checkbox" className="mr-2" checked={listValue(form.foundationAndFloor).includes(opt)} onChange={() => setField("foundationAndFloor", toggleList(form.foundationAndFloor, opt))} />{opt}</label>
                ))}
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Framing, Joinery & Lining</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-gray-500">Framing</label>
                  {["Likely Rimu","Treated pinus","Untreated pinus","No framing (double brick)"].map((opt)=>(<label key={opt} className="text-sm block mt-1"><input type="checkbox" className="mr-2" checked={listValue(form.framing).includes(opt)} onChange={() => setField("framing", toggleList(form.framing, opt))} />{opt}</label>))}
                </div>
                <div>
                  <label className="text-xs text-gray-500">Joinery</label>
                  {["Timber","Aluminium (Single Glazed)","Aluminium (Double Glazed)","uPVC"].map((opt)=>(<label key={opt} className="text-sm block mt-1"><input type="checkbox" className="mr-2" checked={listValue(form.joinery).includes(opt)} onChange={() => setField("joinery", toggleList(form.joinery, opt))} />{opt}</label>))}
                </div>
                <div>
                  <label className="text-xs text-gray-500">Lining</label>
                  {["Plasterboard","Timber","Hardboard","Plaster"].map((opt)=>(<label key={opt} className="text-sm block mt-1"><input type="checkbox" className="mr-2" checked={listValue(form.lining).includes(opt)} onChange={() => setField("lining", toggleList(form.lining, opt))} />{opt}</label>))}
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Building Paper</h2>
              <div className="flex gap-2 flex-wrap">
                {["Not detected","Detected (but unable to guarantee extent or condition)"].map((opt)=>(
                  <label key={opt} className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white cursor-pointer">
                    <input type="radio" name="buildingPaper" className="mr-2" checked={(form.buildingPaper as string) === opt} onChange={() => setField("buildingPaper", opt)} />
                    {opt}
                  </label>
                ))}
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Exterior Cladding</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {["Timber","Cement Board","Rendered Plaster","Masonry veneer (nominal 140mm cavity)","Masonry (double brick)","EIFS","Palisade (plastic) weatherboard","Corrugated steel"].map((opt)=>(
                  <label key={opt} className="text-sm"><input type="checkbox" className="mr-2" checked={listValue(form.exteriorCladding).includes(opt)} onChange={() => setField("exteriorCladding", toggleList(form.exteriorCladding, opt))} />{opt}</label>
                ))}
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">3) Install Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Cladding Type</label>
                  <div className="mt-1 grid grid-cols-1 gap-1">
                    {["Timber","Cement Board","Rendered Plaster","Masonry Veneer","Masonry (Double brick)","EIFS","Palisade (plastic) weatherboard","Corrugated steel"].map((opt)=>(<label key={opt} className="text-sm"><input type="checkbox" className="mr-2" checked={listValue(form.claddingType).includes(opt)} onChange={() => setField("claddingType", toggleList(form.claddingType, opt))} />{opt}</label>))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Installed Via</label>
                  <div className="mt-1 grid grid-cols-1 gap-1">
                    {["Through wall","Injected from internal lining","Installed during reclad/new build","Other"].map((opt)=>(<label key={opt} className="text-sm"><input type="checkbox" className="mr-2" checked={listValue(form.claddingTypeInstalledVia).includes(opt)} onChange={() => setField("claddingTypeInstalledVia", toggleList(form.claddingTypeInstalledVia, opt))} />{opt}</label>))}
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-gray-500">Finish of Cladding</label>
                  <div className="mt-1 grid grid-cols-1 md:grid-cols-3 gap-1">
                    {["Painted","Unpainted","Recoatable in good condition","Requires maintenance"].map((opt)=>(<label key={opt} className="text-sm"><input type="checkbox" className="mr-2" checked={listValue(form.finishOfCladding).includes(opt)} onChange={() => setField("finishOfCladding", toggleList(form.finishOfCladding, opt))} />{opt}</label>))}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Assessment Questions</h2>

              <div className="space-y-3">
                {q.map(([key, label]) => (
                  <div key={key} className="border border-gray-100 rounded-lg p-3">
                    <label className="text-xs text-gray-600 font-medium">{label}</label>
                    <SelectYesNo value={form[key]} onChange={(v) => setField(key, v)} />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="text-xs text-gray-500">Prior to Installation Work Required</label>
                  <textarea value={(form.c22_externalMoisture_priorToInstallationWorkRequired as string) || ""} onChange={(e) => setField("c22_externalMoisture_priorToInstallationWorkRequired", e.target.value)} rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Prior to Certification Work Required</label>
                  <textarea value={(form.c22_externalMoisture_priorToCertificationWorkRequired as string) || ""} onChange={(e) => setField("c22_externalMoisture_priorToCertificationWorkRequired", e.target.value)} rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Assessor Declaration</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Assessor Name</label>
                  <input value={(form.assessorName as string) || ""} onChange={(e) => setField("assessorName", e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Assessor Signature</label>
                  <div className="text-sm text-gray-700 mt-1">{job.ebaForm?.signature_assessor?.fileName ? "Uploaded" : "Not uploaded"}</div>
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4 sticky bottom-3">
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => saveEBA(true)} disabled={saving} className="bg-white border border-gray-300 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">{saving ? "Saving..." : "Save as Draft"}</button>
                <button onClick={() => saveEBA(false)} disabled={saving} className="bg-[#1a3a4a] text-white px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">{saving ? "Finalising..." : "Save as Finalised"}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
