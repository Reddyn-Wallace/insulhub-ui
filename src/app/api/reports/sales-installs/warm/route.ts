import { NextRequest, NextResponse } from "next/server";
import { requireInsulhubAuth, tokenFromRequest } from "@/lib/insulhub-auth";
import { defaultWarmRanges, parseReportRange, warmSalesInstallsReports } from "@/lib/reports/sales-installs-server";

type WarmRangeInput = {
  from?: string;
  to?: string;
};

export async function POST(request: NextRequest) {
  try {
    const unauthorized = await requireInsulhubAuth(request);
    if (unauthorized) return unauthorized;

    const token = tokenFromRequest(request);
    let ranges = defaultWarmRanges();

    try {
      const body = await request.json() as { ranges?: WarmRangeInput[] };
      if (Array.isArray(body.ranges) && body.ranges.length > 0) {
        ranges = body.ranges.slice(0, 4).map((range) => {
          const parsed = parseReportRange(range.from || null, range.to || null);
          return { fromDate: parsed.fromDate, toDate: parsed.toDate };
        });
      }
    } catch {
      ranges = defaultWarmRanges();
    }

    const results = await warmSalesInstallsReports(token, ranges);
    return NextResponse.json({ warmed: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to warm sales report";
    const status = message.includes("from must be") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
