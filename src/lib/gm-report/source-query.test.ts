import { afterEach, expect, it, vi } from "vitest";
import { sourceQuery } from "./access";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("does not tolerate a hidden authentication error after five missing-date errors", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const dateError = {
    message: "Cannot return null for non-nullable field JobSchema.acceptedAt",
    path: ["job", "acceptedAt"],
    extensions: { code: "INTERNAL_SERVER_ERROR" },
  };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({
          data: null,
          errors: [
            ...Array.from({ length: 5 }, () => dateError),
            {
              message: "UNAUTHENTICATED",
              path: ["job"],
              extensions: { code: "UNAUTHENTICATED" },
            },
          ],
        }),
      ),
  );
  const failure = await sourceQuery(
    "secret",
    "query GMReportAcceptedAt {job{acceptedAt}}",
  ).catch((e) => e);
  expect(failure.isMissingAcceptanceDate).toBe(false);
});
it("identifies a failed job field without exposing upstream request secrets or partial data", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
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
    vi.fn().mockResolvedValue(
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
