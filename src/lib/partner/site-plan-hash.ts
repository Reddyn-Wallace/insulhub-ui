import { createHash } from "node:crypto";
import type { SitePlanDrawingDocument } from "../site-plan-drawings";

export const PARTNER_SITE_PLAN_RENDERER_VERSION = "partner-site-plan-renderer-v2";
export const PARTNER_SITE_PLAN_TEMPLATE_SHA256 = "b82dc68276806628e2574a6a51a6299d1a23df56f4ba8a5a4a06226d3ebd904b";
export const PARTNER_SITE_PLAN_FONT_SHA256 = "478c558ea716033cd60c03438f628dfa75694dcf6b5f6d505a2f05fd2b4f3823";

export type SitePlanRenderInput = {
  drawingName: string;
  siteAddress: { street: string | null; suburb: string | null; city: string | null; postcode: string | null };
  document: SitePlanDrawingDocument;
  templateVersion: "site-plan-template-v2";
  templateSha256: string;
  fontSha256: string;
  rendererVersion: string;
};

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Render input contains a non-finite number");
  if (Object.is(value, -0) || value === 0) return "0";
  return value.toString().replace(/e\+/, "e");
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key.normalize("NFC"))}:${canonicalJson(record[key] === undefined ? null : record[key])}`).join(",")}}`;
  }
  throw new Error("Render input contains an unsupported value");
}

export function normalizeSitePlanRenderInput(input: {
  drawingName: string;
  siteAddress?: Partial<SitePlanRenderInput["siteAddress"]> | null;
  document: SitePlanDrawingDocument;
}): SitePlanRenderInput {
  const address = input.siteAddress ?? {};
  const text = (value: unknown) => {
    if (typeof value !== "string") return null;
    const normalized = value.replace(/\r\n?/g, "\n").normalize("NFC");
    if (/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(normalized)) throw new Error("Render text contains unsupported control characters");
    return normalized.replace(/\n+/g, " ").trim();
  };
  return {
    drawingName: text(input.drawingName) ?? "",
    siteAddress: { street: text(address.street), suburb: text(address.suburb), city: text(address.city), postcode: text(address.postcode) },
    document: input.document,
    templateVersion: "site-plan-template-v2",
    templateSha256: PARTNER_SITE_PLAN_TEMPLATE_SHA256,
    fontSha256: PARTNER_SITE_PLAN_FONT_SHA256,
    rendererVersion: PARTNER_SITE_PLAN_RENDERER_VERSION,
  };
}

export function sitePlanRenderHash(input: SitePlanRenderInput): string {
  return createHash("sha256").update(canonicalJson(input), "utf8").digest("hex");
}

export function sitePlanAddressLine(address: SitePlanRenderInput["siteAddress"]): string {
  return [address.street, address.suburb, address.city, address.postcode].map((part) => part?.trim()).filter(Boolean).join(", ").normalize("NFC");
}
