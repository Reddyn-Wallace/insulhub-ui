"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { gql } from "@/lib/graphql";

type Photo = { fileName?: string; thumbnail?: string };

type Job = {
  _id: string;
  jobNumber: number;
  ebaForm?: Record<string, unknown> & {
    complete?: boolean;
    clientApproved?: boolean;
    signature_assessor?: { fileName?: string } | string | null;
    signature_conformityToCodeMarkCert?: Photo | string | null;
    photos_elevation_north?: Photo[];
    photos_elevation_east?: Photo[];
    photos_elevation_south?: Photo[];
    photos_elevation_west?: Photo[];
    photos_foundation?: Photo[];
    photos_maintenance?: Photo[];
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
  lead?: {
    allocatedTo?: { firstname?: string; lastname?: string };
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
      lead {
        allocatedTo {
          firstname
          lastname
        }
      }
      ebaForm {
        _id
        complete
        clientApproved
        clientApprovedAt
        address
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

        masonryCladding_masonryCladUnderfloorVentsArePresentAndClear
        masonryCladding_windowOrMasonryVerticalJointsAreSealed
        masonryCladding_soffitsAppearToBeSoundWithNoWaterStainingOrBubblingPaintWhichMayIndicateGuttersOrRoofLeakingIntoSurfeitsAndPossiblyWalls
        masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater
        masonryCladding_underfloorSpaceExcessivelyDamp
        c22_externalMoisture_priorToInstallationWorkRequired
        c22_externalMoisture_priorToCertificationWorkRequired
        skip_photos_elevation_north
        skip_photos_elevation_south
        skip_photos_elevation_east
        skip_photos_elevation_west
        assessorName
        signature_assessor { fileName thumbnail }
        signature_conformityToCodeMarkCert { fileName thumbnail }
        clientApproval_signature_propertyOwners { fileName thumbnail }
        photos_elevation_north { fileName thumbnail }
        photos_elevation_east { fileName thumbnail }
        photos_elevation_south { fileName thumbnail }
        photos_elevation_west { fileName thumbnail }
        photos_foundation { fileName thumbnail }
        photos_maintenance { fileName thumbnail }
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
        signature_assessor { fileName thumbnail }
        signature_conformityToCodeMarkCert { fileName thumbnail }
        clientApproval_signature_propertyOwners { fileName thumbnail }
        photos_elevation_north { fileName thumbnail }
        photos_elevation_east { fileName thumbnail }
        photos_elevation_south { fileName thumbnail }
        photos_elevation_west { fileName thumbnail }
        photos_foundation { fileName thumbnail }
        photos_maintenance { fileName thumbnail }
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

function signatureFileName(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "fileName" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>).fileName || "");
  }
  return "";
}

function listValue(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") {
    if (v.includes(" | ")) return v.split("|").map((x) => x.trim()).filter(Boolean);
    return v.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

function toggleList(curr: unknown, item: string): string {
  const arr = listValue(curr);
  const next = arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
  return next.join(" | ");
}

function getOtherFromList(curr: unknown): string {
  const arr = listValue(curr);
  const other = arr.find((x) => x.toLowerCase().startsWith("other:"));
  return other ? other.slice(other.indexOf(":") + 1).trim() : "";
}

function setOtherInList(curr: unknown, value: string): string {
  const arr = listValue(curr).filter((x) => !x.toLowerCase().startsWith("other:"));
  const next = value.trim();
  if (next) arr.push(`Other: ${next}`);
  return arr.join(" | ");
}

function parseKnownList(curr: unknown, knownOptions: string[]): string[] {
  const arr = listValue(curr);
  if (arr.length > 1 || typeof curr !== "string") return arr;

  const raw = curr;
  const found = knownOptions.filter((opt) => raw.includes(opt));
  return found.length ? found : arr;
}

function toggleKnownList(curr: unknown, item: string, knownOptions: string[]): string {
  const arr = parseKnownList(curr, knownOptions);
  const next = arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
  return next.join(" | ");
}

function parseLegacyCheckboxList(curr: unknown, knownOptions: string[]): string[] {
  const arr = listValue(curr);
  const direct = arr.filter((x) => knownOptions.includes(x));
  if (direct.length) return direct;
  const other = getOtherFromList(curr);
  if (other) {
    return other
      .split("|")
      .map((x) => x.trim())
      .filter((x) => knownOptions.includes(x));
  }
  return parseKnownList(curr, knownOptions).filter((x) => knownOptions.includes(x));
}

function toggleLegacyCheckboxList(curr: unknown, item: string, knownOptions: string[]): string[] {
  const arr = parseLegacyCheckboxList(curr, knownOptions);
  const next = item === "__noop__" ? arr : arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
  return buildLegacyCheckboxArray(next, getLegacyCustomOther(curr, knownOptions), knownOptions);
}

function getLegacyCustomOther(curr: unknown, knownOptions: string[]): string {
  const arr = listValue(curr);
  const explicitTail = arr[arr.length - 1];
  if (typeof explicitTail === "string" && explicitTail.length > 0 && !knownOptions.includes(explicitTail.trim()) && !explicitTail.toLowerCase().startsWith("other:")) {
    return explicitTail;
  }
  const other = arr.find((x) => x.toLowerCase().startsWith("other:"));
  if (!other) return "";
  return other
    .slice(other.indexOf(":") + 1)
    .split("|")
    .map((x) => x.trim())
    .filter((x) => x && !knownOptions.includes(x))
    .join(" ");
}

function hasLegacyCustomOther(curr: unknown, knownOptions: string[]): boolean {
  return getLegacyCustomOther(curr, knownOptions).length > 0;
}

function buildLegacyCheckboxArray(selectedKnown: string[], customOther: string, knownOptions: string[]): string[] {
  const filteredSelected = selectedKnown.filter((x) => knownOptions.includes(x));
  const rawCustom = customOther ?? "";
  const summaryCustom = rawCustom.trim();
  const out: string[] = [];
  if (summaryCustom) out.push(`Other: ${[summaryCustom, ...filteredSelected].join(" | ")}`);
  out.push(...knownOptions.filter((opt) => filteredSelected.includes(opt)));
  out.push(rawCustom);
  return out;
}

function setLegacyCheckboxListOther(curr: unknown, value: string, knownOptions: string[]): string[] {
  const selected = parseLegacyCheckboxList(curr, knownOptions);
  return buildLegacyCheckboxArray(selected, value, knownOptions);
}

function requiresLegacyOtherText(curr: unknown, knownOptions: string[]): boolean {
  const arr = listValue(curr);
  const customOther = getLegacyCustomOther(curr, knownOptions);
  const hasPendingOtherSelection = arr.includes("Other") || !!customOther.trim();
  return hasPendingOtherSelection && !customOther.trim();
}

function parseLegacyMappedCheckboxList(curr: unknown, allowedStoredValues: string[]): string[] {
  return parseLegacyCheckboxList(curr, allowedStoredValues);
}

function toggleLegacyMappedCheckboxList(curr: unknown, storedValue: string, allowedStoredValues: string[]): string[] {
  return toggleLegacyCheckboxList(curr, storedValue, allowedStoredValues);
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some((x) => typeof x === "string" ? x.trim().length > 0 : !!x);
  return true;
}

const YES_NO_NA_KEYS = [
  "b131_structure",
  "c22_preventionOfFireOccuring",
  "g931_electricity",
  "h131_energyEfficiency",
  "c22_externalMoisture_paintFinishOfExteriorCladdingAppearsToBeInAnWellMaintainedCondition",
  "c22_externalMoisture_exteriorCladdingAppearsToHaveDeteriorationToALevelThatMayAllowWaterIngress",
  "c22_externalMoisture_joineryAppearsToBeInGoodConditionAndNotAllowingWaterIngress",
  "c22_externalMoisture_flashingsArePresentAndAppearToBeInstalledCorrectly",
  "c22_externalMoisture_allExistingPenetrationsAreSealed",
  "c22_externalMoisture_joinBetweenDifferentCladdingTypesSealed",
  "c22_externalMoisture_guttersAndDownPipesArePresentAndAppearToBeFunctioningCorrectly",
  "c22_externalMoisture_isWaterAbleToPoolAgainstExteriorWall",
  "c22_externalMoisture_wallsAreFreeToAir",
  "masonryCladding_masonryCladUnderfloorVentsArePresentAndClear",
  "masonryCladding_windowOrMasonryVerticalJointsAreSealed",
  "masonryCladding_soffitsAppearToBeSoundWithNoWaterStainingOrBubblingPaintWhichMayIndicateGuttersOrRoofLeakingIntoSurfeitsAndPossiblyWalls",
  "masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater",
  "masonryCladding_underfloorSpaceExcessivelyDamp",
] as const;

const FINALISE_REQUIRED_KEYS = [
  "nameOfOwners",
  "proofOfOwnership",
  "bcaOrTa",
  "lotOrDPNumber",
  "approximateYearOfConstruction",
  "numberOfStories",
  "roofAndEavesCol1",
  "roofAndEavesCol2",
  "roofAndEavesCol3",
  "foundationAndFloor",
  "framing",
  "joinery",
  "lining",
  "buildingPaper",
  "exteriorCladding",
  "claddingType",
  "claddingTypeInstalledVia",
  "b131_structure",
  "c22_preventionOfFireOccuring",
  "g931_electricity",
  "h131_energyEfficiency",
  "c22_externalMoisture_paintFinishOfExteriorCladdingAppearsToBeInAnWellMaintainedCondition",
  "c22_externalMoisture_exteriorCladdingAppearsToHaveDeteriorationToALevelThatMayAllowWaterIngress",
  "c22_externalMoisture_joineryAppearsToBeInGoodConditionAndNotAllowingWaterIngress",
  "c22_externalMoisture_flashingsArePresentAndAppearToBeInstalledCorrectly",
  "c22_externalMoisture_allExistingPenetrationsAreSealed",
  "c22_externalMoisture_joinBetweenDifferentCladdingTypesSealed",
  "c22_externalMoisture_guttersAndDownPipesArePresentAndAppearToBeFunctioningCorrectly",
  "c22_externalMoisture_isWaterAbleToPoolAgainstExteriorWall",
  "c22_externalMoisture_wallsAreFreeToAir",
  "masonryCladding_masonryCladUnderfloorVentsArePresentAndClear",
  "masonryCladding_windowOrMasonryVerticalJointsAreSealed",
  "masonryCladding_soffitsAppearToBeSoundWithNoWaterStainingOrBubblingPaintWhichMayIndicateGuttersOrRoofLeakingIntoSurfeitsAndPossiblyWalls",
  "masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater",
  "masonryCladding_underfloorSpaceExcessivelyDamp",
  "assessorName",
] as const;

const externalMoistureQuestions = [
  ["c22_externalMoisture_paintFinishOfExteriorCladdingAppearsToBeInAnWellMaintainedCondition", "Paint finish of exterior cladding appears to be in an well maintained condition?"],
  ["c22_externalMoisture_exteriorCladdingAppearsToHaveDeteriorationToALevelThatMayAllowWaterIngress", "Exterior cladding appears to have deterioration to a level that may allow water ingress?"],
  ["c22_externalMoisture_joineryAppearsToBeInGoodConditionAndNotAllowingWaterIngress", "Joinery appears to be in good condition and not allowing water ingress?"],
  ["c22_externalMoisture_flashingsArePresentAndAppearToBeInstalledCorrectly", "Flashings are present and appear to be installed correctly?"],
  ["c22_externalMoisture_allExistingPenetrationsAreSealed", "All existing penetrations are sealed?"],
  ["c22_externalMoisture_joinBetweenDifferentCladdingTypesSealed", "Join between different cladding types sealed?"],
  ["c22_externalMoisture_guttersAndDownPipesArePresentAndAppearToBeFunctioningCorrectly", "Gutters and down pipes are present and appear to be functioning correctly?"],
  ["c22_externalMoisture_isWaterAbleToPoolAgainstExteriorWall", "Is water able to pool against exterior wall e.g. raised sealed deck?"],
  ["c22_externalMoisture_wallsAreFreeToAir", "Walls are free to air e.g no raised border bounded by exterior wall?"],
] as const;

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
  const [roofTypeOtherChecked, setRoofTypeOtherChecked] = useState(false);
  const [roofCladdingOtherChecked, setRoofCladdingOtherChecked] = useState(false);
  const [ebaPhotos, setEbaPhotos] = useState<Record<string, string[]>>({});
  const [uploadingPhotosBySection, setUploadingPhotosBySection] = useState<Record<string, number>>({});
  const [finaliseAttempted, setFinaliseAttempted] = useState(false);
  const [elevationSkip, setElevationSkip] = useState<Record<string, boolean>>({ north:false, east:false, south:false, west:false });
  const [signing, setSigning] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [activeSection, setActiveSection] = useState("admin");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const fileInputRef = useRef<Record<string, HTMLInputElement | null>>({});
  const cameraInputRef = useRef<Record<string, HTMLInputElement | null>>({});

  const setField = (name: string, value: unknown) => {
    setDirty(true);
    setForm((f) => ({ ...f, [name]: value }));
  };


  const getToken = () => (typeof window !== "undefined" ? localStorage.getItem("token") || "" : "");
  const fileUrl = (fileName: string) => `https://api.insulhub.nz/files/documents/${encodeURIComponent(fileName)}?token=${getToken()}`;

  const persistPhotoCache = useCallback((next: Record<string, string[]>) => {
    if (typeof window !== "undefined") {
      const payload = JSON.stringify(next);
      sessionStorage.setItem(`eba-photos:${id}`, payload);
      localStorage.setItem(`eba-photos:${id}`, payload);
    }
  }, [id]);

  const sectionToEbaField = (section: string) => {
    if (section === "foundation") return "photos_foundation";
    if (section === "maintenance") return "photos_maintenance";
    if (section.startsWith("elevation_")) {
      const dir = section.replace("elevation_", "");
      return `photos_elevation_${dir}`;
    }
    return "";
  };

  const toPhotoObjects = (fileNames: string[]) =>
    fileNames.map((fileName) => ({ fileName, thumbnail: fileName }));

  function startDraw(x: number, y: number) {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    drawingRef.current = true;
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function drawTo(x: number, y: number) {
    const c = canvasRef.current;
    if (!c || !drawingRef.current) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function stopDraw() {
    drawingRef.current = false;
  }

  function canvasPointFromClient(clientX: number, clientY: number) {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const scaleX = c.width / rect.width;
    const scaleY = c.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function clearSignaturePad() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
  }

  const drawSavedSignatureToCanvas = useCallback(async (fileName: string) => {
    const c = canvasRef.current;
    if (!c || !fileName) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("token") || "" : "";
      const url = `https://api.insulhub.nz/files/documents/${encodeURIComponent(fileName)}?token=${token}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Could not load signature image"));
        img.src = objectUrl;
      });

      ctx.clearRect(0, 0, c.width, c.height);
      const scale = Math.min(c.width / img.width, c.height / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (c.width - w) / 2;
      const y = (c.height - h) / 2;
      ctx.drawImage(img, x, y, w, h);
      URL.revokeObjectURL(objectUrl);
    } catch {
      // best effort only
    }
  }, []);

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return [] as string[];
    const formData = new FormData();
    Array.from(files).forEach((f) => formData.append("files", f));
    const res = await fetch("https://api.insulhub.nz/files/upload", {
      method: "POST",
      headers: { "x-token": getToken() },
      body: formData,
    });
    const json = await res.json();
    return (json.fileNames || []) as string[];
  }

  async function removeEbaPhoto(section: string, fileName: string) {
    if (!job || job.ebaForm?.clientApproved) return;
    const field = sectionToEbaField(section);
    if (!field) return;
    try {
      const nextNames = (ebaPhotos[section] || []).filter((x) => x !== fileName);
      await gql(SAVE_EBA_MUTATION, {
        input: { _id: job._id, ebaForm: { [field]: toPhotoObjects(nextNames) } },
        isDraft: true,
      });
      setEbaPhotos((p) => {
        const next = { ...p, [section]: nextNames };
        persistPhotoCache(next);
        return next;
      });
      setNotice("Photo removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove photo");
    }
  }

  async function saveAssessorSignature() {
    const c = canvasRef.current;
    if (!c || !job || job.ebaForm?.clientApproved) return;
    setSigning(true);
    setError("");
    try {
      const blob: Blob | null = await new Promise((resolve) => c.toBlob((b) => resolve(b), "image/png"));
      if (!blob) throw new Error("Could not capture signature");
      const files = new File([blob], `signature-${Date.now()}.png`, { type: "image/png" });
      const fileNames = await uploadFiles({ 0: files, length: 1, item: (i: number) => (i === 0 ? files : null) } as unknown as FileList);
      if (!fileNames.length) throw new Error("Signature upload failed");
      const fileName = fileNames[0];
      const thumbnail = fileName;
      await gql(SAVE_EBA_MUTATION, { input: { _id: job._id, ebaForm: { signature_assessor: { fileName, thumbnail } } }, isDraft: true });
      setJob((prev) => prev ? ({ ...prev, ebaForm: { ...(prev.ebaForm || {}), signature_assessor: { fileName, thumbnail } } }) : prev);
      setNotice("Assessor signature saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save signature");
    } finally {
      setSigning(false);
    }
  }

  async function uploadEbaPhotos(section: string, files: FileList | null) {
    if (!job || job.ebaForm?.clientApproved || !files || files.length === 0) return;
    const photoCount = files.length;
    setUploadingPhotosBySection((p) => ({ ...p, [section]: (p[section] || 0) + photoCount }));
    setNotice(`Uploading ${photoCount} photo${photoCount > 1 ? "s" : ""}...`);

    try {
      const fileNames = await uploadFiles(files);
      if (!fileNames.length) return;
      const field = sectionToEbaField(section);
      if (!field) return;
      const mergedNames = [...(ebaPhotos[section] || []), ...fileNames];
      await gql(SAVE_EBA_MUTATION, {
        input: { _id: job._id, ebaForm: { [field]: toPhotoObjects(mergedNames) } },
        isDraft: true,
      });
      setEbaPhotos((p) => { const next = { ...p, [section]: mergedNames }; persistPhotoCache(next); return next; });
      setNotice(`Uploaded ${fileNames.length} photo${fileNames.length > 1 ? "s" : ""}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setUploadingPhotosBySection((p) => {
        const next = Math.max(0, (p[section] || 0) - photoCount);
        return { ...p, [section]: next };
      });
    }
  }

  function handlePhotoInputChange(section: string, e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    void uploadEbaPhotos(section, files);
    e.target.value = "";
  }
  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const data = await gql<{ job: Job }>(EBA_JOB_QUERY, { _id: id }, {
        cacheKey: `eba-job:${id}`,
        ttlMs: 5 * 60 * 1000,
      });
      setJob(data.job);
      const cachedPhotos = typeof window !== "undefined"
        ? (sessionStorage.getItem(`eba-photos:${id}`) || localStorage.getItem(`eba-photos:${id}`))
        : null;
      if (cachedPhotos) {
        try { setEbaPhotos(JSON.parse(cachedPhotos)); } catch {}
      }

      const salespersonName = [
        data.job.lead?.allocatedTo?.firstname,
        data.job.lead?.allocatedTo?.lastname,
      ].filter(Boolean).join(" ");

      const nextForm: Record<string, unknown> = {
        ...(data.job.ebaForm || {}),
        nameOfOwners: (data.job.ebaForm?.nameOfOwners as string) || data.job.client?.contactDetails?.name || "",
        proofOfOwnership: (data.job.ebaForm?.proofOfOwnership as string) || "Certificate of Title",
        lotOrDPNumber: (data.job.ebaForm?.lotOrDPNumber as string) || data.job.client?.contactDetails?.lotDPNumber || "",
        assessorName: (data.job.ebaForm?.assessorName as string) || salespersonName || "",
        date: toDatetimeLocal(data.job.ebaForm?.date as string | undefined),
      };
      for (const key of YES_NO_NA_KEYS) {
        const normalized = fromYesNoNA(nextForm[key]);
        if (normalized !== undefined) nextForm[key] = normalized;
      }
      setForm(nextForm);
      setDirty(false);
      setRoofTypeOtherChecked(listValue(nextForm.roofAndEavesCol1).includes("Other") || !!getLegacyCustomOther(nextForm.roofAndEavesCol1, ["Hip Gable","Double Gable","Skillion / Mono pitch"]).trim());
      setRoofCladdingOtherChecked(listValue(nextForm.roofAndEavesCol2).includes("Other") || !!getLegacyCustomOther(nextForm.roofAndEavesCol2, ["Corrugated Steel","Tile","Membrane"]).trim());

      const photosFromDb: Record<string, string[]> = {
        elevation_north: (data.job.ebaForm?.photos_elevation_north || []).map((p) => p.fileName || "").filter(Boolean),
        elevation_east: (data.job.ebaForm?.photos_elevation_east || []).map((p) => p.fileName || "").filter(Boolean),
        elevation_south: (data.job.ebaForm?.photos_elevation_south || []).map((p) => p.fileName || "").filter(Boolean),
        elevation_west: (data.job.ebaForm?.photos_elevation_west || []).map((p) => p.fileName || "").filter(Boolean),
        foundation: (data.job.ebaForm?.photos_foundation || []).map((p) => p.fileName || "").filter(Boolean),
        maintenance: (data.job.ebaForm?.photos_maintenance || []).map((p) => p.fileName || "").filter(Boolean),
      };
      setEbaPhotos(photosFromDb);
      setElevationSkip({
        north: !!data.job.ebaForm?.skip_photos_elevation_north,
        east: !!data.job.ebaForm?.skip_photos_elevation_east,
        south: !!data.job.ebaForm?.skip_photos_elevation_south,
        west: !!data.job.ebaForm?.skip_photos_elevation_west,
      });
      persistPhotoCache(photosFromDb);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load EBA");
    } finally {
      setLoading(false);
    }
  }, [id, persistPhotoCache]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const fileName = signatureFileName(job?.ebaForm?.signature_assessor);
    if (!fileName) {
      const c = canvasRef.current;
      const ctx = c?.getContext("2d");
      if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
      return;
    }
    drawSavedSignatureToCanvas(fileName);
  }, [job?.ebaForm?.signature_assessor, drawSavedSignatureToCanvas]);

  const address = useMemo(() => {
    const c = job?.client?.contactDetails;
    return [c?.streetAddress, c?.suburb, c?.city, c?.postCode].filter(Boolean).join(", ");
  }, [job]);

  function toYesNoNA(value: unknown): "YES" | "NO" | "NA" | null {
    if (value === true) return "YES";
    if (value === false) return "NO";
    if (value === "NOT_APPLICABLE" || value === "NA") return "NA";
    if (value === "YES" || value === "NO") return value;
    return null;
  }

  function fromYesNoNA(value: unknown): true | false | "NOT_APPLICABLE" | undefined {
    if (value === true || value === "YES") return true;
    if (value === false || value === "NO") return false;
    if (value === "NOT_APPLICABLE" || value === "NA") return "NOT_APPLICABLE";
    return undefined;
  }

  async function saveEBA(isDraft: boolean, opts: { stay?: boolean; quiet?: boolean } = {}) {
    if (!job || job.ebaForm?.clientApproved) return;
    if (!isDraft) setFinaliseAttempted(true);
    if (!opts.quiet) setSaving(true);
    setError("");
    if (!opts.quiet) setNotice("");
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

        masonryCladding_masonryCladUnderfloorVentsArePresentAndClear: toYesNoNA(form.masonryCladding_masonryCladUnderfloorVentsArePresentAndClear),
        masonryCladding_windowOrMasonryVerticalJointsAreSealed: toYesNoNA(form.masonryCladding_windowOrMasonryVerticalJointsAreSealed),
        masonryCladding_soffitsAppearToBeSoundWithNoWaterStainingOrBubblingPaintWhichMayIndicateGuttersOrRoofLeakingIntoSurfeitsAndPossiblyWalls: form.masonryCladding_soffitsAppearToBeSoundWithNoWaterStainingOrBubblingPaintWhichMayIndicateGuttersOrRoofLeakingIntoSurfeitsAndPossiblyWalls,
        masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater: form.masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater,
        masonryCladding_underfloorSpaceExcessivelyDamp: toYesNoNA(form.masonryCladding_underfloorSpaceExcessivelyDamp),
        c22_externalMoisture_priorToInstallationWorkRequired: form.c22_externalMoisture_priorToInstallationWorkRequired,
        c22_externalMoisture_priorToCertificationWorkRequired: form.c22_externalMoisture_priorToCertificationWorkRequired,
        skip_photos_elevation_north: elevationSkip.north,
        skip_photos_elevation_south: elevationSkip.south,
        skip_photos_elevation_east: elevationSkip.east,
        skip_photos_elevation_west: elevationSkip.west,
        assessorName: form.assessorName,
      };

      if (!isDraft && !finaliseChecks.canFinalise) {
        setNotice("Please complete all required fields before finalising.");
        if (!opts.quiet) setSaving(false);
        return;
      }

      const input = { _id: job._id, ebaForm };
      const res = await gql<{ saveEBA: Job }>(SAVE_EBA_MUTATION, { input, isDraft });
      setJob((prev) => (prev ? { ...prev, ebaForm: { ...(prev.ebaForm || {}), ...(res.saveEBA.ebaForm || {}), ...ebaForm } } : prev));
      setLastSavedAt(new Date());
      if (!opts.quiet) setNotice(isDraft ? "EBA draft saved." : "EBA finalised.");
      if (!opts.stay) router.replace(`/jobs/${id}`);
    } catch (err) {
      if (!opts.quiet) setError(err instanceof Error ? err.message : "Failed to save EBA");
    } finally {
      if (!opts.quiet) setSaving(false);
    }
  }

  const finaliseChecks = useMemo(() => {
    const requiredFieldLabels: Record<string, string> = {
      nameOfOwners: "Name of owners",
      proofOfOwnership: "Proof of ownership",
      bcaOrTa: "BCA/TA",
      lotOrDPNumber: "Lot / DP Number",
      approximateYearOfConstruction: "Approx year of construction",
      numberOfStories: "Number of stories",
      roofAndEavesCol1: "Roof type",
      roofAndEavesCol2: "Roof cladding",
      roofAndEavesCol3: "Eaves",
      foundationAndFloor: "Foundation and floor",
      framing: "Framing",
      joinery: "Joinery",
      lining: "Lining",
      buildingPaper: "Building paper",
      exteriorCladding: "Exterior cladding",
      claddingType: "Cladding type",
      claddingTypeInstalledVia: "Cladding installed via",
      finishOfCladding: "Finish of cladding",
      b131_structure: "Structure B1.3.1",
      b131_structure_priorToInstallationWorkRequired: "Structure work required",
      b131_structure_priorToCertificationWorkRequired: "Structure work required",
      c22_preventionOfFireOccuring: "Prevention of fire C2.2",
      c22_preventionOfFireOccuring_priorToInstallationWorkRequired: "Fire work required",
      c22_preventionOfFireOccuring_priorToCertificationWorkRequired: "Fire work required",
      g931_electricity: "Electricity G9.3.1",
      g931_electricity_priorToInstallationWorkRequired: "Electricity work required",
      g931_electricity_priorToCertificationWorkRequired: "Electricity work required",
      h131_energyEfficiency: "Energy efficiency H1.3.1",
      c22_externalMoisture_paintFinishOfExteriorCladdingAppearsToBeInAnWellMaintainedCondition: "External moisture: paint finish",
      c22_externalMoisture_exteriorCladdingAppearsToHaveDeteriorationToALevelThatMayAllowWaterIngress: "External moisture: cladding deterioration",
      c22_externalMoisture_joineryAppearsToBeInGoodConditionAndNotAllowingWaterIngress: "External moisture: joinery",
      c22_externalMoisture_flashingsArePresentAndAppearToBeInstalledCorrectly: "External moisture: flashings",
      c22_externalMoisture_allExistingPenetrationsAreSealed: "External moisture: penetrations",
      c22_externalMoisture_joinBetweenDifferentCladdingTypesSealed: "External moisture: cladding joins",
      c22_externalMoisture_guttersAndDownPipesArePresentAndAppearToBeFunctioningCorrectly: "External moisture: gutters/downpipes",
      c22_externalMoisture_isWaterAbleToPoolAgainstExteriorWall: "External moisture: water pooling",
      c22_externalMoisture_wallsAreFreeToAir: "External moisture: walls free to air",
      masonryCladding_masonryCladUnderfloorVentsArePresentAndClear: "Masonry vents",
      masonryCladding_windowOrMasonryVerticalJointsAreSealed: "Masonry joints",
      masonryCladding_soffitsAppearToBeSoundWithNoWaterStainingOrBubblingPaintWhichMayIndicateGuttersOrRoofLeakingIntoSurfeitsAndPossiblyWalls: "Soffits condition",
      masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater: "Damp/soft/mouldy areas",
      masonryCladding_underfloorSpaceExcessivelyDamp: "Underfloor dampness",
      c22_externalMoisture_priorToInstallationWorkRequired: "External moisture work required",
      c22_externalMoisture_priorToCertificationWorkRequired: "External moisture work required",
      assessorName: "Assessor name",
    };

    const missingFields: string[] = FINALISE_REQUIRED_KEYS.filter((key) => !hasValue(form[key]));

    // finishOfCladding stores detail text in an "Other:" prefix, so hasValue would return true
    // even when no option is actually selected. Use parseLegacyMappedCheckboxList instead.
    if (!parseLegacyMappedCheckboxList(form.finishOfCladding, ["Timber / Cement Board", "Painted render / plaster / masonry", "Unsealed masonry"]).length) {
      missingFields.push("finishOfCladding");
    }

    // Conditionally required textarea pairs — at least one of the pair must be filled.
    // The install key acts as a sentinel: when it is in missingFields both textareas highlight red.
    if (form.b131_structure === false) {
      if (!hasValue(form.b131_structure_priorToInstallationWorkRequired) && !hasValue(form.b131_structure_priorToCertificationWorkRequired)) {
        missingFields.push("b131_structure_priorToInstallationWorkRequired");
      }
    }
    if (form.c22_preventionOfFireOccuring === true) {
      if (!hasValue(form.c22_preventionOfFireOccuring_priorToInstallationWorkRequired) && !hasValue(form.c22_preventionOfFireOccuring_priorToCertificationWorkRequired)) {
        missingFields.push("c22_preventionOfFireOccuring_priorToInstallationWorkRequired");
      }
    }
    if (form.g931_electricity === false) {
      if (!hasValue(form.g931_electricity_priorToInstallationWorkRequired) && !hasValue(form.g931_electricity_priorToCertificationWorkRequired)) {
        missingFields.push("g931_electricity_priorToInstallationWorkRequired");
      }
    }
    const redWhenYesSet = new Set([
      "c22_externalMoisture_exteriorCladdingAppearsToHaveDeteriorationToALevelThatMayAllowWaterIngress",
      "c22_externalMoisture_isWaterAbleToPoolAgainstExteriorWall",
      "masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater",
      "masonryCladding_underfloorSpaceExcessivelyDamp",
    ]);
    const externalMoistureWorkNeeded = [
      ...externalMoistureQuestions.map(([k]) => k as string),
      "masonryCladding_masonryCladUnderfloorVentsArePresentAndClear",
      "masonryCladding_windowOrMasonryVerticalJointsAreSealed",
    ].some((k) => redWhenYesSet.has(k) ? form[k] === true : form[k] === false);
    const waterIngressWorkNeeded =
      form.masonryCladding_soffitsAppearToBeSoundWithNoWaterStainingOrBubblingPaintWhichMayIndicateGuttersOrRoofLeakingIntoSurfeitsAndPossiblyWalls === false ||
      form.masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater === true ||
      form.masonryCladding_underfloorSpaceExcessivelyDamp === true;
    if (externalMoistureWorkNeeded || waterIngressWorkNeeded) {
      if (!hasValue(form.c22_externalMoisture_priorToInstallationWorkRequired) && !hasValue(form.c22_externalMoisture_priorToCertificationWorkRequired)) {
        missingFields.push("c22_externalMoisture_priorToInstallationWorkRequired");
      }
    }

    const requiredPhotoSections = (["north", "east", "south", "west"] as const)
      .filter((dir) => !elevationSkip[dir])
      .map((dir) => `elevation_${dir}`);
    const missingPhotoSections = requiredPhotoSections.filter((section) => (ebaPhotos[section] || []).length === 0);
    const hasAssessorSignature = !!signatureFileName(job?.ebaForm?.signature_assessor);

    const missingItems = [
      ...missingFields.map((key) => requiredFieldLabels[key] || key),
      ...((roofTypeOtherChecked && !getLegacyCustomOther(form.roofAndEavesCol1, ["Hip Gable","Double Gable","Skillion / Mono pitch"]).trim()) ? ["Roof type other text"] : []),
      ...((roofCladdingOtherChecked && !getLegacyCustomOther(form.roofAndEavesCol2, ["Corrugated Steel","Tile","Membrane"]).trim()) ? ["Roof cladding other text"] : []),
      ...missingPhotoSections.map((section) => `Photo: ${section.replace("elevation_", "")} elevation`),
      ...(hasAssessorSignature ? [] : ["Assessor signature"]),
    ];

    return {
      canFinalise: missingItems.length === 0,
      missingCount: missingItems.length,
      missingItems,
      missingFields,
      missingPhotoSections,
      missingSignature: !hasAssessorSignature,
      missingRoofTypeOther: roofTypeOtherChecked && !getLegacyCustomOther(form.roofAndEavesCol1, ["Hip Gable","Double Gable","Skillion / Mono pitch"]).trim(),
      missingRoofCladdingOther: roofCladdingOtherChecked && !getLegacyCustomOther(form.roofAndEavesCol2, ["Corrugated Steel","Tile","Membrane"]).trim(),
    };
  }, [form, ebaPhotos, elevationSkip, job?.ebaForm?.signature_assessor]);

  const locked = !!job?.ebaForm?.clientApproved;
  const totalRequiredItems = FINALISE_REQUIRED_KEYS.length + 5;
  const completedRequiredItems = Math.max(0, totalRequiredItems - finaliseChecks.missingCount);
  const completionPercent = Math.round((completedRequiredItems / totalRequiredItems) * 100);
  const missingPreviewItems = finaliseChecks.missingItems.slice(0, 8);
  const photoCount = (["north", "east", "south", "west"] as const).reduce((sum, dir) => (
    sum + (elevationSkip[dir] ? 1 : (ebaPhotos[`elevation_${dir}`] || []).length > 0 ? 1 : 0)
  ), 0);
  const signatureReady = !!signatureFileName(job?.ebaForm?.signature_assessor);
  const sectionMissingItems = (sectionId: string) =>
    finaliseChecks.missingItems.filter((item) => sectionForMissingItem(item) === sectionId);

  const sections = [
    { id: "admin", label: "Admin", helper: "Owner, authority, date", done: ["nameOfOwners", "proofOfOwnership", "bcaOrTa", "lotOrDPNumber"].every((key) => !finaliseChecks.missingFields.includes(key)) },
    { id: "building", label: "Building", helper: "Construction details", done: ["approximateYearOfConstruction", "numberOfStories", "roofAndEavesCol1", "roofAndEavesCol2", "roofAndEavesCol3", "foundationAndFloor", "framing", "joinery", "lining", "buildingPaper", "exteriorCladding"].every((key) => !finaliseChecks.missingFields.includes(key)) },
    { id: "install", label: "Install", helper: "Cladding and finish", done: ["claddingType", "claddingTypeInstalledVia", "finishOfCladding"].every((key) => !finaliseChecks.missingFields.includes(key)) },
    { id: "code", label: "Code", helper: "B1, C2, G9, H1", done: ["b131_structure", "c22_preventionOfFireOccuring", "g931_electricity", "h131_energyEfficiency"].every((key) => !finaliseChecks.missingFields.includes(key)) },
    { id: "moisture", label: "Moisture", helper: "External water checks", done: !finaliseChecks.missingItems.some((item) => item.toLowerCase().includes("moisture") || item.toLowerCase().includes("masonry") || item.toLowerCase().includes("soffit") || item.toLowerCase().includes("damp")) },
    { id: "photos", label: "Photos", helper: `${photoCount}/4 elevations`, done: finaliseChecks.missingPhotoSections.length === 0 },
    { id: "sign", label: "Sign", helper: "Declaration", done: signatureReady },
  ];

  const scrollToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const sectionForMissingItem = (item: string) => {
    const value = item.toLowerCase();
    if (value.includes("photo") || value.includes("elevation")) return "photos";
    if (value.includes("signature") || value.includes("assessor")) return "sign";
    if (value.includes("cladding type") || value.includes("finish of cladding") || value.includes("installed via")) return "install";
    if (value.includes("structure") || value.includes("fire") || value.includes("electricity") || value.includes("energy efficiency")) return "code";
    if (value.includes("moisture") || value.includes("masonry") || value.includes("soffit") || value.includes("damp")) return "moisture";
    if (value.includes("roof") || value.includes("foundation") || value.includes("framing") || value.includes("joinery") || value.includes("lining") || value.includes("building paper") || value.includes("exterior cladding") || value.includes("year") || value.includes("stories")) return "building";
    return "admin";
  };

  const goToNextMissing = () => {
    const next = finaliseChecks.missingItems[0];
    if (!next) return;
    scrollToSection(sectionForMissingItem(next));
  };

  const statusForSection = (sectionId: string) => {
    const missing = sectionMissingItems(sectionId);
    if (missing.length) return `${missing.length} missing`;
    return "Done";
  };

  const saveLabel = dirty
    ? "Autosaving..."
    : lastSavedAt
      ? `Saved ${lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "Saved";

  useEffect(() => {
    if (!job || locked || loading || !dirty) return;
    const handle = window.setTimeout(() => {
      void saveEBA(true, { stay: true, quiet: true });
      setDirty(false);
    }, 1200);
    return () => window.clearTimeout(handle);
  }, [form, elevationSkip, job, locked, loading, dirty]);

  const YesNoRow = ({ keyName, label, notApplicable = false, noIsGreen = false, yesIsGreenText = false }: { keyName: string; label: string; notApplicable?: boolean; noIsGreen?: boolean; yesIsGreenText?: boolean }) => (
    <div>
      <p className="text-sm text-gray-700">{label}</p>
      <div className="flex gap-3 mt-1">
        <label className={`text-sm ${noIsGreen ? "text-red-700" : yesIsGreenText ? "text-green-700" : ""}`}><input type="radio" name={keyName} className={`mr-2 ${noIsGreen ? "accent-red-600" : "accent-green-600"}`} checked={form[keyName] === true} onChange={() => setField(keyName, true)} />Yes</label>
        <label className={`text-sm ${noIsGreen ? "text-green-700" : "text-red-700"}`}><input type="radio" name={keyName} className={`mr-2 ${noIsGreen ? "accent-green-600" : "accent-red-600"}`} checked={form[keyName] === false} onChange={() => setField(keyName, false)} />No</label>
        {notApplicable && <label className="text-sm text-gray-600"><input type="radio" name={keyName} className="mr-2 accent-gray-500" checked={form[keyName] === "NOT_APPLICABLE"} onChange={() => setField(keyName, "NOT_APPLICABLE")} />Not Applicable</label>}
      </div>
    </div>
  );
  const panelClass = (sectionId: string, base = "bg-white border border-gray-200 rounded-lg p-4 scroll-mt-36") =>
    `${base} ${activeSection === sectionId ? "block" : "hidden"}`;

  return (
    <div className="min-h-screen bg-[#eef2f3] text-slate-900">
      <div className="sticky top-0 z-30 border-b border-[#003f4d]/20 bg-[#00485a] text-white shadow-sm">
        <div className="h-1.5 bg-[#f36c21]" />
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-3">
        <button onClick={() => router.replace(`/jobs/${id}`)} className="text-sm text-white/85 whitespace-nowrap">← Back to Job</button>
        <h1 className="order-3 w-full text-center text-sm font-semibold text-white sm:order-none sm:w-auto sm:flex-1">Existing Building Assessment</h1>
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
      </div>

      <div className="mx-auto max-w-7xl p-4 pb-28">
        {loading && <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">Loading EBA...</div>}
        {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}

        {!loading && job && (
          <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <main className="space-y-4">
              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="bg-[#f7fafb] px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#00485a]">Guided EBA workflow</p>
                      <h2 className="mt-1 text-lg font-semibold text-slate-900">#{job.jobNumber} · {address || "No address"}</h2>
                      <p className="mt-1 text-sm text-slate-600">Work one focused section at a time, jump to the next missing item, then finalise with confidence.</p>
                    </div>
                    <div className="flex min-w-48 flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3">
                      <div>
                        <p className="text-xs text-slate-500">Draft state</p>
                        <p className={`mt-1 text-sm font-semibold ${dirty ? "text-amber-700" : "text-emerald-700"}`}>{saveLabel}</p>
                      </div>
                      {!finaliseChecks.canFinalise && (
                        <button type="button" onClick={goToNextMissing} className="rounded-md bg-[#00485a] px-3 py-2 text-xs font-semibold text-white">
                          Next required
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
                  <div className="rounded-lg border border-slate-100 p-3">
                    <p className="text-xs text-slate-500">Finalise readiness</p>
                    <p className={`mt-1 text-sm font-semibold ${finaliseChecks.canFinalise ? "text-emerald-700" : "text-amber-700"}`}>{finaliseChecks.canFinalise ? "Ready" : `${finaliseChecks.missingCount} items missing`}</p>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-[#f36c21]" style={{ width: `${completionPercent}%` }} /></div>
                  </div>
                  <div className="rounded-lg border border-slate-100 p-3">
                    <p className="text-xs text-slate-500">Elevation photos</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{photoCount}/4 complete</p>
                    <p className="mt-1 text-xs text-slate-500">Uploaded or intentionally skipped</p>
                  </div>
                  <div className="rounded-lg border border-slate-100 p-3">
                    <p className="text-xs text-slate-500">Signature</p>
                    <p className={`mt-1 text-sm font-semibold ${signatureReady ? "text-emerald-700" : "text-amber-700"}`}>{signatureReady ? "Assessor signed" : "Needed before finalise"}</p>
                    <p className="mt-1 text-xs text-slate-500">{locked ? "Locked after client signing" : "Editable until client approval"}</p>
                  </div>
                </div>
              </section>

              <nav className="sticky top-[86px] z-20 -mx-1 grid grid-flow-col auto-cols-[minmax(132px,1fr)] gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {sections.map((section) => (
                  <button key={section.id} type="button" onClick={() => scrollToSection(section.id)} className={`min-h-[58px] rounded-md border px-3 py-2 text-left ${activeSection === section.id ? "border-[#00485a] bg-[#e8f2f4] text-[#00485a] shadow-sm" : section.done ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                    <span className="block text-sm font-semibold">{section.done ? "✓ " : ""}{section.label}</span>
                    <span className="mt-0.5 block text-[11px] opacity-75">{statusForSection(section.id)}</span>
                  </button>
                ))}
              </nav>

              <fieldset disabled={locked} className={locked ? "space-y-4 opacity-75" : "space-y-4"}>
          <div className={`border rounded-lg p-3 text-sm ${job.ebaForm?.clientApproved ? "bg-emerald-50 border-emerald-200 text-emerald-700" : job.ebaForm?.complete ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
            {job.ebaForm?.clientApproved ? "EBA is client signed and complete." : job.ebaForm?.complete ? "EBA is finalised." : "EBA draft in progress. Changes autosave after edits; use finalise when all checks are complete."}
          </div>
            <div id="section-admin" className={panelClass("admin")}>
              <h2 className="text-sm font-semibold text-gray-700 mb-3">1) Administrative Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500">Property Address</label><div className="text-sm text-gray-800 mt-1">{address || "-"}</div></div>
                <div><label className="text-xs text-gray-500">Name of Owners</label><input value={(form.nameOfOwners as string) || ""} onChange={(e) => setField("nameOfOwners", e.target.value)} className={`w-full border rounded-lg px-3 py-2 text-sm mt-1 ${finaliseAttempted && finaliseChecks.missingFields.includes("nameOfOwners") ? "border-red-400 bg-red-50" : "border-gray-200"}`} /></div>
                <div><label className="text-xs text-gray-500">Proof of Ownership</label><select value={(form.proofOfOwnership as string) || ""} onChange={(e) => setField("proofOfOwnership", e.target.value)} className={`w-full border rounded-lg px-3 py-2 text-sm mt-1 ${finaliseAttempted && finaliseChecks.missingFields.includes("proofOfOwnership") ? "border-red-400 bg-red-50" : "border-gray-200"}`}><option>Certificate of Title</option><option>Rates</option><option>Other</option></select></div>
                <div><label className="text-xs text-gray-500">BCA/TA</label><input value={(form.bcaOrTa as string) || ""} onChange={(e) => setField("bcaOrTa", e.target.value)} className={`w-full border rounded-lg px-3 py-2 text-sm mt-1 ${finaliseAttempted && finaliseChecks.missingFields.includes("bcaOrTa") ? "border-red-400 bg-red-50" : "border-gray-200"}`} /></div>
                <div><label className="text-xs text-gray-500">Lot / DP Number</label><input value={(form.lotOrDPNumber as string) || ""} onChange={(e) => setField("lotOrDPNumber", e.target.value)} className={`w-full border rounded-lg px-3 py-2 text-sm mt-1 ${finaliseAttempted && finaliseChecks.missingFields.includes("lotOrDPNumber") ? "border-red-400 bg-red-50" : "border-gray-200"}`} /></div>
                <div><label className="text-xs text-gray-500">Date</label><input type="datetime-local" value={(form.date as string) || ""} onChange={(e) => setField("date", e.target.value)} className={`w-full border rounded-lg px-3 py-2 text-sm mt-1 ${finaliseAttempted && finaliseChecks.missingFields.includes("date") ? "border-red-400 bg-red-50" : "border-gray-200"}`} /></div>
              </div>
            </div>

            <div id="section-building" className={panelClass("building")}>
              <h2 className="text-sm font-semibold text-gray-700 mb-3">2) Existing Building Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500">Approx Year of Construction</label><input value={(form.approximateYearOfConstruction as string) || ""} onChange={(e) => setField("approximateYearOfConstruction", e.target.value)} className={`w-full border rounded-lg px-3 py-2 text-sm mt-1 ${finaliseAttempted && finaliseChecks.missingFields.includes("approximateYearOfConstruction") ? "border-red-400 bg-red-50" : "border-gray-200"}`} /></div>
                <div><label className="text-xs text-gray-500">Number of Stories</label><input type="number" value={(form.numberOfStories as number | undefined)?.toString() || ""} onChange={(e) => setField("numberOfStories", e.target.value ? Number(e.target.value) : undefined)} className={`w-full border rounded-lg px-3 py-2 text-sm mt-1 ${finaliseAttempted && finaliseChecks.missingFields.includes("numberOfStories") ? "border-red-400 bg-red-50" : "border-gray-200"}`} /></div>
                <div className="md:col-span-2">
                  <label className="text-xs text-gray-500">Property Site Section</label>
                  <div className={`flex gap-2 mt-1 flex-wrap rounded-lg p-1 ${finaliseAttempted && finaliseChecks.missingFields.includes("propertySiteSection") ? "border border-red-400 bg-red-50" : ""}`}>
                    {["Flat Section","Sloping Section","Steep Section"].map((opt) => (
                      <label key={opt} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white cursor-pointer">
                        <input type="radio" name="propertySiteSection" className="mr-1" checked={(form.propertySiteSection as string) === opt} onChange={() => setField("propertySiteSection", opt)} />{opt}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-gray-500">Property Site Exposure</label>
                  <div className={`flex gap-2 mt-1 flex-wrap rounded-lg p-1 ${finaliseAttempted && finaliseChecks.missingFields.includes("propertySiteExposure") ? "border border-red-400 bg-red-50" : ""}`}>
                    {["Exposed","Semi-Exposed","Sheltered"].map((opt) => (
                      <label key={opt} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white cursor-pointer">
                        <input type="radio" name="propertySiteExposure" className="mr-1" checked={(form.propertySiteExposure as string) === opt} onChange={() => setField("propertySiteExposure", opt)} />{opt}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs text-gray-500">Property Site Area</label>
                  <div className={`flex gap-2 mt-1 flex-wrap rounded-lg p-1 ${finaliseAttempted && finaliseChecks.missingFields.includes("propertySiteArea") ? "border border-red-400 bg-red-50" : ""}`}>
                    {["Urban","Rural"].map((opt) => (
                      <label key={opt} className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white cursor-pointer">
                        <input type="radio" name="propertySiteArea" className="mr-1" checked={(form.propertySiteArea as string) === opt} onChange={() => setField("propertySiteArea", opt)} />{opt}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className={`${activeSection === "building" ? "block" : "hidden"} border rounded-lg p-4 ${finaliseAttempted && (finaliseChecks.missingFields.includes("roofAndEavesCol1") || finaliseChecks.missingFields.includes("roofAndEavesCol2") || finaliseChecks.missingFields.includes("roofAndEavesCol3")) ? "border-red-400 bg-red-50" : "bg-white border-gray-200"}`}>
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Roof & Eaves</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Roof Type</label>
                  <div className="mt-1 space-y-1">{["Hip Gable","Double Gable","Skillion / Mono pitch"].map((opt)=>(<label key={opt} className="text-sm block"><input type="checkbox" className="mr-2" checked={parseLegacyCheckboxList(form.roofAndEavesCol1, ["Hip Gable","Double Gable","Skillion / Mono pitch"]).includes(opt)} onChange={() => setField("roofAndEavesCol1", toggleLegacyCheckboxList(form.roofAndEavesCol1, opt, ["Hip Gable","Double Gable","Skillion / Mono pitch"]))} />{opt}</label>))}</div>
                  <label className="text-sm block mt-2"><input type="checkbox" className="mr-2" checked={roofTypeOtherChecked} onChange={(e) => {
                    setRoofTypeOtherChecked(e.target.checked);
                    setField("roofAndEavesCol1", e.target.checked ? ["Other", ...parseLegacyCheckboxList(form.roofAndEavesCol1, ["Hip Gable","Double Gable","Skillion / Mono pitch"]), ""] : buildLegacyCheckboxArray(parseLegacyCheckboxList(form.roofAndEavesCol1, ["Hip Gable","Double Gable","Skillion / Mono pitch"]), "", ["Hip Gable","Double Gable","Skillion / Mono pitch"]));
                  }} />Other</label>
                  {roofTypeOtherChecked && (
                    <input
                      type="text"
                      placeholder="Other roof type"
                      value={getLegacyCustomOther(form.roofAndEavesCol1, ["Hip Gable","Double Gable","Skillion / Mono pitch"])}
                      onChange={(e) => setField("roofAndEavesCol1", setLegacyCheckboxListOther(form.roofAndEavesCol1, e.target.value, ["Hip Gable","Double Gable","Skillion / Mono pitch"]))}
                      className={`w-full border rounded-lg px-3 py-2 text-sm mt-2 ${finaliseAttempted && finaliseChecks.missingRoofTypeOther ? "border-red-400 bg-red-50" : "border-gray-200"}`}
                    />
                  )}
                  {finaliseAttempted && finaliseChecks.missingRoofTypeOther && <div className="text-xs text-red-600 mt-1">Other roof type is required</div>}
                </div>
                <div>
                  <label className="text-xs text-gray-500">Roof Cladding</label>
                  <div className="mt-1 space-y-1">{["Corrugated Steel","Tile","Membrane"].map((opt)=>(<label key={opt} className="text-sm block"><input type="checkbox" className="mr-2" checked={parseLegacyCheckboxList(form.roofAndEavesCol2, ["Corrugated Steel","Tile","Membrane"]).includes(opt)} onChange={() => setField("roofAndEavesCol2", toggleLegacyCheckboxList(form.roofAndEavesCol2, opt, ["Corrugated Steel","Tile","Membrane"]))} />{opt}</label>))}</div>
                  <label className="text-sm block mt-2"><input type="checkbox" className="mr-2" checked={roofCladdingOtherChecked} onChange={(e) => {
                    setRoofCladdingOtherChecked(e.target.checked);
                    setField("roofAndEavesCol2", e.target.checked ? ["Other", ...parseLegacyCheckboxList(form.roofAndEavesCol2, ["Corrugated Steel","Tile","Membrane"]), ""] : buildLegacyCheckboxArray(parseLegacyCheckboxList(form.roofAndEavesCol2, ["Corrugated Steel","Tile","Membrane"]), "", ["Corrugated Steel","Tile","Membrane"]));
                  }} />Other</label>
                  {roofCladdingOtherChecked && (
                    <input
                      type="text"
                      placeholder="Other roof cladding"
                      value={getLegacyCustomOther(form.roofAndEavesCol2, ["Corrugated Steel","Tile","Membrane"])}
                      onChange={(e) => setField("roofAndEavesCol2", setLegacyCheckboxListOther(form.roofAndEavesCol2, e.target.value, ["Corrugated Steel","Tile","Membrane"]))}
                      className={`w-full border rounded-lg px-3 py-2 text-sm mt-2 ${finaliseAttempted && finaliseChecks.missingRoofCladdingOther ? "border-red-400 bg-red-50" : "border-gray-200"}`}
                    />
                  )}
                  {finaliseAttempted && finaliseChecks.missingRoofCladdingOther && <div className="text-xs text-red-600 mt-1">Other roof cladding is required</div>}
                </div>
                <div>
                  <label className="text-xs text-gray-500">Eaves</label>
                  <div className="mt-1 space-y-1">{["No eaves","Modest eaves","Generous Eaves"].map((opt)=>(<label key={opt} className="text-sm block"><input type="checkbox" className="mr-2" checked={parseLegacyCheckboxList(form.roofAndEavesCol3, ["No eaves","Modest eaves","Generous Eaves"]).includes(opt)} onChange={() => setField("roofAndEavesCol3", toggleLegacyCheckboxList(form.roofAndEavesCol3, opt, ["No eaves","Modest eaves","Generous Eaves"]))} />{opt}</label>))}</div>
                </div>
              </div>
            </div>

            <div className={`${activeSection === "building" ? "block" : "hidden"} border rounded-lg p-4 ${finaliseAttempted && finaliseChecks.missingFields.includes("foundationAndFloor") ? "border-red-400 bg-red-50" : "bg-white border-gray-200"}`}>
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Foundation & Floor</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {["Ring Perimeter","Piles","Slab","Suspended Floor Timber"].map((opt)=>(
                  <label key={opt} className="text-sm"><input type="checkbox" className="mr-2" checked={parseLegacyCheckboxList(form.foundationAndFloor, ["Ring Perimeter","Piles","Slab","Suspended Floor Timber"]).includes(opt)} onChange={() => setField("foundationAndFloor", toggleLegacyCheckboxList(form.foundationAndFloor, opt, ["Ring Perimeter","Piles","Slab","Suspended Floor Timber"]))} />{opt}</label>
                ))}
              </div>
            </div>

            <div className={`${activeSection === "building" ? "block" : "hidden"} border rounded-lg p-4 ${finaliseAttempted && (finaliseChecks.missingFields.includes("framing") || finaliseChecks.missingFields.includes("joinery") || finaliseChecks.missingFields.includes("lining")) ? "border-red-400 bg-red-50" : "bg-white border-gray-200"}`}>
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Framing, Joinery & Lining</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-gray-500">Framing</label>
                  {["Likely Rimu","Treated pinus","Untreated pinus","No framing (double brick)"].map((opt)=>(<label key={opt} className="text-sm block mt-1"><input type="checkbox" className="mr-2" checked={parseLegacyCheckboxList(form.framing, ["Likely Rimu","Treated pinus","Untreated pinus","No framing (double brick)"]).includes(opt)} onChange={() => setField("framing", toggleLegacyCheckboxList(form.framing, opt, ["Likely Rimu","Treated pinus","Untreated pinus","No framing (double brick)"]))} />{opt}</label>))}
                </div>
                <div>
                  <label className="text-xs text-gray-500">Joinery</label>
                  {["Timber","Aluminium/steel","uPVC","Appears to be installed correctly"].map((opt)=>(<label key={opt} className="text-sm block mt-1"><input type="checkbox" className="mr-2" checked={parseLegacyCheckboxList(form.joinery, ["Timber","Aluminium/steel","uPVC","Appears to be installed correctly"]).includes(opt)} onChange={() => setField("joinery", toggleLegacyCheckboxList(form.joinery, opt, ["Timber","Aluminium/steel","uPVC","Appears to be installed correctly"]))} />{opt}</label>))}
                </div>
                <div>
                  <label className="text-xs text-gray-500">Lining</label>
                  {["Plasterboard","Hardboard","Sarked","Masonry"].map((opt)=>(<label key={opt} className="text-sm block mt-1"><input type="checkbox" className="mr-2" checked={parseLegacyCheckboxList(form.lining, ["Plasterboard","Hardboard","Sarked","Masonry"]).includes(opt)} onChange={() => setField("lining", toggleLegacyCheckboxList(form.lining, opt, ["Plasterboard","Hardboard","Sarked","Masonry"]))} />{opt}</label>))}
                </div>
              </div>
            </div>

            <div className={`${activeSection === "building" ? "block" : "hidden"} border rounded-lg p-4 ${finaliseAttempted && finaliseChecks.missingFields.includes("buildingPaper") ? "border-red-400 bg-red-50" : "bg-white border-gray-200"}`}>
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

            <div className={`${activeSection === "building" ? "block" : "hidden"} border rounded-lg p-4 ${finaliseAttempted && finaliseChecks.missingFields.includes("exteriorCladding") ? "border-red-400 bg-red-50" : "bg-white border-gray-200"}`}>
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Exterior Cladding</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {["Timber","Cement Board","Rendered Plaster","Masonry veneer (nominal 140mm cavity)","Masonry (double brick)","EIFS","Palisade (plastic) weatherboard","Corrugated steel"].map((opt)=>(
                  <label key={opt} className="text-sm"><input type="checkbox" className="mr-2" checked={parseLegacyMappedCheckboxList(form.exteriorCladding, ["Timber","Cement Board","Rendered Plaster","Masonry veneer (nominal 140mm cavity)","Masonry (double brick)","EIFS","Palisade (plastic) weatherboard","Corrugated steel"]).includes(opt)} onChange={() => setField("exteriorCladding", toggleLegacyMappedCheckboxList(form.exteriorCladding, opt, ["Timber","Cement Board","Rendered Plaster","Masonry veneer (nominal 140mm cavity)","Masonry (double brick)","EIFS","Palisade (plastic) weatherboard","Corrugated steel"]))} />{opt}</label>
                ))}
              </div>
            </div>

            <div id="section-install" className={panelClass("install")}>
              <h2 className="text-sm font-semibold text-gray-700 mb-3">3) Install Information</h2>

              <h3 className="text-sm font-semibold text-gray-700 mb-2">Cladding Type</h3>
              <div className={`grid grid-cols-1 md:grid-cols-2 gap-1 mb-4 rounded-lg p-1 ${finaliseAttempted && finaliseChecks.missingFields.includes("claddingType") ? "border border-red-400 bg-red-50" : ""}`}>
                {["Timber","Cement Board","Rendered Plaster","Masonry Veneer","Masonry (Double brick)","EIFS","Palisade (plastic) weatherboard","Corrugated Steel"].map((opt)=>(
                  <label key={opt} className="text-sm"><input type="checkbox" className="mr-2" checked={parseLegacyMappedCheckboxList(form.claddingType, ["Timber","Cement Board","Rendered Plaster","Masonry Veneer","Masonry (Double brick)","EIFS","Palisade (plastic) weatherboard","Corrugated Steel"]).includes(opt)} onChange={() => setField("claddingType", toggleLegacyMappedCheckboxList(form.claddingType, opt, ["Timber","Cement Board","Rendered Plaster","Masonry Veneer","Masonry (Double brick)","EIFS","Palisade (plastic) weatherboard","Corrugated Steel"]))} />{opt}</label>
                ))}
              </div>

              <p className="text-sm text-gray-700 font-medium mb-1">Installed Via:</p>
              <div className={`grid grid-cols-1 gap-1 mb-4 rounded-lg p-1 ${finaliseAttempted && finaliseChecks.missingFields.includes("claddingTypeInstalledVia") ? "border border-red-400 bg-red-50" : ""}`}>
                {[
                  { label: "Cladding", value: "Cladding" },
                  { label: "Internal Lining", helper: "(mandatory for EIF, Palisade or Corrugated Steel)", value: "Internal Lining" },
                ].map((opt)=>(
                  <label key={opt.value} className="text-sm flex items-start gap-2"><input type="checkbox" className="mt-1" checked={parseLegacyMappedCheckboxList(form.claddingTypeInstalledVia, ["Cladding","Internal Lining"]).includes(opt.value)} onChange={() => setField("claddingTypeInstalledVia", toggleLegacyMappedCheckboxList(form.claddingTypeInstalledVia, opt.value, ["Cladding","Internal Lining"]))} /><span><span>{opt.label}</span>{opt.helper ? <span className="block text-xs text-gray-500">{opt.helper}</span> : null}</span></label>
                ))}
              </div>

              <h3 className="text-sm font-semibold text-gray-700 mb-2">Installation</h3>
              <p className="text-sm text-gray-600 mb-4">
                Framing timber and accessible cavities are located by various means including infra red detection and a 16mm installation hole is made to access each cavity. The installation hole can be made in the exterior cladding (with the exception of palisade weather board, corrugated steel or EIFS claddings) or in the interior lining. The Insulmax® installation machinery is calibrated for the construction type and each cavity is filled with Insulmax® water resistant blown mineral fibre.
              </p>

              <h3 className="text-sm font-semibold text-gray-700 mb-2">Finishing of Cladding</h3>
              <div className={`grid grid-cols-1 gap-2 rounded-lg p-1 ${finaliseAttempted && finaliseChecks.missingFields.includes("finishOfCladding") ? "border border-red-400 bg-red-50" : ""}`}>
                {(() => {
                  const finishOptions = [
                    { value: "Timber / Cement Board", detail: "Timber / Cement Board Holes filled with Turbo house filler, sand flush and holes sealed with exterior paint system" },
                    { value: "Painted render / plaster / masonry", detail: "Painted render / plaster / masonry Holes filled with Turbo house filler, sand flush and holes sealed with exterior paint system" },
                    { value: "Unsealed masonry", detail: "Unsealed masonry Holes filled with sand / cement mortar and exterior cladding sealed with appropriate Surfapor masonry surface sealer for concrete or clay based substrates. Clay brick http://www.pacificnanotech.co.nz/catalog/surfapore-range/surfapore-r Concrete block/brick http://www.pacificnanotech.co.nz/catalog/surfapore/surfapore-c" },
                  ];
                  const storedValues = finishOptions.map((opt) => opt.value);
                  const selectedFinish = parseLegacyMappedCheckboxList(form.finishOfCladding, storedValues);
                  return finishOptions.map((opt)=>(
                    <label key={opt.value} className="text-sm"><input type="checkbox" className="mr-2 align-top mt-1" checked={selectedFinish.includes(opt.value)} onChange={() => {
                      const nextSelected = selectedFinish.includes(opt.value) ? selectedFinish.filter((x) => x !== opt.value) : [...selectedFinish, opt.value];
                      setField("finishOfCladding", buildLegacyCheckboxArray(nextSelected, "", storedValues));
                    }} /><span>{opt.value}</span></label>
                  ));
                })()}
              </div>
            </div>

            <div id="section-code" className={activeSection === "code" || activeSection === "moisture" ? "bg-white border border-gray-200 rounded-lg p-4 scroll-mt-36" : "hidden"}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-gray-700">4</span>
                <h2 className="text-sm font-semibold text-gray-700">Assessment of the Existing Building</h2>
              </div>
              <p className="text-xs text-gray-500 mb-3">In relation to S112 to determine that the installation of Insulmax® insulation will not reduce compliance of the existing building.</p>

              <div className="space-y-4">
                <div className={activeSection === "code" ? "space-y-4" : "hidden"}>
                {[
                  ["Structure B1.3.1","Do linings and claddings appear to have been fixed correctly and are suitable to withstand the slight pressure that they will experience during the installation process ?","b131_structure","b131_structure_priorToInstallationWorkRequired","b131_structure_priorToCertificationWorkRequired"],
                  ["Prevention of Fire Occurring C2.2","Is a through wall flu located in the area proposed to be insulated ?","c22_preventionOfFireOccuring","c22_preventionOfFireOccuring_priorToInstallationWorkRequired","c22_preventionOfFireOccuring_priorToCertificationWorkRequired"],
                  ["Electricity G9.3.1","After removing a plug point on an exterior wall, wiring is observed to be TPS ?","g931_electricity","g931_electricity_priorToInstallationWorkRequired","g931_electricity_priorToCertificationWorkRequired"],
                  ["Energy Efficiency H1.3.1","Is Insulmax® insulation able to be installed so increasing the thermal resistance of the wall structure and limiting uncontrolled airflow?","h131_energyEfficiency",null,null],
                ].map(([heading, question, key, installKey, certKey]) => {
                  const selectedYes = form[key as string] === true;
                  const selectedNo = form[key as string] === false;
                  const isFireQuestion = key === "c22_preventionOfFireOccuring";

                  const showWorkRequired = Boolean(
                    installKey && ((isFireQuestion && selectedYes) || (!isFireQuestion && selectedNo))
                  );

                  const helpText = key === "b131_structure" && selectedNo
                    ? "Indicate in work required prior to installation that linings should be attached more securely"
                    : key === "c22_preventionOfFireOccuring" && selectedYes
                      ? "Mark on site plan and DO NOT install in cavity containing a through wall flu or alternatively obtain written confirmation from flu installer that insulation may be installed around through wall flu"
                      : key === "g931_electricity" && selectedNo
                        ? "Indicate in work required prior to the installation of Insulmax® that wiring requires upgrading to TPS in walls proposed to be insulated with Insulmax®"
                        : key === "h131_energyEfficiency" && selectedNo
                          ? "Indicate on site plan areas of wall that are not able to be insulated with Insulmax®"
                          : "";

                  return (
                    <div key={key as string} className="border border-gray-100 rounded-lg p-3">
                      <h3 className="text-sm font-semibold text-gray-700">{heading as string}</h3>
                      <p className="text-sm text-gray-700 mt-2">{question as string}</p>
                      <div className="flex gap-3 mt-2">
                        <label className={`text-sm ${isFireQuestion ? "text-red-700" : ""}`}>
                          <input
                            type="radio"
                            name={key as string}
                            className={`mr-2 ${isFireQuestion ? "accent-red-600" : "accent-green-600"}`}
                            checked={selectedYes}
                            onChange={() => setField(key as string, true)}
                          />
                          Yes
                        </label>
                        <label className={`text-sm ${isFireQuestion ? "text-green-700" : "text-red-700"}`}>
                          <input
                            type="radio"
                            name={key as string}
                            className={`mr-2 ${isFireQuestion ? "accent-green-600" : "accent-red-600"}`}
                            checked={selectedNo}
                            onChange={() => setField(key as string, false)}
                          />
                          No
                        </label>
                      </div>
                      {!showWorkRequired && helpText && (
                        <p className="text-sm text-red-700 mt-2">{helpText}</p>
                      )}
                      {showWorkRequired && installKey && (
                        <div className="mt-3">
                          {helpText && <p className="text-sm text-red-700 mb-2">{helpText}</p>}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs text-gray-500">Prior to Installation Work Required</label>
                              <textarea value={(form[installKey as string] as string) || ""} onChange={(e) => setField(installKey as string, e.target.value)} rows={2} className={`w-full border rounded-lg px-3 py-2 text-sm mt-1 ${finaliseAttempted && finaliseChecks.missingFields.includes(installKey as string) ? "border-red-400 bg-red-50" : "border-gray-200"}`} />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500">Prior to Certification Work Required</label>
                              <textarea value={(certKey ? (form[certKey as string] as string) : "") || ""} onChange={(e) => certKey && setField(certKey as string, e.target.value)} rows={2} className={`w-full border rounded-lg px-3 py-2 text-sm mt-1 ${finaliseAttempted && finaliseChecks.missingFields.includes(installKey as string) ? "border-red-400 bg-red-50" : "border-gray-200"}`} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>

                <div id="section-moisture" className={`${activeSection === "moisture" ? "block" : "hidden"} border border-gray-100 rounded-lg p-3 scroll-mt-36`}>
                  <h3 className="text-sm font-semibold text-gray-700">External Moisture E2.3.3 E2.3.5</h3>
                  <div className="space-y-3 mt-2">
                    {externalMoistureQuestions.map(([k, q]) => {
                      const noIsGreen = k === "c22_externalMoisture_exteriorCladdingAppearsToHaveDeteriorationToALevelThatMayAllowWaterIngress"
                        || k === "c22_externalMoisture_isWaterAbleToPoolAgainstExteriorWall";

                      return (
                        <div key={k}>
                          <p className="text-sm text-gray-700">{q}</p>
                          <div className="flex gap-3 mt-1">
                            <label className={`text-sm ${noIsGreen ? "text-red-700" : ""}`}>
                              <input
                                type="radio"
                                name={k}
                                className={`mr-2 ${noIsGreen ? "accent-red-600" : "accent-green-600"}`}
                                checked={form[k] === true}
                                onChange={() => setField(k, true)}
                              />
                              Yes
                            </label>
                            <label className={`text-sm ${noIsGreen ? "text-green-700" : "text-red-700"}`}>
                              <input
                                type="radio"
                                name={k}
                                className={`mr-2 ${noIsGreen ? "accent-green-600" : "accent-red-600"}`}
                                checked={form[k] === false}
                                onChange={() => setField(k, false)}
                              />
                              No
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="space-y-3 mt-3">
                    <YesNoRow keyName="masonryCladding_masonryCladUnderfloorVentsArePresentAndClear" label="Masonry clad home underfloor vents are present and clear?" notApplicable yesIsGreenText />
                    <YesNoRow keyName="masonryCladding_windowOrMasonryVerticalJointsAreSealed" label="Window / masonry vertical joints are sealed?" notApplicable yesIsGreenText />
                  </div>

                  {(() => {
                    const redWhenYesKeys = new Set([
                      "c22_externalMoisture_exteriorCladdingAppearsToHaveDeteriorationToALevelThatMayAllowWaterIngress",
                      "c22_externalMoisture_isWaterAbleToPoolAgainstExteriorWall",
                      "masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater",
                      "masonryCladding_underfloorSpaceExcessivelyDamp",
                    ]);

                    const externalMoistureHasRed = [
                      ...externalMoistureQuestions.map(([k]) => k),
                      "masonryCladding_masonryCladUnderfloorVentsArePresentAndClear",
                      "masonryCladding_windowOrMasonryVerticalJointsAreSealed",
                    ].some((k) => redWhenYesKeys.has(k) ? form[k] === true : form[k] === false);

                    if (!externalMoistureHasRed) return null;

                    return (
                      <div className="mt-3">
                        <p className="text-sm text-red-700 mb-2">
                          Itemise maintenance in work required section that is either required prior to the installation of Insulmax® for major maintenance areas or prior to issuing an Insulmax® Completion Certificate. Example: itemised major maintenance may be, prevent water from pooling against wall by removing deck from south wall as marked on site plan before the installation of Insulmax®.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-gray-500">Prior to Installation Work Required</label>
                            <textarea value={(form.c22_externalMoisture_priorToInstallationWorkRequired as string) || ""} onChange={(e) => setField("c22_externalMoisture_priorToInstallationWorkRequired", e.target.value)} rows={2} className={`w-full border rounded-lg px-3 py-2 text-sm mt-1 ${finaliseAttempted && finaliseChecks.missingFields.includes("c22_externalMoisture_priorToInstallationWorkRequired") ? "border-red-400 bg-red-50" : "border-gray-200"}`} />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">Prior to Certification Work Required</label>
                            <textarea value={(form.c22_externalMoisture_priorToCertificationWorkRequired as string) || ""} onChange={(e) => setField("c22_externalMoisture_priorToCertificationWorkRequired", e.target.value)} rows={2} className={`w-full border rounded-lg px-3 py-2 text-sm mt-1 ${finaliseAttempted && finaliseChecks.missingFields.includes("c22_externalMoisture_priorToInstallationWorkRequired") ? "border-red-400 bg-red-50" : "border-gray-200"}`} />
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className={`${activeSection === "moisture" ? "block" : "hidden"} border border-gray-100 rounded-lg p-3`}>
                  <h3 className="text-sm font-semibold text-gray-700">Signs of Water Ingress</h3>
                  <div className="space-y-3 mt-2">
                    <YesNoRow keyName="masonryCladding_soffitsAppearToBeSoundWithNoWaterStainingOrBubblingPaintWhichMayIndicateGuttersOrRoofLeakingIntoSurfeitsAndPossiblyWalls" label="Soffits appear to be sound with no water staining or bubbling paint which may indicate gutters or roof leaking into soffits and possibly walls?" />
                    <YesNoRow keyName="masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater" label="Areas of lining / cladding appear to be damp / soft / discoloured / mouldy or rotten suggesting the accumulation of water?" noIsGreen />
                    <YesNoRow keyName="masonryCladding_underfloorSpaceExcessivelyDamp" label="Underfloor space is excessively damp ?" notApplicable noIsGreen />
                  </div>

                  {(() => {
                    const waterIngressHasRed =
                      form.masonryCladding_soffitsAppearToBeSoundWithNoWaterStainingOrBubblingPaintWhichMayIndicateGuttersOrRoofLeakingIntoSurfeitsAndPossiblyWalls === false ||
                      form.masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater === true ||
                      form.masonryCladding_underfloorSpaceExcessivelyDamp === true;

                    if (!waterIngressHasRed) return null;

                    return (
                      <div className="mt-3">
                        <p className="text-sm text-red-700 mb-2">
                          Do not install Insulmax® until further investigations have been made to confirm that enclosed spaces have not accumulated moisture to a level that may cause fungal growth or the degradation of building elements. Framing moisture levels must be below 18% and the source of water ingress identified and remedied. Excessive underfloor moisture may be due to leaking in wall pipes, ground water or gutters leaking water in the wall soffit and wall cavity in the case of masonry veneer construction. Work required would be to repair leaking pipes before the installation of Insulmax® or check soffits for water staining or other signs of water ingress. Results of the investigation to be noted in work required prior to the installation of Insulmax®.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs text-gray-500">Prior to Installation Work Required</label>
                            <textarea value={(form.c22_externalMoisture_priorToInstallationWorkRequired as string) || ""} onChange={(e) => setField("c22_externalMoisture_priorToInstallationWorkRequired", e.target.value)} rows={2} className={`w-full border rounded-lg px-3 py-2 text-sm mt-1 ${finaliseAttempted && finaliseChecks.missingFields.includes("c22_externalMoisture_priorToInstallationWorkRequired") ? "border-red-400 bg-red-50" : "border-gray-200"}`} />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500">Prior to Certification Work Required</label>
                            <textarea value={(form.c22_externalMoisture_priorToCertificationWorkRequired as string) || ""} onChange={(e) => setField("c22_externalMoisture_priorToCertificationWorkRequired", e.target.value)} rows={2} className={`w-full border rounded-lg px-3 py-2 text-sm mt-1 ${finaliseAttempted && finaliseChecks.missingFields.includes("c22_externalMoisture_priorToInstallationWorkRequired") ? "border-red-400 bg-red-50" : "border-gray-200"}`} />
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            <div id="section-photos" className={panelClass("photos")}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-gray-700">5</span>
                <h2 className="text-sm font-semibold text-gray-700">Site Photos</h2>
              </div>

              <h3 className="text-sm font-semibold text-gray-700 mb-2">Elevation</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(["north","east","south","west"] as const).map((dir) => (
                  <div key={dir} className={`border rounded-lg p-3 ${finaliseAttempted && finaliseChecks.missingPhotoSections.includes(`elevation_${dir}`) ? "border-red-400 bg-red-50" : "border-gray-100"}`}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-gray-700 capitalize">{dir} Elevation</p>
                      <label className="text-xs text-gray-600 flex items-center gap-1">
                        <input type="checkbox" checked={!!elevationSkip[dir]} onChange={(e)=>setElevationSkip((p)=>({ ...p, [dir]: e.target.checked }))} />
                        Skip
                      </label>
                    </div>
                    {!elevationSkip[dir] && (
                      <>
                        <div className="flex gap-2 mb-2">
                          <button type="button" disabled={!!uploadingPhotosBySection[`elevation_${dir}`]} onClick={() => fileInputRef.current[`elevation_${dir}`]?.click()} className="text-xs bg-gray-100 text-gray-700 px-2.5 py-1.5 rounded disabled:opacity-50">Add existing</button>
                          <button type="button" disabled={!!uploadingPhotosBySection[`elevation_${dir}`]} onClick={() => cameraInputRef.current[`elevation_${dir}`]?.click()} className="text-xs bg-[#1a3a4a] text-white px-2.5 py-1.5 rounded disabled:opacity-50">Take photo</button>
                        </div>
                        {uploadingPhotosBySection[`elevation_${dir}`] > 0 && <p className="text-xs text-[#1a3a4a] mb-2">Uploading photo...</p>}
                        <input ref={(el)=>{ fileInputRef.current[`elevation_${dir}`]=el; }} type="file" accept="image/*" onChange={(e) => handlePhotoInputChange(`elevation_${dir}`, e)} className="hidden" />
                        <input ref={(el)=>{ cameraInputRef.current[`elevation_${dir}`]=el; }} type="file" accept="image/*" capture="environment" onChange={(e) => handlePhotoInputChange(`elevation_${dir}`, e)} className="hidden" />
                        {(ebaPhotos[`elevation_${dir}`] || []).length > 0 && (
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            {(ebaPhotos[`elevation_${dir}`] || []).map((f) => (
                              <div key={f} className="border border-gray-200 rounded p-1">
                                <a href={fileUrl(f)} target="_blank" rel="noreferrer"><img src={fileUrl(f)} alt={f} className="w-full h-20 object-cover rounded" /></a>
                                <div className="flex justify-between items-center mt-1">
                                  <span className="text-[10px] text-gray-500 truncate max-w-[70%]">{f}</span>
                                  <button type="button" onClick={() => removeEbaPhoto(`elevation_${dir}`, f)} className="text-[10px] text-red-600">Delete</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <div className="border border-gray-100 rounded-lg p-3">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Foundation</h3>
                  <div className="flex gap-2 mb-2">
                    <button type="button" disabled={!!uploadingPhotosBySection.foundation} onClick={() => fileInputRef.current.foundation?.click()} className="text-xs bg-gray-100 text-gray-700 px-2.5 py-1.5 rounded disabled:opacity-50">Add existing</button>
                    <button type="button" disabled={!!uploadingPhotosBySection.foundation} onClick={() => cameraInputRef.current.foundation?.click()} className="text-xs bg-[#1a3a4a] text-white px-2.5 py-1.5 rounded disabled:opacity-50">Take photo</button>
                  </div>
                  {uploadingPhotosBySection.foundation > 0 && <p className="text-xs text-[#1a3a4a] mb-2">Uploading photo...</p>}
                  <input ref={(el)=>{ fileInputRef.current.foundation=el; }} type="file" accept="image/*" onChange={(e) => handlePhotoInputChange('foundation', e)} className="hidden" />
                  <input ref={(el)=>{ cameraInputRef.current.foundation=el; }} type="file" accept="image/*" capture="environment" onChange={(e) => handlePhotoInputChange('foundation', e)} className="hidden" />
                  {(ebaPhotos.foundation || []).length > 0 && (
                    <div className="mt-2 grid grid-cols-2 gap-2">{(ebaPhotos.foundation || []).map((f) => (
                      <div key={f} className="border border-gray-200 rounded p-1"><a href={fileUrl(f)} target="_blank" rel="noreferrer"><img src={fileUrl(f)} alt={f} className="w-full h-20 object-cover rounded" /></a><div className="flex justify-between items-center mt-1"><span className="text-[10px] text-gray-500 truncate max-w-[70%]">{f}</span><button type="button" onClick={() => removeEbaPhoto('foundation', f)} className="text-[10px] text-red-600">Delete</button></div></div>
                    ))}</div>
                  )}
                </div>
                <div className="border border-gray-100 rounded-lg p-3">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Maintenance</h3>
                  <div className="flex gap-2 mb-2">
                    <button type="button" disabled={!!uploadingPhotosBySection.maintenance} onClick={() => fileInputRef.current.maintenance?.click()} className="text-xs bg-gray-100 text-gray-700 px-2.5 py-1.5 rounded disabled:opacity-50">Add existing</button>
                    <button type="button" disabled={!!uploadingPhotosBySection.maintenance} onClick={() => cameraInputRef.current.maintenance?.click()} className="text-xs bg-[#1a3a4a] text-white px-2.5 py-1.5 rounded disabled:opacity-50">Take photo</button>
                  </div>
                  {uploadingPhotosBySection.maintenance > 0 && <p className="text-xs text-[#1a3a4a] mb-2">Uploading photo...</p>}
                  <input ref={(el)=>{ fileInputRef.current.maintenance=el; }} type="file" accept="image/*" onChange={(e) => handlePhotoInputChange('maintenance', e)} className="hidden" />
                  <input ref={(el)=>{ cameraInputRef.current.maintenance=el; }} type="file" accept="image/*" capture="environment" onChange={(e) => handlePhotoInputChange('maintenance', e)} className="hidden" />
                  {(ebaPhotos.maintenance || []).length > 0 && (
                    <div className="mt-2 grid grid-cols-2 gap-2">{(ebaPhotos.maintenance || []).map((f) => (
                      <div key={f} className="border border-gray-200 rounded p-1"><a href={fileUrl(f)} target="_blank" rel="noreferrer"><img src={fileUrl(f)} alt={f} className="w-full h-20 object-cover rounded" /></a><div className="flex justify-between items-center mt-1"><span className="text-[10px] text-gray-500 truncate max-w-[70%]">{f}</span><button type="button" onClick={() => removeEbaPhoto('maintenance', f)} className="text-[10px] text-red-600">Delete</button></div></div>
                    ))}</div>
                  )}
                </div>
              </div>
            </div>

            <div id="section-sign" className={panelClass("sign", "border border-gray-200 rounded-lg overflow-hidden scroll-mt-36")}>
              <div className="bg-gray-100 px-4 py-3 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-[#1a3a4a] text-white text-xs font-bold flex items-center justify-center">6</span>
                <h2 className="text-sm font-semibold text-gray-700 tracking-wide">DECLARATIONS</h2>
              </div>

              <div className="p-4 grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4 bg-white">
                <div className="text-sm font-semibold text-gray-700">Assessment of Existing Building</div>

                <div className="border border-gray-200 rounded-lg p-4">
                  <p className="text-sm text-gray-700 mb-2">
                    Based on this assessment of the existing building I am satisfied that the property is suitable for the installation of Insulmax® retrofit wall insulation. In relation to S112, the ability of the existing building to comply with the applicable building code clauses including durability B2.3.1 (to the extent of the other clauses) will not be reduced by the installation of Insulmax® blown fibre existing wall insulation on the following provisions:
                  </p>
                  <ul className="list-disc ml-5 text-sm text-gray-700 mb-3 space-y-1">
                    <li>Work itemised to be completed prior to the installation of Insulmax® is completed</li>
                    <li>Insulmax® is installed according to the Insulmax® Installation Manual</li>
                    <li>Reparation of exterior cladding is completed according to the Insulmax® Installation Manual</li>
                    <li>Work itemised to be completed before the application of CCC / issue of Insulmax® certificate of completion is completed</li>
                  </ul>

                  <div>
                    <label className="text-xs text-gray-500">Licensed Building Assessor Name</label>
                    <input value={(form.assessorName as string) || ""} onChange={(e) => setField("assessorName", e.target.value)} className={`w-full border rounded-lg px-3 py-2 text-sm mt-1 ${finaliseAttempted && finaliseChecks.missingFields.includes("assessorName") ? "border-red-400 bg-red-50" : "border-gray-200"}`} />
                  </div>

                  <div className="text-xs text-gray-500 mt-3 mb-1">Assessor signature</div>
                  <div className={`border rounded-lg bg-white overflow-hidden ${finaliseAttempted && finaliseChecks.missingSignature ? "border-red-400 bg-red-50" : "border-gray-300"}`}>
                    <canvas
                      ref={canvasRef}
                      width={900}
                      height={220}
                      className="w-full h-40 touch-none"
                      onPointerDown={(e) => {
                        const p = canvasPointFromClient(e.clientX, e.clientY);
                        startDraw(p.x, p.y);
                      }}
                      onPointerMove={(e) => {
                        const p = canvasPointFromClient(e.clientX, e.clientY);
                        drawTo(p.x, p.y);
                      }}
                      onPointerUp={stopDraw}
                      onPointerLeave={stopDraw}
                      onPointerCancel={stopDraw}
                    />
                  </div>
                  <div className="flex gap-2 mt-2 items-center flex-wrap">
                    <button type="button" onClick={clearSignaturePad} className="px-3 py-2 text-sm bg-gray-100 rounded-lg">Clear</button>
                    <button type="button" onClick={saveAssessorSignature} disabled={signing} className="px-3 py-2 text-sm bg-[#1a3a4a] text-white rounded-lg disabled:opacity-50">{signing ? 'Saving...' : 'Save Signature'}</button>
                  </div>
                </div>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4 bg-white border-t border-gray-200">
                <div className="text-sm font-semibold text-gray-700">Declaration of Conformity to CodeMark Certification</div>
                <div className="border border-gray-200 rounded-lg p-4">
                  <p className="text-sm text-gray-700">
                    I declare that I am an Insulmax® license holder and that all conditions of the attached CodeMark Certificate number CMNZ70028 have been met and will continue to be met during this installation of Insulmax® retrofit wall insulation.
                  </p>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">License Holder</div>
                      <div className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-gray-50">Insulmax® license holder</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Conformity signature</div>
                      <div className="border border-gray-200 rounded-lg min-h-24 bg-gray-50 flex items-center justify-center overflow-hidden">
                        {signatureFileName(job.ebaForm?.signature_conformityToCodeMarkCert) ? (
                          <img
                            src={fileUrl(signatureFileName(job.ebaForm?.signature_conformityToCodeMarkCert))}
                            alt="Conformity to CodeMark signature"
                            className="max-h-24 object-contain"
                          />
                        ) : (
                          <span className="text-xs text-gray-500 px-3 text-center">Region/license holder signature not available on this job.</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
              </fieldset>
            </main>

            <aside className="lg:sticky lg:top-28 h-fit space-y-3">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Workflow</p>
                <div className="mt-3 space-y-1">
                  {sections.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => scrollToSection(section.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm ${activeSection === section.id ? "bg-[#e8f2f4] text-[#00485a]" : "text-slate-700 hover:bg-slate-50"}`}
                    >
                      <span>
                        <span className="block font-semibold">{section.label}</span>
                        <span className="block text-xs opacity-70">{section.helper}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${section.done ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                        {statusForSection(section.id)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Missing before finalise</p>
                {finaliseChecks.canFinalise ? (
                  <p className="mt-2 text-sm font-semibold text-emerald-700">All required items are present.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    <button type="button" onClick={goToNextMissing} className="w-full rounded-md bg-[#00485a] px-3 py-2 text-sm font-semibold text-white">
                      Jump to next required
                    </button>
                    {missingPreviewItems.map((item) => (
                      <button key={item} type="button" onClick={() => scrollToSection(sectionForMissingItem(item))} className="block w-full rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-900">
                        {item}
                      </button>
                    ))}
                    {finaliseChecks.missingItems.length > missingPreviewItems.length && <p className="text-xs text-slate-500">{finaliseChecks.missingItems.length - missingPreviewItems.length} more missing items</p>}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Functional contract</p>
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  <li>Autosaves draft field edits</li>
                  <li>Locks once client approved</li>
                  <li>Uploads photos/signature immediately</li>
                  <li>Requires elevation photos or skip</li>
                  <li>Preserves CodeMark declaration</li>
                </ul>
              </div>
            </aside>
          </div>

            <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur">
              <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-700">{finaliseChecks.canFinalise ? "Ready to finalise" : `${finaliseChecks.missingCount} required item${finaliseChecks.missingCount === 1 ? "" : "s"} left`}</p>
                  <p className="truncate text-[11px] text-slate-500">{saveLabel}{finaliseChecks.canFinalise ? " · all checks complete" : missingPreviewItems[0] ? ` · next: ${missingPreviewItems[0]}` : ""}</p>
                </div>
                <div className="flex gap-2 flex-wrap justify-end">
                {!finaliseChecks.canFinalise && (
                  <button type="button" onClick={goToNextMissing} className="bg-[#00485a] text-white px-4 py-2.5 rounded-lg text-sm font-semibold">
                    Next required
                  </button>
                )}
                {locked ? (
                  <button type="button" onClick={() => router.replace(`/jobs/${id}`)} className="bg-[#1a3a4a] text-white px-4 py-2.5 rounded-lg text-sm font-semibold">Close</button>
                ) : (
                  <>
                    <button onClick={() => saveEBA(true)} disabled={saving} className="bg-white border border-gray-300 text-gray-700 px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50">{saving ? "Saving..." : "Save as draft and close"}</button>
                    <button onClick={() => saveEBA(false)} disabled={saving} className="bg-[#1a3a4a] text-white px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50">{saving ? "Finalising..." : "Finalise EBA"}</button>
                  </>
                )}
                </div>
              </div>
              {finaliseAttempted && !finaliseChecks.canFinalise && (
                <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
                  <p className="text-xs font-semibold text-amber-800">{finaliseChecks.missingCount} required item(s) still missing</p>
                  <p className="text-[11px] text-amber-700 mt-1">Foundation and maintenance photos are optional.</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {missingPreviewItems.map((item) => (
                      <span key={item} className="text-[11px] bg-white border border-amber-200 rounded-full px-2 py-0.5 text-amber-800">{item}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
