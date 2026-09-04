import { describe, expect, it } from "vitest";
import { neutralPartnerTracking } from "./neutral-tracking";

describe("neutral partner tracking boundary", () => {
  it("exposes only workflow milestones and plain amendments", () => {
    const tracking = neutralPartnerTracking({
      id: "job", clientReference: "ABC-1",
      milestones: {
        EBA_COMPLETED: { recordedAt: "2026-09-01T00:00:00Z", effectiveAt: "2026-09-01T00:00:00Z" },
        INSTALL_DATE_SET: { recordedAt: "2026-09-02T00:00:00Z", installDate: "2026-09-10" },
        JOB_COMPLETED: { recordedAt: "2026-09-11T00:00:00Z" },
        INVOICE_SENT: { recordedAt: "2026-09-12T00:00:00Z" },
        COMMISSION_PAID: { recordedAt: "2026-09-13T00:00:00Z" },
        CANCELLED: { recordedAt: "2026-09-14T00:00:00Z" },
      },
      amendments: [{ sequence: 1, description: "  Install moved to Friday  ", contractDeltaCents: 5000, createdAt: "2026-09-03T00:00:00Z" }],
      billingModel: "INSULHUB_BILLED", invoice: { reference: "SECRET" }, settlement: { commissionCents: 5000 },
    });
    expect(tracking).toEqual({
      id: "job", clientReference: "ABC-1",
      milestones: {
        EBA_COMPLETED: { recordedAt: "2026-09-01T00:00:00.000Z", effectiveAt: "2026-09-01T00:00:00.000Z" },
        INSTALL_DATE_SET: { recordedAt: "2026-09-02T00:00:00.000Z", installDate: "2026-09-10" },
        JOB_COMPLETED: { recordedAt: "2026-09-11T00:00:00.000Z" },
      },
      amendments: [{ sequence: 1, description: "Install moved to Friday", createdAt: "2026-09-03T00:00:00.000Z" }],
    });
    expect(JSON.stringify(tracking)).not.toMatch(/billing|invoice|commission|settlement|cancel/i);
  });
});
