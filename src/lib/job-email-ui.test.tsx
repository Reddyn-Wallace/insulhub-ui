// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import JobEmailComposer from "@/components/JobEmailComposer";
const props = { jobId: "job", email: "customer@example.com", contactName: "Customer", templates: [{ id: "template", title: "Booking", subject: "Booking details", body: "Hello Customer" }], onRecorded: vi.fn() };
const initial = { enabled: true, senders: [{ id: "sender", label: "Staff", senderValue: "staff@example.com", signatureHtml: "<b>Staff signature</b>" }], message: null };
beforeEach(() => { vi.stubGlobal("localStorage", { getItem: () => "test" }); sessionStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open() { render(<JobEmailComposer {...props} />); fireEvent.click(await screen.findByRole("button", { name: "Send email from CRM" })); }
it("sends edited subject and body once and closes on confirmation", async () => {
  let posts = 0; let sent: Record<string, unknown> = {};
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (init?.method !== "POST") return Response.json(initial);
    posts++; sent = JSON.parse(String(init.body)); return Response.json({ message: { ...sent, status: "sent" } });
  });
  await open(); fireEvent.change(screen.getByLabelText("Template"), { target: { value: "template" } });
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Edited booking" } });
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Exact edited message" } });
  expect(screen.queryByTitle("Email preview")).toBeNull();
  const send = screen.getByRole("button", { name: "Send email" }); fireEvent.click(send); fireEvent.click(send);
  await waitFor(() => expect(screen.queryByLabelText("Message")).toBeNull());
  expect(posts).toBe(1); expect(sent).toMatchObject({ subject: "Edited booking", body: "Exact edited message", destination: props.email, senderId: "sender" });
  expect(props.onRecorded).toHaveBeenCalledWith(expect.objectContaining({ status: "sent" }));
});
it("preserves an uncertain attempt across reloads without resending", async () => {
  sessionStorage.setItem("job-email-attempt:job", JSON.stringify({ id: "attempt", senderId: "sender", subject: "Original", body: "Original body", destination: props.email }));
  const fetcher = vi.fn(async () => Response.json({ ...initial, message: { id: "attempt", status: "unknown", subject: "Original", body: "Original body" } })); vi.stubGlobal("fetch", fetcher);
  await open(); expect(screen.getByLabelText("Message")).toHaveProperty("disabled", true);
  expect(screen.queryByRole("button", { name: "Send email" })).toBeNull();
  expect(fetcher.mock.calls.length).toBe(1);
});
it("keeps safe rejections editable", async () => {
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => init?.method === "POST" ? Response.json({ error: "Refresh contact", safeToEdit: true }, { status: 409 }) : Response.json(initial));
  await open(); fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Booking" } }); fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hi" } }); fireEvent.click(screen.getByRole("button", { name: "Send email" }));
  await screen.findByRole("alert"); expect(screen.getByLabelText("Message")).toHaveProperty("disabled", false);
  expect(sessionStorage.getItem("job-email-attempt:job")).toBeNull();
});

it("closes immediately during a delayed send and reopens only for a real failure", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => init?.method === "POST" ? new Promise<Response>(resolve => { finish = resolve; }) : Response.json(initial));
  await open(); fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Booking" } }); fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hi" } });
  fireEvent.click(screen.getByRole("button", { name: "Send email" }));
  expect(screen.queryByLabelText("Message")).toBeNull();
  expect(props.onRecorded).toHaveBeenCalledWith(expect.objectContaining({ status: "sending", body: "Hi" }));
  await act(async () => finish(Response.json({ message: { id: "attempt", status: "failed", failureReason: "Account disconnected" } })));
  expect(await screen.findByText("Account disconnected")).toBeTruthy();
});
it("hides CRM email when disabled, even with a saved attempt", async () => {
  sessionStorage.setItem("job-email-attempt:job", JSON.stringify({ id: "attempt", subject: "Original", body: "Original" }));
  vi.stubGlobal("fetch", async () => Response.json({ ...initial, enabled: false }));
  await act(async () => { render(<JobEmailComposer {...props} />); });
  expect(screen.queryByRole("button", { name: "Send email from CRM" })).toBeNull();
});
