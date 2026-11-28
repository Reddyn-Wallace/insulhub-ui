import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/campaigns/[id]/route";

const mocks = vi.hoisted(() => ({ sql: vi.fn(), authenticate: vi.fn() }));
vi.mock("@/lib/overlay-db", () => ({ overlaySql: mocks.sql, ensureOverlaySchema: vi.fn() }));
vi.mock("@/lib/insulhub-auth", () => ({ requireInsulhubAuth: mocks.authenticate }));

const campaignId = randomUUID();
const recipientId = randomUUID();
function readHistory(id = recipientId) {
  const query = new URLSearchParams({ openHistoryRecipientId: id });
  return GET(new NextRequest(`http://localhost/api/campaigns/${campaignId}?${query}`), {
    params: Promise.resolve({ id: campaignId }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue(null);
});

it("requires authentication before reading any open history", async () => {
  mocks.authenticate.mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }));
  expect((await readHistory()).status).toBe(401);
  expect(mocks.sql).not.toHaveBeenCalled();
});

it.each([
  { channel: "email", id: "invalid" },
  { channel: "sms", id: recipientId },
])("rejects recipient history outside supported email requests", async ({ channel, id }) => {
  mocks.sql.mockResolvedValueOnce([{ id: campaignId, channel }]);
  expect((await readHistory(id)).status).toBe(404);
  expect(mocks.sql).toHaveBeenCalledTimes(1);
});
