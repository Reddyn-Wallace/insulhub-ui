import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth } from "@/lib/insulhub-auth";
import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";

type InstallPlanningInput = {
  jobId?: string;
  status?: "confirmed" | "pencilled";
  installScope?: "" | "internal" | "external" | "both";
  planningNote?: string;
  councilApprovalNA?: boolean;
};

function toInstallPlanning(row: Record<string, unknown>) {
  return {
    source: "overlay",
    jobId: row.insulhub_job_id,
    status: row.status,
    installScope: row.install_scope,
    note: row.planning_note,
    councilApprovalNA: row.council_approval_na,
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

    const status = input.status || "confirmed";
    const installScope = input.installScope || "";
    if (!["confirmed", "pencilled"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    if (!["", "internal", "external", "both"].includes(installScope)) {
      return NextResponse.json({ error: "Invalid installScope" }, { status: 400 });
    }

    const rows = await overlaySql`
      INSERT INTO job_install_planning (
        insulhub_job_id,
        status,
        install_scope,
        planning_note,
        council_approval_na
      )
      VALUES (
        ${jobId},
        ${status},
        ${installScope},
        ${input.planningNote?.trim() || ""},
        ${input.councilApprovalNA ?? false}
      )
      ON CONFLICT (insulhub_job_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        install_scope = EXCLUDED.install_scope,
        planning_note = EXCLUDED.planning_note,
        council_approval_na = EXCLUDED.council_approval_na,
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
