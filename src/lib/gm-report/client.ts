import type { Commentary } from "./types";
export type Recovery = {
  commentary: Commentary;
  base: Commentary;
  revision: number;
};
function recoveryKey(week: string) {
  let hash = 2166136261;
  for (const ch of localStorage.getItem("token") || "")
    hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return `gm-report-draft:${hash >>> 0}:${week}`;
}
export function writeRecovery(week: string, value: Recovery) {
  try {
    sessionStorage.setItem(recoveryKey(week), JSON.stringify(value));
  } catch {
    /* The unload warning still protects text if browser storage is unavailable. */
  }
}
export function clearRecovery(week: string) {
  try {
    sessionStorage.removeItem(recoveryKey(week));
  } catch {}
}
export function readRecovery(week: string): Recovery | null {
  try {
    const x = JSON.parse(sessionStorage.getItem(recoveryKey(week)) || "null");
    if (!x || !Number.isInteger(x.revision) || !x.commentary || !x.base)
      return null;
    for (const field of ["profit", "upcoming", "pipeline"])
      if (
        typeof x.commentary[field] !== "string" ||
        x.commentary[field].length > 20000 ||
        typeof x.base[field] !== "string"
      )
        return null;
    return x;
  } catch {
    return null;
  }
}
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const token = localStorage.getItem("token");
  if (!token)
    throw new RequestError(
      "Sign in to the internal CRM to view this report.",
      401,
    );
  const r = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-access-token": token },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  let data;
  try {
    data = await r.json();
  } catch {
    throw new RequestError(
      "The report server could not be reached. Please retry.",
      r.status,
    );
  }
  if (!r.ok)
    throw new RequestError(
      data?.error || "The report could not be saved.",
      r.status,
    );
  return data as T;
}
