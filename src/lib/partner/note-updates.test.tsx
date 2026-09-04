// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PartnerNoteComposer from "@/components/PartnerNoteComposer";
import PartnerUpdateTimeline from "@/components/PartnerUpdateTimeline";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("deliberate partner note sharing", () => {
  it("defaults to private notes and never posts internal text to the partner endpoint", async () => {
    const saved: string[] = []; const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    render(<PartnerNoteComposer partnerName="Test Partner" onInternalSave={async text => { saved.push(text); return true; }} onPartnerSave={async () => { throw Error("Must not share"); }} onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Internal details" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(saved).toEqual(["Internal details"]));
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires selecting partner sharing and retains the draft after a failed post", async () => {
    const shared: string[] = [];
    render(<PartnerNoteComposer partnerName="Test Partner" onInternalSave={async () => false} onPartnerSave={async text => { shared.push(text); throw Error("Try again later"); }} onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Share with partner" }));
    expect(screen.getByText("Visible to Test Partner")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Installer booked" } });
    fireEvent.click(screen.getByRole("button", { name: "Post update" }));
    await screen.findByRole("alert");
    expect(shared).toEqual(["Installer booked"]);
    expect((screen.getByLabelText("Note") as HTMLTextAreaElement).value).toBe("Installer booked");
  });
  it("does not offer sharing for an unlinked job", () => {
    render(<PartnerNoteComposer onInternalSave={async () => true} onPartnerSave={async () => {}} onDone={() => {}} />);
    expect(screen.queryByRole("button", { name: "Share with partner" })).toBeNull();
  });
});

it("shows attributed plain text updates and acknowledges only the displayed sequence", async () => {
  const requests: unknown[] = [];vi.stubGlobal("fetch",async (_url: string, init: RequestInit) => { requests.push(JSON.parse(String(init.body)));return new Response(JSON.stringify({ok:true}),{status:200}); });
  render(<PartnerUpdateTimeline jobId="job" feed={{updates:[{sequence:2,description:"<b>Install arranged</b>",authorName:"Reddyn Wallace",createdAt:"2026-09-05T00:00:00Z"}],latestSequence:2,readSequence:1}} />);
  expect(screen.getByText("<b>Install arranged</b>")).toBeTruthy();
  expect(screen.getByText(/Reddyn Wallace/)).toBeTruthy();
  await waitFor(()=>expect(requests).toEqual([{seenSequence:2}]));
});
