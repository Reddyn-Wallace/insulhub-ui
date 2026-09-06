import { overlaySql } from "./overlay-db";
export type JobMessagingSettings = { enabled: boolean; testUserId: string; testerName: string };
export async function readJobMessagingSettings(): Promise<JobMessagingSettings> {
  const rows = await overlaySql`SELECT key,value FROM overlay_settings WHERE key IN ('job_sms_enabled','job_crm_test_user')`;
  const enabled = rows.find(row => row.key === "job_sms_enabled")?.value === "true";
  const testValue = rows.find(row => row.key === "job_crm_test_user")?.value;
  if (!testValue) return { enabled, testUserId: "", testerName: "" };
  try {
    const test = JSON.parse(String(testValue));
    if (typeof test.userId !== "string" || !test.userId || typeof test.name !== "string") throw Error("Invalid tester");
    return { enabled, testUserId: test.userId, testerName: test.name };
  } catch { return { enabled: false, testUserId: "invalid", testerName: "Unknown account" }; }
}
export function jobMessagingAllowed(settings: JobMessagingSettings, userId: string) {
  return settings.enabled && (!settings.testUserId || settings.testUserId === userId);
}
export async function crmJobMessagingEnabled(userId: string) {
  return jobMessagingAllowed(await readJobMessagingSettings(), userId);
}
