type Provider = "stub" | "gmail" | "smsgate";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_SETTINGS_SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";
export const GMAIL_OAUTH_SCOPE = `${GMAIL_SEND_SCOPE} ${GMAIL_SETTINGS_SCOPE}`;

export type DeliveryMessage = {
  channel: "email" | "sms";
  provider: Provider;
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  body: string;
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

function mimeMessage(input: DeliveryMessage) {
  const from = addressHeader(input.from, input.fromName);
  const to = headerValue(input.to);
  const subject = headerValue(input.subject);
  const signature = input.provider === "gmail" ? input.providerConfig?.gmailSignature?.trim() : "";
  if (signature) {
    const boundary = `insulhub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const plainBody = appendEmailSignature(input.body, stripHtml(signature)).replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
    const htmlBody = `${plainToHtml(input.body).replace(/(<br>)*$/g, "")}<br><br>${signature}`;

    return [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      plainBody,
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      htmlBody,
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

function normalizeBaseUrl(raw: string) {
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
  const refreshToken = input.refreshToken || process.env.GMAIL_SEND_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
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
  let token = input.accessToken || process.env.GMAIL_SEND_ACCESS_TOKEN?.trim() || "";
  let refreshed: Awaited<ReturnType<typeof refreshGmailToken>> = null;
  if (!token || !tokenIsFresh(input.tokenExpiresAt)) {
    refreshed = await refreshGmailToken(input);
    if (refreshed) token = refreshed.accessToken;
  }
  if (!token) throw new Error("Connect Gmail before sending");

  const userId = input.providerConfig?.gmailUserId || process.env.GMAIL_SEND_USER_ID?.trim() || "me";
  const raw = base64Url(mimeMessage(input));

  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userId)}/messages/send`, {
    method: "POST",
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

function smsgateAuthHeaders(config?: Record<string, string>) {
  const token = config?.smsgateAuthToken || process.env.SMSGATE_AUTH_TOKEN?.trim();
  if (token) return { authorization: `Bearer ${token}` };

  const username = config?.smsgateUsername || process.env.SMSGATE_USERNAME?.trim();
  const password = config?.smsgatePassword || process.env.SMSGATE_PASSWORD?.trim();
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
