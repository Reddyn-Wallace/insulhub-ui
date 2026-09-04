import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { legacyTransport, type LegacyTransportConfig } from "./graphql-transport";

const config = (fetchImpl: typeof fetch): LegacyTransportConfig => ({ graphqlEndpoint: "https://legacy.test/graphql", accessToken: "secret-token-never-return", allowedOrigins: ["https://legacy.test"], timeoutMs: 100, fetchImpl, graphqlAuthPolicy: "UNAPPROVED_BEARER_SCAFFOLD" });
const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json", ...(init.headers ?? {}) }, ...init });

describe("bounded legacy transport", () => {
  it.each([302, 307, 400, 500])("classifies post-send HTTP %s as ambiguous and never follows redirects", async (status) => {
    const fetchImpl = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) => { void _input; void _init; return new Response("", { status, headers: { location: "https://evil.test/steal" } }); });
    const result = await legacyTransport(config(fetchImpl as typeof fetch), { kind: "GRAPHQL", query: "mutation X{doThing}", variables: {} });
    expect(result.kind).toBe("AMBIGUOUS"); expect(fetchImpl).toHaveBeenCalledTimes(1); expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });

  it("keeps the abort active through a hanging streamed response body", async () => {
    const fetchImpl = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => new Response(new ReadableStream({ start(controller) { init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted"))); } }), { headers: { "content-type": "application/json" } }));
    const result = await legacyTransport(config(fetchImpl as typeof fetch), { kind: "GRAPHQL", query: "mutation X{doThing}", variables: {} });
    expect(result.kind).toBe("AMBIGUOUS");
  });

  it("rejects bad upload bytes before fetch and verifies exact upload headers", async () => {
    const bytes = Buffer.from("%PDF-1.7\ntransport"); const sha = createHash("sha256").update(bytes).digest("hex");
    const fetchImpl = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) => { void _input; void _init; return json({ storageKey: "safe/file.pdf", fileName: "safe.pdf", contentSha256: sha, byteSize: bytes.length }); });
    expect((await legacyTransport(config(fetchImpl as typeof fetch), { kind: "UPLOAD", fileName: "safe.pdf", idempotencyKey: "company:request:0", contentSha256: "0".repeat(64), bytes, headerPolicy: "UNAPPROVED_RAW_PDF_SCAFFOLD" })).kind).toBe("DEFINITE_FAILURE");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await legacyTransport(config(fetchImpl as typeof fetch), { kind: "UPLOAD", fileName: "safe.pdf", idempotencyKey: "company:request:0", contentSha256: sha, bytes, headerPolicy: "UNAPPROVED_RAW_PDF_SCAFFOLD" })).kind).toBe("CONFIRMED");
    expect(fetchImpl.mock.calls[0][0].toString()).toBe("https://legacy.test/files/upload");
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ "content-type": "application/pdf", "x-content-sha256": sha, "x-file-name": "safe.pdf" });
    const sent = fetchImpl.mock.calls[0]; const headers = sent[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret-token-never-return");
    expect(JSON.stringify({ url: sent[0].toString(), body: String(sent[1]?.body), headers: { ...headers, authorization: "[bound-only]" } })).not.toContain("secret-token-never-return");
  });

  it("rejects JSONP, oversized and partial GraphQL responses without exposing token or provider text", async () => {
    const responses = [
      new Response("{}", { headers: { "content-type": "application/jsonp" } }),
      new Response("{}", { headers: { "content-type": "application/json", "content-length": String(600 * 1024) } }),
      json({ data: { changed: true }, errors: [{ message: "Hine secret-token-never-return" }] }),
      json({ data: { changed: true }, errors: { message: "Hine secret-token-never-return" } }),
      new Response(Uint8Array.from([0x7b, 0x22, 0x64, 0x61, 0x74, 0x61, 0x22, 0x3a, 0xff, 0x7d]), { headers: { "content-type": "application/json" } }),
    ];
    for (const response of responses) {
      const result = await legacyTransport(config(vi.fn(async () => response) as typeof fetch), { kind: "GRAPHQL", query: "mutation X{doThing}", variables: {} });
      expect(result.kind).toBe("AMBIGUOUS"); expect(JSON.stringify(result)).not.toMatch(/Hine|secret-token|provider/i);
    }
  });

  it("fails closed before fetch for an unapproved origin", async () => {
    const fetchImpl = vi.fn(async () => json({ data: {} }));
    const result = await legacyTransport({ ...config(fetchImpl as typeof fetch), allowedOrigins: ["https://other.test"] }, { kind: "GRAPHQL", query: "query X{x}", variables: {} });
    expect(result.kind).toBe("DEFINITE_FAILURE"); expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects unserializable bodies and control-bearing tokens before fetch", async () => {
    const fetchImpl = vi.fn(async () => json({ data: {} }));
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect((await legacyTransport(config(fetchImpl as typeof fetch), { kind: "GRAPHQL", query: "query X{x}", variables: circular })).kind).toBe("DEFINITE_FAILURE");
    expect((await legacyTransport({ ...config(fetchImpl as typeof fetch), accessToken: "secret\nheader" }, { kind: "GRAPHQL", query: "query X{x}", variables: {} })).kind).toBe("DEFINITE_FAILURE");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
