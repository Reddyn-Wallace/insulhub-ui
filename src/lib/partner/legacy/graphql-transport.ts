import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { ambiguous, definiteFailure, type LegacyCallContext, type LegacyOutcome } from "./types";

const GRAPHQL_REQUEST_MAX = 256 * 1024;
const RESPONSE_MAX = 512 * 1024;
const PDF_MAX = 5 * 1024 * 1024;
const TIMEOUT_MAX_MS = 30_000;

export interface LegacyTransportConfig {
  graphqlEndpoint: string;
  accessToken: string;
  allowedOrigins: readonly string[];
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  graphqlAuthPolicy: "UNAPPROVED_BEARER_SCAFFOLD";
}

export type LegacyTransportRequest =
  | { kind: "GRAPHQL"; query: string; variables: Readonly<Record<string, unknown>> }
  | { kind: "UPLOAD"; fileName: string; idempotencyKey: string; contentSha256: string; bytes: Uint8Array; headerPolicy: "UNAPPROVED_RAW_PDF_SCAFFOLD" };

function endpoints(raw: string): { graphql: URL; upload: URL } | null {
  try {
    const graphql = new URL(raw);
    if (graphql.protocol !== "https:" || graphql.username || graphql.password || graphql.pathname !== "/graphql" || graphql.search || graphql.hash) return null;
    return { graphql, upload: new URL("/files/upload", graphql.origin) };
  } catch { return null; }
}

async function boundedBody(response: Response): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > RESPONSE_MAX) return null;
  if (!response.body) {
    const body = new Uint8Array(await response.arrayBuffer());
    return body.byteLength <= RESPONSE_MAX ? body : null;
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > RESPONSE_MAX) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const output = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

export async function legacyTransport<T>(config: LegacyTransportConfig, request: LegacyTransportRequest, context?: LegacyCallContext): Promise<LegacyOutcome<T>> {
  const target = endpoints(config.graphqlEndpoint);
  const timeoutMs = config.timeoutMs ?? 15_000;
  let allowedOrigins: Set<string>;
  try { allowedOrigins = new Set(config.allowedOrigins.map((value) => new URL(value).origin)); } catch { return definiteFailure("LEGACY_INVALID_INPUT"); }
  if (!target || !allowedOrigins.has(target.graphql.origin) || config.graphqlAuthPolicy !== "UNAPPROVED_BEARER_SCAFFOLD" || !config.accessToken || config.accessToken.length > 8_192 || /[\u0000-\u001f\u007f-\u009f]/u.test(config.accessToken) || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > TIMEOUT_MAX_MS) return definiteFailure("LEGACY_INVALID_INPUT");
  let url: URL; let body: BodyInit; let headers: Record<string, string>;
  if (request.kind === "GRAPHQL") {
    let encoded = ""; try { encoded = JSON.stringify({ query: request.query, variables: request.variables }); } catch { return definiteFailure("LEGACY_INVALID_INPUT"); }
    if (!request.query || Buffer.byteLength(encoded, "utf8") > GRAPHQL_REQUEST_MAX) return definiteFailure("LEGACY_INVALID_INPUT");
    url = target.graphql; body = encoded; headers = { authorization: `Bearer ${config.accessToken}`, "content-type": "application/json", accept: "application/json" };
  } else {
    if (request.headerPolicy !== "UNAPPROVED_RAW_PDF_SCAFFOLD" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(request.fileName)
      || !/^[0-9a-f]{64}$/.test(request.contentSha256) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(request.idempotencyKey)
      || request.bytes.byteLength < 1 || request.bytes.byteLength > PDF_MAX || !Buffer.from(request.bytes).subarray(0, 5).equals(Buffer.from("%PDF-"))) return definiteFailure("LEGACY_INVALID_INPUT");
    const actual = createHash("sha256").update(request.bytes).digest(); const expected = Buffer.from(request.contentSha256, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(actual, expected)) return definiteFailure("LEGACY_UPLOAD_INTEGRITY");
    url = target.upload; body = Buffer.from(request.bytes); headers = {
      authorization: `Bearer ${config.accessToken}`, "content-type": "application/pdf", accept: "application/json",
      "x-file-name": request.fileName, "x-idempotency-key": request.idempotencyKey, "x-content-sha256": request.contentSha256,
    };
  }
  const remaining = context?.remainingMs() ?? timeoutMs;
  if (context && (context.signal.aborted || !Number.isFinite(remaining) || remaining <= 0)) return definiteFailure("LEGACY_REMOTE_NO_EFFECT");
  const effectiveTimeout = Math.max(1, Math.min(timeoutMs, remaining));
  const controller = new AbortController(); const abort = () => controller.abort(); context?.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, effectiveTimeout);
  try {
    const response = await (config.fetchImpl ?? fetch)(url, { method: "POST", headers, body, redirect: "error", signal: controller.signal });
    if (response.status >= 300 && response.status < 400) return ambiguous();
    if (response.status >= 400) return ambiguous();
    const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (mediaType !== "application/json") return ambiguous();
    const bytes = await boundedBody(response);
    if (!bytes) return ambiguous();
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return ambiguous(); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return ambiguous();
    const envelope = parsed as { data?: unknown; errors?: unknown };
    if (Object.hasOwn(envelope, "errors") && (!Array.isArray(envelope.errors) || envelope.errors.length > 0)) return ambiguous();
    if (request.kind === "GRAPHQL") return envelope.data === undefined ? ambiguous() : { kind: "CONFIRMED", value: envelope.data as T };
    return { kind: "CONFIRMED", value: parsed as T };
  } catch { return ambiguous(); } finally { clearTimeout(timer); context?.signal.removeEventListener("abort", abort); }
}
