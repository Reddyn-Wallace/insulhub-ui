/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

function loadCommunicationSettingsModule() {
  const filename = path.join(__dirname, "..", "src", "lib", "communication-settings.ts");
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
    require: (request) => {
      if (request === "@/lib/overlay-db") {
        return {
          ensureOverlaySchema: async () => undefined,
          overlaySql: async () => [],
        };
      }
      return require(request);
    },
    console,
    Date,
    Intl,
    Math,
    JSON,
    Number,
    String,
    Boolean,
  });
  const script = new vm.Script(output, { filename });
  script.runInContext(context);
  return module.exports;
}

function nzDate(year, month, day, hour, minute) {
  // These tests use June dates, where New Zealand is UTC+12.
  return new Date(Date.UTC(year, month - 1, day - 1, hour + 12, minute));
}

function nzStamp(date) {
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

function withFixedRandom(value, fn) {
  const original = Math.random;
  Math.random = () => value;
  try {
    fn();
  } finally {
    Math.random = original;
  }
}

const settingsModule = loadCommunicationSettingsModule();
const {
  addSendWindowOffset,
  campaignRecipientScheduleAt,
  communicationSendWindowError,
  nextAllowedSendAt,
  normalizeCommunicationSettings,
} = settingsModule;

const baseSettings = normalizeCommunicationSettings({
  campaignSendWindowEnabled: true,
  campaignSendWindowStartTime: "08:30",
  campaignSendWindowEndTime: "17:30",
  campaignSmsPerMinute: 30,
  campaignEmailDailyLimit: 60,
});

const clamped = normalizeCommunicationSettings({
  campaignSendWindowEnabled: "false",
  campaignSendWindowStartTime: "bad",
  campaignSendWindowEndTime: "26:00",
  campaignSmsPerMinute: 0,
  campaignEmailDailyLimit: 10_000,
});
assert.equal(clamped.campaignSendWindowEnabled, false);
assert.equal(clamped.campaignSendWindowStartTime, "08:30");
assert.equal(clamped.campaignSendWindowEndTime, "17:30");
assert.equal(clamped.campaignSmsPerMinute, 1);
assert.equal(clamped.campaignEmailDailyLimit, 2_000);

assert.equal(
  communicationSendWindowError(baseSettings, nzDate(2026, 6, 19, 8, 0)),
  "Campaigns can only be sent between 08:30 and 17:30 NZ time."
);
assert.equal(communicationSendWindowError(baseSettings, nzDate(2026, 6, 19, 9, 0)), "");
assert.equal(
  communicationSendWindowError(baseSettings, nzDate(2026, 6, 19, 17, 30)),
  "Campaigns can only be sent between 08:30 and 17:30 NZ time."
);

assert.equal(nzStamp(nextAllowedSendAt(baseSettings, 0, nzDate(2026, 6, 19, 8, 0))), "2026-06-19 08:30");
assert.equal(nzStamp(nextAllowedSendAt(baseSettings, 0, nzDate(2026, 6, 19, 9, 15))), "2026-06-19 09:15");
assert.equal(nzStamp(nextAllowedSendAt(baseSettings, 0, nzDate(2026, 6, 19, 18, 5))), "2026-06-20 08:30");

assert.equal(
  nzStamp(addSendWindowOffset(baseSettings, 20 * 60_000, nzDate(2026, 6, 19, 17, 20))),
  "2026-06-20 08:40"
);
assert.equal(
  nzStamp(addSendWindowOffset({ ...baseSettings, campaignSendWindowEnabled: false }, 20 * 60_000, nzDate(2026, 6, 19, 17, 20))),
  "2026-06-19 17:40"
);

assert.equal(
  nzStamp(campaignRecipientScheduleAt({ ...baseSettings, campaignSmsPerMinute: 1 }, "sms", 4, nzDate(2026, 6, 19, 17, 29))),
  "2026-06-20 08:33"
);

withFixedRandom(0.5, () => {
  const tinyWindowSettings = normalizeCommunicationSettings({
    campaignSendWindowEnabled: true,
    campaignSendWindowStartTime: "08:30",
    campaignSendWindowEndTime: "08:33",
    campaignSmsPerMinute: 30,
    campaignEmailDailyLimit: 3,
  });
  assert.equal(
    nzStamp(campaignRecipientScheduleAt(tinyWindowSettings, "email", 0, nzDate(2026, 6, 19, 8, 30))),
    "2026-06-19 08:30"
  );
  assert.equal(
    nzStamp(campaignRecipientScheduleAt(tinyWindowSettings, "email", 2, nzDate(2026, 6, 19, 8, 30))),
    "2026-06-19 08:32"
  );
  assert.equal(
    nzStamp(campaignRecipientScheduleAt(tinyWindowSettings, "email", 3, nzDate(2026, 6, 19, 8, 30))),
    "2026-06-20 08:30"
  );
  assert.equal(
    nzStamp(campaignRecipientScheduleAt(baseSettings, "email", 1, nzDate(2026, 6, 19, 17, 29))),
    "2026-06-20 08:38"
  );
});

console.log("communication settings scheduling tests passed");
