type Provider = "stub" | "gmail" | "smsgate";

const trustedEmailHtmlBrand = Symbol("trusted-email-html");
const MAX_TRUSTED_EMAIL_HTML_BYTES = 96 * 1024;

export type TrustedEmailHtml = {
  readonly html: string;
  readonly [trustedEmailHtmlBrand]: true;
};

/** Server-rendered email HTML only. The symbol brand cannot be supplied by JSON/request spreading. */
export function createTrustedEmailHtml(html: string): TrustedEmailHtml {
  if (!html || html.includes("\0") || Buffer.byteLength(html, "utf8") > MAX_TRUSTED_EMAIL_HTML_BYTES) {
    throw new Error("Trusted email HTML is invalid");
  }
  return Object.freeze({ html, [trustedEmailHtmlBrand]: true as const });
}

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_SETTINGS_SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";
export const GMAIL_OAUTH_SCOPE = `${GMAIL_SEND_SCOPE} ${GMAIL_SETTINGS_SCOPE}`;

export type DeliveryMessage = {
  signal?: AbortSignal;
  // Account emails must use the selected connection and prove its authorised From address.
  strictGmailConnection?: boolean;
  channel: "email" | "sms";
  provider: Provider;
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  body: string;
  trustedHtml?: TrustedEmailHtml;
  providerConfig?: Record<string, string>;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string | null;
};

export type DeliveryResult = {
  ok: boolean;
  providerMessageId?: string;
  failureReason?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
};

export type ConnectionTestInput = {
  provider: Provider;
  providerConfig?: Record<string, string>;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string | null;
};

export type GmailSignatureResult = DeliveryResult & {
  signature?: string;
  signatureEmail?: string;
};

export type SmsgateInboxMessage = {
  id: string;
  type: string;
  sender: string;
  recipient: string;
  simNumber: number | null;
  message: string;
  receivedAt: string;
};

export type SmsgateInboxResult = {
  ok: boolean;
  messages: SmsgateInboxMessage[];
  failureReason?: string;
  unsupportedInCloudMode?: boolean;
};

export type SmsgateWebhook = {
  id: string;
  url: string;
  event: string;
  deviceId: string;
};

export type SmsgateDevice = {
  id: string;
  name: string;
  lastSeen: string;
  createdAt: string;
  updatedAt: string;
};

export type SmsgateLogEntry = {
  createdAt: string;
  module: string;
  priority: string;
  message: string;
};

export type SmsgateApiResult<T> = {
  ok: boolean;
  status: number;
  value?: T;
  failureReason?: string;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function base64Url(input: string) {
  return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function headerValue(input: string) {
  return input.replace(/[\r\n]+/g, " ").trim();
}

function encodeMimeHeader(input: string) {
  const clean = headerValue(input);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  const words: string[] = [];
  let chunk = "";
  for (const character of clean) {
    const candidate = `${chunk}${character}`;
    if (chunk && Buffer.byteLength(candidate, "utf8") > 42) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`);
      chunk = character;
    } else chunk = candidate;
  }
  if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`);
  return words.join("\r\n ");
}

function addressHeader(email: string, displayName?: string) {
  const address = headerValue(email);
  const name = headerValue(displayName || "");
  if (!name) return address;
  const quotedName = name.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  return `"${quotedName}" <${address}>`;
}

function appendEmailSignature(body: string, signature?: string) {
  const cleanSignature = (signature || "").trim();
  if (!cleanSignature) return body;
  return `${body.replace(/\s+$/g, "")}\n\n${cleanSignature}`;
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plainToHtml(input: string) {
  return escapeHtml(input).replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
}

function stripHtml(input: string) {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function base64MimeBody(input: string) {
  return Buffer.from(input, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function mimeMessage(input: DeliveryMessage) {
  const from = addressHeader(input.from, input.fromName);
  const to = headerValue(input.to);
  const subject = encodeMimeHeader(input.subject);
  const signature = input.provider === "gmail" ? input.providerConfig?.gmailSignature?.trim() ?? "" : "";
  const trustedHtml = input.trustedHtml;
  if (trustedHtml !== undefined && trustedHtml[trustedEmailHtmlBrand] !== true) throw new Error("Trusted email HTML is invalid");
  if (signature || trustedHtml) {
    let boundary = "";
    do boundary = `insulhub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    while (input.body.includes(boundary) || trustedHtml?.html.includes(boundary) || signature.includes(boundary));
    const plainBody = base64MimeBody(appendEmailSignature(input.body, stripHtml(signature)));
    const baseHtml = trustedHtml?.html ?? plainToHtml(input.body).replace(/(<br>)*$/g, "");
    const htmlBody = signature ? `${baseHtml}<br><br>${signature}` : baseHtml;

    return [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      plainBody,
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      base64MimeBody(htmlBody),
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }

  const body = input.body.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
}

async function parseResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text };
  }
}

function responseErrorMessage(body: Record<string, unknown>, fallback: string) {
  const error = body.error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  if (typeof error === "string") return error;
  if (typeof body.error_description === "string") return body.error_description;
  if (typeof body.message === "string") return body.message;
  return fallback;
}

export function normalizeBaseUrl(raw: string) {
  const value = raw.trim().replace(/\/+$/, "");
  if (!value) return value;
  const withProtocol = /^https?:\/\//i.test(value)
    ? value
    : value.includes(":443") || value.includes("sms-gate.app")
      ? `https://${value}`
      : `http://${value}`;
  const url = new URL(withProtocol);
  if (url.hostname === "api.sms-gate.app" && (url.pathname === "/" || url.pathname === "")) {
    url.pathname = "/3rdparty/v1";
  }
  return url.toString().replace(/\/+$/, "");
}

async function refreshGmailToken(input: DeliveryMessage) {
  const clientId = process.env.GMAIL_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET?.trim();
  const refreshToken = input.refreshToken || (input.strictGmailConnection ? undefined : process.env.GMAIL_SEND_REFRESH_TOKEN?.trim());
  if (!clientId || !clientSecret || !refreshToken) return null;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    ...(input.signal ? { signal: input.signal } : {}),
    method: "POST",
    ...(input.strictGmailConnection ? { redirect: "error" as const } : {}),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const body = await parseResponseBody(response);
  if (!response.ok || typeof body.access_token !== "string") {
    throw new Error(responseErrorMessage(body, "Could not refresh Gmail access"));
  }

  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : Number(body.expires_in || 3600);
  return {
    accessToken: body.access_token,
    refreshToken,
    tokenExpiresAt: new Date(Date.now() + Math.max(60, expiresIn - 60) * 1000).toISOString(),
  };
}

function tokenIsFresh(value?: string | null) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time > Date.now() + 60_000;
}

async function sendGmail(input: DeliveryMessage): Promise<DeliveryResult> {
  let token = input.accessToken || (input.strictGmailConnection ? "" : process.env.GMAIL_SEND_ACCESS_TOKEN?.trim()) || "";
  let refreshed: Awaited<ReturnType<typeof refreshGmailToken>> = null;
  if (!token || !tokenIsFresh(input.tokenExpiresAt)) {
    refreshed = await refreshGmailToken(input);
    if (refreshed) token = refreshed.accessToken;
    else if (input.strictGmailConnection) throw new Error("Selected Gmail connection could not be refreshed");
  }
  if (!token) throw new Error("Connect Gmail before sending");

  const userId = input.strictGmailConnection ? "me" : input.providerConfig?.gmailUserId || process.env.GMAIL_SEND_USER_ID?.trim() || "me";
  if (input.strictGmailConnection) {
    const identity = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs/${encodeURIComponent(input.from.trim().toLowerCase())}`, {
      headers: { authorization: `Bearer ${token}` }, signal: input.signal, redirect: "error",
    });
    const sendAs = await parseResponseBody(identity);
    if (!identity.ok || typeof sendAs.sendAsEmail !== "string" ||
        sendAs.sendAsEmail.toLowerCase() !== input.from.trim().toLowerCase() ||
        !(sendAs.isPrimary === true || sendAs.verificationStatus === "accepted")) {
      throw new Error("Selected Gmail connection is not authorised for the account sender");
    }
  }
  const raw = base64Url(mimeMessage(input));

  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userId)}/messages/send`, {
    ...(input.signal ? { signal: input.signal } : {}),
    method: "POST",
    ...(input.strictGmailConnection ? { redirect: "error" as const } : {}),
    headers: {
      "authorization": `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  const body = await parseResponseBody(response);
  if (!response.ok) {
    return {
      ok: false,
      failureReason: responseErrorMessage(body, response.statusText),
    };
  }

  return {
    ok: true,
    providerMessageId: typeof body.id === "string" ? body.id : undefined,
    accessToken: refreshed?.accessToken,
    refreshToken: refreshed?.refreshToken,
    tokenExpiresAt: refreshed?.tokenExpiresAt,
  };
}

async function getGmailAccess(input: ConnectionTestInput | DeliveryMessage) {
  let token = input.accessToken || process.env.GMAIL_SEND_ACCESS_TOKEN?.trim() || "";
  let refreshed: Awaited<ReturnType<typeof refreshGmailToken>> = null;
  if (!token || !tokenIsFresh(input.tokenExpiresAt)) {
    refreshed = await refreshGmailToken(input as DeliveryMessage);
    if (refreshed) token = refreshed.accessToken;
  }
  if (!token) throw new Error("Connect Gmail before sending");
  return { token, refreshed };
}

async function testGmailConnection(input: ConnectionTestInput): Promise<DeliveryResult> {
  const { token, refreshed } = await getGmailAccess(input);
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
  const body = await parseResponseBody(response);
  if (!response.ok) {
    return { ok: false, failureReason: responseErrorMessage(body, response.statusText) };
  }
  const scope = typeof body.scope === "string" ? body.scope : "";
  const scopes = scope.split(/\s+/);
  if (!scopes.includes(GMAIL_SEND_SCOPE)) {
    return { ok: false, failureReason: "Gmail is connected, but the send permission is missing. Reconnect Gmail and approve send access." };
  }
  if (!scopes.includes(GMAIL_SETTINGS_SCOPE)) {
    return { ok: false, failureReason: "Gmail is connected, but signature access is missing. Reconnect Gmail and approve the updated access." };
  }
  return {
    ok: true,
    accessToken: refreshed?.accessToken,
    refreshToken: refreshed?.refreshToken,
    tokenExpiresAt: refreshed?.tokenExpiresAt,
  };
}

export async function fetchGmailSignature(input: ConnectionTestInput, senderEmail?: string): Promise<GmailSignatureResult> {
  try {
    const { token, refreshed } = await getGmailAccess(input);
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs", {
      headers: {
        "authorization": `Bearer ${token}`,
        "content-type": "application/json",
      },
    });
    const body = await parseResponseBody(response);
    if (!response.ok) {
      return {
        ok: false,
        failureReason: responseErrorMessage(body, response.statusText),
        accessToken: refreshed?.accessToken,
        refreshToken: refreshed?.refreshToken,
        tokenExpiresAt: refreshed?.tokenExpiresAt,
      };
    }

    const sendAs = Array.isArray(body.sendAs) ? body.sendAs as Array<Record<string, unknown>> : [];
    const wantedEmail = senderEmail?.trim().toLowerCase();
    const exact = wantedEmail
      ? sendAs.find((item) => stringValue(item.sendAsEmail).toLowerCase() === wantedEmail)
      : undefined;
    const primary = sendAs.find((item) => Boolean(item.isPrimary));
    const withSignature = sendAs.find((item) => stringValue(item.signature).trim());
    const selected = exact || primary || withSignature || sendAs[0];
    const signature = stringValue(selected?.signature).trim();

    return {
      ok: true,
      signature,
      signatureEmail: stringValue(selected?.sendAsEmail),
      accessToken: refreshed?.accessToken,
      refreshToken: refreshed?.refreshToken,
      tokenExpiresAt: refreshed?.tokenExpiresAt,
    };
  } catch (error) {
    return { ok: false, failureReason: friendlyNetworkError(error, "Could not sync Gmail signature") };
  }
}

export function smsgateAuthHeaders(config?: Record<string, string>, strict = false) {
  const token = config?.smsgateAuthToken || (!strict ? process.env.SMSGATE_AUTH_TOKEN?.trim() : undefined);
  if (token) return { authorization: `Bearer ${token}` };

  const username = config?.smsgateUsername || (!strict ? process.env.SMSGATE_USERNAME?.trim() : undefined);
  const password = config?.smsgatePassword || (!strict ? process.env.SMSGATE_PASSWORD?.trim() : undefined);
  if (username && password) {
    return { authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}` };
  }

  throw new Error("SMSGATE_AUTH_TOKEN or SMSGATE_USERNAME/SMSGATE_PASSWORD is required");
}

function normalizeSmsPhoneNumber(value: string) {
  const compact = value.replace(/[^\d+]/g, "");
  if (compact.startsWith("+64")) return compact;
  const digits = compact.replace(/\D/g, "");
  if (digits.startsWith("0")) return `+64${digits.slice(1)}`;
  if (digits.startsWith("64")) return `+${digits}`;
  return compact;
}

export async function readSmsgateInbox(input: {
  providerConfig?: Record<string, string>;
  from: string;
  to: string;
  limit?: number;
}): Promise<SmsgateInboxResult> {
  try {
    const baseUrl = normalizeBaseUrl(input.providerConfig?.smsgateBaseUrl || requiredEnv("SMSGATE_BASE_URL"));
    const limit = Math.max(1, Math.min(500, Math.trunc(input.limit || 100)));
    const query = new URLSearchParams({
      type: "SMS",
      limit: String(limit),
      offset: "0",
      from: input.from,
      to: input.to,
    });
    const deviceId = input.providerConfig?.smsgateDeviceId || process.env.SMSGATE_DEVICE_ID?.trim();
    if (deviceId) query.set("deviceId", deviceId);

    const response = await fetch(`${baseUrl}/inbox?${query.toString()}`, {
      headers: {
        ...smsgateAuthHeaders(input.providerConfig),
        "content-type": "application/json",
      },
      cache: "no-store",
    });
    const text = await response.text();
    let body: unknown = [];
    try {
      body = text ? JSON.parse(text) : [];
    } catch {
      body = { message: text };
    }
    if (!response.ok) {
      const record = body && typeof body === "object" && !Array.isArray(body)
        ? body as Record<string, unknown>
        : {};
      return {
        ok: false,
        messages: [],
        failureReason: responseErrorMessage(record, response.statusText || `SMSGate inbox request failed (${response.status})`),
        unsupportedInCloudMode: response.status === 501,
      };
    }
    if (!Array.isArray(body)) {
      return { ok: false, messages: [], failureReason: "SMSGate returned an unexpected inbox response" };
    }

    const messages = body.map((row): SmsgateInboxMessage | null => {
      if (!row || typeof row !== "object") return null;
      const value = row as Record<string, unknown>;
      const sender = stringValue(value.sender || value.phoneNumber);
      const message = stringValue(value.contentPreview || value.message);
      const receivedAt = stringValue(value.createdAt || value.receivedAt);
      if (!sender || !receivedAt) return null;
      return {
        id: stringValue(value.id || value.messageId),
        type: stringValue(value.type) || "SMS",
        sender,
        recipient: stringValue(value.recipient),
        simNumber: typeof value.simNumber === "number" ? value.simNumber : null,
        message,
        receivedAt,
      };
    }).filter((message): message is SmsgateInboxMessage => Boolean(message));

    return { ok: true, messages };
  } catch (error) {
    return { ok: false, messages: [], failureReason: friendlyNetworkError(error, "Could not read SMSGate inbox") };
  }
}

async function smsgateJsonRequest<T>(input: {
  providerConfig?: Record<string, string>;
  path: string;
  method?: "GET" | "POST" | "DELETE";
  body?: Record<string, unknown>;
}): Promise<SmsgateApiResult<T>> {
  try {
    const baseUrl = normalizeBaseUrl(input.providerConfig?.smsgateBaseUrl || requiredEnv("SMSGATE_BASE_URL"));
    const response = await fetch(`${baseUrl}${input.path}`, {
      method: input.method || "GET",
      headers: {
        ...smsgateAuthHeaders(input.providerConfig),
        "content-type": "application/json",
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      cache: "no-store",
    });
    const text = await response.text();
    let value: unknown;
    try {
      value = text ? JSON.parse(text) : undefined;
    } catch {
      value = text ? { message: text } : undefined;
    }
    if (!response.ok) {
      const record = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
      return {
        ok: false,
        status: response.status,
        failureReason: responseErrorMessage(record, response.statusText || `SMSGate request failed (${response.status})`),
      };
    }
    return { ok: true, status: response.status, value: value as T };
  } catch (error) {
    return { ok: false, status: 0, failureReason: friendlyNetworkError(error, "Could not reach SMSGate") };
  }
}

export async function listSmsgateWebhooks(providerConfig?: Record<string, string>) {
  return smsgateJsonRequest<SmsgateWebhook[]>({ providerConfig, path: "/webhooks" });
}

export async function listSmsgateDevices(providerConfig?: Record<string, string>) {
  return smsgateJsonRequest<SmsgateDevice[]>({ providerConfig, path: "/devices" });
}

export async function getSmsgateLogs(input: {
  providerConfig?: Record<string, string>;
  from: string;
  to: string;
}) {
  const params = new URLSearchParams({ from: input.from, to: input.to });
  return smsgateJsonRequest<SmsgateLogEntry[]>({ providerConfig: input.providerConfig, path: `/logs?${params}` });
}

export async function getSmsgateSettings(providerConfig?: Record<string, string>) {
  return smsgateJsonRequest<Record<string, unknown>>({ providerConfig, path: "/settings" });
}

export async function registerSmsgateWebhook(input: {
  providerConfig?: Record<string, string>;
  url: string;
  event: "sms:received" | "sms:batch:received";
}): Promise<SmsgateApiResult<SmsgateWebhook>> {
  const body: Record<string, unknown> = { url: input.url, event: input.event };
  const deviceId = input.providerConfig?.smsgateDeviceId || process.env.SMSGATE_DEVICE_ID?.trim();
  if (deviceId) body.deviceId = deviceId;
  return smsgateJsonRequest<SmsgateWebhook>({
    providerConfig: input.providerConfig,
    path: "/webhooks",
    method: "POST",
    body,
  });
}

export async function deleteSmsgateWebhook(providerConfig: Record<string, string> | undefined, id: string) {
  return smsgateJsonRequest<undefined>({
    providerConfig,
    path: `/webhooks/${encodeURIComponent(id)}`,
    method: "DELETE",
  });
}

export async function refreshSmsgateInbox(input: {
  providerConfig?: Record<string, string>;
  from: string;
  to: string;
  webhookDelivery?: "Individual" | "Batch";
}): Promise<SmsgateApiResult<undefined>> {
  const body: Record<string, unknown> = {
    since: input.from,
    until: input.to,
    messageTypes: ["SMS"],
    webhookDelivery: input.webhookDelivery || "Individual",
  };
  const deviceId = input.providerConfig?.smsgateDeviceId || process.env.SMSGATE_DEVICE_ID?.trim();
  if (deviceId) body.deviceId = deviceId;
  return smsgateJsonRequest<undefined>({
    providerConfig: input.providerConfig,
    path: "/inbox/refresh",
    method: "POST",
    body,
  });
}

async function sendSmsgate(input: DeliveryMessage): Promise<DeliveryResult> {
  const baseUrl = normalizeBaseUrl(input.providerConfig?.smsgateBaseUrl || requiredEnv("SMSGATE_BASE_URL"));
  const deviceId = input.providerConfig?.smsgateDeviceId || process.env.SMSGATE_DEVICE_ID?.trim();
  const simNumber = input.providerConfig?.smsgateSimNumber || process.env.SMSGATE_SIM_NUMBER?.trim();
  const requestBody: Record<string, unknown> = {
    phoneNumbers: [normalizeSmsPhoneNumber(input.to)],
    textMessage: { text: input.body },
    withDeliveryReport: true,
  };
  if (deviceId) requestBody.deviceId = deviceId;
  if (simNumber) requestBody.simNumber = Number(simNumber);

  let response = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      ...smsgateAuthHeaders(input.providerConfig),
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  let body = await parseResponseBody(response);
  const firstFailure = responseErrorMessage(body, response.statusText);
  if (!response.ok && deviceId && /select device|record not found|device/i.test(firstFailure)) {
    delete requestBody.deviceId;
    response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        ...smsgateAuthHeaders(input.providerConfig),
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    body = await parseResponseBody(response);
  }
  if (!response.ok) {
    return { ok: false, failureReason: responseErrorMessage(body, response.statusText) };
  }

  return { ok: true, providerMessageId: typeof body.id === "string" ? body.id : undefined };
}

async function testSmsgateConnection(input: ConnectionTestInput): Promise<DeliveryResult> {
  const baseUrl = normalizeBaseUrl(input.providerConfig?.smsgateBaseUrl || requiredEnv("SMSGATE_BASE_URL"));
  const response = await fetch(`${baseUrl}/devices`, {
    headers: {
      ...smsgateAuthHeaders(input.providerConfig),
      "content-type": "application/json",
    },
  });
  const body = await parseResponseBody(response);
  if (!response.ok) return { ok: false, failureReason: responseErrorMessage(body, response.statusText) };
  const deviceId = input.providerConfig?.smsgateDeviceId?.trim();
  if (deviceId && Array.isArray(body)) {
    const found = body.some((device) => (
      device && typeof device === "object" && (device as { id?: unknown }).id === deviceId
    ));
    if (!found) {
      return {
        ok: false,
        failureReason: "Connected to SMSGate, but the Device ID was not found. Check the Device ID, or remove it to let SMSGate choose an available device.",
      };
    }
  }
  return { ok: true };
}

export async function deliverCommunication(input: DeliveryMessage): Promise<DeliveryResult> {
  try {
    if (input.provider === "stub") return { ok: true, providerMessageId: `stub-${Date.now()}` };
    if (input.provider === "gmail") return sendGmail(input);
    if (input.provider === "smsgate") return sendSmsgate(input);
    return { ok: false, failureReason: `Unsupported provider: ${input.provider}` };
  } catch (error) {
    return { ok: false, failureReason: friendlyNetworkError(error, "Delivery failed") };
  }
}

export async function testCommunicationConnection(input: ConnectionTestInput): Promise<DeliveryResult> {
  try {
    if (input.provider === "stub") return { ok: true };
    if (input.provider === "gmail") return testGmailConnection(input);
    if (input.provider === "smsgate") return testSmsgateConnection(input);
    return { ok: false, failureReason: `Unsupported provider: ${input.provider}` };
  } catch (error) {
    return { ok: false, failureReason: friendlyNetworkError(error, "Connection test failed") };
  }
}

function friendlyNetworkError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (error.message === "fetch failed") {
    return "Could not reach the server address from InsulHub. Check the SMSGate server address includes the right host/port and is reachable from this device/server.";
  }
  return error.message || fallback;
}
