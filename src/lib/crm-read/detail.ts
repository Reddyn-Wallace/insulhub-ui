import { gql } from "@/lib/graphql";
import { JOB_DETAIL_QUERY } from "@/lib/queries";
import { loadCrmRead, recentCrmRead } from "./client";

// A read started by opening a card is safe to hand over to the page.
// Reopening an older record must refresh the editable fields.
const handoffMs = 2_000;

export const recentJobDetail = <T>(id: string, token: string, consume = false) => recentCrmRead<T | null>("detail", id, token, handoffMs, consume);

export async function loadJobDetail<T>(id: string, token: string, keepHandoff = false) {
  const read = await loadCrmRead("detail", id, token, async () => {
    const response = await gql<{ job: T | null }>(JOB_DETAIL_QUERY, { _id: id }, { token });
    return response.job ?? null;
  });
  if (!keepHandoff) await recentJobDetail(id, token, true);
  return read.data;
}

export async function warmJobDetail(id: string) {
  const token = localStorage.getItem("token");
  if (!token || document.visibilityState !== "visible") return;
  if (!(await recentJobDetail(id, token))) await loadJobDetail(id, token, true);
}
