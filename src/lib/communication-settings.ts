import { ensureOverlaySchema, overlaySql } from "@/lib/overlay-db";

export type CommunicationSettings = {
  campaignSendWindowEnabled: boolean;
  campaignSendWindowStartTime: string;
  campaignSendWindowEndTime: string;
  campaignSmsPerMinute: number;
  campaignEmailDailyLimit: number;
};

export const DEFAULT_COMMUNICATION_SETTINGS: CommunicationSettings = {
  campaignSendWindowEnabled: true,
  campaignSendWindowStartTime: "08:30",
  campaignSendWindowEndTime: "17:30",
  campaignSmsPerMinute: 30,
  campaignEmailDailyLimit: 100,
};

const SETTINGS_KEY = "communication_delivery_settings";

function intValue(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function boolValue(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return fallback;
}

function timeValue(value: unknown, fallback: string) {
  if (typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return value;
  return fallback;
}

function hourToTime(value: unknown, fallback: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const hour = Math.min(23, Math.max(0, Math.round(parsed)));
  return `${String(hour).padStart(2, "0")}:00`;
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function sendWindowDurationMs(settings: CommunicationSettings) {
  const startMinute = minutesFromTime(settings.campaignSendWindowStartTime);
  const endMinute = minutesFromTime(settings.campaignSendWindowEndTime);
  return Math.max(60_000, (endMinute - startMinute) * 60_000);
}

export function normalizeCommunicationSettings(input: unknown): CommunicationSettings {
  const values = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const legacyStart = values.campaignSendWindowStartHour;
  const legacyEnd = values.campaignSendWindowEndHour;
  return {
    campaignSendWindowEnabled: boolValue(
      values.campaignSendWindowEnabled,
      DEFAULT_COMMUNICATION_SETTINGS.campaignSendWindowEnabled
    ),
    campaignSendWindowStartTime: timeValue(
      values.campaignSendWindowStartTime,
      hourToTime(legacyStart, DEFAULT_COMMUNICATION_SETTINGS.campaignSendWindowStartTime)
    ),
    campaignSendWindowEndTime: timeValue(
      values.campaignSendWindowEndTime,
      hourToTime(legacyEnd, DEFAULT_COMMUNICATION_SETTINGS.campaignSendWindowEndTime)
    ),
    campaignSmsPerMinute: intValue(
      values.campaignSmsPerMinute,
      DEFAULT_COMMUNICATION_SETTINGS.campaignSmsPerMinute,
      1,
      120
    ),
    campaignEmailDailyLimit: intValue(
      values.campaignEmailDailyLimit,
      DEFAULT_COMMUNICATION_SETTINGS.campaignEmailDailyLimit,
      1,
      2_000
    ),
  };
}

export async function loadCommunicationSettings() {
  await ensureOverlaySchema();
  const rows = await overlaySql`
    SELECT value
    FROM overlay_settings
    WHERE key = ${SETTINGS_KEY}
    LIMIT 1
  `;
  const raw = rows[0]?.value;
  if (!raw) return DEFAULT_COMMUNICATION_SETTINGS;

  try {
    return normalizeCommunicationSettings(JSON.parse(String(raw)));
  } catch {
    return DEFAULT_COMMUNICATION_SETTINGS;
  }
}

export async function saveCommunicationSettings(input: unknown) {
  await ensureOverlaySchema();
  const settings = normalizeCommunicationSettings(input);
  await overlaySql`
    INSERT INTO overlay_settings (key, value)
    VALUES (${SETTINGS_KEY}, ${JSON.stringify(settings)})
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  return settings;
}

export function nzHour(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

export function nzMinuteOfDay(now = new Date()) {
  return nzHour(now);
}

export function communicationSendWindowError(settings: CommunicationSettings, now = new Date()) {
  if (!settings.campaignSendWindowEnabled) return "";
  const currentMinute = nzMinuteOfDay(now);
  const startMinute = minutesFromTime(settings.campaignSendWindowStartTime);
  const endMinute = minutesFromTime(settings.campaignSendWindowEndTime);
  if (
    currentMinute >= startMinute &&
    currentMinute < endMinute
  ) {
    return "";
  }
  return `Campaigns can only be sent between ${settings.campaignSendWindowStartTime} and ${settings.campaignSendWindowEndTime} NZ time.`;
}

export function communicationSendDelayMs(settings: CommunicationSettings, channel: string) {
  if (channel === "sms") return Math.ceil(60_000 / settings.campaignSmsPerMinute);
  return 0;
}

export function nextAllowedSendAt(settings: CommunicationSettings, offsetMs = 0, now = new Date()) {
  if (!settings.campaignSendWindowEnabled) return new Date(now.getTime() + offsetMs);

  const currentMinute = nzMinuteOfDay(now);
  const startMinute = minutesFromTime(settings.campaignSendWindowStartTime);
  const endMinute = minutesFromTime(settings.campaignSendWindowEndTime);
  let waitMinutes = 0;
  if (currentMinute < startMinute) {
    waitMinutes = startMinute - currentMinute;
  } else if (currentMinute >= endMinute) {
    waitMinutes = (24 * 60 - currentMinute) + startMinute;
  }

  return new Date(now.getTime() + waitMinutes * 60_000 + offsetMs);
}

export function addSendWindowOffset(settings: CommunicationSettings, offsetMs = 0, now = new Date()) {
  if (!settings.campaignSendWindowEnabled) return new Date(now.getTime() + offsetMs);

  const startMinute = minutesFromTime(settings.campaignSendWindowStartTime);
  const endMinute = minutesFromTime(settings.campaignSendWindowEndTime);
  let cursor = nextAllowedSendAt(settings, 0, now);
  let remainingMs = Math.max(0, offsetMs);

  while (remainingMs > 0) {
    const currentMinute = nzMinuteOfDay(cursor);
    if (currentMinute < startMinute || currentMinute >= endMinute) {
      cursor = nextAllowedSendAt(settings, 0, cursor);
      continue;
    }

    const remainingWindowMs = Math.max(0, (endMinute - currentMinute) * 60_000);
    if (remainingMs < remainingWindowMs) {
      return new Date(cursor.getTime() + remainingMs);
    }

    remainingMs -= remainingWindowMs;
    cursor = nextAllowedSendAt(settings, 0, new Date(cursor.getTime() + remainingWindowMs));
  }

  return cursor;
}

export function campaignRecipientScheduleAt(
  settings: CommunicationSettings,
  channel: "email" | "sms",
  index: number,
  now = new Date()
) {
  if (channel === "sms") {
    return addSendWindowOffset(settings, index * communicationSendDelayMs(settings, channel), now);
  }

  const windowMs = sendWindowDurationMs(settings);
  const indexWithinDay = index % settings.campaignEmailDailyLimit;
  const baseSpacingMs = Math.ceil(windowMs / settings.campaignEmailDailyLimit);
  const jitterMs = indexWithinDay === 0 ? 0 : Math.round(baseSpacingMs * (Math.random() * 0.2 - 0.1));
  const offsetMs = index * baseSpacingMs + jitterMs;
  return addSendWindowOffset(settings, Math.max(0, offsetMs), now);
}

export function communicationEmailSpacingEstimateMs(settings: CommunicationSettings) {
  const windowMs = sendWindowDurationMs(settings);
  const baseDelay = Math.ceil(windowMs / settings.campaignEmailDailyLimit);
  const jitter = Math.round(baseDelay * (Math.random() * 0.2 - 0.1));
  return Math.max(0, baseDelay + jitter);
}
