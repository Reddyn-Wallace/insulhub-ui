import { invalidateCalendarData } from "@/lib/calendar/cache";
import { clearBrowserCachePrefixes } from "@/lib/client-cache";

export class CrmReadAccessDenied extends Error {}

export function isCrmReadDenied(error: unknown) {
  return error instanceof CrmReadAccessDenied ||
    (error instanceof Error && /unauthorized|unauthenticated|forbidden|access denied|sign-in changed/i.test(error.message));
}

export function clearCrmReadSnapshots() {
  invalidateCalendarData();
  clearBrowserCachePrefixes(["jobs-cache:"], ["session", "local"]);
}

export function clearCrmBrowserSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("me");
  clearBrowserCachePrefixes([
    "gql:", "jobs-cache:", "crm-sent-cache:", "job-cache:", "users-cache",
    "calendar:", "install-planning:", "calendar-placeholders:",
  ], ["session", "local"]);
}
