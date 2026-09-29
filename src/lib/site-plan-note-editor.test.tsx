// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DrawSitePlanPage from "@/app/jobs/[id]/site-plan-draw/page";
import { EMPTY_SITE_PLAN_DOCUMENT, parseSitePlanDocument, type SitePlanDrawingDocument } from "./site-plan-drawings";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "job-1", drawingId: "drawing-1" }), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/graphql", () => ({ gql: async () => ({ job: { _id: "job-1", quote: { files_QuoteSitePlan: [] } } }) }));
let saved: SitePlanDrawingDocument | undefined;
let document: SitePlanDrawingDocument;
beforeEach(() => {
  document = { ...EMPTY_SITE_PLAN_DOCUMENT, textNotes: [{ id: "note", text: "Access", x: 8, y: 8, fontSize: 0.82, boxWidth: 4, boxHeight: 2 }] };
  saved = undefined;
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), clear: () => storage.clear() });
  vi.stubGlobal("React", React);
  localStorage.setItem("token", "test-token");
  vi.stubGlobal("ResizeObserver", class { constructor(private cb: ResizeObserverCallback) {} observe() { this.cb([{ contentRect: { width: 916, height: 866 } }] as ResizeObserverEntry[], this as unknown as ResizeObserver); } disconnect() {} });
  vi.stubGlobal("PointerEvent", class extends MouseEvent { pointerId = 1; pointerType = "mouse"; });
  Object.defineProperty(SVGElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
  Object.defineProperty(SVGElement.prototype, "releasePointerCapture", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ measureText: (text: string) => ({ width: text.length * 20 }) } as never);
  vi.stubGlobal("fetch", async (_url: string, options?: RequestInit) => {
    if (options?.method === "PATCH") {
      const input = JSON.parse(options.body as string);
      saved = parseSitePlanDocument(input.document, { noteTransforms: true }) ?? undefined;
      if (!saved) return { ok: false, json: async () => ({ error: "Invalid drawing document" }) };
      document = saved;
    }
    return { ok: true, json: async () => ({ drawing: { id: "drawing-1", name: "Ground floor", revision: 2, document, lastPdfFileName: null } }) };
  });
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function open() {
  render(<DrawSitePlanPage />);
  await screen.findByDisplayValue("Ground floor");
  const svg = screen.getByText("Access").closest("svg")!;
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 850, width: 900, height: 850, toJSON: () => ({}) });
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  pointer(svg, "pointerDown", 8, 8);
  pointer(svg, "pointerUp", 8, 8);
  return svg;
}
function pointer(target: Element, event: "pointerDown" | "pointerMove" | "pointerUp" | "pointerCancel", x: number, y: number) {
  fireEvent[event](target, { clientX: x * 50, clientY: y * 50, bubbles: true });
}
it("scales the text and box together, saves, reopens, and undoes the whole resize", async () => {
  const svg = await open();
  pointer(screen.getByRole("button", { name: "Resize note" }), "pointerDown", 10, 8.56);
  pointer(svg, "pointerMove", 12, 9.12);
  pointer(svg, "pointerUp", 12, 9.12);
  expect(Number(screen.getByText("Access").closest("text")!.getAttribute("font-size"))).toBeCloseTo(1.64);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saved?.textNotes[0].fontSize).toBeCloseTo(1.64));
  expect(saved?.textNotes[0].boxWidth).toBeCloseTo(8);
  expect(saved?.textNotes[0].boxHeight).toBeCloseTo(4);
  fireEvent.click(screen.getByTitle("Undo"));
  expect(Number(screen.getByText("Access").closest("text")!.getAttribute("font-size"))).toBeCloseTo(0.82);
  cleanup();
  await open();
  expect(Number(screen.getByText("Access").closest("text")!.getAttribute("font-size"))).toBeCloseTo(1.64);
});
it("rotates a note, keeps it selectable at its rotated position and saves the angle", async () => {
  const svg = await open();
  pointer(screen.getByRole("button", { name: "Rotate note" }), "pointerDown", 8, 5.76);
  pointer(svg, "pointerMove", 9.8, 7.56);
  pointer(svg, "pointerUp", 9.8, 7.56);
  expect(screen.getByText("Access").closest("g")!.getAttribute("transform")).toBe("rotate(90 8 7.56)");
  pointer(svg, "pointerDown", 2, 2); pointer(svg, "pointerUp", 2, 2);
  pointer(svg, "pointerDown", 8, 9.4); pointer(svg, "pointerUp", 8, 9.4);
  expect(screen.getByRole("button", { name: "Rotate note" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saved?.textNotes[0].rotation).toBe(90));
});

it("shrinks a rotated note proportionally and restores it when a drag is cancelled", async () => {
  document.textNotes[0].rotation = 90;
  const svg = await open();
  pointer(screen.getByRole("button", { name: "Resize note" }), "pointerDown", 7, 9.56);
  pointer(svg, "pointerMove", 7.5, 8.78);
  pointer(svg, "pointerUp", 7.5, 8.78);
  expect(Number(screen.getByText("Access").closest("text")!.getAttribute("font-size"))).toBeCloseTo(0.41);
  pointer(screen.getByRole("button", { name: "Resize note" }), "pointerDown", 7.5, 8.78);
  pointer(svg, "pointerMove", 7, 9.56);
  pointer(svg, "pointerCancel", 7, 9.56);
  expect(Number(screen.getByText("Access").closest("text")!.getAttribute("font-size"))).toBeCloseTo(0.41);
  fireEvent.click(screen.getByTitle("Undo"));
  expect(Number(screen.getByText("Access").closest("text")!.getAttribute("font-size"))).toBeCloseTo(0.82);
});
it("supports keyboard adjustment and retains rotation while moving and editing", async () => {
  const svg = await open();
  fireEvent.keyDown(screen.getByRole("button", { name: "Rotate note" }), { key: "ArrowRight" });
  fireEvent.keyDown(screen.getByRole("button", { name: "Resize note" }), { key: "ArrowUp" });
  pointer(svg, "pointerDown", 8, 8); pointer(svg, "pointerMove", 9, 9); pointer(svg, "pointerUp", 9, 9);
  expect(screen.getByText("Access").closest("g")!.getAttribute("transform")).toBe("rotate(5 9 8.516)");
  const editButtons = screen.getAllByRole("button", { name: "Edit" });
  fireEvent.click(editButtons[0]);
  const text = screen.getByRole("textbox", { name: "Note text" });
  fireEvent.change(text, { target: { value: "Access hatch" } });
  fireEvent.blur(text);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saved?.textNotes[0]).toMatchObject({ rotation: 5, x: 9, y: 9, text: "Access hatch" }));
  expect(saved?.textNotes[0].fontSize).toBeCloseTo(0.902);
});

it.each([45, 90, 180, 270])("keeps the box centre fixed when rotated to %s degrees", async (angle) => {
  const svg = await open();
  pointer(screen.getByRole("button", { name: "Rotate note" }), "pointerDown", 8, 5.76);
  const radians = angle * Math.PI / 180;
  pointer(svg, "pointerMove", 8 + 1.8 * Math.sin(radians), 7.56 - 1.8 * Math.cos(radians));
  pointer(svg, "pointerUp", 8 + 1.8 * Math.sin(radians), 7.56 - 1.8 * Math.cos(radians));
  const transform = screen.getByText("Access").closest("g")!.getAttribute("transform")!;
  const values = transform.match(/-?[\d.]+/g)!.map(Number);
  expect(values[0]).toBeCloseTo(angle);
  expect(values[1]).toBeCloseTo(8);
  expect(values[2]).toBeCloseTo(7.56);
});
