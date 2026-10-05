import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gql } from "./graphql";

const mutation = "mutation CreateFinalInvoices { createFinalInvoices { _id } }";
const upstreamError = "Xero API request failed: Unauthorized";
let values: Map<string, string>;
let location: { href: string };
let requests: { query: string; token: string | null }[];
let replies: (() => Promise<Response>)[];
const json = (body: unknown, status = 200) => () => Promise.resolve(Response.json(body, { status }));

beforeEach(() => {
  values = new Map([["token", "current-session"], ["me", "current-user"]]);
  location = { href: "/jobs/alan" };
  requests = [];
  replies = [];
  vi.stubGlobal("window", { location });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    requests.push({ query: JSON.parse(String(init.body)).query, token: new Headers(init.headers).get("x-access-token") });
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected request");
    return reply();
  });
});
afterEach(() => vi.unstubAllGlobals());

function expectSessionKept() {
  expect(values.get("token")).toBe("current-session");
  expect(values.get("me")).toBe("current-user");
  expect(location.href).toBe("/jobs/alan");
}

describe("GraphQL authentication failures", () => {
  it.each([200, 401])("keeps a valid CRM session and surfaces the original invoice error (HTTP %s)", async (status) => {
    replies = [json({ errors: [{ message: upstreamError }] }, status), json({ data: { me: { _id: "user" } } })];
    await expect(gql(mutation)).rejects.toThrow(upstreamError);
    expectSessionKept();
    expect(requests).toHaveLength(2);
    expect(requests[1].query).toContain("me { _id }");
    expect(requests[1].token).toBe("current-session");
    expect(requests.filter(r => r.query === mutation)).toHaveLength(1);
  });

  it.each([
    json({ errors: [{ message: "Unauthenticated" }] }),
    json({}, 401),
  ])("logs out only when the independent identity check confirms an invalid session", async (check) => {
    replies = [json({ errors: [{ message: upstreamError }] }), check];
    await expect(gql(mutation)).rejects.toThrow("Unauthorized");
    expect(requests).toHaveLength(2);
    expect(values.has("token")).toBe(false);
    expect(values.has("me")).toBe(false);
    expect(location.href).toBe("/login");
  });

  it.each([
    json({}, 503),
    json({ errors: [{ message: "Database unavailable" }] }),
    json({ errors: [{ message: "Forbidden" }] }, 403),
    json({ data: { me: null } }),
    async () => { throw new Error("Network failure"); },
  ])("preserves the session and original error when identity verification is inconclusive", async (check) => {
    replies = [json({ errors: [{ message: upstreamError }] }), check];
    await expect(gql(mutation)).rejects.toThrow(upstreamError);
    expectSessionKept();
    expect(requests).toHaveLength(2);
  });

  it("does not clear a newer login when an old session check completes", async () => {
    replies = [json({ errors: [{ message: upstreamError }] }), async () => {
      values.set("token", "new-session");
      return Response.json({}, { status: 401 });
    }];
    await expect(gql(mutation)).rejects.toThrow(upstreamError);
    expect(values.get("token")).toBe("new-session");
    expect(location.href).toBe("/jobs/alan");
  });

  it("does not probe or retry non-authentication errors", async () => {
    replies = [json({ errors: [{ message: "Invoice already exists" }] })];
    await expect(gql(mutation)).rejects.toThrow("Invoice already exists");
    expectSessionKept();
    expect(requests).toHaveLength(1);
  });
});

it.each([
  ['Unexpected error value: "{\\"response\\":{\\"body\\":{\\"Title\\":\\"Unauthorized\\",\\"Detail\\":\\"TokenExpired: token expired\\"},\\"request\\":{\\"host\\":\\"api.xero.com\\",\\"authorization\\":\\"Bearer secret-fixture\\"}}}"', /Xero connection has expired/],
  ['Unexpected error value: {"request":{"authorization":"Bearer secret-fixture"}}', /server could not complete/],
])("does not display serialized backend credentials in an error", async (message, expected) => {
  replies = [json({ errors: [{ message }] }), json({ data: { me: { _id: "user" } } })];
  const error = await gql(mutation).catch(error => error);
  if (!(error instanceof Error)) throw new Error("Expected the request to fail");
  expect(error.message).toMatch(expected);
  expect(error.message).not.toContain("secret-fixture");
  expectSessionKept();
});
