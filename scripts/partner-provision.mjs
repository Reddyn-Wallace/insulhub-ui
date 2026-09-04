#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { Pool } from "pg";
import { provisionPilotRecords } from "./partner-provisioning.mjs";

if (process.env.NODE_ENV === "production") throw new Error("Pilot provisioning is disabled in production");
if (process.env.PARTNER_ALLOW_LOCAL_PROVISIONING !== "true") throw new Error("Set PARTNER_ALLOW_LOCAL_PROVISIONING=true for local/test provisioning");
if (!process.env.PARTNER_MIGRATION_DATABASE_URL) throw new Error("PARTNER_MIGRATION_DATABASE_URL is required");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalInteger(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
  return Number(value);
}

const quoteDefaultNames = [
  "PARTNER_PILOT_WALL_RATE_CENTS", "PARTNER_PILOT_CEILING_RATE_CENTS",
  "PARTNER_PILOT_DEPOSIT_BASIS_POINTS", "PARTNER_PILOT_CONSENT_FEE_CENTS",
  "PARTNER_PILOT_QUOTE_EXTRAS_JSON", "PARTNER_PILOT_QUOTE_DEFAULTS_REVISION",
];
let quoteDefaults;
if (quoteDefaultNames.some((name) => process.env[name] !== undefined && process.env[name] !== "")) {
  let extras;
  try { extras = process.env.PARTNER_PILOT_QUOTE_EXTRAS_JSON ? JSON.parse(process.env.PARTNER_PILOT_QUOTE_EXTRAS_JSON) : [{ id: "council-fee", name: "Council Fee", priceCents: 33000 }]; }
  catch { throw new Error("PARTNER_PILOT_QUOTE_EXTRAS_JSON must be valid JSON"); }
  quoteDefaults = {
    wallRateCents: optionalInteger("PARTNER_PILOT_WALL_RATE_CENTS", null),
    ceilingRateCents: optionalInteger("PARTNER_PILOT_CEILING_RATE_CENTS", null),
    depositBasisPoints: optionalInteger("PARTNER_PILOT_DEPOSIT_BASIS_POINTS", 2500),
    consentFeeCents: optionalInteger("PARTNER_PILOT_CONSENT_FEE_CENTS", 0),
    extras,
    revision: optionalInteger("PARTNER_PILOT_QUOTE_DEFAULTS_REVISION", 0),
  };
}

const billingModel = required("PARTNER_PILOT_BILLING_MODEL");
if (!new Set(["INSULHUB_BILLED", "PARTNER_BILLED"]).has(billingModel)) throw new Error("PARTNER_PILOT_BILLING_MODEL is invalid");

const users = [
  {
    email: required("PARTNER_PILOT_USER_EMAIL").toLowerCase(),
    password: required("PARTNER_PILOT_USER_PASSWORD"),
    name: required("PARTNER_PILOT_USER_NAME"),
    principalType: "PARTNER",
  },
  {
    email: required("PARTNER_OPERATOR_EMAIL").toLowerCase(),
    password: required("PARTNER_OPERATOR_PASSWORD"),
    name: required("PARTNER_OPERATOR_NAME"),
    principalType: "INTERNAL",
    opsRole: required("PARTNER_OPERATOR_ROLE"),
  },
];
for (const user of users) if (user.password.length < 12 || user.password.length > 128) throw new Error("Provisioned passwords must be 12–128 characters");

const pool = new Pool({ connectionString: process.env.PARTNER_MIGRATION_DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const result = await provisionPilotRecords(client, {
    company: {
      slug: required("PARTNER_PILOT_COMPANY_SLUG"),
      name: required("PARTNER_PILOT_COMPANY_NAME"),
      billingModel,
      ...(quoteDefaults ? { quoteDefaults } : {}),
    },
    users,
  }, { hashPassword, randomId: randomUUID });
  await client.query("COMMIT");
  console.log(`Pilot provisioning complete: ${result.createdUsers} created, ${result.reusedUsers} safely reused`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
