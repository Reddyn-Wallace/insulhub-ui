import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";
import { getDefaultInstallPlanningDetails, normalizeInstallPlanningDetails, type InstallPlanningDetails } from "@/lib/install-planning";

type InstallPlanningInput = {
  jobId?: string;
  status?: "confirmed" | "pencilled";
  installScope?: "" | "internal" | "external" | "both";
  planningNote?: string;
  councilApprovalNA?: boolean;
  accessNotes?: string;
  extensionHosesRequired?: boolean;
  extensionHosesDistance?: string;
  extensionLaddersRequired?: boolean;
  extensionLaddersLocation?: "" | "internal" | "external";
  externalPaintingRequired?: boolean;
  externalPaintingSupply?: "" | "us" | "customer";
};

function toInstallPlanning(row: Record<string, unknown>) {
  return {
    source: "overlay",
    jobId: row.insulhub_job_id,
    status: row.status,
    installScope: row.install_scope,
    note: row.planning_note,
    councilApprovalNA: row.council_approval_na,
    ...normalizeInstallPlanningDetails({
      accessNotes: String(row.access_notes || ""),
      extensionHosesRequired: row.extension_hoses_required === true,
      extensionHosesDistance: String(row.extension_hoses_distance || ""),
      extensionLaddersRequired: row.extension_ladders_required === true,
      extensionLaddersLocation: row.extension_ladders_location === "internal" || row.extension_ladders_location === "external" ? row.extension_ladders_location as InstallPlanningDetails["extensionLaddersLocation"] : "",
      externalPaintingRequired: row.external_painting_required === true,
      externalPaintingSupply: row.external_painting_supply === "us" || row.external_painting_supply === "customer" ? row.external_painting_supply as InstallPlanningDetails["externalPaintingSupply"] : "",
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();

    const { searchParams } = new URL(request.url);
    const jobIds = (searchParams.get("jobIds") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (jobIds.length === 0) {
      return NextResponse.json({ planning: [] });
    }

    const rows = await overlaySql`
      SELECT *
      FROM job_install_planning
      WHERE insulhub_job_id = ANY(${jobIds}::text[])
      ORDER BY insulhub_job_id ASC
    `;

    return NextResponse.json({ planning: rows.map(toInstallPlanning) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load install planning" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    await ensureOverlaySchema();

    const input = (await request.json()) as InstallPlanningInput;
    const jobId = input.jobId?.trim();
    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    const existingRows = await overlaySql`
      SELECT *
      FROM job_install_planning
      WHERE insulhub_job_id = ${jobId}
      LIMIT 1
    `;
    const existing = existingRows[0]
      ? toInstallPlanning(existingRows[0])
      : {
          status: "confirmed",
          installScope: "",
          note: "",
          councilApprovalNA: false,
          ...getDefaultInstallPlanningDetails(),
        };

    const status = input.status || String(existing.status);
    const installScope = input.installScope ?? String(existing.installScope);
    if (!["confirmed", "pencilled"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    if (!["", "internal", "external", "both"].includes(installScope)) {
      return NextResponse.json({ error: "Invalid installScope" }, { status: 400 });
    }

    const details = normalizeInstallPlanningDetails({
      accessNotes: input.accessNotes ?? existing.accessNotes,
      extensionHosesRequired: input.extensionHosesRequired ?? existing.extensionHosesRequired,
      extensionHosesDistance: input.extensionHosesDistance ?? existing.extensionHosesDistance,
      extensionLaddersRequired: input.extensionLaddersRequired ?? existing.extensionLaddersRequired,
      extensionLaddersLocation: input.extensionLaddersLocation ?? existing.extensionLaddersLocation,
      externalPaintingRequired: input.externalPaintingRequired ?? existing.externalPaintingRequired,
      externalPaintingSupply: input.externalPaintingSupply ?? existing.externalPaintingSupply,
    });

    const rows = await overlaySql`
      INSERT INTO job_install_planning (
        insulhub_job_id,
        status,
        install_scope,
        planning_note,
        council_approval_na,
        access_notes,
        extension_hoses_required,
        extension_hoses_distance,
        extension_ladders_required,
        extension_ladders_location,
        external_painting_required,
        external_painting_supply
      )
      VALUES (
        ${jobId},
        ${status},
        ${installScope},
        ${input.planningNote?.trim() ?? existing.note},
        ${input.councilApprovalNA ?? existing.councilApprovalNA},
        ${details.accessNotes},
        ${details.extensionHosesRequired},
        ${details.extensionHosesDistance},
        ${details.extensionLaddersRequired},
        ${details.extensionLaddersLocation},
        ${details.externalPaintingRequired},
        ${details.externalPaintingSupply}
      )
      ON CONFLICT (insulhub_job_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        install_scope = EXCLUDED.install_scope,
        planning_note = EXCLUDED.planning_note,
        council_approval_na = EXCLUDED.council_approval_na,
        access_notes = EXCLUDED.access_notes,
        extension_hoses_required = EXCLUDED.extension_hoses_required,
        extension_hoses_distance = EXCLUDED.extension_hoses_distance,
        extension_ladders_required = EXCLUDED.extension_ladders_required,
        extension_ladders_location = EXCLUDED.extension_ladders_location,
        external_painting_required = EXCLUDED.external_painting_required,
        external_painting_supply = EXCLUDED.external_painting_supply,
        updated_at = now()
      RETURNING *
    `;

    return NextResponse.json({ planning: toInstallPlanning(rows[0]) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save install planning" },
      { status: 500 }
    );
  }
}
