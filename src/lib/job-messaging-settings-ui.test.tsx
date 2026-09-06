// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import JobSmsSettings from "@/components/JobSmsSettings";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("allows setting account-only testing while off, then enables without changing the audience", async () => {
  vi.stubGlobal("localStorage", { getItem: () => "test" });
  let settings = { enabled: false, testOnly: false, testerName: "", isTester: false, canManage: true };
  const writes: unknown[] = [];
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      const input = JSON.parse(String(init.body)); writes.push(input);
      settings = { ...settings, ...input, testerName: "Test Person", isTester: true };
    }
    return Response.json(settings);
  });
  render(<JobSmsSettings />);
  const onlyMe = screen.getByLabelText("Test only with my account");
  await waitFor(() => expect(onlyMe).toHaveProperty("disabled", false));
  fireEvent.click(onlyMe);
  await waitFor(() => expect(writes).toEqual([{ enabled: false, testOnly: true }]));
  await waitFor(() => expect(screen.getByLabelText("Enable CRM SMS and email")).toHaveProperty("disabled", false));
  fireEvent.click(screen.getByLabelText("Enable CRM SMS and email"));
  await screen.findByText("Available only to Test Person. Other staff keep the manual options.");
  expect(writes[1]).toEqual({ enabled: true });
});
