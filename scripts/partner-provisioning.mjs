const DEFAULT_QUOTE_DEFAULTS = {
  wallRateCents: null,
  ceilingRateCents: null,
  depositBasisPoints: 2500,
  consentFeeCents: 0,
  extras: [{ id: "council-fee", name: "Council Fee", priceCents: 33000 }],
  revision: 0,
};

function normalizeQuoteDefaults(value) {
  const input = value ?? DEFAULT_QUOTE_DEFAULTS;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Pilot quote defaults are invalid");
  const allowed = new Set(["wallRateCents", "ceilingRateCents", "depositBasisPoints", "consentFeeCents", "extras", "revision"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("Pilot quote defaults are invalid");
  const rate = (candidate) => candidate === null || (Number.isInteger(candidate) && candidate >= 1 && candidate <= 10_000_000);
  if (!rate(input.wallRateCents) || !rate(input.ceilingRateCents)
    || !Number.isInteger(input.depositBasisPoints) || input.depositBasisPoints < 0 || input.depositBasisPoints > 10_000
    || !Number.isInteger(input.consentFeeCents) || input.consentFeeCents < 0 || input.consentFeeCents > 1_000_000_000
    || !Number.isInteger(input.revision) || input.revision < 0 || input.revision > 2_147_483_647
    || !Array.isArray(input.extras) || input.extras.length > 50 || Buffer.byteLength(JSON.stringify(input.extras), "utf8") > 7000) {
    throw new Error("Pilot quote defaults are invalid");
  }
  const ids = new Set();
  const extras = input.extras.map((extra) => {
    if (!extra || typeof extra !== "object" || Array.isArray(extra) || Object.keys(extra).sort().join(",") !== "id,name,priceCents"
      || typeof extra.id !== "string" || !extra.id || extra.id.length > 80 || ids.has(extra.id)
      || typeof extra.name !== "string" || !extra.name.trim() || extra.name.length > 120
      || !Number.isInteger(extra.priceCents) || extra.priceCents < 0 || extra.priceCents > 1_000_000_000) {
      throw new Error("Pilot quote defaults are invalid");
    }
    ids.add(extra.id);
    return { id: extra.id, name: extra.name, priceCents: extra.priceCents };
  });
  return { wallRateCents: input.wallRateCents, ceilingRateCents: input.ceilingRateCents, depositBasisPoints: input.depositBasisPoints, consentFeeCents: input.consentFeeCents, extras, revision: input.revision };
}

export async function provisionPilotRecords(sql, input, dependencies) {
  const opsRoles = new Set(["ADMIN", "OPERATIONS", "FINANCE", "VIEWER"]);
  for (const user of input.users) {
    if (!["PARTNER", "INTERNAL"].includes(user.principalType) || (user.principalType === "INTERNAL" ? !opsRoles.has(user.opsRole) : user.opsRole != null)) throw new Error("Provisioning requires an explicit valid internal role and no partner operations role");
  }
  const quoteDefaults = normalizeQuoteDefaults(input.company.quoteDefaults);
  const insertedCompany = await sql.query(
    `INSERT INTO partner_companies (slug, name, billing_model, quote_default_wall_rate_cents,
       quote_default_ceiling_rate_cents, quote_default_deposit_basis_points,
       quote_default_consent_fee_cents, quote_default_extras, quote_defaults_revision)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     ON CONFLICT DO NOTHING
     RETURNING id, name, billing_model, is_active, quote_default_wall_rate_cents,
       quote_default_ceiling_rate_cents, quote_default_deposit_basis_points,
       quote_default_consent_fee_cents, quote_default_extras, quote_defaults_revision`,
    [input.company.slug, input.company.name, input.company.billingModel, quoteDefaults.wallRateCents,
      quoteDefaults.ceilingRateCents, quoteDefaults.depositBasisPoints, quoteDefaults.consentFeeCents,
      JSON.stringify(quoteDefaults.extras), quoteDefaults.revision],
  );
  const company = insertedCompany.rows[0] ?? (await sql.query(
    `SELECT id, name, billing_model, is_active, quote_default_wall_rate_cents,
       quote_default_ceiling_rate_cents, quote_default_deposit_basis_points,
       quote_default_consent_fee_cents, quote_default_extras, quote_defaults_revision
     FROM partner_companies WHERE lower(slug) = lower($1)`,
    [input.company.slug],
  )).rows[0];
  if (!company) throw new Error("Could not resolve pilot company");
  if (company.name !== input.company.name || company.billing_model !== input.company.billingModel) {
    throw new Error("Existing pilot company does not match requested name and billing model");
  }
  if (company.is_active !== true) throw new Error("Existing pilot company is inactive");
  if (input.company.quoteDefaults) {
    const storedDefaults = normalizeQuoteDefaults({
      wallRateCents: company.quote_default_wall_rate_cents,
      ceilingRateCents: company.quote_default_ceiling_rate_cents,
      depositBasisPoints: Number(company.quote_default_deposit_basis_points),
      consentFeeCents: Number(company.quote_default_consent_fee_cents),
      extras: company.quote_default_extras,
      revision: Number(company.quote_defaults_revision),
    });
    if (JSON.stringify(storedDefaults) !== JSON.stringify(quoteDefaults)) throw new Error("Existing pilot company quote defaults do not match");
  }

  let createdUsers = 0;
  let reusedUsers = 0;
  for (const user of input.users) {
    const expectedCompanyId = user.principalType === "PARTNER" ? company.id : null;
    const existing = await sql.query(
      `SELECT u.id, u.company_id, u.principal_type, u.ops_role, u.disabled_at, (a.id IS NOT NULL) AS has_credential_account
       FROM partner_users u
       LEFT JOIN partner_accounts a
         ON a.user_id = u.id AND a.provider_id = 'credential' AND a.password IS NOT NULL
       WHERE lower(u.email) = lower($1)
       LIMIT 1`,
      [user.email],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (row.principal_type !== user.principalType || row.company_id !== expectedCompanyId) {
        throw new Error(`Existing user ${user.email} does not match requested principal and company`);
      }
      if (row.ops_role !== (user.principalType === "INTERNAL" ? user.opsRole : null)) throw new Error("Existing user operations role does not match requested role");
      if (row.disabled_at) throw new Error("Existing user is disabled");
      if (row.has_credential_account !== true) {
        throw new Error(`Existing user ${user.email} has no credential account`);
      }
      reusedUsers += 1;
      continue;
    }

    const userId = dependencies.randomId();
    const passwordHash = await dependencies.hashPassword(user.password);
    await sql.query(
      `INSERT INTO partner_users (id, company_id, principal_type, name, email, email_verified, ops_role)
       VALUES ($1, $2, $3, $4, $5, true, $6)`,
      [userId, expectedCompanyId, user.principalType, user.name, user.email, user.principalType === "INTERNAL" ? user.opsRole : null],
    );
    await sql.query(
      `INSERT INTO partner_accounts (id, account_id, provider_id, user_id, password)
       VALUES ($1, $2, 'credential', $2, $3)`,
      [dependencies.randomId(), userId, passwordHash],
    );
    await sql.query(
      `INSERT INTO partner_audit_events (event_type, subject_user_id, company_id, metadata)
       VALUES ('USER_PROVISIONED', $1, $2, $3::jsonb)`,
      [userId, expectedCompanyId, JSON.stringify({ principalType: user.principalType })],
    );
    createdUsers += 1;
  }
  return { companyId: company.id, companyCreated: Boolean(insertedCompany.rows[0]), createdUsers, reusedUsers };
}
