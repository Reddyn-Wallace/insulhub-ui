// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import JobEmailComposer from "@/components/JobEmailComposer";
import JobSmsComposer from "@/components/JobSmsComposer";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); });

it.each(["email", "sms"])("opens %s immediately while accounts load", async channel => {
  vi.stubGlobal("localStorage", { getItem: () => "test" });
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", () => new Promise<Response>(resolve => { finish = resolve; }));
  const props = { jobId: "job", contactName: "Customer", templates: [], onRecorded: vi.fn(), triggerStyle: "primary" as const };
  render(channel === "email" ? <JobEmailComposer {...props} email="customer@example.com" /> : <JobSmsComposer {...props} phone="0211234567" />);
  const trigger = screen.getByRole("button", { name: channel === "email" ? "✉️ Email" : "💬 Text" });
  expect(trigger).toHaveProperty("disabled", false);
  fireEvent.click(trigger);
  expect(screen.getByRole("status").textContent).toBe("Loading sending accounts…");
  expect(screen.queryByText(/No connected/)).toBeNull();
  expect(screen.queryByLabelText("Message")).toBeNull();
  await act(async () => finish(Response.json({ senders: [{ id: "sender", label: "Staff", senderValue: "staff@example.com" }], message: null })));
  expect(screen.getByLabelText("Message")).toBeTruthy();
  expect(screen.queryByText("Loading sending accounts…")).toBeNull();
});
