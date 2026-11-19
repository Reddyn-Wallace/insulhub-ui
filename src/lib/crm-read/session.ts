import { clearBrowserCachePrefixes } from "@/lib/client-cache";

export function clearCrmBrowserSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("me");
  clearBrowserCachePrefixes([
    "gql:", "jobs-cache:", "crm-sent-cache:", "job-cache:", "users-cache",
    "calendar:", "install-planning:", "calendar-placeholders:",
  ], ["session", "local"]);
}
