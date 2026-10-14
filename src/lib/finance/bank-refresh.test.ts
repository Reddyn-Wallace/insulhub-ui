import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { refreshBankAccounts } from "./bank-refresh";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function setup(response: () => Response) {
  vi.stubEnv("AKAHU_ACCOUNT_ID", "acc_main");
  vi.stubEnv("AKAHU_CREDIT_CARD_ACCOUNT_ID", "acc_card");
  vi.stubEnv("AKAHU_APP_TOKEN", "app");
  vi.stubEnv("AKAHU_USER_TOKEN", "user");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response()),
  );
}
it("requests configured accounts and only confirms new timestamps, even if amounts are unchanged", async () => {
  vi.useFakeTimers();
  let post = false;
  setup(() =>
    Response.json({
      success: true,
      item: {
        _id: "acc_main",
        refreshed: {
          balance: post ? "2026-10-08T02:00:00Z" : "2026-10-07T02:00:00Z",
          transactions: post ? "2026-10-08T02:00:00Z" : "2026-10-07T02:00:00Z",
        },
      },
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      if (init.method === "POST") {
        post = true;
        return Response.json({ success: true });
      }
      return Response.json({
        success: true,
        item: {
          _id: String(url).split("/").at(-1),
          refreshed: {
            balance: post ? "2026-10-08T02:00:00Z" : "2026-10-07T02:00:00Z",
            transactions: post
              ? "2026-10-08T02:00:00Z"
              : "2026-10-07T02:00:00Z",
          },
        },
      });
    }),
  );
  const p = refreshBankAccounts();
  await vi.runAllTimersAsync();
  expect((await p).every((r) => r.status === "updated")).toBe(true);
  expect(
    vi.mocked(fetch).mock.calls.filter((c) => c[1]?.method === "POST"),
  ).toHaveLength(2);
});
it("does not claim a queued request updated unchanged data", async () => {
  vi.useFakeTimers();
  setup(() =>
    Response.json({
      success: true,
      item: { _id: "acc_main", refreshed: { balance: "2026-10-07T02:00:00Z" } },
    }),
  );
  vi.stubEnv("AKAHU_CREDIT_CARD_ACCOUNT_ID", "");
  const p = refreshBankAccounts();
  await vi.runAllTimersAsync();
  expect((await p)[0].status).toBe("unchanged");
});
it("reports rate limits without hiding existing balances", async () => {
  setup(() => new Response("", { status: 429 }));
  expect(
    (await refreshBankAccounts()).every((r) => r.status === "unavailable"),
  ).toBe(true);
});
it("waits for transaction freshness after the balance advances", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T00:00:00Z"));
  setup(() => Response.json({}));
  vi.stubEnv("AKAHU_CREDIT_CARD_ACCOUNT_ID", "");
  let posted = false,
    reads = 0;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (init?.method === "POST") {
      posted = true;
      return Response.json({ success: true });
    }
    if (posted) reads++;
    return Response.json({
      success: true,
      item: {
        _id: "acc_main",
        refreshed: {
          balance: posted ? "2026-10-14T00:00:00Z" : "2026-10-13T00:00:00Z",
          transactions:
            reads >= 3 ? "2026-10-14T00:00:00Z" : "2026-10-13T00:00:00Z",
        },
      },
    });
  });
  let done = false;
  const result = refreshBankAccounts().then((r) => {
    done = true;
    return r;
  });
  await vi.advanceTimersByTimeAsync(6000);
  expect(done).toBe(false);
  await vi.runAllTimersAsync();
  expect((await result)[0]).toMatchObject({
    status: "updated",
    balanceUpdated: true,
    transactionsUpdated: true,
  });
});
it("reports a partial update when transactions never advance", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T00:00:00Z"));
  setup(() => Response.json({}));
  vi.stubEnv("AKAHU_CREDIT_CARD_ACCOUNT_ID", "");
  let posted = false;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (init?.method === "POST") {
      posted = true;
      return Response.json({ success: true });
    }
    return Response.json({
      success: true,
      item: {
        _id: "acc_main",
        refreshed: {
          balance: posted ? "2026-10-14T00:00:00Z" : "2026-10-13T00:00:00Z",
          transactions: "2026-10-13T00:00:00Z",
        },
      },
    });
  });
  const result = refreshBankAccounts();
  await vi.runAllTimersAsync();
  expect((await result)[0]).toMatchObject({
    status: "partial",
    balanceUpdated: true,
    transactionsUpdated: false,
  });
});
it("does not repeatedly request upstream refresh during the personal-app rest period", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T00:30:00Z"));
  setup(() =>
    Response.json({
      success: true,
      item: {
        _id: "acc_main",
        refreshed: {
          balance: "2026-10-14T00:00:00Z",
          transactions: "2026-10-13T00:00:00Z",
        },
      },
    }),
  );
  vi.stubEnv("AKAHU_CREDIT_CARD_ACCOUNT_ID", "");
  expect((await refreshBankAccounts())[0].status).toBe("unchanged");
  expect(
    vi.mocked(fetch).mock.calls.filter((c) => c[1]?.method === "POST"),
  ).toHaveLength(0);
});
