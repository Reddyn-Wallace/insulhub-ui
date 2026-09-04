import { describe, expect, it } from "vitest";
import { provisionPilotRecords } from "../../../scripts/partner-provisioning.mjs";
import { createPartnerTestDatabase } from "./test-db";

const company = { slug: "pilot", name: "Pilot Company", billingModel: "INSULHUB_BILLED" };
const users = [
  { email: "partner@example.test", password: "initial partner password", name: "Partner", principalType: "PARTNER" },
  { email: "ops@example.test", password: "initial operator password", name: "Operator", principalType: "INTERNAL", opsRole: "ADMIN" },
];

function dependencies() {
  let sequence = 0;
  let hashes = 0;
  return {
    value: {
      randomId: () => `provision-id-${sequence += 1}`,
      hashPassword: async (password: string) => { hashes += 1; return `hash:${password}`; },
    },
    hashCount: () => hashes,
  };
}

describe("safe pilot provisioning", () => {
  it("requires explicit internal roles and never silently promotes an existing operator", async () => {
    const { Pool } = createPartnerTestDatabase();
    const pool = new Pool(), deps = dependencies();
    await expect(provisionPilotRecords(pool, { company, users: [{ ...users[1], opsRole: undefined }] }, deps.value)).rejects.toThrow("explicit valid internal role");
    expect((await pool.query("SELECT count(*) count FROM partner_companies")).rows[0].count).toBe(0);
    const financeUsers = [{ ...users[1], opsRole: "FINANCE" }];
    await provisionPilotRecords(pool, { company, users: financeUsers }, deps.value);
    expect((await pool.query("SELECT ops_role FROM partner_users WHERE email=$1", [users[1].email])).rows[0].ops_role).toBe("FINANCE");
    await expect(provisionPilotRecords(pool, { company, users: [users[1]] }, deps.value)).rejects.toThrow("role does not match");
    await pool.end();
  });
  it("is idempotent only for exact ownership and never resets existing passwords", async () => {
    const { Pool } = createPartnerTestDatabase();
    const pool = new Pool();
    const deps = dependencies();
    const first = await provisionPilotRecords(pool, { company, users }, deps.value);
    expect(first).toMatchObject({ companyCreated: true, createdUsers: 2, reusedUsers: 0 });
    const originalPasswords = (await pool.query("SELECT password FROM partner_accounts ORDER BY account_id")).rows.map((row: { password: string }) => row.password);

    const second = await provisionPilotRecords(pool, {
      company,
      users: users.map((user) => ({ ...user, password: `replacement ${user.password}` })),
    }, deps.value);
    expect(second).toMatchObject({ companyCreated: false, createdUsers: 0, reusedUsers: 2 });
    expect(deps.hashCount()).toBe(2);
    expect((await pool.query("SELECT password FROM partner_accounts ORDER BY account_id")).rows.map((row: { password: string }) => row.password)).toEqual(originalPasswords);
    expect((await pool.query("SELECT 1 FROM partner_audit_events WHERE event_type = 'USER_PROVISIONED'")).rowCount).toBe(2);
    await pool.end();
  });

  it("fails closed when an existing company name or billing model differs", async () => {
    const { Pool } = createPartnerTestDatabase();
    const pool = new Pool();
    const deps = dependencies();
    await provisionPilotRecords(pool, { company, users }, deps.value);
    await expect(provisionPilotRecords(pool, { company: { ...company, name: "Different Company" }, users }, deps.value)).rejects.toThrow("does not match");
    await expect(provisionPilotRecords(pool, { company: { ...company, billingModel: "PARTNER_BILLED" }, users }, deps.value)).rejects.toThrow("does not match");
    await pool.end();
  });

  it("fails closed when an existing email has another principal type or company", async () => {
    const { Pool } = createPartnerTestDatabase();
    const pool = new Pool();
    const deps = dependencies();
    await provisionPilotRecords(pool, { company, users }, deps.value);
    await expect(provisionPilotRecords(pool, {
      company,
      users: [{ ...users[0], principalType: "INTERNAL", opsRole: "ADMIN" }],
    }, deps.value)).rejects.toThrow("does not match requested principal and company");
    await pool.end();
  });

  it("fails closed when the matching company is inactive", async () => {
    const { Pool } = createPartnerTestDatabase();
    const pool = new Pool();
    const deps = dependencies();
    const provisioned = await provisionPilotRecords(pool, { company, users }, deps.value);
    await pool.query("UPDATE partner_companies SET is_active = false WHERE id = $1", [provisioned.companyId]);
    await expect(provisionPilotRecords(pool, { company, users }, deps.value)).rejects.toThrow("company is inactive");
    await pool.end();
  });

  it("fails closed when a matching user no longer has a credential account", async () => {
    const { Pool } = createPartnerTestDatabase();
    const pool = new Pool();
    const deps = dependencies();
    await provisionPilotRecords(pool, { company, users }, deps.value);
    await pool.query(
      "DELETE FROM partner_accounts WHERE account_id = (SELECT id FROM partner_users WHERE email = $1)",
      [users[0].email],
    );
    await expect(provisionPilotRecords(pool, { company, users: [users[0]] }, deps.value)).rejects.toThrow("has no credential account");
    await pool.end();
  });

  it("validates and pins explicit pilot quote defaults without silently changing them", async () => {
    const { Pool } = createPartnerTestDatabase();
    const pool = new Pool();
    const deps = dependencies();
    const quoteDefaults = { wallRateCents: 15000, ceilingRateCents: null, depositBasisPoints: 3000, consentFeeCents: 2500, extras: [{ id: "council", name: "Council", priceCents: 33000 }], revision: 4 };
    await provisionPilotRecords(pool, { company: { ...company, quoteDefaults }, users }, deps.value);
    await expect(provisionPilotRecords(pool, { company: { ...company, quoteDefaults: { ...quoteDefaults, wallRateCents: 16000 } }, users }, deps.value)).rejects.toThrow("quote defaults do not match");
    await pool.end();
  });

  it("rejects malformed or oversized quote defaults before database writes", async () => {
    const { Pool } = createPartnerTestDatabase();
    const pool = new Pool();
    const deps = dependencies();
    await expect(provisionPilotRecords(pool, { company: { ...company, quoteDefaults: { wallRateCents: 0, ceilingRateCents: null, depositBasisPoints: 2500, consentFeeCents: 0, extras: [], revision: 0 } }, users }, deps.value)).rejects.toThrow("quote defaults are invalid");
    await expect(provisionPilotRecords(pool, { company: { ...company, quoteDefaults: { wallRateCents: null, ceilingRateCents: null, depositBasisPoints: 2500, consentFeeCents: 0, extras: [{ id: "x", name: "", priceCents: 0 }], revision: 0 } }, users }, deps.value)).rejects.toThrow("quote defaults are invalid");
    await pool.end();
  });
});
