import "server-only";
import type { LegacyCallContext } from "./legacy/types";

export interface MonotonicClock { now(): number }

const defaultClock: MonotonicClock = { now: () => performance.now() };

export class PartnerWorkerDeadline implements LegacyCallContext {
  readonly signal: AbortSignal;
  private readonly end: number;
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(durationMs: number, private readonly controller = new AbortController(), private readonly clock: MonotonicClock = defaultClock) {
    if (!Number.isFinite(durationMs) || durationMs < 1 || durationMs > 15 * 60_000) throw new Error("PARTNER_WORKER_INVALID_DEADLINE");
    this.end = clock.now() + durationMs;
    this.signal = controller.signal;
    this.timer = setTimeout(() => controller.abort(), durationMs);
    this.timer.unref?.();
  }

  remainingMs(): number { return Math.max(0, this.end - this.clock.now()); }
  abort(): void { this.controller.abort(); }
  expired(): boolean { return this.signal.aborted || this.remainingMs() <= 0; }
  dispose(): void { clearTimeout(this.timer); }
}

export function createPartnerWorkerDeadline(durationMs: number, options: { controller?: AbortController; clock?: MonotonicClock } = {}): PartnerWorkerDeadline {
  return new PartnerWorkerDeadline(durationMs, options.controller, options.clock);
}
