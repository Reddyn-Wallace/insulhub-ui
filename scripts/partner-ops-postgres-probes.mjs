import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const LEGACY_OPS_GATE_SIGNATURES = [
  "public.partner_ops_dashboard(text)", "public.partner_ops_company_list(text)", "public.partner_ops_job_detail(text,uuid)",
  "public.partner_ops_company_create_full(text,text,text,text,jsonb)", "public.partner_ops_company_update_full(text,uuid,integer,text,text,text,jsonb)",
  "public.partner_ops_partner_user_list(text,uuid)", "public.partner_ops_partner_user_create(text,uuid,text,text,text,text)", "public.partner_ops_partner_user_disable(text,uuid,text)",
  "public.partner_ops_fact_append(text,uuid,uuid,text,timestamptz)", "public.partner_ops_amendment_append(text,uuid,uuid,jsonb)",
  "public.partner_ops_invoice_upsert(text,uuid,uuid,integer,text,bigint,timestamptz)", "public.partner_ops_settlement_upsert(text,uuid,uuid,integer,bigint,bigint,text,timestamptz)",
];
const RETIRED_OPS_GATE_SIGNATURES = new Set([
  "public.partner_ops_dashboard(text)",
  "public.partner_ops_fact_append(text,uuid,uuid,text,timestamptz)",
  "public.partner_ops_invoice_upsert(text,uuid,uuid,integer,text,bigint,timestamptz)",
  "public.partner_ops_settlement_upsert(text,uuid,uuid,integer,bigint,bigint,text,timestamptz)",
]);
const NEUTRAL_OPS_GATE_SIGNATURES = LEGACY_OPS_GATE_SIGNATURES.filter(signature=>!RETIRED_OPS_GATE_SIGNATURES.has(signature));
export const COMPANY_ACCESS_GATE_SIGNATURES = [
  "public.partner_ops_company_active(text,uuid,integer,boolean)",
  "public.partner_access_manage_users(text,uuid)",
  "public.partner_access_manage_user(text,uuid,text,text,boolean)",
  "public.partner_access_manage_create(text,uuid,text,text,text,text,text)",
  "public.partner_access_manage_invite(text,uuid,text,text,text,text)",
];
export const OPS_GATE_SIGNATURES = [
  "public.partner_ops_access_invite(text,uuid,text,text,text)", "public.partner_ops_access_issue(text,uuid,text,text,text)",
  "public.partner_ops_access_password(text,uuid,text,text)", "public.partner_ops_access_users(text,uuid)",
  "public.partner_access_rate_limit(text,integer)", "public.partner_access_email_result(text,boolean)",
  ...NEUTRAL_OPS_GATE_SIGNATURES,
];
export const LINK_GATE_SIGNATURES = [
  "public.partner_ops_job_links(text,uuid)", "public.partner_ops_job_link(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz)",
  "public.partner_ops_link_lookup(text,text)", "public.partner_ops_job_status(text,text,jsonb,timestamptz)",
];
export const LIVE_CONNECTION_GATE_SIGNATURES = [
  "public.partner_ops_legacy_connection_status(text,uuid)",
  "public.partner_ops_legacy_connection_set(text,uuid,integer,text,bytea,bytea,integer,text,text)",
  "public.partner_ops_job_link_investigation_required(text,uuid,uuid)",
  "public.partner_ops_job_link_investigated(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz)",
];
export const NOTIFICATION_SETTINGS_GATE_SIGNATURES = [
  "public.partner_settings_notification_get(text)",
  "public.partner_settings_notification_set(text,integer,text)",
];
const assert = (value, message) => { if (!value) throw new Error(`Operations PostgreSQL gate: ${message}`); };
const identifier = value => `"${String(value).replaceAll('"', '""')}"`;
async function rejected(client, query, values = [], expectedMessage) {
  await client.query("SAVEPOINT ops_probe");
  let denied = false;
  try { await client.query(query, values); } catch (error) { denied = expectedMessage === undefined || error?.message === expectedMessage; }
  await client.query("ROLLBACK TO SAVEPOINT ops_probe");
  await client.query("RELEASE SAVEPOINT ops_probe");
  assert(denied, "unsafe operation unexpectedly succeeded");
}

/** All fixtures, temporary login roles and writes are rolled back together. */
export async function probePartnerOperations(pool) {
  const neutralInstalled=(await pool.query("SELECT EXISTS(SELECT 1 FROM partner_schema_migrations WHERE version='020_partner_neutral_submission_v2') installed")).rows[0].installed;
  if(neutralInstalled)return probeNeutralPartnerOperations(pool);
  const down = readFileSync(new URL("../migrations/partner/007_partner_operations.down.sql", import.meta.url), "utf8");
  const rollbackGuard = /^BEGIN;\s*(DO \$\$[\s\S]*?END \$\$;)/.exec(down)?.[1];
  assert(rollbackGuard, "007 down must begin with its unsafe rollback guard");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const migrationLogin = (await client.query("SELECT current_user name")).rows[0].name;
    await client.query(`GRANT partner_ops_owner TO ${identifier(migrationLogin)} WITH INHERIT TRUE, SET TRUE`);
    const login = `partner_ops_gate_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await client.query(`CREATE ROLE ${identifier(login)} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await client.query(`GRANT partner_ops_runtime TO ${identifier(login)}`);
    await client.query(`GRANT ${identifier(login)},partner_portal_runtime TO ${identifier(migrationLogin)}`);

    const roles = await client.query("SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname IN('partner_ops_owner','partner_ops_runtime')");
    assert(roles.rowCount === 2 && roles.rows.every(row => !row.rolcanlogin && !row.rolinherit && !row.rolsuper && !row.rolcreatedb && !row.rolcreaterole && !row.rolreplication && !row.rolbypassrls), "operations groups must be non-login and unprivileged");
    const functions = await client.query(`SELECT signature,p.oid,p.prosecdef,p.proconfig,owner.rolname owner,
      has_function_privilege($2,p.oid,'EXECUTE') executable,
      has_function_privilege('partner_portal_runtime',p.oid,'EXECUTE') portal,
      has_function_privilege('partner_submission_worker',p.oid,'EXECUTE') worker,
      NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public_denied
      FROM unnest($1::text[]) signature LEFT JOIN pg_proc p ON p.oid=to_regprocedure(signature) LEFT JOIN pg_roles owner ON owner.oid=p.proowner`, [LEGACY_OPS_GATE_SIGNATURES, login]);
    assert(functions.rowCount === 12 && functions.rows.every(row => row.oid && row.prosecdef && row.owner === "partner_ops_owner" && row.proconfig?.join(",") === "search_path=pg_catalog" && row.executable && !row.portal && !row.worker && row.public_denied), "all 12 exact functions must have the fixed owner/path and no PUBLIC/portal/worker execution");
    const accountAccessInstalled = (await client.query("SELECT to_regprocedure('public.partner_ops_access_invite(text,uuid,text,text,text)') IS NOT NULL installed")).rows[0].installed;
    const linksInstalled = (await client.query("SELECT to_regprocedure('public.partner_ops_job_links(text,uuid)') IS NOT NULL installed")).rows[0].installed;
    const liveConnectionInstalled=(await client.query("SELECT to_regprocedure('public.partner_ops_legacy_connection_status(text,uuid)') IS NOT NULL installed")).rows[0].installed;
    const notificationSettingsInstalled=(await client.query("SELECT to_regprocedure('public.partner_settings_notification_get(text)') IS NOT NULL installed")).rows[0].installed;
    const approvedSignatures = [...(notificationSettingsInstalled?NOTIFICATION_SETTINGS_GATE_SIGNATURES:[]),...(linksInstalled ? LINK_GATE_SIGNATURES : []),...(liveConnectionInstalled?LIVE_CONNECTION_GATE_SIGNATURES:[]),...(accountAccessInstalled ? OPS_GATE_SIGNATURES : LEGACY_OPS_GATE_SIGNATURES)];
    const effective = await client.query(`SELECT
      EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege WHERE n.nspname='public' AND c.relkind IN('r','p','v','m','f') AND has_table_privilege($1,c.oid,privilege)) tables,
      EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) privilege WHERE n.nspname='public' AND c.relkind IN('r','p','v','m','f') AND has_any_column_privilege($1,c.oid,privilege)) columns,
      EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname NOT IN($1,'partner_ops_runtime') AND pg_has_role($1,r.oid,'MEMBER')) memberships,
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN('pg_catalog','information_schema') AND (p.prosecdef OR p.proname LIKE 'partner_ops_%') AND has_function_privilege($1,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM unnest($2::text[]) s WHERE to_regprocedure(s)=p.oid)) unapproved`, [login, approvedSignatures]);
    assert(Object.values(effective.rows[0]).every(value => value === false), "login must have no effective table/column privileges, hidden role membership or unapproved definer");

    const actors = Object.fromEntries(["ADMIN", "OPERATIONS", "FINANCE", "VIEWER"].map(role => [role, randomUUID()]));
    for (const [role, id] of Object.entries(actors)) await client.query("INSERT INTO partner_users(id,principal_type,name,email,ops_role) VALUES($1,'INTERNAL','Gate operator',$2,$3)", [id, `${id}@example.test`, role]);
    await rejected(client, rollbackGuard, [], "partner operations rollback refused: 007 records would be lost");
    await rejected(client, "INSERT INTO partner_users(id,principal_type,name,email,ops_role) VALUES($1,'INTERNAL','Missing role',$2,NULL)", [randomUUID(), `${randomUUID()}@example.test`]);
    const defaults = JSON.stringify({ wallRateCents: 9500, ceilingRateCents: 6500, depositBasisPoints: 2500, consentFeeCents: 0, extras: [{ id: "council", name: "Council Fee", priceCents: 33000 }] });
    await client.query(`SET ROLE ${identifier(login)}`);
    const companySlug = `ops-${randomUUID().slice(0, 8)}`;
    const company = (await client.query("SELECT partner_ops_company_create_full($1,$2,'Gate Company','INSULHUB_BILLED',$3::jsonb) id", [actors.ADMIN, companySlug, defaults])).rows[0].id;
    assert((await client.query("SELECT partner_ops_company_update_full($1,$2,0,$3,'Updated Gate Company','PARTNER_BILLED',$4::jsonb) ok", [actors.ADMIN, company, companySlug, defaults])).rows[0].ok === true, "company settings update must succeed");
    assert((await client.query("SELECT partner_ops_company_update_full($1,$2,0,$3,'Stale update','PARTNER_BILLED',$4::jsonb) ok", [actors.ADMIN, company, companySlug, defaults])).rows[0].ok === false, "stale company revision must not mutate");
    const listedCompany = (await client.query("SELECT * FROM partner_ops_company_list($1)", [actors.ADMIN])).rows.find(row => row.id === company);
    assert(listedCompany?.extras?.[0]?.priceCents === 33000, "company default extras must round-trip");
    await rejected(client, "SELECT partner_ops_company_create_full($1,'denied','Denied','INSULHUB_BILLED',$2::jsonb)", [actors.VIEWER, defaults]);
    const user = randomUUID(), hash = `${"a".repeat(32)}:${"b".repeat(128)}`;
    await client.query("SELECT partner_ops_partner_user_create($1,$2,$3,'Gate Partner',$4,$5)", [actors.ADMIN, company, user, `${user}@example.test`, hash]);
    const publicUsers = await client.query("SELECT * FROM partner_ops_partner_user_list($1,$2)", [actors.ADMIN, company]);
    assert(publicUsers.rowCount === 1 && !JSON.stringify(publicUsers.rows).includes(hash), "partner account listing must be redacted");
    await rejected(client, "SELECT * FROM partner_accounts");
    await rejected(client, "SELECT partner_ops_authorize($1,'ADMIN')", [actors.ADMIN]);
    await client.query("RESET ROLE");

    const jobs = {};
    for (const [key, model] of [["commission", "INSULHUB_BILLED"], ["remittance", "PARTNER_BILLED"], ["cancelled", "INSULHUB_BILLED"], ["draft", "INSULHUB_BILLED"]]) {
      jobs[key] = randomUUID();
      await client.query("INSERT INTO partner_jobs(id,company_id,created_by_user_id,client_reference,billing_model_snapshot,submission_state,submission_started_at,submitted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)", [jobs[key], company, user, `OPS-${key}`, model, key === "draft" ? "DRAFT" : "SUBMITTED", key === "draft" ? null : new Date("2026-08-31T00:00:00Z")]);
    }
    await client.query("INSERT INTO partner_sessions(id,user_id,token,expires_at) VALUES($1,$2,$3,now()+interval '1 day')", [randomUUID(), user, randomUUID()]);
    await client.query(`SET ROLE ${identifier(login)}`);
    assert((await client.query("SELECT * FROM partner_ops_dashboard($1)", [actors.VIEWER])).rowCount >= 4, "viewer can read dashboard");
    assert((await client.query("SELECT partner_ops_job_detail($1,$2) job", [actors.VIEWER, jobs.commission])).rows[0].job?.billingModel === "INSULHUB_BILLED", "existing job keeps its own billing snapshot");
    await rejected(client, "SELECT partner_ops_fact_append($1,$2,$3,'EBA_COMPLETED',now())", [actors.FINANCE, company, jobs.commission]);
    for (const fact of ["COMMISSION_PAID", "REMITTANCE_RECEIVED", "INVOICE_SENT"]) await rejected(client, "SELECT partner_ops_fact_append($1,$2,$3,$4,now())", [actors.OPERATIONS, company, jobs.commission, fact]);
    await rejected(client, "SELECT partner_ops_fact_append($1,$2,$3,'EBA_COMPLETED',now())", [actors.OPERATIONS, company, jobs.draft]);
    await rejected(client, "SELECT partner_ops_invoice_upsert($1,$2,$3,9,'INV-1',50000,now())", [actors.FINANCE, company, jobs.commission]);
    await rejected(client, "SELECT partner_ops_settlement_upsert($1,$2,$3,0,50000,10000,'PENDING',NULL)", [actors.FINANCE, company, jobs.commission]);
    await client.query("SELECT partner_ops_fact_append($1,$2,$3,'EBA_COMPLETED',now())", [actors.OPERATIONS, company, jobs.commission]);
    await rejected(client, "SELECT partner_ops_fact_append($1,$2,$3,'EBA_COMPLETED',now())", [actors.OPERATIONS, company, jobs.commission]);
    await client.query("SET LOCAL TIME ZONE 'America/Los_Angeles'");
    await client.query("SELECT partner_ops_fact_append($1,$2,$3,'INSTALL_DATE_SET','2026-09-04T00:00:00Z')", [actors.OPERATIONS, company, jobs.commission]);
    await client.query("SELECT partner_ops_fact_append($1,$2,$3,'INSTALL_DATE_SET','2026-09-02T00:00:00Z')", [actors.OPERATIONS, company, jobs.commission]);
    await client.query("SELECT partner_ops_amendment_append($1,$2,$3,'{\"version\":1,\"description\":\"Scope confirmed\"}'::jsonb)", [actors.OPERATIONS, company, jobs.commission]);
    for (const [key, status] of [["commission", "PAID"], ["remittance", "RECEIVED"]]) {
      const job = jobs[key];
      await client.query("SELECT partner_ops_invoice_upsert($1,$2,$3,0,'INV-1',50000,now())", [actors.FINANCE, company, job]);
      await rejected(client, "SELECT partner_ops_settlement_upsert($1,$2,$3,0,49999,10000,'PENDING',NULL)", [actors.FINANCE, company, job]);
      await rejected(client, "SELECT partner_ops_settlement_upsert($1,$2,$3,0,50000,10000,$4,now())", [actors.OPERATIONS, company, job, status]);
      await client.query("SELECT partner_ops_settlement_upsert($1,$2,$3,0,50000,10000,$4,now())", [actors.FINANCE, company, job, status]);
      await rejected(client, "SELECT partner_ops_settlement_upsert($1,$2,$3,0,50000,10000,$4,now())", [actors.FINANCE, company, job, status]);
      await rejected(client, "SELECT partner_ops_invoice_upsert($1,$2,$3,0,'INV-2',51000,now())", [actors.FINANCE, company, job]);
    }
    await client.query("SELECT partner_ops_invoice_upsert($1,$2,$3,0,'INV-C',50000,now())", [actors.FINANCE, company, jobs.cancelled]);
    await client.query("SELECT partner_ops_settlement_upsert($1,$2,$3,0,50000,10000,'PENDING',NULL)", [actors.FINANCE, company, jobs.cancelled]);
    await client.query("SELECT partner_ops_fact_append($1,$2,$3,'CANCELLED',now())", [actors.OPERATIONS, company, jobs.cancelled]);
    await rejected(client, "SELECT partner_ops_fact_append($1,$2,$3,'JOB_COMPLETED',now())", [actors.OPERATIONS, company, jobs.cancelled]);
    await rejected(client, "SELECT partner_ops_invoice_upsert($1,$2,$3,0,'INV-C',50000,now())", [actors.FINANCE, company, jobs.cancelled]);
    await client.query("SELECT partner_ops_amendment_append($1,$2,$3,'{\"version\":1,\"description\":\"Cancellation explained\"}'::jsonb)", [actors.OPERATIONS, company, jobs.cancelled]);
    await client.query("RESET ROLE");
    // Table-privileged probes prove the triggers themselves, not an earlier API guard.
    await client.query("SET ROLE partner_ops_owner");
    await rejected(client, "INSERT INTO partner_tracking_facts(company_id,job_id,fact_type,value_type,value,source,effective_at,recorded_by_user_id) VALUES($1,$2,'JOB_COMPLETED','BOOLEAN','true'::jsonb,'LOCAL_INTERNAL',now(),$3)", [company, jobs.cancelled, actors.ADMIN], "OPS_CANCELLED");
    await rejected(client, "INSERT INTO partner_tracking_facts(company_id,job_id,fact_type,value_type,value,source,effective_at,recorded_by_user_id) VALUES($1,$2,'CANCELLED','BOOLEAN','true'::jsonb,'LOCAL_INTERNAL',now(),$3)", [company, jobs.cancelled, actors.ADMIN], "OPS_DUPLICATE_FACT");
    await rejected(client, "INSERT INTO partner_job_invoices(company_id,job_id,reference,amount_cents,sent_at,created_by_user_id,updated_by_user_id) VALUES($1,$2,'INV-C2',100,now(),$3,$3)", [company, jobs.cancelled, actors.ADMIN], "OPS_CANCELLED");
    await rejected(client, "UPDATE partner_job_invoices SET reference='INV-C2' WHERE company_id=$1 AND job_id=$2", [company, jobs.cancelled], "OPS_CANCELLED");
    await rejected(client, "INSERT INTO partner_job_settlements(company_id,job_id,billing_model_snapshot,gross_cents,manual_commission_cents,net_due_cents,settlement_status,created_by_user_id) VALUES($1,$2,'INSULHUB_BILLED',50000,10000,10000,'PENDING',$3)", [company, jobs.cancelled, actors.ADMIN], "OPS_CANCELLED");
    await rejected(client, "UPDATE partner_job_settlements SET gross_cents=50001 WHERE company_id=$1 AND job_id=$2", [company, jobs.cancelled], "OPS_CANCELLED");
    await client.query("RESET ROLE");
    await client.query("SAVEPOINT ops_role_rollback_probe");
    await client.query("UPDATE partner_users SET ops_role='ADMIN' WHERE id=ANY($1::text[])", [Object.values(actors)]);
    await rejected(client, rollbackGuard, [], "partner operations rollback refused: 007 records would be lost");
    await client.query("ROLLBACK TO SAVEPOINT ops_role_rollback_probe");
    await client.query("RELEASE SAVEPOINT ops_role_rollback_probe");
    const terminalFacts = await client.query("SELECT fact_type FROM partner_tracking_facts WHERE company_id=$1 AND fact_type IN('COMMISSION_PAID','REMITTANCE_RECEIVED')", [company]);
    assert(terminalFacts.rowCount === 2, "both settlement paths must atomically emit one terminal fact");
    const orderedFacts = (await client.query("SELECT fact_type,recorded_at FROM partner_tracking_facts WHERE company_id=$1 AND job_id=$2 ORDER BY recorded_at", [company, jobs.commission])).rows;
    assert(orderedFacts.map(row => row.fact_type).join(',') === 'EBA_COMPLETED,INSTALL_DATE_SET,INSTALL_DATE_SET,INVOICE_SENT,COMMISSION_PAID', "all milestone producers must follow committed recording order");
    const audits = await client.query("SELECT event_type,metadata FROM partner_audit_events WHERE company_id=$1", [company]);
    for (const event of ["OPS_COMPANY_CREATED", "OPS_COMPANY_UPDATED", "OPS_PARTNER_USER_PROVISIONED", "OPS_FACT_RECORDED", "OPS_AMENDMENT_RECORDED", "OPS_INVOICE_RECORDED", "OPS_SETTLEMENT_RECORDED"]) assert(audits.rows.some(row => row.event_type === event), `missing ${event} audit`);
    assert(!JSON.stringify(audits.rows).includes(hash), "audit must never include password hash");
    await rejected(client, "UPDATE partner_tracking_facts SET note='changed' WHERE company_id=$1", [company]);
    await rejected(client, "DELETE FROM partner_job_amendments WHERE company_id=$1", [company]);
    await rejected(client, "UPDATE partner_audit_events SET metadata='{}'::jsonb WHERE company_id=$1", [company]);
    await client.query("SET ROLE partner_portal_runtime");
    await rejected(client, "UPDATE partner_users SET ops_role='ADMIN' WHERE id=$1", [user]);
    await rejected(client, "UPDATE partner_users SET principal_type='INTERNAL',company_id=NULL,ops_role='ADMIN' WHERE id=$1", [user]);
    await rejected(client, "INSERT INTO partner_audit_events(event_type,company_id,job_id,metadata) VALUES('OPS_SETTLEMENT_RECORDED',$1,$2,'{}'::jsonb)", [company, jobs.commission]);
    const projection = (await client.query("SELECT partner_partner_tracking_projection($1,$2,$3) value", [user, company, jobs.commission])).rows[0].value;
    assert(projection?.settlement?.status === "PAID", "partner projection must show committed settlement");
    assert(projection?.milestones?.INSTALL_DATE_SET?.installDate === "2026-09-02", "latest recorded install correction must win even when moved earlier");
    assert(!Object.hasOwn(projection.milestones.INSTALL_DATE_SET,'effectiveAt') && !Object.hasOwn(projection.milestones.EBA_COMPLETED,'installDate'), "irrelevant milestone date fields must be omitted");
    assert(!Object.hasOwn(projection.amendments[0],'contractDeltaCents'), "an unspecified amendment amount must not become zero or null");
    assert((await client.query("SELECT partner_partner_tracking_projection($1,$2,$3) value", [user, randomUUID(), jobs.commission])).rows[0].value === null, "guessed company must not project data");
    await client.query("RESET ROLE");
    await client.query("UPDATE partner_companies SET is_active=false WHERE id=$1", [company]);
    await client.query("SET ROLE partner_portal_runtime");
    assert((await client.query("SELECT partner_partner_tracking_projection($1,$2,$3) value", [user, company, jobs.commission])).rows[0].value === null, "inactive company must not project data");
    await client.query("RESET ROLE");
    await client.query("UPDATE partner_companies SET is_active=true WHERE id=$1", [company]);
    await client.query("UPDATE partner_users SET disabled_at=now() WHERE id=$1", [actors.VIEWER]);
    await client.query(`SET ROLE ${identifier(login)}`);
    await rejected(client, "SELECT * FROM partner_ops_dashboard($1)", [actors.VIEWER]);
    await client.query("SELECT partner_ops_partner_user_disable($1,$2,$3)", [actors.ADMIN, company, user]);
    await client.query("RESET ROLE");
    assert((await client.query("SELECT count(*)::integer count FROM partner_sessions WHERE user_id=$1", [user])).rows[0].count === 0, "disable must revoke sessions");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query("RESET ROLE").catch(() => undefined);
    client.release();
  }
}

async function probeNeutralPartnerOperations(pool){
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const migrationLogin=(await client.query("SELECT current_user name")).rows[0].name;
    const login=`partner_ops_neutral_${randomUUID().replaceAll("-","").slice(0,12)}`;
    await client.query(`CREATE ROLE ${identifier(login)} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await client.query(`GRANT partner_ops_runtime TO ${identifier(login)}`);
    await client.query(`GRANT ${identifier(login)} TO ${identifier(migrationLogin)}`);
    const companyAccessInstalled=(await client.query("SELECT to_regprocedure('public.partner_ops_company_active(text,uuid,integer,boolean)') IS NOT NULL installed")).rows[0].installed;
    const active=[...(companyAccessInstalled?COMPANY_ACCESS_GATE_SIGNATURES:[]),...NOTIFICATION_SETTINGS_GATE_SIGNATURES,...LINK_GATE_SIGNATURES,...LIVE_CONNECTION_GATE_SIGNATURES,...OPS_GATE_SIGNATURES];
    const privileges=await client.query(`SELECT signature,to_regprocedure(signature) oid,has_function_privilege($2,to_regprocedure(signature),'EXECUTE') executable FROM unnest($1::text[]) signature`,[active,login]);
    assert(privileges.rowCount===active.length&&privileges.rows.every(row=>row.oid&&row.executable),"neutral operations login must retain only its approved functions");
    const retired=await client.query(`SELECT signature,has_function_privilege($2,to_regprocedure(signature),'EXECUTE') executable FROM unnest($1::text[]) signature`,[[...RETIRED_OPS_GATE_SIGNATURES],login]);
    assert(retired.rows.every(row=>row.executable===false),"retired dashboard, finance and manual fact functions must not be executable");
    const company=randomUUID(),partner=randomUUID(),job=randomUUID();
    await client.query("INSERT INTO partner_companies(id,slug,name,billing_model) VALUES($1,$2,'Neutral Gate','INSULHUB_BILLED')",[company,`neutral-${company.slice(0,8)}`]);
    await client.query("INSERT INTO partner_users(id,company_id,principal_type,name,email) VALUES($1,$2,'PARTNER','Gate Partner',$3)",[partner,company,`${partner}@example.test`]);
    await client.query("INSERT INTO partner_jobs(id,company_id,created_by_user_id,client_reference,billing_model_snapshot,submission_state,submission_started_at,submitted_at) VALUES($1,$2,$3,'NEUTRAL-1','INSULHUB_BILLED','SUBMITTED',now(),now())",[job,company,partner]);
    await client.query(`SET ROLE ${identifier(login)}`);
    assert((await client.query("SELECT partner_ops_amendment_append('insulhub-settings-service',$1,$2,'{\"version\":1,\"description\":\"Install moved\"}'::jsonb) ok",[company,job])).rows[0].ok===true,"partner-visible amendment must remain writable from normal InsulHub");
    for(const [query,values] of [
      ["SELECT * FROM partner_ops_dashboard('insulhub-settings-service')",[]],
      ["SELECT partner_ops_fact_append('insulhub-settings-service',$1,$2,'EBA_COMPLETED',now())",[company,job]],
      ["SELECT partner_ops_invoice_upsert('insulhub-settings-service',$1,$2,0,'INV-1',1,now())",[company,job]],
      ["SELECT partner_ops_settlement_upsert('insulhub-settings-service',$1,$2,0,1,0,'PENDING',NULL)",[company,job]],
    ])await rejected(client,query,values);
    await client.query("RESET ROLE");
  }finally{await client.query("ROLLBACK").catch(()=>{});await client.query("RESET ROLE").catch(()=>{});client.release();}
}

export async function assertPartnerOperationsRemoved(pool) {
  const result = await pool.query("SELECT to_regclass('public.partner_job_invoices') invoices, EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'partner_ops_%' OR p.proname='partner_partner_tracking_projection')) functions, EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('partner_ops_owner','partner_ops_runtime')) roles, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='partner_users' AND column_name='ops_role') column");
  assert(result.rows[0].invoices === null && !result.rows[0].functions && !result.rows[0].roles && !result.rows[0].column, "007 down must remove every function/role/table/column");
}
