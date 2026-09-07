// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import JobEmailComposer from "@/components/JobEmailComposer";
const props = { jobId: "job", email: "customer@example.com", contactName: "Customer", templates: [{ id: "template", title: "Booking", subject: "Booking details", body: "Hello Customer" }], onRecorded: vi.fn() };
const initial = { enabled: true, senders: [{ id: "sender", label: "Staff", senderValue: "staff@example.com", signatureHtml: "<b>Staff signature</b>" }], message: null };
beforeEach(() => { vi.stubGlobal("localStorage", { getItem: () => "test" }); sessionStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open() { render(<JobEmailComposer {...props} />); await waitFor(() => expect(screen.getByRole("button", { name: "Send email from CRM" })).toHaveProperty("disabled", false)); fireEvent.click(screen.getByRole("button", { name: "Send email from CRM" })); }
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
it("keeps saved email attempts accessible regardless of retired availability", async () => {
  sessionStorage.setItem("job-email-attempt:job", JSON.stringify({ id: "attempt", subject: "Original", body: "Original" }));
  vi.stubGlobal("fetch", async () => Response.json({ ...initial, enabled: false }));
  await act(async () => { render(<JobEmailComposer {...props} />); });
  fireEvent.click(screen.getByRole("button", { name: "Send email from CRM" }));
  expect(screen.getByLabelText("Message")).toHaveProperty("value", "Original");
});
it("uses the primary Email action to open the CRM composer", async () => {
  vi.stubGlobal("fetch", async () => Response.json(initial));
  render(<JobEmailComposer {...props} triggerStyle="primary" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "✉️ Email" })).toHaveProperty("disabled", false)); fireEvent.click(screen.getByRole("button", { name: "✉️ Email" }));
  expect(screen.getByLabelText("Subject")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Send email from CRM" })).toBeNull();
});
it("keeps the primary Email action available after an account-loading failure and can retry", async () => {
  let failed = true; vi.stubGlobal("fetch", async () => failed ? Response.json({error:"Unavailable"},{status:503}) : Response.json(initial));
  render(<JobEmailComposer {...props} triggerStyle="primary" />);
  const email = await screen.findByRole("button", {name:"✉️ Email"});
  await waitFor(()=>expect(email).toHaveProperty('disabled',false)); fireEvent.click(email);
  expect(screen.getByRole('alert')).toBeTruthy(); failed=false;
  fireEvent.click(screen.getByRole('button',{name:'Reload sending accounts'}));
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Reload sending accounts'})).toBeNull());
});

it("offers account setup or legacy sending without opening an unusable composer", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ enabled: true, senders: [], message: null }));
  let legacyOpened = false;
  render(<JobEmailComposer {...props} onLegacy={() => { legacyOpened = true; }} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Send email from CRM" })).toHaveProperty("disabled", false)); fireEvent.click(screen.getByRole("button", { name: "Send email from CRM" }));
  expect(screen.getByRole("dialog", { name: "No email account connected" })).toBeTruthy();
  expect(screen.queryByLabelText("Message")).toBeNull();
  expect(screen.getByRole("button", { name: "Connect an account" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(legacyOpened).toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Send email from CRM" }));
  fireEvent.click(screen.getByRole("button", { name: "Use Legacy Comms" }));
  expect(legacyOpened).toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("keeps an unresolved send available when its account is disconnected", async () => {
  sessionStorage.setItem("job-email-attempt:job", JSON.stringify({ id: "pending", senderId: "old", destination: "customer", body: "Original", subject: "Original subject", templateTitle: "" }));
  vi.stubGlobal("fetch", async () => Response.json({ enabled: true, senders: [], message: null }));
  await open();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByLabelText("Message")).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Recover original send attempt" })).toBeTruthy();
});
