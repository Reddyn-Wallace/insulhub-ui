/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

function jsonResponse(status, body, statusText = status < 400 ? "OK" : "Bad Request") {
  return {
    ok: status < 400,
    status,
    statusText,
    text: async () => JSON.stringify(body),
  };
}

function decodeBase64Url(value) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function loadCommunicationDeliveryModule(fetchProxy) {
  const filename = path.join(__dirname, "..", "src", "lib", "communication-delivery.ts");
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;

  const module = { exports: {} };
  const context = vm.createContext({
    exports: module.exports,
    module,
    require,
    console,
    Buffer,
    Date,
    Error,
    JSON,
    Math,
    Number,
    process: { env: {} },
    URL,
    URLSearchParams,
    fetch: (...args) => fetchProxy(...args),
  });
  const script = new vm.Script(output, { filename });
  script.runInContext(context);
  return module.exports;
}

(async () => {
  let mockFetch = async () => {
    throw new Error("Unexpected fetch");
  };
  const delivery = loadCommunicationDeliveryModule((...args) => mockFetch(...args));
  const futureTokenExpiry = new Date(Date.now() + 60 * 60_000).toISOString();

  const stubResult = await delivery.deliverCommunication({
    channel: "email",
    provider: "stub",
    from: "stub@example.com",
    to: "test@example.com",
    subject: "Subject",
    body: "Body",
  });
  assert.equal(stubResult.ok, true);
  assert.match(stubResult.providerMessageId, /^stub-/);

  mockFetch = async () => jsonResponse(200, {
    scope: delivery.GMAIL_SEND_SCOPE,
  });
  const missingSettingsScope = await delivery.testCommunicationConnection({
    provider: "gmail",
    accessToken: "token",
    tokenExpiresAt: futureTokenExpiry,
  });
  assert.equal(missingSettingsScope.ok, false);
  assert.match(missingSettingsScope.failureReason, /signature access is missing/i);

  mockFetch = async () => jsonResponse(200, {
    scope: delivery.GMAIL_OAUTH_SCOPE,
  });
  const gmailConnection = await delivery.testCommunicationConnection({
    provider: "gmail",
    accessToken: "token",
    tokenExpiresAt: futureTokenExpiry,
  });
  assert.equal(gmailConnection.ok, true);

  mockFetch = async (url) => {
    assert.equal(String(url), "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs");
    return jsonResponse(200, {
      sendAs: [
        { sendAsEmail: "primary@example.com", isPrimary: true, signature: "<div>Primary</div>" },
        { sendAsEmail: "reddyn@insulmax.co.nz", isPrimary: false, signature: "<div><b>Reddyn</b><br>Insulmax</div>" },
      ],
    });
  };
  const signature = await delivery.fetchGmailSignature({
    provider: "gmail",
    accessToken: "token",
    tokenExpiresAt: futureTokenExpiry,
  }, "reddyn@insulmax.co.nz");
  assert.equal(signature.ok, true);
  assert.equal(signature.signatureEmail, "reddyn@insulmax.co.nz");
  assert.equal(signature.signature, "<div><b>Reddyn</b><br>Insulmax</div>");

  let gmailRequestBody;
  mockFetch = async (url, init) => {
    assert.equal(String(url), "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    gmailRequestBody = JSON.parse(init.body);
    return jsonResponse(200, { id: "gmail-message-1" });
  };
  const gmailSend = await delivery.deliverCommunication({
    channel: "email",
    provider: "gmail",
    from: "reddyn@insulmax.co.nz",
    fromName: "Reddyn Wallace",
    to: "test@example.com",
    subject: "Quote follow up",
    body: "Hi Jane,\nThis is a test.",
    providerConfig: {
      gmailSignature: '<div style="color:#f36c21"><b>Reddyn Wallace</b><br><a href="https://insulmax.co.nz">insulmax.co.nz</a></div>',
    },
    accessToken: "token",
    tokenExpiresAt: futureTokenExpiry,
  });
  assert.equal(gmailSend.ok, true);
  assert.equal(gmailSend.providerMessageId, "gmail-message-1");
  const rawMime = decodeBase64Url(gmailRequestBody.raw);
  assert.match(rawMime, /From: "Reddyn Wallace" <reddyn@insulmax\.co\.nz>/);
  assert.match(rawMime, /Content-Type: multipart\/alternative/);
  assert.match(rawMime, /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(rawMime, /Reddyn Wallace\r\ninsulmax\.co\.nz/);
  assert.match(rawMime, /Content-Type: text\/html; charset=UTF-8/);
  assert.match(rawMime, /<div style="color:#f36c21"><b>Reddyn Wallace<\/b><br><a href="https:\/\/insulmax\.co\.nz">insulmax\.co\.nz<\/a><\/div>/);

  let smsgateUrl = "";
  let smsgateBody;
  let smsgateAuth = "";
  mockFetch = async (url, init) => {
    smsgateUrl = String(url);
    smsgateBody = JSON.parse(init.body);
    smsgateAuth = init.headers.authorization;
    return jsonResponse(200, { id: "sms-message-1" });
  };
  const smsSend = await delivery.deliverCommunication({
    channel: "sms",
    provider: "smsgate",
    from: "Main phone",
    to: "027 123 4567",
    subject: "",
    body: "SMS test",
    providerConfig: {
      smsgateBaseUrl: "api.sms-gate.app:443",
      smsgateUsername: "user",
      smsgatePassword: "pass",
    },
  });
  assert.equal(smsSend.ok, true);
  assert.equal(smsgateUrl, "https://api.sms-gate.app/3rdparty/v1/messages");
  assert.deepEqual(smsgateBody.phoneNumbers, ["+64271234567"]);
  assert.equal(smsgateBody.textMessage.text, "SMS test");
  assert.equal(smsgateAuth, `Basic ${Buffer.from("user:pass", "utf8").toString("base64")}`);

  mockFetch = async (url, init) => {
    const parsed = new URL(String(url));
    assert.equal(`${parsed.origin}${parsed.pathname}`, "https://api.sms-gate.app/3rdparty/v1/inbox");
    assert.equal(parsed.searchParams.get("type"), "SMS");
    assert.equal(parsed.searchParams.get("limit"), "25");
    assert.equal(parsed.searchParams.get("deviceId"), "device-1");
    assert.equal(init.headers.authorization, `Basic ${Buffer.from("user:pass", "utf8").toString("base64")}`);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify([{
        id: "reply-1",
        type: "SMS",
        sender: "+64271234567",
        recipient: "+64210000000",
        simNumber: 1,
        contentPreview: "Yes please",
        createdAt: "2026-08-30T08:15:00Z",
      }]),
    };
  };
  const inbox = await delivery.readSmsgateInbox({
    providerConfig: {
      smsgateBaseUrl: "api.sms-gate.app:443",
      smsgateUsername: "user",
      smsgatePassword: "pass",
      smsgateDeviceId: "device-1",
    },
    from: "2026-08-29T00:00:00Z",
    to: "2026-08-30T23:59:59Z",
    limit: 25,
  });
  assert.equal(inbox.ok, true);
  assert.equal(inbox.messages.length, 1);
  assert.equal(inbox.messages[0].message, "Yes please");

  mockFetch = async () => ({
    ok: false,
    status: 501,
    statusText: "Not Implemented",
    text: async () => JSON.stringify({ message: "Inbox listing is not available in cloud mode" }),
  });
  const unsupportedInbox = await delivery.readSmsgateInbox({
    providerConfig: {
      smsgateBaseUrl: "api.sms-gate.app:443",
      smsgateUsername: "user",
      smsgatePassword: "pass",
    },
    from: "2026-08-29T00:00:00Z",
    to: "2026-08-30T23:59:59Z",
  });
  assert.equal(unsupportedInbox.ok, false);
  assert.equal(unsupportedInbox.unsupportedInCloudMode, true);

  const smsgateCalls = [];
  mockFetch = async (url, init = {}) => {
    smsgateCalls.push({ url: String(url), init });
    if (String(url).endsWith("/devices") && (init.method || "GET") === "GET") {
      return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify([{ id: "device-1", name: "Phone", lastSeen: "2026-08-30T20:00:00Z" }]) };
    }
    if (String(url).endsWith("/webhooks") && (init.method || "GET") === "GET") {
      return { ok: true, status: 200, statusText: "OK", text: async () => JSON.stringify([]) };
    }
    if (String(url).endsWith("/webhooks") && init.method === "POST") {
      return { ok: true, status: 201, statusText: "Created", text: async () => JSON.stringify({ id: "hook-1", url: "https://example.com/hook", event: "sms:batch:received" }) };
    }
    return { ok: true, status: init.method === "DELETE" ? 204 : 202, statusText: "OK", text: async () => "" };
  };
  const gatewayConfig = {
    smsgateBaseUrl: "api.sms-gate.app:443",
    smsgateUsername: "user",
    smsgatePassword: "pass",
    smsgateDeviceId: "device-1",
  };
  const devices = await delivery.listSmsgateDevices(gatewayConfig);
  assert.equal(devices.ok, true);
  assert.equal(devices.value[0].id, "device-1");
  assert.equal((await delivery.listSmsgateWebhooks(gatewayConfig)).ok, true);
  assert.equal((await delivery.registerSmsgateWebhook({
    providerConfig: gatewayConfig,
    url: "https://example.com/hook",
    event: "sms:batch:received",
  })).value.id, "hook-1");
  assert.equal((await delivery.refreshSmsgateInbox({
    providerConfig: gatewayConfig,
    from: "2026-08-29T00:00:00Z",
    to: "2026-08-30T23:59:59Z",
  })).ok, true);
  assert.equal((await delivery.deleteSmsgateWebhook(gatewayConfig, "hook-1")).ok, true);
  const registerBody = JSON.parse(smsgateCalls[2].init.body);
  assert.equal(registerBody.deviceId, "device-1");
  assert.equal(registerBody.event, "sms:batch:received");
  const refreshBody = JSON.parse(smsgateCalls[3].init.body);
  assert.deepEqual(refreshBody.messageTypes, ["SMS"]);
  assert.equal(refreshBody.webhookDelivery, "Batch");
  assert.equal(smsgateCalls[4].url, "https://api.sms-gate.app/3rdparty/v1/webhooks/hook-1");

  console.log("communication delivery tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
