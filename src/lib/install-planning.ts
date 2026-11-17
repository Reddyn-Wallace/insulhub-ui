export type InstallPlanningDetails = {
  accessNotes: string;
  parkingNotes: string;
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
    parkingNotes: "",
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
    parkingNotes: input?.parkingNotes?.trim() || "",
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

  if (details.parkingNotes) {
    lines.push(`Parking: ${details.parkingNotes}`);
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

export type InstallBookingStatus = "confirmed" | "pencilled";

const INSTALL_META_START = "[INSTALL_META]";
const INSTALL_META_END = "[/INSTALL_META]";

export function parseInstallMeta(notes?: string | null): { status: InstallBookingStatus; note: string; scope: "internal" | "external" | "both" | "" } {
  const text = notes || "";
  const start = text.indexOf(INSTALL_META_START);
  const end = text.indexOf(INSTALL_META_END);
  if (start === -1 || end === -1 || end < start) {
    return { status: "confirmed", note: "", scope: "" };
  }

  const body = text
    .slice(start + INSTALL_META_START.length, end)
    .trim();

  const statusMatch = body.match(/^status:\s*(.+)$/im);
  const noteMatch = body.match(/^note:\s*([\s\S]*?)(?:\n[a-z_]+:|$)/im);
  const scopeMatch = body.match(/^install_scope:\s*(.+)$/im);
  const rawStatus = (statusMatch?.[1] || "confirmed").trim().toLowerCase();
  const rawScope = (scopeMatch?.[1] || "").trim().toLowerCase();
  return {
    status: rawStatus === "pencilled" ? "pencilled" : "confirmed",
    note: (noteMatch?.[1] || "").trim(),
    scope: rawScope === "internal" || rawScope === "external" || rawScope === "both" ? rawScope : "",
  };
}
