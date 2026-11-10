import { request, RequestError } from "./client";
import type { Report } from "./types";

// A long first build can outlive the browser connection. The server keeps its
// lease and publishes the snapshot, so recover it with reads, never another POST.
async function waitForRefresh(
  week: string,
  previous: Report | null,
): Promise<Report> {
  for (let attempt = 0; attempt < 150; attempt++) {
    const { report } = await request<{ report: Report | null }>(
      `/api/gm-reports/${week}`,
    );
    if (!report?.refreshing) {
      if (
        report?.snapshot &&
        report.snapshot.builtAt !== previous?.snapshot?.builtAt
      )
        return report;
      throw new Error(
        "The refresh did not finish. Your saved report is unchanged. Please retry.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    "The refresh is taking longer than expected. Reload the saved report shortly.",
  );
}

export async function refreshReport(
  week: string,
  previous: Report | null,
): Promise<Report> {
  if (previous?.refreshing) return waitForRefresh(week, previous);
  try {
    return (
      await request<{ report: Report }>(`/api/gm-reports/${week}`, "POST", {
        action: "refresh",
      })
    ).report;
  } catch (error) {
    // Explicit HTTP/source errors already released the lease and remain errors.
    if (error instanceof RequestError) throw error;
    return waitForRefresh(week, previous);
  }
}
