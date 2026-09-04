export interface SubmissionKeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
  readonly length?: number;
  key?(index: number): string | null;
}

export interface SubmissionLockManager {
  request<T>(name: string, callback: () => Promise<T> | T): Promise<T>;
}

export interface PartnerSubmissionKeyRecord {
  key: string;
  state: "ALLOCATED" | "PENDING";
  createdAt: number;
  updatedAt: number;
}

export interface PartnerSubmissionKeyInput { scope: string; jobId: string; jobRevision: number; floorPlanRevision: number }

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECORD_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export function partnerSubmissionBrowserKeyName(scope: string, jobId: string, jobRevision: number, floorPlanRevision: number): string {
  return `partner-submission:v1:${scope}:${jobId}:${jobRevision}:${floorPlanRevision}`;
}

function storageName(input: PartnerSubmissionKeyInput): string {
  return partnerSubmissionBrowserKeyName(input.scope, input.jobId, input.jobRevision, input.floorPlanRevision);
}

function parseRecord(raw: string | null): PartnerSubmissionKeyRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PartnerSubmissionKeyRecord>;
    return typeof value.key === "string" && UUID_V4.test(value.key)
      && (value.state === "ALLOCATED" || value.state === "PENDING")
      && Number.isSafeInteger(value.createdAt) && Number.isSafeInteger(value.updatedAt)
      && Number(value.createdAt) > 0 && Number(value.updatedAt) >= Number(value.createdAt)
      ? value as PartnerSubmissionKeyRecord : null;
  } catch { return null; }
}

function persistVerified(storage: SubmissionKeyStorage, name: string, record: PartnerSubmissionKeyRecord): boolean {
  try {
    storage.setItem(name, JSON.stringify(record));
    const settled = parseRecord(storage.getItem(name));
    return settled?.key === record.key && settled.state === record.state
      && settled.createdAt === record.createdAt && settled.updatedAt === record.updatedAt;
  } catch { return false; }
}

/** Allocates and durably marks one cross-tab key PENDING before any POST is allowed. */
export async function allocatePendingPartnerSubmissionKey(
  input: PartnerSubmissionKeyInput,
  storage: SubmissionKeyStorage | null,
  locks: SubmissionLockManager | null,
  randomUUID: () => string = () => crypto.randomUUID(),
  now: () => number = () => Date.now(),
): Promise<string | null> {
  if (!storage || !locks) return null;
  const name = storageName(input);
  try {
    return await locks.request(`partner-submission-lock:${name}`, async () => {
      const timestamp = now();
      const existing = parseRecord(storage.getItem(name));
      // Never expire PENDING: it may represent a committed freeze whose response was lost.
      if (existing?.state === "PENDING") return existing.key;
      let record = existing;
      if (!record || timestamp - record.updatedAt > RECORD_TTL_MS) {
        const key = randomUUID();
        if (!UUID_V4.test(key)) return null;
        record = { key, state: "ALLOCATED", createdAt: timestamp, updatedAt: timestamp };
        if (!persistVerified(storage, name, record)) return null;
      }
      const pending = { ...record, state: "PENDING" as const, updatedAt: timestamp };
      if (persistVerified(storage, name, pending)) return pending.key;
      // A failed read-back must never leave a marker that a reload could mistake
      // for an approved network attempt.
      try { storage.removeItem?.(name); } catch { /* caller remains fail closed */ }
      return null;
    });
  } catch { return null; }
}

export function readPartnerSubmissionKeyRecord(input: PartnerSubmissionKeyInput, storage: SubmissionKeyStorage | null): PartnerSubmissionKeyRecord | null {
  try { return storage ? parseRecord(storage.getItem(storageName(input))) : null; } catch { return null; }
}

export function readPendingPartnerSubmissionKey(input: PartnerSubmissionKeyInput, storage: SubmissionKeyStorage | null): string | null {
  const record = readPartnerSubmissionKeyRecord(input, storage);
  return record?.state === "PENDING" ? record.key : null;
}

/** Finds an exact or newer revision tombstone for this authenticated job scope. */
export function inspectPendingPartnerSubmissionForJob(input: PartnerSubmissionKeyInput, storage: SubmissionKeyStorage | null): { state: "PENDING"; key: string; jobRevision: number; floorPlanRevision: number } | { state: "NONE" | "UNAVAILABLE" } {
  const prefix = `partner-submission:v1:${input.scope}:${input.jobId}:`;
  try {
    if (!storage?.key || typeof storage.length !== "number") return { state: "UNAVAILABLE" };
    for (let index = 0; index < storage.length; index += 1) {
      const name = storage.key(index); if (!name?.startsWith(prefix)) continue;
      const suffix = name.slice(prefix.length).match(/^(\d+):(\d+)$/); if (!suffix) continue;
      const jobRevision = Number(suffix[1]); const floorPlanRevision = Number(suffix[2]);
      if (!Number.isSafeInteger(jobRevision) || !Number.isSafeInteger(floorPlanRevision) || jobRevision < input.jobRevision || floorPlanRevision < input.floorPlanRevision) continue;
      const record = parseRecord(storage.getItem(name)); if (record?.state === "PENDING") return { state: "PENDING", key: record.key, jobRevision, floorPlanRevision };
    }
  } catch { return { state: "UNAVAILABLE" }; }
  return { state: "NONE" };
}

export function clearPartnerSubmissionKey(input: PartnerSubmissionKeyInput, storage: SubmissionKeyStorage | null): void {
  try { storage?.removeItem?.(storageName(input)); } catch { /* fail closed state remains server-authoritative */ }
}

export function clearPartnerSubmissionScope(scope: string, storage: SubmissionKeyStorage | null): void {
  const prefix = `partner-submission:v1:${scope}:`;
  try {
    if (!storage?.key || !storage.removeItem || typeof storage.length !== "number") return;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index); if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch { /* best effort only after successful logout */ }
}
