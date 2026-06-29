"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { gql } from "@/lib/graphql";
import {
  getDefaultInstallPlanningDetails,
  normalizeInstallPlanningDetails,
  type InstallPlanningDetails,
} from "@/lib/install-planning";

type Photo = { fileName?: string; thumbnail?: string };
type Direction = "north" | "east" | "south" | "west";
type SaveState = "saved" | "saving" | "error";
type OtherChoiceConfig = { name: string; label: string; options: string[]; placeholder: string };

type Job = {
  _id: string;
  jobNumber: number;
  ebaForm?: Record<string, unknown> & {
    complete?: boolean;
    clientApproved?: boolean;
    signature_assessor?: { fileName?: string; thumbnail?: string } | string | null;
    signature_conformityToCodeMarkCert?: Photo | string | null;
    photos_elevation_north?: Photo[];
    photos_elevation_east?: Photo[];
    photos_elevation_south?: Photo[];
    photos_elevation_west?: Photo[];
    photos_foundation?: Photo[];
    photos_maintenance?: Photo[];
    skip_photos_elevation_north?: boolean;
    skip_photos_elevation_east?: boolean;
    skip_photos_elevation_south?: boolean;
    skip_photos_elevation_west?: boolean;
  };
  client?: {
    _id?: string;
    billingSameAsPhysical?: boolean;
    contactDetails?: {
      _id?: string;
      name?: string;
      streetAddress?: string;
      suburb?: string;
      city?: string;
      postCode?: string;
      lotDPNumber?: string;
    };
  };
  lead?: { allocatedTo?: { firstname?: string; lastname?: string } };
};

const EBA_JOB_QUERY = `
  query EBAJob($_id: ObjectId!) {
    job(_id: $_id) {
      _id
      jobNumber
      client {
        _id
        billingSameAsPhysical
        contactDetails {
          _id
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
        nameOfOwners
        proofOfOwnership
        bcaOrTa
        lotOrDPNumber
        date
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
        c22_externalMoisture
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
        masonryCladding_underfloorSpaceExcessivelyDamp_priorToInstallationWorkRequired
        masonryCladding_underfloorSpaceExcessivelyDamp_priorToCertificationWorkRequired
        c22_externalMoisture_priorToInstallationWorkRequired
        c22_externalMoisture_priorToCertificationWorkRequired
        skip_photos_elevation_north
        skip_photos_elevation_east
        skip_photos_elevation_south
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
        c22_externalMoisture
        c22_externalMoisture_priorToInstallationWorkRequired
        c22_externalMoisture_priorToCertificationWorkRequired
        masonryCladding_underfloorSpaceExcessivelyDamp_priorToInstallationWorkRequired
        masonryCladding_underfloorSpaceExcessivelyDamp_priorToCertificationWorkRequired
        signature_assessor { fileName thumbnail }
        signature_conformityToCodeMarkCert { fileName thumbnail }
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

const UPDATE_EBA_SIGNATURE_MUTATION = `
  mutation UpdateEbaSignature($input: UpdateJobInput!) {
    updateJob(input: $input) {
      _id
      ebaForm {
        signature_assessor { fileName thumbnail }
      }
    }
  }
`;

const UPDATE_CLIENT_LOT_DP_MUTATION = `
  mutation UpdateClientLotDP($_id: ObjectId!, $input: UpdateClientInput!) {
    updateClient(_id: $_id, input: $input) {
      _id
      contactDetails { _id lotDPNumber }
    }
  }
`;

const directions: Direction[] = ["north", "east", "south", "west"];

const bcaOrTaOptions = [
  "Kapiti Coast District Council",
  "Masterton District Council",
  "South Wairarapa District Council",
  "Carterton District Council",
  "Wellington City Council",
  "Lower Hutt Council",
  "Upper Hutt City Council",
  "Porirua City Council",
];

const sectionOrder = ["admin", "building", "roof", "envelope", "install", "compliance", "water", "moisture", "photos", "installPlanning", "sign"] as const;
type SectionId = (typeof sectionOrder)[number];

const sectionMeta: Record<SectionId, { title: string; short: string }> = {
  admin: { title: "Admin", short: "Owner and council details" },
  building: { title: "Building details", short: "Age, site and construction" },
  roof: { title: "Roof and envelope", short: "Roof, floor and cladding" },
  envelope: { title: "Interior envelope", short: "Framing, joinery and lining" },
  install: { title: "Install method", short: "Cladding and finish" },
  compliance: { title: "Code checks", short: "Structure, fire, wiring, energy" },
  water: { title: "Signs of water ingress", short: "Soffits, damp lining and underfloor" },
  moisture: { title: "Moisture checks", short: "External water and dampness" },
  photos: { title: "Photos", short: "Elevation photo cards" },
  installPlanning: { title: "Install planning", short: "Useful details for the install team" },
  sign: { title: "Sign", short: "Assessor declaration" },
};

const roofTypeOptions = ["Hip Gable", "Double Gable", "Skillion / Mono pitch"];
const roofCladdingOptions = ["Corrugated Steel", "Tile", "Membrane"];
const joineryOptions = ["Timber", "Aluminium/steel", "uPVC", "Appears to be installed correctly"];
const roofOtherConfigs: OtherChoiceConfig[] = [
  { name: "roofAndEavesCol1", label: "Roof type", options: roofTypeOptions, placeholder: "Other roof type" },
  { name: "roofAndEavesCol2", label: "Roof cladding", options: roofCladdingOptions, placeholder: "Other roof cladding" },
];

const requiredLabels: Record<string, string> = {
  nameOfOwners: "Owner name",
  proofOfOwnership: "Proof of ownership",
  bcaOrTa: "BCA/TA",
  lotOrDPNumber: "Lot / DP number",
  date: "Assessment date",
  approximateYearOfConstruction: "Approx year",
  numberOfStories: "Stories",
  propertySiteSection: "Site section",
  propertySiteExposure: "Site exposure",
  propertySiteArea: "Site area",
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
  claddingTypeInstalledVia: "Installed via",
  finishOfCladding: "Finish of cladding",
  b131_structure: "Structure",
  b131_structure_priorToInstallationWorkRequired: "Structure work required",
  b131_structure_priorToCertificationWorkRequired: "Structure certification work",
  c22_preventionOfFireOccuring: "Fire check",
  c22_preventionOfFireOccuring_priorToInstallationWorkRequired: "Fire work required",
  c22_preventionOfFireOccuring_priorToCertificationWorkRequired: "Fire certification work",
  g931_electricity: "TPS wiring",
  g931_electricity_priorToInstallationWorkRequired: "Electrical work required",
  g931_electricity_priorToCertificationWorkRequired: "Electrical certification work",
  h131_energyEfficiency: "Energy efficiency",
  c22_externalMoisture_paintFinishOfExteriorCladdingAppearsToBeInAnWellMaintainedCondition: "Paint finish",
  c22_externalMoisture_exteriorCladdingAppearsToHaveDeteriorationToALevelThatMayAllowWaterIngress: "Cladding deterioration",
  c22_externalMoisture_joineryAppearsToBeInGoodConditionAndNotAllowingWaterIngress: "Joinery condition",
  c22_externalMoisture_flashingsArePresentAndAppearToBeInstalledCorrectly: "Flashings",
  c22_externalMoisture_allExistingPenetrationsAreSealed: "Penetrations sealed",
  c22_externalMoisture_joinBetweenDifferentCladdingTypesSealed: "Cladding joins",
  c22_externalMoisture_guttersAndDownPipesArePresentAndAppearToBeFunctioningCorrectly: "Gutters/downpipes",
  c22_externalMoisture_isWaterAbleToPoolAgainstExteriorWall: "Water pooling",
  c22_externalMoisture_wallsAreFreeToAir: "Walls free to air",
  masonryCladding_masonryCladUnderfloorVentsArePresentAndClear: "Masonry vents",
  masonryCladding_windowOrMasonryVerticalJointsAreSealed: "Masonry joints",
  masonryCladding_soffitsAppearToBeSoundWithNoWaterStainingOrBubblingPaintWhichMayIndicateGuttersOrRoofLeakingIntoSurfeitsAndPossiblyWalls: "Soffits condition",
  masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater: "Damp areas",
  masonryCladding_underfloorSpaceExcessivelyDamp: "Underfloor dampness",
  masonryCladding_underfloorSpaceExcessivelyDamp_priorToInstallationWorkRequired: "Water ingress work required",
  masonryCladding_underfloorSpaceExcessivelyDamp_priorToCertificationWorkRequired: "Water ingress certification work",
  c22_externalMoisture_priorToInstallationWorkRequired: "Moisture work required",
  c22_externalMoisture_priorToCertificationWorkRequired: "Moisture certification work",
  extensionHosesDistance: "Extension hose distance",
  extensionLaddersLocation: "Extension ladder location",
  externalPaintingSupply: "External painting paint supply",
  assessorName: "Assessor name",
};

const finaliseRequiredKeys = Object.keys(requiredLabels).filter(
  (key) => !key.endsWith("_priorToInstallationWorkRequired")
    && !key.endsWith("_priorToCertificationWorkRequired")
    && key !== "finishOfCladding"
    && !["extensionHosesDistance", "extensionLaddersLocation", "externalPaintingSupply"].includes(key),
);

const externalMoistureQuestions = [
  ["c22_externalMoisture_paintFinishOfExteriorCladdingAppearsToBeInAnWellMaintainedCondition", "Paint finish well maintained?", false],
  ["c22_externalMoisture_exteriorCladdingAppearsToHaveDeteriorationToALevelThatMayAllowWaterIngress", "Cladding deterioration may allow water ingress?", true],
  ["c22_externalMoisture_joineryAppearsToBeInGoodConditionAndNotAllowingWaterIngress", "Joinery in good condition?", false],
  ["c22_externalMoisture_flashingsArePresentAndAppearToBeInstalledCorrectly", "Flashings present and correct?", false],
  ["c22_externalMoisture_allExistingPenetrationsAreSealed", "Existing penetrations sealed?", false],
  ["c22_externalMoisture_joinBetweenDifferentCladdingTypesSealed", "Different cladding joins sealed?", false],
  ["c22_externalMoisture_guttersAndDownPipesArePresentAndAppearToBeFunctioningCorrectly", "Gutters/downpipes functioning?", false],
  ["c22_externalMoisture_isWaterAbleToPoolAgainstExteriorWall", "Water able to pool against wall?", true],
  ["c22_externalMoisture_wallsAreFreeToAir", "Walls free to air?", false],
] as const;

const waterIngressQuestions = [
  ["masonryCladding_soffitsAppearToBeSoundWithNoWaterStainingOrBubblingPaintWhichMayIndicateGuttersOrRoofLeakingIntoSurfeitsAndPossiblyWalls", "Soffits sound with no water staining/bubbling?", false],
  ["masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater", "Damp, soft, discoloured, mouldy or rotten areas?", true],
  ["masonryCladding_underfloorSpaceExcessivelyDamp", "Underfloor space excessively damp?", true],
] as const;

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some((item) => hasValue(item));
  return true;
}

function listValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter((item) => item.trim());
  if (typeof value === "string") {
    const sep = value.includes(" | ") ? " | " : ",";
    return value.split(sep).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function toggleListValue(value: unknown, item: string, options: string[]) {
  const current = listValue(value).filter((entry) => options.includes(entry));
  const next = current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item];
  return next;
}

function parseLegacyCheckboxList(value: unknown, knownOptions: string[]): string[] {
  const values = listValue(value);
  const direct = values.filter((entry) => knownOptions.includes(entry));
  if (direct.length) return direct;

  const otherSummary = values.find((entry) => entry.toLowerCase().startsWith("other:"));
  if (!otherSummary) return [];

  return otherSummary
    .slice(otherSummary.indexOf(":") + 1)
    .split("|")
    .map((entry) => entry.trim())
    .filter((entry) => knownOptions.includes(entry));
}

function getLegacyCustomOther(value: unknown, knownOptions: string[]): string {
  const values = listValue(value);
  const explicitTail = values[values.length - 1];
  if (typeof explicitTail === "string" && explicitTail.length > 0 && !knownOptions.includes(explicitTail.trim()) && !explicitTail.toLowerCase().startsWith("other:")) {
    return explicitTail;
  }

  const otherSummary = values.find((entry) => entry.toLowerCase().startsWith("other:"));
  if (!otherSummary) return "";

  return otherSummary
    .slice(otherSummary.indexOf(":") + 1)
    .split("|")
    .map((entry) => entry.trim())
    .filter((entry) => entry && !knownOptions.includes(entry))
    .join(" ");
}

function buildLegacyCheckboxArray(selectedKnown: string[], customOther: string, knownOptions: string[]): string[] {
  const filteredSelected = selectedKnown.filter((entry) => knownOptions.includes(entry));
  const rawCustom = customOther ?? "";
  const summaryCustom = rawCustom.trim();
  const output: string[] = [];
  if (summaryCustom) output.push(`Other: ${[summaryCustom, ...filteredSelected].join(" | ")}`);
  output.push(...knownOptions.filter((option) => filteredSelected.includes(option)));
  output.push(rawCustom);
  return output;
}

function toggleLegacyCheckboxList(value: unknown, item: string, knownOptions: string[]): string[] {
  const selected = parseLegacyCheckboxList(value, knownOptions);
  const next = selected.includes(item) ? selected.filter((entry) => entry !== item) : [...selected, item];
  return buildLegacyCheckboxArray(next, getLegacyCustomOther(value, knownOptions), knownOptions);
}

function setLegacyCheckboxListOther(value: unknown, customOther: string, knownOptions: string[]): string[] {
  return buildLegacyCheckboxArray(parseLegacyCheckboxList(value, knownOptions), customOther, knownOptions);
}

function toDatetimeLocal(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(value?: string) {
  return value ? new Date(value).toISOString() : undefined;
}

function signatureFileName(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "fileName" in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>).fileName || "");
  }
  return "";
}

function toYesNoNa(value: unknown): "YES" | "NO" | "NA" | null {
  if (value === true || value === "YES") return "YES";
  if (value === false || value === "NO") return "NO";
  if (value === "NOT_APPLICABLE" || value === "NA") return "NA";
  return null;
}

function fromYesNoNa(value: unknown): true | false | "NOT_APPLICABLE" | undefined {
  if (value === true || value === "YES") return true;
  if (value === false || value === "NO") return false;
  if (value === "NOT_APPLICABLE" || value === "NA") return "NOT_APPLICABLE";
  return undefined;
}

function setDefaultIfBlank(form: Record<string, unknown>, key: string, value: true | false | "NOT_APPLICABLE") {
  if (!hasValue(form[key])) form[key] = value;
}

function sectionForKey(key: string): SectionId {
  if (["nameOfOwners", "proofOfOwnership", "bcaOrTa", "lotOrDPNumber", "date"].includes(key)) return "admin";
  if (["approximateYearOfConstruction", "numberOfStories", "propertySiteSection", "propertySiteExposure", "propertySiteArea"].includes(key)) return "building";
  if (["roofAndEavesCol1", "roofAndEavesCol1Other", "roofAndEavesCol2", "roofAndEavesCol2Other", "roofAndEavesCol3", "foundationAndFloor", "exteriorCladding"].includes(key)) return "roof";
  if (["framing", "joinery", "lining", "buildingPaper"].includes(key)) return "envelope";
  if (["claddingType", "claddingTypeInstalledVia", "finishOfCladding"].includes(key)) return "install";
  if (key.startsWith("masonryCladding") || key === "c22_externalMoisture_priorToInstallationWorkRequired" || key === "c22_externalMoisture_priorToCertificationWorkRequired") return "water";
  if (key.startsWith("c22_externalMoisture")) return "moisture";
  if (key.includes("photo")) return "photos";
  if (["extensionHosesDistance", "extensionLaddersLocation", "externalPaintingSupply"].includes(key)) return "installPlanning";
  if (key.includes("signature") || key === "assessorName") return "sign";
  return "compliance";
}

export default function EbaPreviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id || "";

  const [activeSection, setActiveSection] = useState<SectionId>("admin");
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [missingOpen, setMissingOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [installPlanningDetails, setInstallPlanningDetails] = useState<InstallPlanningDetails>(() => getDefaultInstallPlanningDetails());
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [elevationSkip, setElevationSkip] = useState<Record<Direction, boolean>>({ north: false, east: false, south: false, west: false });
  const [finaliseAttempted, setFinaliseAttempted] = useState(false);
  const [signing, setSigning] = useState(false);
  const [optionalPhotosOpen, setOptionalPhotosOpen] = useState(false);
  const initialSectionSetRef = useRef(false);
  const fileInputRef = useRef<Record<string, HTMLInputElement | null>>({});
  const cameraInputRef = useRef<Record<string, HTMLInputElement | null>>({});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const autosaveTimerRef = useRef<number | null>(null);
  const editVersionRef = useRef(0);

  const locked = !!job?.ebaForm?.clientApproved;

  const address = useMemo(() => {
    const c = job?.client?.contactDetails;
    return [c?.streetAddress, c?.suburb, c?.city, c?.postCode].filter(Boolean).join(", ");
  }, [job]);

  const shortAddress = useMemo(() => {
    const c = job?.client?.contactDetails;
    return [c?.streetAddress, c?.suburb].filter(Boolean).join(", ") || "No address";
  }, [job]);

  const getToken = () => (typeof window !== "undefined" ? localStorage.getItem("token") || "" : "");
  const fileUrl = useCallback((fileName: string) => `https://api.insulhub.nz/files/documents/${encodeURIComponent(fileName)}?token=${getToken()}`, []);

  const setField = (name: string, value: unknown) => {
    editVersionRef.current += 1;
    setDirty(true);
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const setInstallPlanningField = <K extends keyof InstallPlanningDetails>(name: K, value: InstallPlanningDetails[K]) => {
    editVersionRef.current += 1;
    setDirty(true);
    setInstallPlanningDetails((prev) => {
      const next = { ...prev, [name]: value };
      if (name === "extensionHosesRequired" && value === false) next.extensionHosesDistance = "";
      if (name === "extensionLaddersRequired" && value === false) next.extensionLaddersLocation = "";
      if (name === "externalPaintingRequired" && value === false) next.externalPaintingSupply = "";
      return next;
    });
  };

  const sectionToEbaField = (section: string) => {
    if (section === "foundation") return "photos_foundation";
    if (section === "maintenance") return "photos_maintenance";
    if (section.startsWith("elevation_")) return `photos_elevation_${section.replace("elevation_", "")}`;
    return "";
  };

  const toPhotoObjects = (fileNames: string[]) => fileNames.map((fileName) => ({ fileName, thumbnail: fileName }));

  const ebaPayload = useMemo(() => ({
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
    c22_externalMoisture: null,
    c22_externalMoisture_paintFinishOfExteriorCladdingAppearsToBeInAnWellMaintainedCondition: form.c22_externalMoisture_paintFinishOfExteriorCladdingAppearsToBeInAnWellMaintainedCondition,
    c22_externalMoisture_exteriorCladdingAppearsToHaveDeteriorationToALevelThatMayAllowWaterIngress: form.c22_externalMoisture_exteriorCladdingAppearsToHaveDeteriorationToALevelThatMayAllowWaterIngress,
    c22_externalMoisture_joineryAppearsToBeInGoodConditionAndNotAllowingWaterIngress: form.c22_externalMoisture_joineryAppearsToBeInGoodConditionAndNotAllowingWaterIngress,
    c22_externalMoisture_flashingsArePresentAndAppearToBeInstalledCorrectly: form.c22_externalMoisture_flashingsArePresentAndAppearToBeInstalledCorrectly,
    c22_externalMoisture_allExistingPenetrationsAreSealed: form.c22_externalMoisture_allExistingPenetrationsAreSealed,
    c22_externalMoisture_joinBetweenDifferentCladdingTypesSealed: form.c22_externalMoisture_joinBetweenDifferentCladdingTypesSealed,
    c22_externalMoisture_guttersAndDownPipesArePresentAndAppearToBeFunctioningCorrectly: form.c22_externalMoisture_guttersAndDownPipesArePresentAndAppearToBeFunctioningCorrectly,
    c22_externalMoisture_isWaterAbleToPoolAgainstExteriorWall: form.c22_externalMoisture_isWaterAbleToPoolAgainstExteriorWall,
    c22_externalMoisture_wallsAreFreeToAir: form.c22_externalMoisture_wallsAreFreeToAir,
    masonryCladding_masonryCladUnderfloorVentsArePresentAndClear: toYesNoNa(form.masonryCladding_masonryCladUnderfloorVentsArePresentAndClear),
    masonryCladding_windowOrMasonryVerticalJointsAreSealed: toYesNoNa(form.masonryCladding_windowOrMasonryVerticalJointsAreSealed),
    masonryCladding_soffitsAppearToBeSoundWithNoWaterStainingOrBubblingPaintWhichMayIndicateGuttersOrRoofLeakingIntoSurfeitsAndPossiblyWalls: form.masonryCladding_soffitsAppearToBeSoundWithNoWaterStainingOrBubblingPaintWhichMayIndicateGuttersOrRoofLeakingIntoSurfeitsAndPossiblyWalls,
    masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater: form.masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater,
    masonryCladding_underfloorSpaceExcessivelyDamp: toYesNoNa(form.masonryCladding_underfloorSpaceExcessivelyDamp),
    masonryCladding_underfloorSpaceExcessivelyDamp_priorToInstallationWorkRequired: form.masonryCladding_underfloorSpaceExcessivelyDamp_priorToInstallationWorkRequired,
    masonryCladding_underfloorSpaceExcessivelyDamp_priorToCertificationWorkRequired: form.masonryCladding_underfloorSpaceExcessivelyDamp_priorToCertificationWorkRequired,
    c22_externalMoisture_priorToInstallationWorkRequired: form.c22_externalMoisture_priorToInstallationWorkRequired,
    c22_externalMoisture_priorToCertificationWorkRequired: form.c22_externalMoisture_priorToCertificationWorkRequired,
    skip_photos_elevation_north: elevationSkip.north,
    skip_photos_elevation_east: elevationSkip.east,
    skip_photos_elevation_south: elevationSkip.south,
    skip_photos_elevation_west: elevationSkip.west,
    assessorName: form.assessorName,
    signature_assessor: job?.ebaForm?.signature_assessor,
  }), [form, elevationSkip, job?.ebaForm?.signature_assessor]);

  const checks = useMemo(() => {
    const missingKeys = finaliseRequiredKeys.filter((key) => !hasValue(form[key]));
    if (!listValue(form.finishOfCladding).length) missingKeys.push("finishOfCladding");
    roofOtherConfigs.forEach((config) => {
      const hasOtherSelected = listValue(form[config.name]).includes("Other") || !!getLegacyCustomOther(form[config.name], config.options).trim();
      if (hasOtherSelected && !getLegacyCustomOther(form[config.name], config.options).trim()) missingKeys.push(`${config.name}Other`);
    });

    if (form.b131_structure === false) {
      if (!hasValue(form.b131_structure_priorToInstallationWorkRequired)) missingKeys.push("b131_structure_priorToInstallationWorkRequired");
      if (!hasValue(form.b131_structure_priorToCertificationWorkRequired)) missingKeys.push("b131_structure_priorToCertificationWorkRequired");
    }
    if (form.c22_preventionOfFireOccuring === true) {
      if (!hasValue(form.c22_preventionOfFireOccuring_priorToInstallationWorkRequired)) missingKeys.push("c22_preventionOfFireOccuring_priorToInstallationWorkRequired");
      if (!hasValue(form.c22_preventionOfFireOccuring_priorToCertificationWorkRequired)) missingKeys.push("c22_preventionOfFireOccuring_priorToCertificationWorkRequired");
    }
    if (form.g931_electricity === false) {
      if (!hasValue(form.g931_electricity_priorToInstallationWorkRequired)) missingKeys.push("g931_electricity_priorToInstallationWorkRequired");
      if (!hasValue(form.g931_electricity_priorToCertificationWorkRequired)) missingKeys.push("g931_electricity_priorToCertificationWorkRequired");
    }

    const redWhenYes = new Set([
      "c22_externalMoisture_exteriorCladdingAppearsToHaveDeteriorationToALevelThatMayAllowWaterIngress",
      "c22_externalMoisture_isWaterAbleToPoolAgainstExteriorWall",
      "masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater",
      "masonryCladding_underfloorSpaceExcessivelyDamp",
    ]);
    const moistureWorkNeeded = [
      ...externalMoistureQuestions.map(([key]) => key),
      "masonryCladding_masonryCladUnderfloorVentsArePresentAndClear",
      "masonryCladding_windowOrMasonryVerticalJointsAreSealed",
    ].some((key) => redWhenYes.has(key) ? form[key] === true : form[key] === false);
    const waterIngressWorkNeeded = waterIngressQuestions
      .some(([key]) => redWhenYes.has(key) ? form[key] === true : form[key] === false);
    if (moistureWorkNeeded) {
      if (!hasValue(form.c22_externalMoisture_priorToInstallationWorkRequired)) missingKeys.push("c22_externalMoisture_priorToInstallationWorkRequired");
      if (!hasValue(form.c22_externalMoisture_priorToCertificationWorkRequired)) missingKeys.push("c22_externalMoisture_priorToCertificationWorkRequired");
    }
    if (waterIngressWorkNeeded) {
      if (!hasValue(form.masonryCladding_underfloorSpaceExcessivelyDamp_priorToInstallationWorkRequired)) missingKeys.push("masonryCladding_underfloorSpaceExcessivelyDamp_priorToInstallationWorkRequired");
      if (!hasValue(form.masonryCladding_underfloorSpaceExcessivelyDamp_priorToCertificationWorkRequired)) missingKeys.push("masonryCladding_underfloorSpaceExcessivelyDamp_priorToCertificationWorkRequired");
    }
    if (installPlanningDetails.extensionHosesRequired && !installPlanningDetails.extensionHosesDistance.trim()) {
      missingKeys.push("extensionHosesDistance");
    }
    if (installPlanningDetails.extensionLaddersRequired && !installPlanningDetails.extensionLaddersLocation) {
      missingKeys.push("extensionLaddersLocation");
    }
    if (installPlanningDetails.externalPaintingRequired && !installPlanningDetails.externalPaintingSupply) {
      missingKeys.push("externalPaintingSupply");
    }

    const missingPhotos = directions
      .filter((dir) => !elevationSkip[dir])
      .map((dir) => `elevation_${dir}`)
      .filter((section) => (photos[section] || []).length === 0);
    const missingSignature = !signatureFileName(job?.ebaForm?.signature_assessor);
    const missingItems = [
      ...missingKeys.map((key) => ({ label: requiredLabels[key] || (key === "roofAndEavesCol1Other" ? "Other roof type" : key === "roofAndEavesCol2Other" ? "Other roof cladding" : key), section: sectionForKey(key), key })),
      ...missingPhotos.map((section) => ({ label: `${section.replace("elevation_", "")} elevation photo`, section: "photos" as SectionId, key: section })),
      ...(missingSignature ? [{ label: "Assessor signature", section: "sign" as SectionId, key: "signature_assessor" }] : []),
    ];

    const missingBySection = sectionOrder.reduce((acc, section) => {
      acc[section] = missingItems.filter((item) => item.section === section);
      return acc;
    }, {} as Record<SectionId, typeof missingItems>);

    return { missingKeys, missingItems, missingBySection, missingPhotos, moistureWorkNeeded, waterIngressWorkNeeded, canFinalise: missingItems.length === 0 };
  }, [form, photos, elevationSkip, installPlanningDetails, job?.ebaForm?.signature_assessor]);

  const progress = Math.max(0, Math.round(((Object.keys(requiredLabels).length + 5 - checks.missingItems.length) / (Object.keys(requiredLabels).length + 5)) * 100));

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const data = await gql<{ job: Job }>(EBA_JOB_QUERY, { _id: id });
      const params = new URLSearchParams({ jobIds: id });
      const planningRes = await fetch(`/api/install-planning?${params.toString()}`, {
        headers: { "x-access-token": getToken() },
      });
      const planningJson = await planningRes.json().catch(() => ({}));
      if (!planningRes.ok) throw new Error(planningJson?.error || "Failed to load install planning");
      const eba = data.job.ebaForm || {};
      let me: { firstname?: string; lastname?: string } = {};
      if (typeof window !== "undefined") {
        try {
          me = JSON.parse(localStorage.getItem("me") || "{}");
        } catch {
          me = {};
        }
      }
      const userName = [me.firstname, me.lastname].filter(Boolean).join(" ");
      const salespersonName = [data.job.lead?.allocatedTo?.firstname, data.job.lead?.allocatedTo?.lastname].filter(Boolean).join(" ");
      const nextForm: Record<string, unknown> = {
        ...eba,
        nameOfOwners: (eba.nameOfOwners as string) || data.job.client?.contactDetails?.name || "",
        proofOfOwnership: (eba.proofOfOwnership as string) || "Certificate of Title",
        lotOrDPNumber: (eba.lotOrDPNumber as string) || data.job.client?.contactDetails?.lotDPNumber || "",
        assessorName: (eba.assessorName as string) || userName || salespersonName || "",
        joinery: hasValue(eba.joinery) ? eba.joinery : ["Appears to be installed correctly"],
        date: toDatetimeLocal(eba.date as string | undefined),
      };
      [
        "b131_structure",
        "c22_preventionOfFireOccuring",
        "g931_electricity",
        "h131_energyEfficiency",
        ...externalMoistureQuestions.map(([key]) => key),
        "masonryCladding_masonryCladUnderfloorVentsArePresentAndClear",
        "masonryCladding_windowOrMasonryVerticalJointsAreSealed",
        "masonryCladding_soffitsAppearToBeSoundWithNoWaterStainingOrBubblingPaintWhichMayIndicateGuttersOrRoofLeakingIntoSurfeitsAndPossiblyWalls",
        "masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater",
        "masonryCladding_underfloorSpaceExcessivelyDamp",
      ].forEach((key) => {
        const normalized = fromYesNoNa(nextForm[key]);
        if (normalized !== undefined) nextForm[key] = normalized;
      });
      setDefaultIfBlank(nextForm, "b131_structure", true);
      setDefaultIfBlank(nextForm, "c22_preventionOfFireOccuring", false);
      setDefaultIfBlank(nextForm, "g931_electricity", true);
      setDefaultIfBlank(nextForm, "h131_energyEfficiency", true);
      externalMoistureQuestions.forEach(([key, , riskOnYes]) => {
        setDefaultIfBlank(nextForm, key, riskOnYes ? false : true);
      });
      setDefaultIfBlank(nextForm, "masonryCladding_masonryCladUnderfloorVentsArePresentAndClear", "NOT_APPLICABLE");
      setDefaultIfBlank(nextForm, "masonryCladding_windowOrMasonryVerticalJointsAreSealed", "NOT_APPLICABLE");
      setDefaultIfBlank(nextForm, "masonryCladding_soffitsAppearToBeSoundWithNoWaterStainingOrBubblingPaintWhichMayIndicateGuttersOrRoofLeakingIntoSurfeitsAndPossiblyWalls", true);
      setDefaultIfBlank(nextForm, "masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater", false);
      setDefaultIfBlank(nextForm, "masonryCladding_underfloorSpaceExcessivelyDamp", false);

      const nextPhotos = {
        elevation_north: (eba.photos_elevation_north || []).map((p) => p.fileName || "").filter(Boolean),
        elevation_east: (eba.photos_elevation_east || []).map((p) => p.fileName || "").filter(Boolean),
        elevation_south: (eba.photos_elevation_south || []).map((p) => p.fileName || "").filter(Boolean),
        elevation_west: (eba.photos_elevation_west || []).map((p) => p.fileName || "").filter(Boolean),
        foundation: (eba.photos_foundation || []).map((p) => p.fileName || "").filter(Boolean),
        maintenance: (eba.photos_maintenance || []).map((p) => p.fileName || "").filter(Boolean),
      };

      setJob(data.job);
      setForm(nextForm);
      setInstallPlanningDetails(normalizeInstallPlanningDetails(planningJson?.planning?.[0]));
      setPhotos(nextPhotos);
      setElevationSkip({
        north: !!eba.skip_photos_elevation_north,
        east: !!eba.skip_photos_elevation_east,
        south: !!eba.skip_photos_elevation_south,
        west: !!eba.skip_photos_elevation_west,
      });
      setDirty(false);
      editVersionRef.current = 0;
      setSaveState("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load EBA");
    } finally {
      setLoading(false);
    }
  }, [id]);

  async function saveInstallPlanningDetails(detailsToSave = installPlanningDetails) {
    if (!job) return;
    const res = await fetch("/api/install-planning", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-access-token": getToken(),
      },
      body: JSON.stringify({
        jobId: job._id,
        ...normalizeInstallPlanningDetails(detailsToSave),
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Failed to save install planning");
  }

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (loading || initialSectionSetRef.current || checks.missingItems.length === 0) return;
    initialSectionSetRef.current = true;
    setActiveSection(checks.missingItems[0].section);
  }, [loading, checks.missingItems]);

  async function saveDraft(quiet = false) {
    if (!job || locked) return false;
    const saveVersion = editVersionRef.current;
    const installPlanningToSave = normalizeInstallPlanningDetails(installPlanningDetails);
    setSaving(true);
    setSaveState("saving");
    if (!quiet) setNotice("");
    setError("");
    try {
      const lotOrDPNumber = ((form.lotOrDPNumber as string) || "").trim();
      const clientId = job.client?._id;
      const contactDetails = job.client?.contactDetails;
      if (clientId && lotOrDPNumber !== ((contactDetails?.lotDPNumber || "") as string).trim()) {
        await gql(UPDATE_CLIENT_LOT_DP_MUTATION, {
          _id: clientId,
          input: {
            _id: clientId,
            billingSameAsPhysical: job.client?.billingSameAsPhysical ?? true,
            contactDetails: {
              ...(contactDetails || {}),
              lotDPNumber: lotOrDPNumber,
            },
          },
        });
      }
      const res = await gql<{ saveEBA: Job }>(SAVE_EBA_MUTATION, { input: { _id: job._id, ebaForm: ebaPayload }, isDraft: true });
      await saveInstallPlanningDetails(installPlanningToSave);
      setJob((prev) => prev ? {
        ...prev,
        client: prev.client ? {
          ...prev.client,
          contactDetails: prev.client.contactDetails ? {
            ...prev.client.contactDetails,
            lotDPNumber: lotOrDPNumber || prev.client.contactDetails.lotDPNumber,
          } : prev.client.contactDetails,
        } : prev.client,
        ebaForm: { ...(prev.ebaForm || {}), ...(res.saveEBA.ebaForm || {}), ...ebaPayload },
      } : prev);
      if (editVersionRef.current === saveVersion) {
        setDirty(false);
        setSaveState("saved");
        if (!quiet) setNotice("Draft saved.");
      } else {
        setSaveState("saving");
      }
      return true;
    } catch (err) {
      setSaveState("error");
      setError(err instanceof Error ? err.message : "Failed to autosave EBA");
      return false;
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!dirty || loading || locked || !job) return;
    setSaveState("saving");
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      void saveDraft(true);
    }, 1000);
    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    };
  }, [dirty, form, elevationSkip, installPlanningDetails, loading, locked, job]);

  async function finalise() {
    setFinaliseAttempted(true);
    if (!checks.canFinalise) {
      setMissingOpen(true);
      return;
    }
    if (!job || locked) return;
    setSaving(true);
    setSaveState("saving");
    setError("");
    try {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      if (dirty) {
        const draftSaved = await saveDraft(true);
        if (!draftSaved) return;
      }
      await saveInstallPlanningDetails();
      await gql<{ saveEBA: Job }>(SAVE_EBA_MUTATION, { input: { _id: job._id, ebaForm: ebaPayload }, isDraft: false });
      setSaveState("saved");
      router.replace(`/jobs/${id}`);
    } catch (err) {
      setSaveState("error");
      setError(err instanceof Error ? err.message : "Failed to finalise EBA");
    } finally {
      setSaving(false);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return [] as string[];
    const data = new FormData();
    Array.from(files).forEach((file) => data.append("files", file));
    const res = await fetch("https://api.insulhub.nz/files/upload", {
      method: "POST",
      headers: { "x-token": getToken() },
      body: data,
    });
    const json = await res.json();
    return (json.fileNames || []) as string[];
  }

  async function uploadEbaPhotos(section: string, files: FileList | null) {
    if (!job || locked || !files?.length) return;
    setUploading((prev) => ({ ...prev, [section]: true }));
    try {
      const names = await uploadFiles(files);
      const field = sectionToEbaField(section);
      if (!field || !names.length) return;
      const merged = [...(photos[section] || []), ...names];
      await gql(SAVE_EBA_MUTATION, { input: { _id: job._id, ebaForm: { [field]: toPhotoObjects(merged) } }, isDraft: true });
      setPhotos((prev) => ({ ...prev, [section]: merged }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setUploading((prev) => ({ ...prev, [section]: false }));
    }
  }

  async function removeEbaPhoto(section: string, fileName: string) {
    if (!job || locked) return;
    const field = sectionToEbaField(section);
    if (!field) return;
    const next = (photos[section] || []).filter((name) => name !== fileName);
    await gql(SAVE_EBA_MUTATION, { input: { _id: job._id, ebaForm: { [field]: toPhotoObjects(next) } }, isDraft: true });
    setPhotos((prev) => ({ ...prev, [section]: next }));
  }

  function handlePhotoInput(section: string, event: ChangeEvent<HTMLInputElement>) {
    void uploadEbaPhotos(section, event.target.files);
    event.target.value = "";
  }

  function drawStart(clientX: number, clientY: number) {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const rect = c.getBoundingClientRect();
    drawingRef.current = true;
    ctx.beginPath();
    ctx.moveTo((clientX - rect.left) * (c.width / rect.width), (clientY - rect.top) * (c.height / rect.height));
  }

  function drawMove(clientX: number, clientY: number) {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || !drawingRef.current) return;
    const rect = c.getBoundingClientRect();
    ctx.lineTo((clientX - rect.left) * (c.width / rect.width), (clientY - rect.top) * (c.height / rect.height));
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  const drawSavedSignatureToCanvas = useCallback(async (fileName: string) => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || !fileName) return;

    try {
      const res = await fetch(fileUrl(fileName));
      if (!res.ok) return;
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Could not load saved signature"));
        img.src = objectUrl;
      });

      ctx.clearRect(0, 0, c.width, c.height);
      const scale = Math.min(c.width / img.width, c.height / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Best effort only. A failed preview should not block re-signing.
    }
  }, [fileUrl]);

  useEffect(() => {
    const fileName = signatureFileName(job?.ebaForm?.signature_assessor);
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!fileName) {
      if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
      return;
    }
    void drawSavedSignatureToCanvas(fileName);
  }, [job?.ebaForm?.signature_assessor, activeSection, drawSavedSignatureToCanvas]);

  async function saveSignature() {
    const c = canvasRef.current;
    if (!c || !job || locked) return;
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    setSigning(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not capture signature");
      const file = new File([blob], `eba-signature-${Date.now()}.png`, { type: "image/png" });
      const names = await uploadFiles({ 0: file, length: 1, item: (i: number) => (i === 0 ? file : null) } as unknown as FileList);
      const fileName = names[0];
      if (!fileName) throw new Error("Signature upload failed");
      const signature = { fileName, thumbnail: `thumb${fileName}` };
      await gql(UPDATE_EBA_SIGNATURE_MUTATION, { input: { _id: job._id, ebaForm: { signature_assessor: signature } } });
      setJob((prev) => prev ? { ...prev, ebaForm: { ...(prev.ebaForm || {}), signature_assessor: signature } } : prev);
      setDirty(false);
      setSaveState("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save signature");
    } finally {
      setSigning(false);
    }
  }

  const currentIndex = sectionOrder.indexOf(activeSection);
  const nextSection = sectionOrder[Math.min(sectionOrder.length - 1, currentIndex + 1)];
  const isLastSection = activeSection === sectionOrder[sectionOrder.length - 1];
  const saveText = saveState === "saving" ? "Saving..." : saveState === "error" ? "Save error" : "Saved";
  const activeMissing = checks.missingBySection[activeSection] || [];
  const activeDone = activeMissing.length === 0;

  const goToSection = (section: SectionId) => {
    setActiveSection(section);
    setSectionsOpen(false);
    setMissingOpen(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goBack = () => {
    if (typeof window === "undefined") {
      router.replace(`/jobs/${id}`);
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.assign(`/jobs/${id}`);
  };

  const inputClass = (key: string) => `mt-1 w-full rounded-md border px-3 py-2.5 text-sm outline-none transition ${
    (finaliseAttempted || checks.missingItems.length > 0) && checks.missingKeys.includes(key)
      ? "border-[#f36c21] bg-orange-50/40"
      : "border-slate-200 bg-white focus:border-[#00485a]"
  }`;

  const renderField = (name: string, label: string, type = "text") => (
    <label className="block">
      <span className="flex items-center justify-between text-xs font-medium text-slate-500">
        {label}
        {checks.missingKeys.includes(name) && <span className="text-[10px] font-semibold text-[#c75516]">Missing</span>}
      </span>
      <input type={type} value={String(form[name] ?? "")} onChange={(e) => setField(name, type === "number" ? (e.target.value ? Number(e.target.value) : undefined) : e.target.value)} className={inputClass(name)} />
    </label>
  );

  const renderTextarea = (name: string, label: string) => (
    <label className="block">
      <span className="flex items-center justify-between text-xs font-medium text-slate-500">
        {label}
        {checks.missingKeys.includes(name) && <span className="text-[10px] font-semibold text-[#c75516]">Missing</span>}
      </span>
      <textarea value={String(form[name] ?? "")} onChange={(e) => setField(name, e.target.value)} rows={3} className={inputClass(name)} />
    </label>
  );

  const renderWorkFields = (prefix: string) => (
    <div className="space-y-3">
      {renderTextarea(`${prefix}_priorToInstallationWorkRequired`, "Prior to Installation Work Required")}
      {renderTextarea(`${prefix}_priorToCertificationWorkRequired`, "Prior to Certification Work Required")}
    </div>
  );

  const renderSelect = (name: string, label: string, options: string[]) => (
    <label className="block">
      <span className="flex items-center justify-between text-xs font-medium text-slate-500">
        {label}
        {checks.missingKeys.includes(name) && <span className="text-[10px] font-semibold text-[#c75516]">Missing</span>}
      </span>
      <select value={String(form[name] ?? "")} onChange={(e) => setField(name, e.target.value)} className={inputClass(name)}>
        <option value="">Select...</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );

  const renderChoiceButtons = (name: string, label: string, options: string[], multi = false) => {
    const selected = multi ? listValue(form[name]) : [String(form[name] || "")];
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          {checks.missingKeys.includes(name) && <span className="text-[10px] font-semibold text-[#c75516]">Missing</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const active = selected.includes(option);
            return (
              <button key={option} type="button" onClick={() => setField(name, multi ? toggleListValue(form[name], option, options) : option)} className={`rounded-md border px-3 py-2 text-sm font-medium transition ${active ? "border-[#00485a] bg-[#e8f2f4] text-[#00485a]" : "border-slate-200 bg-white text-slate-700"}`}>
                {option}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderOtherChoiceButtons = ({ name, label, options, placeholder }: OtherChoiceConfig) => {
    const selectedKnown = parseLegacyCheckboxList(form[name], options);
    const customOther = getLegacyCustomOther(form[name], options);
    const otherSelected = listValue(form[name]).includes("Other") || customOther.length > 0;
    const missingOther = checks.missingKeys.includes(`${name}Other`);

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          {(checks.missingKeys.includes(name) || missingOther) && <span className="text-[10px] font-semibold text-[#c75516]">Missing</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const active = selectedKnown.includes(option);
            return (
              <button key={option} type="button" onClick={() => setField(name, toggleLegacyCheckboxList(form[name], option, options))} className={`rounded-md border px-3 py-2 text-sm font-medium transition ${active ? "border-[#00485a] bg-[#e8f2f4] text-[#00485a]" : "border-slate-200 bg-white text-slate-700"}`}>
                {option}
              </button>
            );
          })}
          <button type="button" onClick={() => setField(name, otherSelected ? buildLegacyCheckboxArray(selectedKnown, "", options) : ["Other", ...selectedKnown, ""])} className={`rounded-md border px-3 py-2 text-sm font-medium transition ${otherSelected ? "border-[#00485a] bg-[#e8f2f4] text-[#00485a]" : "border-slate-200 bg-white text-slate-700"}`}>
            Other
          </button>
        </div>
        {otherSelected && (
          <label className="block">
            <input
              type="text"
              value={customOther}
              onChange={(e) => setField(name, setLegacyCheckboxListOther(form[name], e.target.value, options))}
              placeholder={placeholder}
              className={`mt-1 w-full rounded-md border px-3 py-2.5 text-sm outline-none transition ${missingOther ? "border-[#f36c21] bg-orange-50/40" : "border-slate-200 bg-white focus:border-[#00485a]"}`}
            />
          </label>
        )}
      </div>
    );
  };

  const renderYesNoButtons = (name: string, label: string, riskOnYes = false, na = false) => {
    const options = [
      { label: "Yes", value: true },
      { label: "No", value: false },
      ...(na ? [{ label: "N/A", value: "NOT_APPLICABLE" as const }] : []),
    ];
    return (
      <div className="rounded-md border border-slate-200 bg-white p-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-slate-800">{label}</p>
          {checks.missingKeys.includes(name) && <span className="shrink-0 text-[10px] font-semibold text-[#c75516]">Missing</span>}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {options.map((option) => {
            const active = form[name] === option.value;
            const risk = active && ((riskOnYes && option.value === true) || (!riskOnYes && option.value === false));
            return (
              <button key={option.label} type="button" onClick={() => setField(name, option.value)} className={`rounded-md border px-3 py-2 text-sm font-semibold ${active ? risk ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderSectionFrame = (children: ReactNode) => (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#00485a]">Section {currentIndex + 1} of {sectionOrder.length}</p>
            <h2 className="text-lg font-semibold text-slate-950">{sectionMeta[activeSection].title}</h2>
            <p className="mt-0.5 text-sm text-slate-500">{sectionMeta[activeSection].short}</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${activeMissing.length ? "bg-orange-50 text-[#c75516]" : "bg-emerald-50 text-emerald-700"}`}>{activeMissing.length ? `${activeMissing.length} missing` : "Done"}</span>
        </div>
      </div>
      {children}
    </section>
  );

  const renderDetails = (children: ReactNode) => (
    <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
      <summary className="cursor-pointer font-medium text-slate-700">Details</summary>
      <div className="mt-2 leading-relaxed">{children}</div>
    </details>
  );

  const renderActiveSection = () => {
    switch (activeSection) {
      case "admin":
        return renderSectionFrame(
            <div className="space-y-3">
              <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">{address || "No property address"}</div>
              {renderField("nameOfOwners", "Name of owners")}
              {renderSelect("proofOfOwnership", "Proof of ownership", ["Certificate of Title", "Rates", "Other"])}
              {renderSelect("bcaOrTa", "BCA/TA", bcaOrTaOptions)}
              {renderField("lotOrDPNumber", "Lot / DP number")}
              {renderField("date", "Assessment date", "datetime-local")}
            </div>
          );
      case "building":
        return renderSectionFrame(
            <div className="space-y-4">
              {renderField("approximateYearOfConstruction", "Approx year")}
              {renderField("numberOfStories", "Stories", "number")}
              {renderChoiceButtons("propertySiteSection", "Site section", ["Flat Section", "Sloping Section", "Steep Section"])}
              {renderChoiceButtons("propertySiteExposure", "Site exposure", ["Sheltered", "Semi-Exposed", "Exposed"])}
              {renderChoiceButtons("propertySiteArea", "Site area", ["Urban", "Rural"])}
            </div>
          );
      case "roof":
        return renderSectionFrame(
            <div className="space-y-4">
              {roofOtherConfigs.map((config) => <div key={config.name}>{renderOtherChoiceButtons(config)}</div>)}
              {renderChoiceButtons("roofAndEavesCol3", "Eaves", ["No eaves", "Modest eaves", "Generous Eaves"], true)}
              {renderChoiceButtons("foundationAndFloor", "Foundation and floor", ["Ring Perimeter", "Piles", "Slab", "Suspended Floor Timber"], true)}
              {renderChoiceButtons("exteriorCladding", "Exterior cladding", ["Timber", "Cement Board", "Rendered Plaster", "Masonry veneer (nominal 140mm cavity)", "Masonry (double brick)", "EIFS", "Palisade (plastic) weatherboard", "Corrugated steel"], true)}
            </div>
          );
      case "envelope":
        return renderSectionFrame(
            <div className="space-y-4">
              {renderChoiceButtons("framing", "Framing", ["Likely Rimu", "Treated pinus", "Untreated pinus", "No framing (double brick)"], true)}
              {renderChoiceButtons("joinery", "Joinery", joineryOptions, true)}
              {renderChoiceButtons("lining", "Lining", ["Plasterboard", "Hardboard", "Sarked", "Masonry"], true)}
              {renderChoiceButtons("buildingPaper", "Building paper", ["Not detected", "Detected (but unable to guarantee extent or condition)"])}
            </div>
          );
      case "install":
        return renderSectionFrame(
            <div className="space-y-4">
              {renderChoiceButtons("claddingType", "Cladding type", ["Timber", "Cement Board", "Rendered Plaster", "Masonry Veneer", "Masonry (Double brick)", "EIFS", "Palisade (plastic) weatherboard", "Corrugated Steel"], true)}
              {renderChoiceButtons("claddingTypeInstalledVia", "Installed via", ["Cladding", "Internal Lining"], true)}
              {renderChoiceButtons("finishOfCladding", "Finish of cladding", ["Timber / Cement Board", "Painted render / plaster / masonry", "Unsealed masonry"], true)}
              {renderDetails("Installation holes are finished according to the selected cladding type and the Insulmax installation manual.")}
            </div>
          );
      case "compliance":
        return renderSectionFrame(
            <div className="space-y-3">
              {renderYesNoButtons("b131_structure", "Linings and claddings suitable for install pressure?")}
              {form.b131_structure === false && renderWorkFields("b131_structure")}
              {renderYesNoButtons("c22_preventionOfFireOccuring", "Through-wall flue in area to be insulated?", true)}
              {form.c22_preventionOfFireOccuring === true && renderWorkFields("c22_preventionOfFireOccuring")}
              {renderYesNoButtons("g931_electricity", "TPS wiring observed after plug point removed?")}
              {form.g931_electricity === false && renderWorkFields("g931_electricity")}
              {renderYesNoButtons("h131_energyEfficiency", "Insulmax can improve thermal resistance and limit airflow?")}
              {form.h131_energyEfficiency === false && (
                <div className="rounded-md border border-orange-100 bg-orange-50/70 px-3 py-2 text-sm font-medium text-[#9a4b13]">
                  Indicate on site plan areas of wall that are not able to be insulated with Insulmax®
                </div>
              )}
              {renderDetails("These checks support the S112 assessment that installing Insulmax will not reduce existing building compliance.")}
            </div>
          );
      case "moisture":
        return renderSectionFrame(
            <div className="space-y-3">
              {externalMoistureQuestions.map(([key, label, riskOnYes]) => renderYesNoButtons(key, label, riskOnYes))}
              {renderYesNoButtons("masonryCladding_masonryCladUnderfloorVentsArePresentAndClear", "Masonry underfloor vents present and clear?", false, true)}
              {renderYesNoButtons("masonryCladding_windowOrMasonryVerticalJointsAreSealed", "Window/masonry vertical joints sealed?", false, true)}
              {checks.moistureWorkNeeded && renderWorkFields("c22_externalMoisture")}
              {renderDetails("These checks cover exterior moisture paths and masonry ventilation.")}
            </div>
          );
      case "water":
        return renderSectionFrame(
            <div className="space-y-3">
              {waterIngressQuestions.map(([key, label, riskOnYes]) => renderYesNoButtons(key, label, riskOnYes, key === "masonryCladding_underfloorSpaceExcessivelyDamp"))}
              {checks.waterIngressWorkNeeded && (
                <>
                  <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                    Do not install Insulmax until the source of water ingress is identified and remedied. Note the required work before installation and certification.
                  </div>
                  {renderWorkFields("masonryCladding_underfloorSpaceExcessivelyDamp")}
                </>
              )}
              {renderDetails("Use this section for visible water ingress signals such as stained soffits, damp lining or excessive underfloor moisture.")}
            </div>
          );
      case "photos":
        return renderSectionFrame(
            <div className="space-y-3">
              {directions.map((dir) => {
                const section = `elevation_${dir}`;
                const imageNames = photos[section] || [];
                const skipped = elevationSkip[dir];
                const missing = checks.missingPhotos.includes(section);
                return (
                  <div key={dir} className={`rounded-lg border p-3 ${missing ? "border-[#f36c21] bg-orange-50/30" : "border-slate-200 bg-white"}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold capitalize text-slate-900">{dir} elevation</p>
                        <p className="text-xs text-slate-500">{skipped ? "Skipped" : imageNames.length ? `${imageNames.length} photo${imageNames.length === 1 ? "" : "s"}` : "Photo required"}</p>
                      </div>
                      <label className="flex items-center gap-1 text-xs font-medium text-slate-600">
                        <input type="checkbox" checked={skipped} onChange={(e) => { setElevationSkip((prev) => ({ ...prev, [dir]: e.target.checked })); setDirty(true); }} />
                        Skip
                      </label>
                    </div>
                    {!skipped && (
                      <>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button type="button" disabled={uploading[section]} onClick={() => cameraInputRef.current[section]?.click()} className="rounded-md bg-[#00485a] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Take photo</button>
                          <button type="button" disabled={uploading[section]} onClick={() => fileInputRef.current[section]?.click()} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Upload</button>
                        </div>
                        <input ref={(el) => { cameraInputRef.current[section] = el; }} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handlePhotoInput(section, e)} />
                        <input ref={(el) => { fileInputRef.current[section] = el; }} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handlePhotoInput(section, e)} />
                        {imageNames.length > 0 && (
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            {imageNames.map((fileName) => (
                              <div key={fileName} className="overflow-hidden rounded-md border border-slate-200 bg-white">
                                <a href={fileUrl(fileName)} target="_blank" rel="noreferrer"><img src={fileUrl(fileName)} alt={fileName} className="h-24 w-full object-cover" /></a>
                                <button type="button" onClick={() => removeEbaPhoto(section, fileName)} className="w-full px-2 py-1 text-xs font-medium text-red-600">Remove</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              <details open={optionalPhotosOpen} onToggle={(e) => setOptionalPhotosOpen(e.currentTarget.open)} className="rounded-lg border border-slate-200 bg-white">
                <summary className="cursor-pointer list-none px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Optional foundation and maintenance photos</p>
                      <p className="text-xs text-slate-500">
                        {(photos.foundation || []).length + (photos.maintenance || []).length
                          ? `${(photos.foundation || []).length + (photos.maintenance || []).length} optional photo${(photos.foundation || []).length + (photos.maintenance || []).length === 1 ? "" : "s"}`
                          : "Add only if useful"}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-[#00485a]">{optionalPhotosOpen ? "Hide" : "Show"}</span>
                  </div>
                </summary>
                <div className="space-y-3 border-t border-slate-100 p-3">
                  {[
                    ["foundation", "Foundations"],
                    ["maintenance", "Maintenance required"],
                  ].map(([section, title]) => {
                    const imageNames = photos[section] || [];
                    return (
                      <div key={section} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{title}</p>
                            <p className="text-xs text-slate-500">{imageNames.length ? `${imageNames.length} photo${imageNames.length === 1 ? "" : "s"}` : "Optional"}</p>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button type="button" disabled={uploading[section]} onClick={() => cameraInputRef.current[section]?.click()} className="rounded-md bg-[#00485a] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Take photo</button>
                          <button type="button" disabled={uploading[section]} onClick={() => fileInputRef.current[section]?.click()} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Upload</button>
                        </div>
                        <input ref={(el) => { cameraInputRef.current[section] = el; }} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handlePhotoInput(section, e)} />
                        <input ref={(el) => { fileInputRef.current[section] = el; }} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handlePhotoInput(section, e)} />
                        {imageNames.length > 0 && (
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            {imageNames.map((fileName) => (
                              <div key={fileName} className="overflow-hidden rounded-md border border-slate-200 bg-white">
                                <a href={fileUrl(fileName)} target="_blank" rel="noreferrer"><img src={fileUrl(fileName)} alt={fileName} className="h-24 w-full object-cover" /></a>
                                <button type="button" onClick={() => removeEbaPhoto(section, fileName)} className="w-full px-2 py-1 text-xs font-medium text-red-600">Remove</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            </div>
          );
      case "installPlanning":
        return renderSectionFrame(
            <div className="space-y-4">
              <div className="rounded-md border border-amber-100 bg-amber-50/70 px-3 py-2 text-sm text-amber-900">
                These answers are for the install team only. They are saved into the job notes, not the formal EBA document.
              </div>
              <label className="block">
                <span className="text-xs font-medium text-slate-500">What is access to the property like?</span>
                <textarea
                  value={installPlanningDetails.accessNotes}
                  onChange={(e) => setInstallPlanningField("accessNotes", e.target.value)}
                  rows={3}
                  placeholder="Optional notes about parking, gates, dogs, steep access, long carries, etc."
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[#00485a]"
                />
              </label>

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <p className="text-sm font-medium text-slate-800">Are extension hoses needed?</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setInstallPlanningField("extensionHosesRequired", true)} className={`rounded-md border px-3 py-2 text-sm font-semibold ${installPlanningDetails.extensionHosesRequired ? "border-[#00485a] bg-[#e8f2f4] text-[#00485a]" : "border-slate-200 bg-slate-50 text-slate-700"}`}>Yes</button>
                  <button type="button" onClick={() => setInstallPlanningField("extensionHosesRequired", false)} className={`rounded-md border px-3 py-2 text-sm font-semibold ${!installPlanningDetails.extensionHosesRequired ? "border-[#00485a] bg-[#e8f2f4] text-[#00485a]" : "border-slate-200 bg-slate-50 text-slate-700"}`}>No</button>
                </div>
                {installPlanningDetails.extensionHosesRequired && (
                  <label className="mt-3 block">
                    <span className="flex items-center justify-between text-xs font-medium text-slate-500">
                      Distance to the property
                      {checks.missingKeys.includes("extensionHosesDistance") && <span className="text-[10px] font-semibold text-[#c75516]">Missing</span>}
                    </span>
                    <input
                      value={installPlanningDetails.extensionHosesDistance}
                      onChange={(e) => setInstallPlanningField("extensionHosesDistance", e.target.value)}
                      placeholder="e.g. 30m from van to house"
                      className={inputClass("extensionHosesDistance")}
                    />
                  </label>
                )}
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <p className="text-sm font-medium text-slate-800">Are extension ladders required?</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setInstallPlanningField("extensionLaddersRequired", true)} className={`rounded-md border px-3 py-2 text-sm font-semibold ${installPlanningDetails.extensionLaddersRequired ? "border-[#00485a] bg-[#e8f2f4] text-[#00485a]" : "border-slate-200 bg-slate-50 text-slate-700"}`}>Yes</button>
                  <button type="button" onClick={() => setInstallPlanningField("extensionLaddersRequired", false)} className={`rounded-md border px-3 py-2 text-sm font-semibold ${!installPlanningDetails.extensionLaddersRequired ? "border-[#00485a] bg-[#e8f2f4] text-[#00485a]" : "border-slate-200 bg-slate-50 text-slate-700"}`}>No</button>
                </div>
                {installPlanningDetails.extensionLaddersRequired && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-slate-500">Ladder location</p>
                      {checks.missingKeys.includes("extensionLaddersLocation") && <span className="text-[10px] font-semibold text-[#c75516]">Missing</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {(["internal", "external"] as const).map((value) => (
                        <button key={value} type="button" onClick={() => setInstallPlanningField("extensionLaddersLocation", value)} className={`rounded-md border px-3 py-2 text-sm font-semibold capitalize ${installPlanningDetails.extensionLaddersLocation === value ? "border-[#00485a] bg-[#e8f2f4] text-[#00485a]" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                          {value}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-3">
                <p className="text-sm font-medium text-slate-800">Does job require external painting?</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setInstallPlanningField("externalPaintingRequired", true)} className={`rounded-md border px-3 py-2 text-sm font-semibold ${installPlanningDetails.externalPaintingRequired ? "border-[#00485a] bg-[#e8f2f4] text-[#00485a]" : "border-slate-200 bg-slate-50 text-slate-700"}`}>Yes</button>
                  <button type="button" onClick={() => setInstallPlanningField("externalPaintingRequired", false)} className={`rounded-md border px-3 py-2 text-sm font-semibold ${!installPlanningDetails.externalPaintingRequired ? "border-[#00485a] bg-[#e8f2f4] text-[#00485a]" : "border-slate-200 bg-slate-50 text-slate-700"}`}>No</button>
                </div>
                {installPlanningDetails.externalPaintingRequired && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-slate-500">Paint supply</p>
                      {checks.missingKeys.includes("externalPaintingSupply") && <span className="text-[10px] font-semibold text-[#c75516]">Missing</span>}
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {[
                        ["us", "Paint provided by us"],
                        ["customer", "Paint provided by customer"],
                      ].map(([value, label]) => (
                        <button key={value} type="button" onClick={() => setInstallPlanningField("externalPaintingSupply", value as InstallPlanningDetails["externalPaintingSupply"])} className={`rounded-md border px-3 py-2 text-sm font-semibold ${installPlanningDetails.externalPaintingSupply === value ? "border-[#00485a] bg-[#e8f2f4] text-[#00485a]" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
      case "sign":
        return renderSectionFrame(
            <div className="space-y-4">
              {renderField("assessorName", "Licenced building assessor")}
              {renderDetails("By signing, the assessor confirms the property is suitable for Insulmax retrofit wall insulation subject to recorded work requirements and installation according to the Insulmax installation manual.")}
              <div className={`overflow-hidden rounded-lg border ${checks.missingItems.some((item) => item.key === "signature_assessor") ? "border-[#f36c21]" : "border-slate-200"}`}>
                <canvas
                  ref={canvasRef}
                  width={900}
                  height={240}
                  className="h-44 w-full touch-none bg-white"
                  onPointerDown={(e) => drawStart(e.clientX, e.clientY)}
                  onPointerMove={(e) => drawMove(e.clientX, e.clientY)}
                  onPointerUp={() => { drawingRef.current = false; }}
                  onPointerLeave={() => { drawingRef.current = false; }}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => canvasRef.current?.getContext("2d")?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Clear</button>
                <button type="button" onClick={saveSignature} disabled={signing || locked} className="rounded-md bg-[#00485a] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{signing ? "Saving..." : "Save signature"}</button>
              </div>
            </div>
          );
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f7f7] text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={goBack} className="rounded-md px-2 py-1 text-sm font-medium text-slate-600">Back</button>
            <div className="min-w-0 flex-1 text-center">
              <h1 className="truncate text-sm font-semibold text-slate-950">{job ? `EBA #${job.jobNumber}` : "EBA"}</h1>
              <p className="truncate text-xs text-slate-500">{shortAddress}</p>
            </div>
            <div className={`text-xs font-semibold ${saveState === "error" ? "text-red-600" : saveState === "saving" ? "text-[#c75516]" : "text-emerald-700"}`}>{saveText}</div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-[#f36c21]" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-32 pt-4">
        {loading && <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">Loading EBA...</div>}
        {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}
        {!loading && job && (
          <>
            {locked && <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">This EBA is client signed and locked.</div>}
            <fieldset disabled={locked} className={locked ? "opacity-70" : ""}>
              {renderActiveSection()}
            </fieldset>
          </>
        )}
      </main>

      {!loading && job && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)]">
          <div className="mx-auto mb-2 flex max-w-3xl items-center justify-between gap-3">
            <p className="truncate text-xs font-medium text-slate-500">
              {activeDone ? "Ready for the next section" : `${activeMissing.length} to finish here`}
            </p>
            <p className="shrink-0 text-xs font-semibold text-slate-600">{progress}% complete</p>
          </div>
          <div className="mx-auto grid max-w-3xl grid-cols-[1fr_1.25fr_1.2fr] gap-2">
            <button type="button" onClick={() => setSectionsOpen(true)} className="rounded-md border border-slate-200 bg-white px-2 py-2.5 text-sm font-semibold text-slate-700">Sections</button>
            <button type="button" onClick={() => isLastSection ? setSectionsOpen(true) : goToSection(nextSection)} className="rounded-md border border-slate-200 bg-white px-2 py-2 text-sm font-semibold leading-tight text-slate-700">
              <span className="block">{isLastSection ? "Review" : "Next"}</span>
              {!isLastSection && <span className="block truncate text-[10px] font-medium text-slate-500">{sectionMeta[nextSection].title}</span>}
            </button>
            <button type="button" onClick={finalise} disabled={locked} className="rounded-md bg-[#00485a] px-2 py-2 text-sm font-semibold leading-tight text-white disabled:opacity-50">
              <span className="block">Finalise</span>
              {!checks.canFinalise && <span className="block text-[10px] font-medium text-white/80">{checks.missingItems.length} left</span>}
            </button>
          </div>
        </div>
      )}

      {(sectionsOpen || missingOpen) && (
        <div className="fixed inset-0 z-50 bg-slate-950/30" onClick={() => { setSectionsOpen(false); setMissingOpen(false); }}>
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-auto rounded-t-2xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" />
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-950">{missingOpen ? "Finish these first" : "Sections"}</h2>
              <button type="button" onClick={() => { setSectionsOpen(false); setMissingOpen(false); }} className="rounded-md px-2 py-1 text-sm text-slate-500">Close</button>
            </div>
            <div className="space-y-2">
              {(missingOpen ? checks.missingItems.map((item) => ({ id: item.section, title: item.label, short: sectionMeta[item.section].title, missing: 1 })) : sectionOrder.map((section) => ({ id: section, title: sectionMeta[section].title, short: sectionMeta[section].short, missing: checks.missingBySection[section]?.length || 0 }))).map((row, index) => (
                <button key={`${row.id}-${row.title}-${index}`} type="button" onClick={() => goToSection(row.id as SectionId)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-3 text-left">
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{row.title}</span>
                    <span className="block text-xs text-slate-500">{row.short}</span>
                  </span>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.missing ? "bg-orange-50 text-[#c75516]" : "bg-emerald-50 text-emerald-700"}`}>{row.missing ? `${row.missing} missing` : "Done"}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
