import { describe, expect, it } from "vitest";
import { PartnerJobLinkRepository } from "./job-link-repository";
import type { PartnerSql } from "./db";
import type { JobLinkTarget } from "./job-link";

const target: JobLinkTarget = {
  id: "6a979ecce193712a011df66d", jobNumber: 28859, customerName: "Test customer",
  address: { street: "1 Test Street", suburb: "", city: "Wellington", postcode: "6012" },
  status: { ebaCompleted: true, installDate: "2026-09-10", jobCompleted: false, checkedAt: "2026-09-05T00:00:00Z" },
};

// The existing PostgreSQL link functions require this four-field contract,
// even though the public portal no longer observes invoice status.
function databaseContract(): PartnerSql {
  return {
    async query(_query, values) {
      const payload = values?.find(value => typeof value === "string" && value.startsWith("{"));
      const status = JSON.parse(String(payload));
      if (Object.keys(status).sort().join() !== "ebaCompleted,installDate,invoiceRecorded,jobCompleted" || status.invoiceRecorded !== null) {
        throw new Error("LINK_INVALID");
      }
      return { rows: [{ result: true }] as never, rowCount: 1 };
    },
  };
}

describe("partner status database compatibility", () => {
  it("refreshes EBA and install date without claiming an invoice status", async () => {
    const repository = new PartnerJobLinkRepository(databaseContract());
    await expect(repository.refresh(target)).resolves.toBe(true);
  });
  it("links an existing job with the current public status fields", async () => {
    const repository = new PartnerJobLinkRepository(databaseContract());
    await expect(repository.commit("company", "job", 1, target)).resolves.toBe(true);
  });
  it("links an investigated submission with the current public status fields", async () => {
    const repository = new PartnerJobLinkRepository(databaseContract());
    await expect(repository.commitInvestigated("company", "job", 1, target)).resolves.toBe(true);
  });
});
