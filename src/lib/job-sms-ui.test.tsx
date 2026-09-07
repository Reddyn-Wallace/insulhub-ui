// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import JobSmsComposer from "@/components/JobSmsComposer";
const senderId = "22222222-2222-4222-8222-222222222222";
const props = { jobId: "job", phone: "0211234567", contactName: "Customer", templates: [{ id: "template", title: "Booking", body: "Hello Customer" }], onRecorded: vi.fn() };
const initial = { enabled: true, senders: [{ id: senderId, label: "Business" }], message: null };
beforeEach(() => { vi.stubGlobal("localStorage", { getItem: () => "test" }); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open() { render(<JobSmsComposer {...props} />); await waitFor(() => expect(screen.getByRole("button", { name: "Send SMS from CRM" })).toHaveProperty("disabled", false)); fireEvent.click(screen.getByRole("button", { name: "Send SMS from CRM" })); }
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
  it("opens CRM sending regardless of a retired availability response", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ ...initial, enabled: false }));
    await open(); expect(screen.getByLabelText("Message")).toBeTruthy();
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

it("keeps saved SMS attempts accessible regardless of retired availability", async () => {
  sessionStorage.setItem("job-sms-attempt:job", JSON.stringify({ id: "attempt", senderId, body: "Saved", destination: props.phone }));
  vi.stubGlobal("fetch", async () => Response.json({ ...initial, enabled: false }));
  await act(async () => { render(<JobSmsComposer {...props} />); });
  fireEvent.click(screen.getByRole("button", { name: "Send SMS from CRM" }));
  expect(screen.getByLabelText("Message")).toHaveProperty("value", "Saved");
});
it("uses the primary Text action to open the CRM composer without sending", async () => {
  const fetcher = vi.fn(async () => Response.json(initial)); vi.stubGlobal("fetch", fetcher);
  render(<JobSmsComposer {...props} triggerStyle="primary" />);
  await waitFor(() => expect(screen.getByRole("button", { name: "💬 Text" })).toHaveProperty("disabled", false)); fireEvent.click(screen.getByRole("button", { name: "💬 Text" }));
  expect(screen.getByLabelText("Message")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Send SMS from CRM" })).toBeNull();
});
it("keeps the primary Text action available after an account-loading failure and can retry", async () => {
  let failed = true; vi.stubGlobal("fetch", async () => failed ? Response.json({error:"Unavailable"},{status:503}) : Response.json(initial));
  render(<JobSmsComposer {...props} triggerStyle="primary" />);
  const text = await screen.findByRole("button", {name:"💬 Text"});
  await waitFor(()=>expect(text).toHaveProperty('disabled',false)); fireEvent.click(text);
  expect(screen.getByRole('alert')).toBeTruthy(); failed=false;
  fireEvent.click(screen.getByRole('button',{name:'Reload sending accounts'}));
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Reload sending accounts'})).toBeNull());
});

it("offers account setup or legacy sending without opening an unusable composer", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ enabled: true, senders: [], message: null }));
  let legacyOpened = false;
  render(<JobSmsComposer {...props} onLegacy={() => { legacyOpened = true; }} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Send SMS from CRM" })).toHaveProperty("disabled", false)); fireEvent.click(screen.getByRole("button", { name: "Send SMS from CRM" }));
  expect(screen.getByRole("dialog", { name: "No SMS account connected" })).toBeTruthy();
  expect(screen.queryByLabelText("Message")).toBeNull();
  expect(screen.getByRole("button", { name: "Connect an account" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(legacyOpened).toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Send SMS from CRM" }));
  fireEvent.click(screen.getByRole("button", { name: "Use Legacy Comms" }));
  expect(legacyOpened).toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("keeps an unresolved send available when its account is disconnected", async () => {
  sessionStorage.setItem("job-sms-attempt:job", JSON.stringify({ id: "pending", senderId: "old", destination: "customer", body: "Original", subject: "Original subject", templateTitle: "" }));
  vi.stubGlobal("fetch", async () => Response.json({ enabled: true, senders: [], message: null }));
  await open();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByLabelText("Message")).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Recover original send attempt" })).toBeTruthy();
});
