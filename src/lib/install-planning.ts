export type InstallPlanningDetails = {
  accessNotes: string;
  extensionHosesRequired: boolean;
  extensionHosesDistance: string;
  extensionLaddersRequired: boolean;
  extensionLaddersLocation: "" | "internal" | "external";
  externalPaintingRequired: boolean;
  externalPaintingSupply: "" | "us" | "customer";
};

export type InstallPlanningPayload = InstallPlanningDetails & {
  status: "confirmed" | "pencilled";
  installScope: "" | "internal" | "external" | "both";
  planningNote: string;
  councilApprovalNA: boolean;
  jobId?: string;
};

export function getDefaultInstallPlanningDetails(): InstallPlanningDetails {
  return {
    accessNotes: "",
    extensionHosesRequired: false,
    extensionHosesDistance: "",
    extensionLaddersRequired: false,
    extensionLaddersLocation: "",
    externalPaintingRequired: false,
    externalPaintingSupply: "",
  };
}

export function normalizeInstallPlanningDetails(input?: Partial<InstallPlanningDetails> | null): InstallPlanningDetails {
  return {
    accessNotes: input?.accessNotes?.trim() || "",
    extensionHosesRequired: input?.extensionHosesRequired === true,
    extensionHosesDistance: input?.extensionHosesDistance?.trim() || "",
    extensionLaddersRequired: input?.extensionLaddersRequired === true,
    extensionLaddersLocation: input?.extensionLaddersLocation === "internal" || input?.extensionLaddersLocation === "external"
      ? input.extensionLaddersLocation
      : "",
    externalPaintingRequired: input?.externalPaintingRequired === true,
    externalPaintingSupply: input?.externalPaintingSupply === "us" || input?.externalPaintingSupply === "customer"
      ? input.externalPaintingSupply
      : "",
  };
}

export function buildInstallPlanningSummaryLines(input?: Partial<InstallPlanningDetails> | null): string[] {
  const details = normalizeInstallPlanningDetails(input);
  const lines: string[] = [];

  if (details.accessNotes) {
    lines.push(`Access to the property: ${details.accessNotes}`);
  }

  if (details.extensionHosesRequired) {
    const line = details.extensionHosesDistance
      ? `Extension hoses needed - distance to property: ${details.extensionHosesDistance}`
      : "Extension hoses needed";
    lines.push(line);
  }

  if (details.extensionLaddersRequired) {
    const location = details.extensionLaddersLocation === "internal"
      ? "Internal"
      : details.extensionLaddersLocation === "external"
        ? "External"
        : "";
    lines.push(location ? `Extension ladders required - ${location}` : "Extension ladders required");
  }

  if (details.externalPaintingRequired) {
    const supply = details.externalPaintingSupply === "us"
      ? "Paint provided by us"
      : details.externalPaintingSupply === "customer"
        ? "Paint provided by customer"
        : "";
    lines.push(supply ? `External painting required - ${supply}` : "External painting required");
  }

  return lines;
}
