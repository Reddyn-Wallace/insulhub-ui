import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { EMPTY_SITE_PLAN_DOCUMENT } from "../site-plan-drawings";
import { canonicalJson, normalizeSitePlanRenderInput, PARTNER_SITE_PLAN_FONT_SHA256, PARTNER_SITE_PLAN_TEMPLATE_SHA256, sitePlanRenderHash } from "./site-plan-hash";
import { sitePlanReadiness } from "./site-plan-readiness";
import { renderPartnerSitePlanPdf } from "./site-plan-renderer";
import { createHash } from "node:crypto";

const wall = { id: "wall-1", start: { x: 1, y: 1 }, end: { x: 8, y: 1 }, style: "solid" as const, color: "teal" as const };
function input() { return normalizeSitePlanRenderInput({ drawingName: "Papa Runga", siteAddress: { street: "18 Kauri Grove", suburb: "Ōtūmoetai", city: "Tauranga", postcode: "3110" }, document: { ...EMPTY_SITE_PLAN_DOCUMENT, walls: [wall], textNotes: [{ id: "note-1", text: "Kia ora\nRārangi tuarua", x: 4, y: 5, fontSize: 0.82, boxWidth: 4, boxHeight: 1.2 }] } }); }

describe("partner site plan render identity", () => {
  it("uses stable sorted canonical JSON with NFC, explicit nulls, finite numbers and no negative zero", () => {
    expect(canonicalJson({ z: -0, a: "Ma\u0304ori", n: null })).toBe('{"a":"Māori","n":null,"z":0}');
    expect(() => canonicalJson({ bad: Number.NaN })).toThrow("non-finite");
    expect(sitePlanRenderHash(input())).toMatch(/^[0-9a-f]{64}$/);
    expect(sitePlanRenderHash(input())).toBe(sitePlanRenderHash(structuredClone(input())));
  });

  it("pins the locked template and bundled font assets", () => {
    expect(createHash("sha256").update(readFileSync(resolve("public/site-plan-template-v2.pdf"))).digest("hex")).toBe(PARTNER_SITE_PLAN_TEMPLATE_SHA256);
    const font=readFileSync(resolve("public/fonts/NotoSans-Regular.ttf"));
    expect(createHash("sha256").update(font).digest("hex")).toBe(PARTNER_SITE_PLAN_FONT_SHA256);
    const tableCount=font.readUInt16BE(4);const tags=Array.from({length:tableCount},(_,index)=>font.toString("ascii",12+index*16,16+index*16));expect(tags).not.toContain("fvar");
  });
});

describe("server site plan renderer", () => {
  it("renders one bounded Unicode page deterministically", async () => {
    const first = await renderPartnerSitePlanPdf(input()); const second = await renderPartnerSitePlanPdf(input());
    expect(first.bytes.equals(second.bytes)).toBe(true); expect(first.contentSha256).toBe(second.contentSha256);
    const pdf = await PDFDocument.load(first.bytes); expect(pdf.getPageCount()).toBe(1); expect(first.bytes.byteLength).toBeLessThanOrEqual(5 * 1024 * 1024);
  }, 30_000);

  it("fails safely for unsupported glyphs and overflowing note boxes", async () => {
    const unsupported = input(); unsupported.document.textNotes[0].text = "emoji 😀";
    await expect(renderPartnerSitePlanPdf(unsupported)).rejects.toThrow("glyph");
    const overflow = input(); overflow.document.textNotes[0] = { ...overflow.document.textNotes[0], text: "one two three four five six seven eight nine ten", boxWidth: 0.8, boxHeight: 0.8 };
    await expect(renderPartnerSitePlanPdf(overflow)).rejects.toThrow("does not fit");
  }, 30_000);
});

describe("site plan readiness", () => {
  it("requires every persisted floor to have a wall and current hash/revision artifact", () => {
    const hash=sitePlanRenderHash(input()); const ready={name:"Ground",revision:2,document:{...EMPTY_SITE_PLAN_DOCUMENT,walls:[wall]},expectedRenderHash:hash,currentArtifact:{drawingRevision:2,renderHash:hash}};
    expect(sitePlanReadiness([ready]).ready).toBe(true);
    expect(sitePlanReadiness([]).ready).toBe(false);
    expect(sitePlanReadiness([ready,{...ready,name:"Extra",document:EMPTY_SITE_PLAN_DOCUMENT}]).ready).toBe(false);
    expect(sitePlanReadiness([{...ready,currentArtifact:{drawingRevision:1,renderHash:hash}}]).ready).toBe(false);
  });
});
