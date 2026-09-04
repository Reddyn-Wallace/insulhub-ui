// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ request: vi.fn(), confirm: vi.fn() }));
vi.mock("@/lib/partner/settings-client", () => ({ settingsRequest: mocks.request }));
vi.mock("@/components/AppDialog", () => ({ useAppDialog: () => ({ confirm: mocks.confirm, dialog: null }) }));
import { Users } from "@/components/PartnerOpsCompanies";
import PartnerAccountPasswordForm from "@/components/PartnerAccountPasswordForm";
import PartnerForgotPasswordForm from "@/components/PartnerForgotPasswordForm";

const company = { id: "company-1", name: "Northwind", revision: 0, billingModel: "INSULHUB_BILLED" as const };
const active = { id: "active-1", name: "Alex Active", email: "alex@example.test", disabledAt: null, invitationPending: false };
const pending = { id: "pending-1", name: "Pat Pending", email: "pat@example.test", disabledAt: null, invitationPending: true };
const disabled = { ...active, id: "disabled-1", name: "Drew Disabled", disabledAt: "2026-08-31" };
const password = "ExamplePassword!2026";
const token = "a".repeat(64);
async function users(rows = [active, pending, disabled]) {
  mocks.request.mockResolvedValue({ users: rows });
  render(<Users companyId={company.id} companyName={company.name} onLock={vi.fn()}/>);
  await screen.findByText(rows[0].name);
}
function creation() {
  fireEvent.click(screen.getByRole("button", { name: "Add user" }));
  fireEvent.change(screen.getByLabelText("User name"), { target: { value: "New Person" } });
  fireEvent.change(screen.getByLabelText("User email"), { target: { value: "NEW@example.test" } });
}
beforeEach(() => {
  mocks.request.mockReset(); mocks.confirm.mockReset().mockResolvedValue(true);
  window.history.replaceState(null, "", "/partner/set-password");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Partner account management in normal Settings", () => {
  it("defaults to invitations without password fields and refreshes users after sent email", async () => {
    await users(); expect(screen.queryByLabelText("Initial password")).toBeNull();
    creation(); mocks.request.mockResolvedValueOnce({ ok: true, delivery: "SENT" }).mockResolvedValueOnce({ users: [active, pending] });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await screen.findByText("Invitation email sent.");
    expect(mocks.request).toHaveBeenCalledWith("/api/settings/partners/company-1/users/invite", "POST", { name: "New Person", email: "new@example.test", role:"SALES" });
    await waitFor(() => expect(screen.queryByLabelText("User name")).toBeNull());
  });
  it("retains manual initial-password creation with password validation", async () => {
    await users(); creation();
    fireEvent.change(screen.getByLabelText("Account setup"), { target: { value: "manual" } });
    fireEvent.change(screen.getByLabelText("Initial password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Create user" }));
    expect(screen.getByRole("alert").textContent).toContain("12–128");
    expect(mocks.request).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Initial password"), { target: { value: password } });
    mocks.request.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ users: [active] });
    fireEvent.click(screen.getByRole("button", { name: "Create user" }));
    await screen.findByText("User created. Share their password securely.");
    expect(mocks.request).toHaveBeenCalledWith("/api/settings/partners/company-1/users", "POST", { name: "New Person", email: "new@example.test", initialPassword: password, role:"SALES" });
    await waitFor(() => expect(screen.queryByLabelText("Initial password")).toBeNull());
  });
  it("shows delivery failures honestly and refreshes the pending user without claiming sent", async () => {
    await users(); creation();
    mocks.request.mockResolvedValueOnce({ ok: true, delivery: "FAILED" }).mockResolvedValueOnce({ users: [pending] });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("email sending could not be confirmed");
    await waitFor(() => expect(screen.queryByText(active.name)).toBeNull());
    expect(screen.queryByText("Invitation email sent.")).toBeNull();
    expect(screen.getByRole("button", { name: "Resend invitation" })).toBeTruthy();
  });
  it("keeps values and blocks duplicate actions after an unknown network outcome", async () => {
    await users(); creation();
    mocks.request.mockRejectedValueOnce(Object.assign(new Error("Connection lost"), { status: 0 }));
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await screen.findByRole("button", { name: "Reload latest details" });
    expect(screen.getByLabelText("User name")).toHaveProperty("value", "New Person");
    expect(screen.getByRole("button", { name: "Send invitation" })).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Role")).toHaveProperty("disabled", true);
  });
  it("resends pending invitations, sends active resets, and shows only safe local previews", async () => {
    await users();
    const url = window.location.origin + "/partner/set-password#token=" + token;
    mocks.request.mockResolvedValueOnce({ ok: true, delivery: "DEMO", demoUrl: url }).mockResolvedValueOnce({ users: [active, pending] });
    fireEvent.click(screen.getByRole("button", { name: "Resend invitation" }));
    const preview = await screen.findByRole("link", { name: "Local demo email — open link (no email sent)" });
    expect(preview.getAttribute("href")).toBe(url);
    expect(mocks.request).toHaveBeenCalledWith("/api/settings/partners/company-1/users/pending-1/access", "POST", { action: "INVITE" });
    mocks.request.mockResolvedValueOnce({ ok: true, delivery: "SENT" }).mockResolvedValueOnce({ users: [active, pending] });
    fireEvent.click(screen.getByRole("button", { name: "Send password reset" }));
    await screen.findByText("Password reset email sent.");
    expect(mocks.request).toHaveBeenCalledWith("/api/settings/partners/company-1/users/active-1/access", "POST", { action: "RESET" });
    expect(screen.queryByRole("link", { name: /Local demo email/ })).toBeNull();
  });
  it("does not render an unsafe demo URL", async () => {
    await users(); creation();
    mocks.request.mockResolvedValueOnce({ ok: true, delivery: "DEMO", demoUrl: "https://other.example/partner/set-password#token=bad" }).mockResolvedValueOnce({ users: [pending] });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await screen.findByText("Local demo email — no email sent.");
    expect(screen.queryByRole("link", { name: /Local demo email/ })).toBeNull();
  });
  it("confirms manual overrides, checks matching passwords and clears them after success", async () => {
    await users([active]);
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: password + "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(screen.getByRole("alert").textContent).toBe("Passwords do not match.");
    expect(mocks.confirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: password } });
    mocks.request.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ users: [active] });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    await screen.findByText("Password updated. Existing sessions have been signed out.");
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("signed out on all devices") }));
    expect(mocks.request).toHaveBeenCalledWith("/api/settings/partners/company-1/users/active-1/access", "POST", { action: "PASSWORD", password });
    expect(screen.queryByLabelText("New password")).toBeNull();
  });
  it("cancelling override performs no write and disabled users have no account actions", async () => {
    await users();
    expect(screen.queryByText(disabled.name)).toBeNull();
    fireEvent.change(screen.getByLabelText("Show users"), {target:{value:"all"}});
    const disabledRow = screen.getByText(disabled.name).closest("li")!;
    expect(within(disabledRow).getByRole("button", {name:"Unarchive"})).toBeTruthy();
    expect(within(disabledRow).queryByRole("button", {name:"Send password reset"})).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Set password" })[0]);
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: password } });
    mocks.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});

describe("Public invitation and password reset forms", () => {
  it("consumes the fragment once under StrictMode, strips it and submits only in request body", async () => {
    window.history.replaceState(null, "", "/partner/set-password#token=" + token);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true })); vi.stubGlobal("fetch", fetcher);
    render(<StrictMode><PartnerAccountPasswordForm /></StrictMode>);
    const input = await screen.findByLabelText("New password");
    expect(window.location.hash).toBe("");
    expect(document.body.textContent).not.toContain(token);
    fireEvent.change(input, { target: { value: password } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));
    await screen.findByText("Your password has been set. Sign in to continue.");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/partner/auth/password/complete", expect.objectContaining({ referrerPolicy: "no-referrer", cache: "no-store", body: JSON.stringify({ token, password }) }));
    expect(screen.queryByLabelText("New password")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to sign in" }).getAttribute("href")).toBe("/partner/login");
  });
  it.each(["", "#token=short", "#token=" + token + "&token=" + token])("rejects missing or malformed fragments %s", async (fragment) => {
    window.history.replaceState(null, "", "/partner/set-password" + fragment);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    render(<PartnerAccountPasswordForm />);
    expect((await screen.findByRole("alert")).textContent).toContain("invalid or has expired");
    expect(window.location.hash).toBe("");
    expect(screen.queryByRole("button", { name: "Set password" })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("validates matching passwords and handles expired links without accepting them again", async () => {
    window.history.replaceState(null, "", "/partner/set-password#token=" + token);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "Invalid link" }, { status: 400 })); vi.stubGlobal("fetch", fetcher);
    render(<PartnerAccountPasswordForm />);
    fireEvent.change(await screen.findByLabelText("New password"), { target: { value: password } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: password + "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));
    expect(screen.getByRole("alert").textContent).toBe("Passwords do not match.");
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Set password" })).toBeNull());
    expect(screen.getByRole("alert").textContent).toContain("invalid or has expired");
  });
  it.each([429, 503])("retains the valid token on retryable response %s", async (status) => {
    window.history.replaceState(null, "", "/partner/set-password#token=" + token);
    const fetcher = vi.fn().mockResolvedValue(Response.json({}, { status })); vi.stubGlobal("fetch", fetcher);
    render(<PartnerAccountPasswordForm />);
    fireEvent.change(await screen.findByLabelText("New password"), { target: { value: password } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Set password" })).toHaveProperty("disabled", false);
    expect(screen.getByLabelText("New password")).toHaveProperty("value", password);
  });
  it("public reset shows only generic success even if the server includes account-specific data", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, demoUrl: "private-token", email: "exists" })); vi.stubGlobal("fetch", fetcher);
    render(<PartnerForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "PERSON@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect((await screen.findByRole("status")).textContent).toContain("If an eligible account matches");
    expect(document.body.textContent).not.toContain("private-token");
    expect(document.body.textContent).not.toContain("exists");
    expect(fetcher).toHaveBeenCalledWith("/api/partner/auth/password/request", expect.objectContaining({ body: JSON.stringify({ email: "person@example.test" }) }));
  });
  it("does not send invalid email addresses and gives usable rate-limit feedback", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({}, { status: 429 })); vi.stubGlobal("fetch", fetcher);
    render(<PartnerForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(screen.getByRole("alert").textContent).toContain("valid email");
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: active.email } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Too many attempts"));
  });
});
