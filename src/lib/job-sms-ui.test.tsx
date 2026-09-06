// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import JobSmsComposer from "@/components/JobSmsComposer";
const senderId = "22222222-2222-4222-8222-222222222222";
const props = { jobId: "job", phone: "0211234567", contactName: "Customer", templates: [{ id: "template", title: "Booking", body: "Hello Customer" }], onRecorded: vi.fn() };
const initial = { enabled: true, senders: [{ id: senderId, label: "Business" }], message: null };
beforeEach(() => { vi.stubGlobal("localStorage", { getItem: () => "test" }); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open() { render(<JobSmsComposer {...props} />); fireEvent.click(await screen.findByRole("button", { name: "Send SMS from CRM" })); }
describe("job SMS composer", () => {
  it("edits a template and preserves the exact request while preventing repeat clicks", async () => {
    let posts = 0; let sent: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      if (init?.method !== "POST") return Response.json(initial);
      posts++; sent = JSON.parse(init.body);
      return Response.json({ message: { ...sent, senderLabel: "Business", actorName: "Staff", status: "accepted" } });
    }));
    await open(); fireEvent.change(screen.getByLabelText("Template"), { target: { value: "template" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello Customer, edited" } });
    const send = screen.getByRole("button", { name: "Send SMS" }); fireEvent.click(send); fireEvent.click(send);
    await waitFor(() => expect(screen.queryByLabelText("Message")).toBeNull()); expect(posts).toBe(1); expect(sent.body).toBe("Hello Customer, edited");
  });
  it("unlocks a safe preclaim rejection so a contact correction can be made", async () => {
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => init?.method === "POST" ? Response.json({ error: "Refresh the job", safeToEdit: true }, { status: 409 }) : Response.json(initial));
    await open(); fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hi" } }); fireEvent.click(screen.getByRole("button", { name: "Send SMS" }));
    await screen.findByRole("alert"); expect(screen.getByLabelText("Message")).toHaveProperty("disabled", false); expect(sessionStorage.getItem("job-sms-attempt:job")).toBeNull();
  });
  it("keeps uncertain attempts locked after remount and waits for automatic status updates", async () => {
    sessionStorage.setItem("job-sms-attempt:job", JSON.stringify({ id: "attempt", senderId, body: "Original", destination: "0211234567", templateTitle: "" }));
    vi.stubGlobal("fetch", async () => Response.json({ ...initial, message: { id: "attempt", status: "unknown" } }));
    await open(); expect(screen.getByLabelText("Message")).toHaveProperty("value", "Original"); expect(screen.getByLabelText("Message")).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "Check message status" })).toBeNull(); expect(screen.queryByRole("button", { name: "Compose another message" })).toBeNull();
  });
  it("does not expose new sending when disabled", async () => {
    const fetcher = vi.fn(async () => Response.json({ ...initial, enabled: false })); vi.stubGlobal("fetch", fetcher);
    render(<JobSmsComposer {...props} />); await waitFor(() => expect(fetcher).toHaveBeenCalled()); expect(screen.queryByRole("button")).toBeNull();
  });
});

it("closes SMS immediately while delivery is still pending", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => init?.method === "POST" ? new Promise<Response>(resolve => { finish = resolve; }) : Response.json(initial));
  await open(); fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hi" } });
  fireEvent.click(screen.getByRole("button", { name: "Send SMS" }));
  expect(screen.queryByLabelText("Message")).toBeNull();
  expect(props.onRecorded).toHaveBeenCalledWith(expect.objectContaining({ status: "sending", body: "Hi" }));
  await act(async () => finish(Response.json({ message: { id: "attempt", status: "accepted" } })));
  expect(screen.queryByLabelText("Message")).toBeNull();
});
