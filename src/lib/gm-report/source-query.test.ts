import { afterEach, expect, it, vi } from "vitest";
import { sourceQuery } from "./access";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("identifies a failed job field without exposing upstream request secrets or partial data", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({
          data: { jobs: { results: [] } },
          errors: [
            {
              message: "Float cannot represent non numeric value: NaN",
              path: ["jobs", "results", 12, "quote", "ceiling", "c_bagCount"],
              extensions: {
                code: "INTERNAL_SERVER_ERROR",
                exception: {
                  headers: { authorization: "secret-upstream-value" },
                },
              },
            },
          ],
        }),
      ),
  );
  await expect(
    sourceQuery(
      "secret-session-token",
      "query GMReportJobs { jobs { total } }",
    ),
  ).rejects.toMatchObject({ status: 503 });
  expect(log).toHaveBeenCalled();
  const recorded = JSON.stringify(log.mock.calls);
  expect(recorded).toContain("GMReportJobs");
  expect(recorded).toContain("c_bagCount");
  expect(recorded).toContain("non-numeric");
  expect(recorded).not.toContain("secret-");
});
it("records useful diagnostics for GraphQL errors returned with HTTP 400", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          {
            errors: [
              {
                message: "Unexpected error value: authorization Bearer PRIVATE",
                path: ["job", "acceptedAt"],
                extensions: { code: "INTERNAL_SERVER_ERROR" },
              },
            ],
          },
          { status: 400 },
        ),
      ),
  );
  await expect(
    sourceQuery(
      "secret",
      "query GMReportAcceptedAt($_id:ObjectId!){job(_id:$_id){acceptedAt}}",
      { _id: "private-job" },
    ),
  ).rejects.toThrow();
  const recorded = JSON.stringify(log.mock.calls);
  expect(recorded).toContain("acceptedAt");
  expect(recorded).not.toContain("PRIVATE");
  expect(recorded).not.toContain("private-job");
});
