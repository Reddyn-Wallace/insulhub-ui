import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as mutate } from "@/app/api/jobs/mutate/route";
import { GET as history } from "@/app/api/jobs/[id]/quote-history/route";
import { POST as pdf } from "@/app/api/jobs/[id]/quote-pdf/route";
import { ADD_FILES, REMOVE_FILE, UPDATE_JOB_QUOTE } from "@/lib/mutations";

const url = process.env.QUOTE_HISTORY_TEST_DATABASE_URL ?? process.env.DEAD_FOLLOWUPS_TEST_DATABASE_URL;
const id = "abcdef123456abcdef123456";
const inaccessibleId = "111111111111111111111111";
const context = (jobId = id) => ({ params: Promise.resolve({ id: jobId }) });
const pdfBytes = "%PDF-1.4\nMock PDF";
const path = `/api/jobs/${id}`;
const makeRequest = (target: string, body?: unknown) => new NextRequest(`http://localhost${target}`, {
  method: body === undefined ? "GET" : "POST",
  body: body === undefined ? undefined : JSON.stringify(body),
  headers: { "x-access-token": "quote-history-test-token", "content-type": "application/json" },
});
const initialQuote = {
  quoteNumber: "Q123", date: "2026-11-27", status: "UNSET", c_total: 6900,
  wall: { SQM: 80 }, extras: [] as { name: string; price: number }[], files_QuoteSitePlan: [] as string[],
};
const initialJob = () => ({ _id: id, stage: "QUOTE", quote: structuredClone(initialQuote) });

describe.skipIf(!url)("quote history through the CRM routes and PostgreSQL", () => {
  let db: Pool;
  let job = initialJob();
  let writes = 0;
  let sendRequests = 0;
  let loseResponse = false;
  let persistPdf = true;
  let blockUpdate: Promise<void> | undefined;
  const provider = vi.fn(async (input: string, init?: RequestInit) => {
    if (input.startsWith("https://api.insulhub.nz/pdf/saveJobAndGetQuotePDF?")) {
      const variables = JSON.parse(new URL(input).searchParams.get("input") || "{}");
      expect(variables._id).toBe(id);
      if (persistPdf) job = { ...job, ...variables };
      return new Response(pdfBytes, { headers: { "content-type": "application/pdf" } });
    }
    expect(input).toBe("https://api.insulhub.nz/graphql");
    const { query, variables } = JSON.parse(String(init?.body));
    if (query.includes("OverlayAuthCheck")) return Response.json({ data: { users: { results: [{ _id: "staff" }] } } });
    if (query.includes("QuoteHistoryJob")) {
      return Response.json({ data: { me: { _id: "staff", firstname: "Andrew" }, job: variables._id === id ? job : null } });
    }
    if (query.includes("FollowupAccess")) {
      return Response.json({ data: { me: { _id: "staff", firstname: "Andrew" }, job: { ...job, updatedAt: "2026-11-27T00:00:00Z", lead: { leadStatus: "NEW" } } } });
    }
    if (query === ADD_FILES || query === REMOVE_FILE) {
      const files = job.quote.files_QuoteSitePlan;
      job.quote.files_QuoteSitePlan = query === ADD_FILES ? [...files, ...variables.fileNames] : files.filter(file => file !== variables.fileName);
      return Response.json({ data: query === ADD_FILES ? { addFiles: true } : { removeFile: true } });
    }
    expect(query).toBe(UPDATE_JOB_QUOTE);
    writes++;
    if (variables.emailQuoteToCustomer) sendRequests++;
    await blockUpdate;
    job = { ...job, ...variables.input };
    if (loseResponse) throw new Error("Upstream reply lost");
    return Response.json({ data: { updateJob: job } });
  });

  beforeAll(async () => {
    if (!url || new URL(url).hostname !== "127.0.0.1" || new URL(url).port !== "55687") {
      throw new Error("Dedicated local database only");
    }
    const setup = new Pool({ connectionString: url });
    try { await setup.query("CREATE SCHEMA IF NOT EXISTS quote_history_test"); } finally { await setup.end(); }
    const testUrl = new URL(url);
    testUrl.searchParams.set("options", "-c search_path=quote_history_test");
    db = new Pool({ connectionString: testUrl.href });
    for (let i = 0; i < 2; i++) {
      await db.query(readFileSync("scripts/quote-history-schema.sql", "utf8"));
    }
    await db.query(readFileSync("scripts/dead-followups-schema.sql", "utf8"));
    await db.query(readFileSync("scripts/dead-followups-date-schema.sql", "utf8"));
    await db.query("TRUNCATE crm_quote_history_events, crm_quote_history_state, dead_quote_date_events, dead_quote_dates");
    vi.stubEnv("DATABASE_URL", testUrl.href);
    vi.stubEnv("QUOTE_HISTORY_ENABLED", "true");
    vi.stubEnv("DEAD_QUOTE_FOLLOWUPS_ENABLED", "false");
    vi.stubEnv("DEAD_QUOTE_DATE_CAPTURE_ENABLED", "true");
    vi.stubGlobal("fetch", provider);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await db?.end();
  });

  const read = async () => {
    const result = await history(makeRequest(`${path}/quote-history`), context());
    expect(result.status).toBe(200);
    return result.json();
  };
  const save = (quote = job.quote, options: { send?: boolean; stage?: string } = {}) =>
    mutate(makeRequest("/api/jobs/mutate", {
      query: UPDATE_JOB_QUOTE, variables: {
        input: { _id: id, stage: options.stage ?? job.stage, quote },
        emailQuoteToCustomer: !!options.send,
      },
    }));

  it("tracks saves, real PDF side effects, attachments, sends and acceptance, then reconciles without replay", async () => {
    expect((await read()).events).toMatchObject([{ kind: "baseline", revision: 1, total: 6900 }]);
    const edited = { ...job.quote, c_total: 7590, wall: { SQM: 92 }, extras: [{ name: "Discount", price: -300 }] };
    expect((await save(edited)).status).toBe(200);
    await save(edited);
    let result = await read();
    expect(result.events.map((entry: { kind: string }) => entry.kind)).toEqual(["edit", "baseline"]);
    expect(result.events[0]).toMatchObject({ actor: "Andrew", revision: 2, changes: expect.arrayContaining([{ label: "Discount", before: "—", after: "-$300.00" }]) });

    await save(job.quote, { send: true });
    await save(job.quote, { send: true });
    result = await read();
    expect(result.lastSend).toMatchObject({ kind: "send", revision: 2, total: 7590 });
    expect(result.events.slice(0, 2)).toMatchObject([{ kind: "send", revision: 2 }, { kind: "send", revision: 2 }]);
    expect(result.changedSinceSend).toBe(false);

    persistPdf = false;
    const exportDraft = { ...job, quote: { ...job.quote, c_total: 7700 } };
    const generated = await pdf(makeRequest(`${path}/quote-pdf`, exportDraft), context());
    expect(generated.status).toBe(200);
    expect(await generated.text()).toBe(pdfBytes);
    expect((await read()).revision).toBe(2);
    persistPdf = true;
    expect((await pdf(makeRequest(`${path}/quote-pdf`, exportDraft), context())).status).toBe(200);
    result = await read();
    expect(result.events[0]).toMatchObject({ kind: "pdf", revision: 3, actor: "Andrew", total: 7700 });
    expect(result.changedSinceSend).toBe(true);

    for (const query of [ADD_FILES, REMOVE_FILE]) {
      const response = await mutate(makeRequest("/api/jobs/mutate", {
        query, variables: { _id: id, documentType: "QUOTE_SITE_PLAN",
          ...(query === ADD_FILES ? { fileNames: ["roof.pdf"] } : { fileName: "roof.pdf" }) },
      }));
      expect(response.status).toBe(200);
    }
    expect((await read()).events.slice(0, 2)).toMatchObject([{ kind: "files", revision: 5 }, { kind: "files", revision: 4 }]);

    await save({ ...job.quote, status: "ACCEPTED" }, { stage: "SCHEDULED" });
    expect((await read()).events[0]).toMatchObject({ kind: "accepted", revision: 5 });
    job.quote.c_total = 7800;
    expect((await read()).events[0]).toMatchObject({ kind: "external", actor: null, revision: 6 });

    loseResponse = true;
    expect((await save({ ...job.quote, c_total: 7900 }, { send: true, stage: "QUOTE" })).status).toBe(503);
    expect((await read()).pending).toBe(true);
    expect((await save()).status).toBe(409);
    expect(sendRequests).toBe(3);
    await db.query("UPDATE crm_quote_history_state SET pending_at=now()-interval '2 minutes'");
    result = await read();
    expect(result.pending).toBe(false);
    expect(result.events[0]).toMatchObject({ kind: "recovered", actor: null, total: 7900 });
    expect(result.lastSend).toMatchObject({ revision: 2, total: 7590 });
    loseResponse = false;
  });

  it("serializes concurrent quote writes", async () => {
    // Keep the dead-date capture out of this check to exercise the history lock directly.
    vi.stubEnv("DEAD_QUOTE_DATE_CAPTURE_ENABLED", "false");
    let release!: () => void;
    blockUpdate = new Promise<void>(resolve => { release = resolve; });
    const before = writes;
    const ongoing = save({ ...job.quote, c_total: 8000 });
    try {
      await vi.waitFor(() => expect(writes).toBe(before + 1));
      expect((await save({ ...job.quote, c_total: 8100 })).status).toBe(409);
      expect(writes).toBe(before + 1);
    } finally {
      release();
      blockUpdate = undefined;
      expect((await ongoing).status).toBe(200);
    }
  });

  it("uses job access for reads and PDF writes and pages over immutable events", async () => {
    expect((await history(makeRequest(`/api/jobs/${inaccessibleId}/quote-history`), context(inaccessibleId))).status).toBe(404);
    expect((await pdf(makeRequest(`/api/jobs/${inaccessibleId}/quote-pdf`, { ...job, _id: inaccessibleId }), context(inaccessibleId))).status).toBe(404);
    expect((await history(makeRequest(`${path}/quote-history?before=9999999999999999999`), context())).status).toBe(400);
    await db.query(`INSERT INTO crm_quote_history_events(job_id, revision, kind) SELECT $1, 9, 'edit' FROM generate_series(1,32)`, [id]);
    const first = await read();
    expect(first.events).toHaveLength(30);
    expect(first.lastSend).toMatchObject({ revision: 2, total: 7590 });
    const next = await history(makeRequest(`${path}/quote-history?before=${first.next}`), context());
    const second = await next.json();
    expect(next.status).toBe(200);
    expect(second.events.length).toBeGreaterThan(2);
    expect(first.events.some((entry: { id: string }) => entry.id === second.events[0].id)).toBe(false);
  });

  it("keeps the CRM available before the feature is enabled", async () => {
    vi.stubEnv("QUOTE_HISTORY_ENABLED", "false");
    expect((await history(makeRequest(`${path}/quote-history`), context())).status).toBe(204);
    expect((await save()).status).toBe(200);
  });
});
