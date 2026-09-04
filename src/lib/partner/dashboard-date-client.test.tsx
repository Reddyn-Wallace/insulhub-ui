// @vitest-environment jsdom

import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PartnerDashboard from "@/components/PartnerDashboard";
import { formatPartnerDate } from "./date";
import type { PartnerJobView } from "./repository";
import { calculateQuote, createQuoteDraft, PRODUCT_QUOTE_DEFAULTS } from "./quote";

const emptyQuote = createQuoteDraft(PRODUCT_QUOTE_DEFAULTS, "LOCAL-DATE-BOUNDARY", "2026-08-29T12:30:00.000Z");

const boundaryJob: PartnerJobView = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  clientReference: "DATE-BOUNDARY",
  submissionState: "DRAFT",
  customerName: "Fictional Boundary",
  customerMobile: "",
  customerEmail: "",
  siteAddress: { street: "", suburb: "", city: "", postcode: "" },
  leadSources: [],
  notes: "",
  revision: 0,
  trackingFacts: [],
  quote: emptyQuote,
  quoteCalculation: calculateQuote(emptyQuote),
  createdAt: "2026-08-29T12:30:00.000Z",
  updatedAt: "2026-08-29T12:30:00.000Z",
};

const originalTimezone = process.env.TZ;

afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("partner-facing Auckland dates", () => {
  it("uses the Auckland calendar date at a UTC day boundary and hydrates without changing markup", async () => {
    expect(formatPartnerDate(boundaryJob.updatedAt)).toBe("30 Aug 2026");

    process.env.TZ = "UTC";
    const serverMarkup = renderToString(<PartnerDashboard jobs={[boundaryJob]} companyName="Northwind Insulation" />);
    expect(serverMarkup).toContain("30 Aug 2026");
    expect(serverMarkup).not.toContain("29 Aug 2026");

    const container = document.createElement("div");
    container.innerHTML = serverMarkup;
    expect(container.textContent).toContain("Updated 30 Aug 2026");
    const normalizedServerMarkup = container.innerHTML;
    document.body.append(container);
    process.env.TZ = "America/Los_Angeles";
    const hydrationErrors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(container, <PartnerDashboard jobs={[boundaryJob]} companyName="Northwind Insulation" />);
    });

    expect(container.innerHTML).toBe(normalizedServerMarkup);
    expect(container.textContent).toContain("Updated 30 Aug 2026");
    expect(hydrationErrors).not.toHaveBeenCalled();
    await act(async () => root?.unmount());
  });
});
