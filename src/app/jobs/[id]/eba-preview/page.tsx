"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { gql } from "@/lib/graphql";

type Photo = { fileName?: string; thumbnail?: string };
type Direction = "north" | "east" | "south" | "west";
type SaveState = "saved" | "saving" | "error";

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
    contactDetails?: {
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

const directions: Direction[] = ["north", "east", "south", "west"];

const sectionOrder = ["admin", "building", "roof", "envelope", "install", "compliance", "moisture", "photos", "sign"] as const;
type SectionId = (typeof sectionOrder)[number];

const sectionMeta: Record<SectionId, { title: string; short: string }> = {
  admin: { title: "Admin", short: "Owner and council details" },
  building: { title: "Building details", short: "Age, site and construction" },
  roof: { title: "Roof and envelope", short: "Roof, floor and cladding" },
  envelope: { title: "Interior envelope", short: "Framing, joinery and lining" },
  install: { title: "Install method", short: "Cladding and finish" },
  compliance: { title: "Code checks", short: "Structure, fire, wiring, energy" },
  moisture: { title: "Moisture checks", short: "External water and dampness" },
  photos: { title: "Photos", short: "Elevation photo cards" },
  sign: { title: "Sign", short: "Assessor declaration" },
};

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
  c22_preventionOfFireOccuring: "Fire check",
  c22_preventionOfFireOccuring_priorToInstallationWorkRequired: "Fire work required",
  g931_electricity: "TPS wiring",
  g931_electricity_priorToInstallationWorkRequired: "Electrical work required",
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
  c22_externalMoisture_priorToInstallationWorkRequired: "Moisture work required",
  assessorName: "Assessor name",
};

const finaliseRequiredKeys = Object.keys(requiredLabels).filter(
  (key) => !key.endsWith("_priorToInstallationWorkRequired") && key !== "finishOfCladding",
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
  if (["roofAndEavesCol1", "roofAndEavesCol2", "roofAndEavesCol3", "foundationAndFloor", "exteriorCladding"].includes(key)) return "roof";
  if (["framing", "joinery", "lining", "buildingPaper"].includes(key)) return "envelope";
  if (["claddingType", "claddingTypeInstalledVia", "finishOfCladding"].includes(key)) return "install";
  if (key.startsWith("c22_externalMoisture") || key.startsWith("masonryCladding")) return "moisture";
  if (key.includes("photo")) return "photos";
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
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
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
    setDirty(true);
    setForm((prev) => ({ ...prev, [name]: value }));
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
    c22_externalMoisture_priorToInstallationWorkRequired: form.c22_externalMoisture_priorToInstallationWorkRequired,
    c22_externalMoisture_priorToCertificationWorkRequired: form.c22_externalMoisture_priorToCertificationWorkRequired,
    skip_photos_elevation_north: elevationSkip.north,
    skip_photos_elevation_east: elevationSkip.east,
    skip_photos_elevation_south: elevationSkip.south,
    skip_photos_elevation_west: elevationSkip.west,
    assessorName: form.assessorName,
  }), [form, elevationSkip]);

  const checks = useMemo(() => {
    const missingKeys = finaliseRequiredKeys.filter((key) => !hasValue(form[key]));
    if (!listValue(form.finishOfCladding).length) missingKeys.push("finishOfCladding");

    if (form.b131_structure === false && !hasValue(form.b131_structure_priorToInstallationWorkRequired) && !hasValue(form.b131_structure_priorToCertificationWorkRequired)) {
      missingKeys.push("b131_structure_priorToInstallationWorkRequired");
    }
    if (form.c22_preventionOfFireOccuring === true && !hasValue(form.c22_preventionOfFireOccuring_priorToInstallationWorkRequired) && !hasValue(form.c22_preventionOfFireOccuring_priorToCertificationWorkRequired)) {
      missingKeys.push("c22_preventionOfFireOccuring_priorToInstallationWorkRequired");
    }
    if (form.g931_electricity === false && !hasValue(form.g931_electricity_priorToInstallationWorkRequired) && !hasValue(form.g931_electricity_priorToCertificationWorkRequired)) {
      missingKeys.push("g931_electricity_priorToInstallationWorkRequired");
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
      "masonryCladding_soffitsAppearToBeSoundWithNoWaterStainingOrBubblingPaintWhichMayIndicateGuttersOrRoofLeakingIntoSurfeitsAndPossiblyWalls",
      "masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater",
      "masonryCladding_underfloorSpaceExcessivelyDamp",
    ].some((key) => redWhenYes.has(key) ? form[key] === true : form[key] === false);
    if (moistureWorkNeeded && !hasValue(form.c22_externalMoisture_priorToInstallationWorkRequired) && !hasValue(form.c22_externalMoisture_priorToCertificationWorkRequired)) {
      missingKeys.push("c22_externalMoisture_priorToInstallationWorkRequired");
    }

    const missingPhotos = directions
      .filter((dir) => !elevationSkip[dir])
      .map((dir) => `elevation_${dir}`)
      .filter((section) => (photos[section] || []).length === 0);
    const missingSignature = !signatureFileName(job?.ebaForm?.signature_assessor);
    const missingItems = [
      ...missingKeys.map((key) => ({ label: requiredLabels[key] || key, section: sectionForKey(key), key })),
      ...missingPhotos.map((section) => ({ label: `${section.replace("elevation_", "")} elevation photo`, section: "photos" as SectionId, key: section })),
      ...(missingSignature ? [{ label: "Assessor signature", section: "sign" as SectionId, key: "signature_assessor" }] : []),
    ];

    const missingBySection = sectionOrder.reduce((acc, section) => {
      acc[section] = missingItems.filter((item) => item.section === section);
      return acc;
    }, {} as Record<SectionId, typeof missingItems>);

    return { missingKeys, missingItems, missingBySection, missingPhotos, canFinalise: missingItems.length === 0 };
  }, [form, photos, elevationSkip, job?.ebaForm?.signature_assessor]);

  const progress = Math.max(0, Math.round(((Object.keys(requiredLabels).length + 5 - checks.missingItems.length) / (Object.keys(requiredLabels).length + 5)) * 100));

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const data = await gql<{ job: Job }>(EBA_JOB_QUERY, { _id: id }, { cacheKey: `eba-job:${id}`, ttlMs: 5 * 60 * 1000 });
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
      setDefaultIfBlank(nextForm, "masonryCladding_underfloorSpaceExcessivelyDamp", "NOT_APPLICABLE");

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
      setPhotos(nextPhotos);
      setElevationSkip({
        north: !!eba.skip_photos_elevation_north,
        east: !!eba.skip_photos_elevation_east,
        south: !!eba.skip_photos_elevation_south,
        west: !!eba.skip_photos_elevation_west,
      });
      setDirty(false);
      setSaveState("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load EBA");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (loading || initialSectionSetRef.current || checks.missingItems.length === 0) return;
    initialSectionSetRef.current = true;
    setActiveSection(checks.missingItems[0].section);
  }, [loading, checks.missingItems]);

  async function saveDraft(quiet = false) {
    if (!job || locked) return;
    setSaving(true);
    setSaveState("saving");
    if (!quiet) setNotice("");
    setError("");
    try {
      const res = await gql<{ saveEBA: Job }>(SAVE_EBA_MUTATION, { input: { _id: job._id, ebaForm: ebaPayload }, isDraft: true });
      setJob((prev) => prev ? { ...prev, ebaForm: { ...(prev.ebaForm || {}), ...(res.saveEBA.ebaForm || {}), ...ebaPayload } } : prev);
      setDirty(false);
      setSaveState("saved");
      if (!quiet) setNotice("Draft saved.");
    } catch (err) {
      setSaveState("error");
      setError(err instanceof Error ? err.message : "Failed to autosave EBA");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!dirty || loading || locked || !job) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      void saveDraft(true);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [dirty, form, elevationSkip, loading, locked, job]);

  async function finalise() {
    setFinaliseAttempted(true);
    if (!checks.canFinalise) {
      setMissingOpen(true);
      return;
    }
    if (!job || locked) return;
    setSaving(true);
    setError("");
    try {
      await gql<{ saveEBA: Job }>(SAVE_EBA_MUTATION, { input: { _id: job._id, ebaForm: ebaPayload }, isDraft: false });
      router.replace(`/jobs/${id}`);
    } catch (err) {
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
    setSigning(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not capture signature");
      const file = new File([blob], `eba-signature-${Date.now()}.png`, { type: "image/png" });
      const names = await uploadFiles({ 0: file, length: 1, item: (i: number) => (i === 0 ? file : null) } as unknown as FileList);
      const fileName = names[0];
      if (!fileName) throw new Error("Signature upload failed");
      await gql(SAVE_EBA_MUTATION, { input: { _id: job._id, ebaForm: { signature_assessor: { fileName, thumbnail: fileName } } }, isDraft: true });
      setJob((prev) => prev ? { ...prev, ebaForm: { ...(prev.ebaForm || {}), signature_assessor: { fileName, thumbnail: fileName } } } : prev);
      setNotice("Signature saved.");
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
              {renderField("bcaOrTa", "BCA/TA")}
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
              {renderChoiceButtons("roofAndEavesCol1", "Roof type", ["Hip Gable", "Double Gable", "Skillion / Mono pitch"], true)}
              {renderChoiceButtons("roofAndEavesCol2", "Roof cladding", ["Corrugated Steel", "Tile", "Membrane"], true)}
              {renderChoiceButtons("roofAndEavesCol3", "Eaves", ["No eaves", "Modest eaves", "Generous Eaves"], true)}
              {renderChoiceButtons("foundationAndFloor", "Foundation and floor", ["Ring Perimeter", "Piles", "Slab", "Suspended Floor Timber"], true)}
              {renderChoiceButtons("exteriorCladding", "Exterior cladding", ["Timber", "Cement Board", "Rendered Plaster", "Masonry veneer (nominal 140mm cavity)", "Masonry (double brick)", "EIFS", "Palisade (plastic) weatherboard", "Corrugated steel"], true)}
            </div>
          );
      case "envelope":
        return renderSectionFrame(
            <div className="space-y-4">
              {renderChoiceButtons("framing", "Framing", ["Likely Rimu", "Treated pinus", "Untreated pinus", "No framing (double brick)"], true)}
              {renderChoiceButtons("joinery", "Joinery", ["Timber", "Aluminium/steel", "uPVC", "Appears to be installed correctly"], true)}
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
              {form.b131_structure === false && renderField("b131_structure_priorToInstallationWorkRequired", "Structure work required")}
              {renderYesNoButtons("c22_preventionOfFireOccuring", "Through-wall flue in area to be insulated?", true)}
              {form.c22_preventionOfFireOccuring === true && renderField("c22_preventionOfFireOccuring_priorToInstallationWorkRequired", "Fire work required")}
              {renderYesNoButtons("g931_electricity", "TPS wiring observed after plug point removed?")}
              {form.g931_electricity === false && renderField("g931_electricity_priorToInstallationWorkRequired", "Electrical work required")}
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
              {renderYesNoButtons("masonryCladding_soffitsAppearToBeSoundWithNoWaterStainingOrBubblingPaintWhichMayIndicateGuttersOrRoofLeakingIntoSurfeitsAndPossiblyWalls", "Soffits sound with no water staining/bubbling?")}
              {renderYesNoButtons("masonryCladding_areasOfLiningOrCladdingAppearToBeDampOrSoftOrDiscolouredOrMouldyOrRottenSuggestingTheAccumulationOfWater", "Damp, soft, discoloured, mouldy or rotten areas?", true)}
              {renderYesNoButtons("masonryCladding_underfloorSpaceExcessivelyDamp", "Underfloor space excessively damp?", true, true)}
              {checks.missingKeys.includes("c22_externalMoisture_priorToInstallationWorkRequired") && renderField("c22_externalMoisture_priorToInstallationWorkRequired", "Moisture work required")}
              {renderDetails("Keep notes focused on work needed before install or before certification.")}
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
            <button type="button" onClick={finalise} disabled={saving || locked} className="rounded-md bg-[#00485a] px-2 py-2 text-sm font-semibold leading-tight text-white disabled:opacity-50">
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
