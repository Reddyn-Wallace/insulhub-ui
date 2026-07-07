import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth, tokenFromRequest } from "@/lib/insulhub-auth";
import { getSalesInstallsReport, parseReportRange } from "@/lib/reports/sales-installs-server";

export async function GET(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    const token = tokenFromRequest(request);
    const { searchParams } = new URL(request.url);
    const { fromDate, toDate } = parseReportRange(searchParams.get("from"), searchParams.get("to"));
    const refresh = searchParams.get("refresh") === "1";
    const response = await getSalesInstallsReport(token, fromDate, toDate, { refresh });

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load sales report";
    const status = message.includes("from must be") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
