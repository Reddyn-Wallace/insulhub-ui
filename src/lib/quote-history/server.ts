import "server-only";
import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { ControlError } from "@/lib/dead-followups/controls";
import {
  QUOTE_HISTORY_FIELDS, quoteDiff, quoteTotal, record, revisionContent, snapshotQuote, type QuoteEvent,
  type QuoteEventKind, type QuoteHistory, type QuoteSnapshot,
} from "./model";

export const quoteHistoryEnabled = () => {
  const configured = process.env.QUOTE_HISTORY_ENABLED;
  return configured === undefined ? process.env.VERCEL_ENV === "production" : configured === "true";
};
const recoveryDelay = 60_000;
let pool: Pool | undefined;

export function quoteHistoryRepository() {
  if (!process.env.DATABASE_URL) throw new ControlError("Quote history storage needs setup.", 503);
  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL, max: 4,
    connectionTimeoutMillis: 5000, statement_timeout: 10000,
  });
  return new QuoteHistoryRepository(pool);
}

type Actor = { id: string; name: string };
type JobRead = { snapshot: QuoteSnapshot | null; actor: Actor };
type State = { revision: number; quote_fields: QuoteSnapshot | null; pending_at: Date | null; last_send_hash: string | null };
type EventRow = { id: string; kind: QuoteEventKind; revision: number; occurred_at: Date; actor_name: string | null; total: string | null; changes: QuoteEvent["changes"] };
export type Confirmation = {
  snapshot: QuoteSnapshot | null;
  kind: "edit" | "send" | "accepted" | "files" | "pdf" | "external";
};

export async function readQuoteHistoryJob(token: string, id: string): Promise<JobRead> {
  const response = await fetch("https://api.insulhub.nz/graphql", {
    method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
    headers: { "content-type": "application/json", "x-access-token": token },
    body: JSON.stringify({
      query: `query QuoteHistoryJob($_id:ObjectId!){me{_id firstname lastname} job(_id:$_id){_id stage sitePlanNotes quote{${QUOTE_HISTORY_FIELDS}}}}`,
      variables: { _id: id },
    }),
  });
  if (response.status === 401 || response.status === 403) throw new ControlError("Sign in again.", response.status);
  if (!response.ok) throw new ControlError("Could not verify quote access.", 503);
  const result = await response.json();
  if (result.errors?.length) throw new ControlError("Could not verify quote access.", 503);
  const me = record(result.data?.me);
  const job = record(result.data?.job);
  if (typeof me._id !== "string" || !me._id) throw new ControlError("Sign in again.", 401);
  if (job._id !== id) throw new ControlError("Quote not found.", 404);
  if (!("quote" in job) || typeof job.stage !== "string") throw new ControlError("Could not verify current quote.", 503);
  return {
    snapshot: snapshotQuote(job),
    actor: { id: me._id, name: [me.firstname, me.lastname].filter(value => typeof value === "string").join(" ").trim() || me._id },
  };
}

function revisionHash(snapshot: QuoteSnapshot | null) {
  return createHash("sha256").update(revisionContent(snapshot)).digest("hex");
}

function event(row: EventRow): QuoteEvent {
  return {
    id: row.id, kind: row.kind, revision: row.revision, at: row.occurred_at.toISOString(),
    actor: row.actor_name, total: row.total === null ? null : Number(row.total), changes: row.changes,
  };
}

export class QuoteHistoryRepository {
  constructor(private readonly db: Pool) {}

  private async locked<T>(id: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    let locked = false;
    let discard = false;
    try {
      const result = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [`crm-quote-history:${id}`]);
      locked = result.rows[0].locked;
      if (!locked) throw new ControlError("Quote history is being updated. Try again shortly.", 409);
      return await work(client);
    } finally {
      if (locked) {
        try {
          await client.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`crm-quote-history:${id}`]);
        } catch {
          discard = true;
        }
      }
      client.release(discard);
    }
  }

  private async state(client: PoolClient, id: string): Promise<State> {
    await client.query("INSERT INTO crm_quote_history_state(job_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
    const { rows } = await client.query<State>("SELECT * FROM crm_quote_history_state WHERE job_id=$1", [id]);
    return rows[0];
  }

  private async append(client: PoolClient, id: string, revision: number, kind: QuoteEventKind,
    snapshot: QuoteSnapshot | null, changes: QuoteEvent["changes"], actor?: Actor) {
    await client.query(
      `INSERT INTO crm_quote_history_events(job_id,revision,kind,actor_id,actor_name,total,changes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, revision, kind, actor?.id ?? null, actor?.name ?? null, quoteTotal(snapshot), JSON.stringify(changes)],
    );
  }

  private async save(client: PoolClient, id: string, state: State, snapshot: QuoteSnapshot | null,
    kind: QuoteEventKind, actor?: Actor) {
    const { changes, revised } = quoteDiff(state.quote_fields, snapshot);
    const revision = state.revision + Number(revised);
    const lastSendHash = kind === "send" ? revisionHash(snapshot) : state.last_send_hash;
    if (!changes.length && !state.pending_at && kind !== "send" && kind !== "accepted") return state;

    await client.query("BEGIN");
    try {
      if (changes.length) {
        const editKind = kind === "send" || kind === "accepted" || kind === "edit"
          ? revised ? "edit" : kind !== "accepted" ? "status" : "accepted"
          : kind;
        await this.append(client, id, revision, editKind, snapshot, kind === "baseline" ? [] : changes, actor);
      }
      if (kind === "send" || (kind === "accepted" && (revised || !changes.length))) {
        await this.append(client, id, revision, kind, snapshot, [], actor);
      }
      if (kind === "recovered" && !changes.length) {
        await this.append(client, id, revision, "unconfirmed", snapshot, []);
      }
      await client.query(
        "UPDATE crm_quote_history_state SET revision=$2, quote_fields=$3, pending_at=NULL, last_send_hash=$4 WHERE job_id=$1",
        [id, revision, snapshot, lastSendHash],
      );
      await client.query("COMMIT");
      return { revision, quote_fields: snapshot, pending_at: null, last_send_hash: lastSendHash };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  private async observe(client: PoolClient, id: string, state: State, current: QuoteSnapshot | null) {
    if (state.pending_at && Date.now() - state.pending_at.getTime() < recoveryDelay) return state;
    const kind = state.pending_at ? "recovered" : state.revision === 0 ? "baseline" : "external";
    return this.save(client, id, state, current, kind);
  }

  async list(id: string, read: () => Promise<JobRead>, cursor: string | null): Promise<QuoteHistory> {
    return this.locked(id, async client => {
      const current = await read();
      const state = await this.observe(client, id, await this.state(client, id), current.snapshot);
      const { rows } = await client.query<EventRow>(
        `SELECT * FROM crm_quote_history_events WHERE job_id=$1 AND ($2::bigint IS NULL OR id<$2)
         ORDER BY id DESC LIMIT 31`, [id, cursor],
      );
      const send = await client.query<EventRow>(
        "SELECT * FROM crm_quote_history_events WHERE job_id=$1 AND kind='send' ORDER BY id DESC LIMIT 1", [id],
      );
      const lastSend = send.rows[0] ? event(send.rows[0]) : null;
      return {
        revision: state.revision, events: rows.slice(0, 30).map(event), next: rows.length > 30 ? rows[29].id : null,
        lastSend, changedSinceSend: !!lastSend && state.last_send_hash !== revisionHash(current.snapshot),
        pending: !!state.pending_at,
      };
    });
  }

  async capture<T>(id: string, read: () => Promise<JobRead>, dispatch: () => Promise<T>,
    confirm: (result: T, before: QuoteSnapshot | null) => Promise<Confirmation | null>): Promise<T> {
    return this.locked(id, async client => {
      const before = await read();
      const stored = await this.state(client, id);
      if (stored.pending_at) throw new ControlError("The previous quote update could not be confirmed. Open Quote history and refresh it before trying again.", 409);
      const state = await this.observe(client, id, stored, before.snapshot);
      // Record intent before calling InsulHub. A timeout must never replay the external request.
      const pending = await client.query<{ pending_at: Date }>(
        "UPDATE crm_quote_history_state SET pending_at=now() WHERE job_id=$1 RETURNING pending_at", [id],
      );
      const result = await dispatch();
      try {
        const confirmation = await confirm(result, before.snapshot);
        if (confirmation) {
          await this.save(client, id, { ...state, pending_at: pending.rows[0].pending_at },
            confirmation.snapshot, confirmation.kind, confirmation.kind === "external" ? undefined : before.actor);
        }
      } catch {
        // Preserve the upstream result so a successful send is never retried due to overlay failure.
        // A later authorised read reconciles the snapshot without inventing attribution or a send.
        console.warn("Quote history confirmation could not be recorded.");
      }
      return result;
    });
  }
}
