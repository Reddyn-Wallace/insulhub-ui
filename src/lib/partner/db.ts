import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { getPartnerDemoPool, partnerDemoModeEnabled } from "./demo";

export interface PartnerSql {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

let pool: Pool | undefined;
let submissionPool: Pool | undefined;
let opsPool: Pool | undefined;

function databaseUsername(value: string, label: string): string {
  try { return decodeURIComponent(new URL(value).username); } catch { throw new Error(`${label} must be a valid PostgreSQL URL`); }
}

export function getPartnerPool(): Pool {
  if (partnerDemoModeEnabled()) return getPartnerDemoPool();
  const connectionString = process.env.PARTNER_DATABASE_URL;
  if (!connectionString) throw new Error("PARTNER_DATABASE_URL is required for partner portal runtime storage");
  if (process.env.NODE_ENV === "production" && (!process.env.PARTNER_MIGRATION_DATABASE_URL || connectionString === process.env.PARTNER_MIGRATION_DATABASE_URL)) throw new Error("Production partner runtime and migration database URLs must use separate roles");
  if(process.env.NODE_ENV==="production"){
    const expected=process.env.PARTNER_DATABASE_RUNTIME_ROLE;
    if(!expected)throw new Error("PARTNER_DATABASE_RUNTIME_ROLE is required in production");
    let runtimeUsername="";let migrationUsername="";
    try{runtimeUsername=decodeURIComponent(new URL(connectionString).username);migrationUsername=decodeURIComponent(new URL(process.env.PARTNER_MIGRATION_DATABASE_URL!).username);}catch{throw new Error("Partner database URLs must be valid PostgreSQL URLs");}
    if(runtimeUsername!==expected||runtimeUsername===migrationUsername)throw new Error("PARTNER_DATABASE_URL must authenticate as a distinct restricted runtime login");
  }
  pool ??= new Pool({ connectionString, max: 5 });
  return pool;
}

export function getPartnerSubmissionPool(): Pool {
  const connectionString = process.env.PARTNER_SUBMISSION_DATABASE_URL;
  if (!connectionString) throw new Error("PARTNER_SUBMISSION_DATABASE_URL is required for the partner submission worker");
  if (process.env.NODE_ENV === "production") {
    const runtimeUrl = process.env.PARTNER_DATABASE_URL;
    const migrationUrl = process.env.PARTNER_MIGRATION_DATABASE_URL;
    const expected = process.env.PARTNER_SUBMISSION_DATABASE_ROLE;
    if (!runtimeUrl || !migrationUrl || !expected) throw new Error("Production submission storage requires runtime, migration, and submission role configuration");
    if (connectionString === runtimeUrl || connectionString === migrationUrl || runtimeUrl === migrationUrl) throw new Error("Production partner database URLs must use three distinct roles");
    const workerUsername = databaseUsername(connectionString, "PARTNER_SUBMISSION_DATABASE_URL");
    if (workerUsername !== expected || workerUsername === databaseUsername(runtimeUrl, "PARTNER_DATABASE_URL") || workerUsername === databaseUsername(migrationUrl, "PARTNER_MIGRATION_DATABASE_URL")) throw new Error("PARTNER_SUBMISSION_DATABASE_URL must authenticate as the restricted submission worker login");
  }
  submissionPool ??= new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5_000, query_timeout: 10_000, statement_timeout: 10_000 });
  return submissionPool;
}

/** The operations login is function-only and must never share any portal credential. */
export function getPartnerOpsPool(): Pool {
  if (partnerDemoModeEnabled()) return getPartnerDemoPool();
  const connectionString = process.env.PARTNER_OPS_DATABASE_URL;
  const expected = process.env.PARTNER_OPS_DATABASE_ROLE;
  if (!connectionString || !expected) throw new Error("PARTNER_OPS_DATABASE_URL and PARTNER_OPS_DATABASE_ROLE are required for operations storage");
  if (process.env.NODE_ENV === "production" && (!process.env.PARTNER_DATABASE_URL || !process.env.PARTNER_SUBMISSION_DATABASE_URL || !process.env.PARTNER_MIGRATION_DATABASE_URL)) throw new Error("Production operations storage requires distinct portal, submission and migration role configuration");
  const login = databaseUsername(connectionString, "PARTNER_OPS_DATABASE_URL");
  const other = [process.env.PARTNER_DATABASE_URL, process.env.PARTNER_SUBMISSION_DATABASE_URL, process.env.PARTNER_MIGRATION_DATABASE_URL].filter(Boolean).map((value) => databaseUsername(value!, "partner database URL"));
  if (login !== expected || other.includes(login)) throw new Error("PARTNER_OPS_DATABASE_URL must use its distinct restricted operations login");
  opsPool ??= new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5_000, query_timeout: 10_000, statement_timeout: 10_000 });
  return opsPool;
}

export const PARTNER_OPS_LEGACY_FUNCTION_SIGNATURES = [
  "public.partner_ops_company_active(text,uuid,integer,boolean)",
  "public.partner_access_manage_users(text,uuid)",
  "public.partner_access_manage_user(text,uuid,text,text,boolean)",
  "public.partner_access_manage_create(text,uuid,text,text,text,text,text)",
  "public.partner_access_manage_invite(text,uuid,text,text,text,text)",
  "public.partner_settings_notification_get(text)",
  "public.partner_settings_notification_set(text,integer,text)",
  "public.partner_ops_job_links(text,uuid)",
  "public.partner_ops_job_link(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz)",
  "public.partner_ops_link_lookup(text,text)",
  "public.partner_ops_job_status(text,text,jsonb,timestamptz)",
  "public.partner_ops_legacy_connection_status(text,uuid)",
  "public.partner_ops_legacy_connection_set(text,uuid,integer,text,bytea,bytea,integer,text,text)",
  "public.partner_ops_job_link_investigation_required(text,uuid,uuid)",
  "public.partner_ops_job_link_investigated(text,uuid,uuid,integer,text,bigint,jsonb,timestamptz)",
  "public.partner_ops_access_invite(text,uuid,text,text,text)",
  "public.partner_ops_access_issue(text,uuid,text,text,text)",
  "public.partner_ops_access_password(text,uuid,text,text)",
  "public.partner_ops_access_users(text,uuid)",
  "public.partner_access_rate_limit(text,integer)",
  "public.partner_access_email_result(text,boolean)",
  "public.partner_ops_dashboard(text)",
  "public.partner_ops_company_list(text)",
  "public.partner_ops_job_detail(text,uuid)",
  "public.partner_ops_company_create_full(text,text,text,text,jsonb)",
  "public.partner_ops_company_update_full(text,uuid,integer,text,text,text,jsonb)",
  "public.partner_ops_partner_user_list(text,uuid)",
  "public.partner_ops_partner_user_create(text,uuid,text,text,text,text)",
  "public.partner_ops_partner_user_disable(text,uuid,text)",
  "public.partner_ops_fact_append(text,uuid,uuid,text,timestamptz)",
  "public.partner_ops_amendment_append(text,uuid,uuid,jsonb)",
  "public.partner_ops_invoice_upsert(text,uuid,uuid,integer,text,bigint,timestamptz)",
  "public.partner_ops_settlement_upsert(text,uuid,uuid,integer,bigint,bigint,text,timestamptz)",
] as const;

const RETIRED_PARTNER_FINANCE_SIGNATURES = new Set<string>([
  "public.partner_ops_dashboard(text)",
  "public.partner_ops_fact_append(text,uuid,uuid,text,timestamptz)",
  "public.partner_ops_invoice_upsert(text,uuid,uuid,integer,text,bigint,timestamptz)",
  "public.partner_ops_settlement_upsert(text,uuid,uuid,integer,bigint,bigint,text,timestamptz)",
]);
export const PARTNER_OPS_FUNCTION_SIGNATURES = PARTNER_OPS_LEGACY_FUNCTION_SIGNATURES.filter((signature) => !RETIRED_PARTNER_FINANCE_SIGNATURES.has(signature));

export async function assertPartnerOpsRole(sql: PartnerSql, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (partnerDemoModeEnabled(env)) return;
  const expected = env.PARTNER_OPS_DATABASE_ROLE;
  if (!expected || expected === "partner_ops_runtime" || expected === "partner_ops_owner") throw new Error("Partner operations database role is not safely provisioned");
  const approvedSignatures = PARTNER_OPS_FUNCTION_SIGNATURES;
  const result = await sql.query<{ current_user: string; runtime_member: boolean; unsafe_login: boolean; unsafe_group: boolean; extra_membership: boolean; direct_tables: boolean; direct_columns: boolean; direct_sequences: boolean; schema_create: boolean; functions: boolean; unapproved_definers: boolean; unsafe_owner: boolean }>(`WITH allowed AS (
    SELECT signature, to_regprocedure(signature)::oid AS oid FROM unnest($1::text[]) signature
  ) SELECT current_user,
    pg_has_role(current_user,'partner_ops_runtime','MEMBER') AS runtime_member,
    EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=current_user AND (NOT r.rolcanlogin OR r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)) AS unsafe_login,
    NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname='partner_ops_runtime' AND NOT r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication AND NOT r.rolbypassrls) AS unsafe_group,
    EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname NOT IN(current_user,'partner_ops_runtime') AND pg_has_role(current_user,r.oid,'MEMBER')) AS extra_membership,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege WHERE n.nspname NOT IN('pg_catalog','information_schema') AND c.relkind IN('r','p','v','m','f') AND has_table_privilege(current_user,c.oid,privilege)) AS direct_tables,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) privilege WHERE n.nspname NOT IN('pg_catalog','information_schema') AND c.relkind IN('r','p','v','m','f') AND has_any_column_privilege(current_user,c.oid,privilege)) AS direct_columns,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','UPDATE','USAGE']) privilege WHERE n.nspname NOT IN('pg_catalog','information_schema') AND c.relkind='S' AND has_sequence_privilege(current_user,c.oid,privilege)) AS direct_sequences,
    has_schema_privilege(current_user,'public','CREATE') AS schema_create,
    (SELECT count(*)=cardinality($1::text[]) AND bool_and(p.oid IS NOT NULL AND p.prosecdef AND r.rolname='partner_ops_owner' AND p.proconfig=ARRAY['search_path=pg_catalog'] AND has_function_privilege(current_user,p.oid,'EXECUTE')) FROM allowed a LEFT JOIN pg_proc p ON p.oid=a.oid LEFT JOIN pg_roles r ON r.oid=p.proowner) AS functions,
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN('pg_catalog','information_schema') AND (p.prosecdef OR p.proname LIKE 'partner_ops_%') AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM allowed a WHERE a.oid=p.oid)) AS unapproved_definers,
    NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname='partner_ops_owner' AND NOT r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication AND NOT r.rolbypassrls AND NOT EXISTS(SELECT 1 FROM pg_roles parent WHERE parent.oid<>r.oid AND pg_has_role(r.oid,parent.oid,'MEMBER'))) AS unsafe_owner`, [approvedSignatures]);
  const row = result.rows[0];
  if (!row || row.current_user !== expected || row.runtime_member !== true || row.functions !== true || [row.unsafe_login, row.unsafe_group, row.extra_membership, row.direct_tables, row.direct_columns, row.direct_sequences, row.schema_create, row.unapproved_definers, row.unsafe_owner].some(value => value !== false)) throw new Error("Partner operations database role is not safely provisioned");
}
// Recheck effective grants per request; a previously safe connection must not mask privilege drift.
export function ensurePartnerOpsRole(): Promise<void> { return assertPartnerOpsRole(getPartnerOpsPool()); }

export async function assertPartnerRuntimeRole(sql:PartnerSql,env:NodeJS.ProcessEnv=process.env):Promise<void>{
  if(partnerDemoModeEnabled(env))return;
  const accessBoundary = await sql.query<{access_functions:boolean;access_tables:boolean}>(`SELECT
    (SELECT count(*)=4 AND bool_and(p.prosecdef AND r.rolname=\'partner_ops_owner\' AND p.proconfig=ARRAY[\'search_path=pg_catalog\'] AND has_function_privilege(current_user,p.oid,\'EXECUTE\'))
    FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid IN (to_regprocedure(\'public.partner_access_rate_limit(text,integer)\'),to_regprocedure(\'public.partner_access_request_reset(text,text)\'),to_regprocedure(\'public.partner_access_complete(text,text)\'),to_regprocedure(\'public.partner_access_email_result(text,boolean)\'))) AS access_functions,
    EXISTS(SELECT 1 FROM unnest(ARRAY[\'public.partner_account_links\',\'public.partner_access_rate_limits\']) table_name CROSS JOIN unnest(ARRAY[\'SELECT\',\'INSERT\',\'UPDATE\',\'DELETE\']) privilege WHERE has_table_privilege(current_user,table_name,privilege)) AS access_tables`);
  if(accessBoundary.rows[0]?.access_functions!==true||accessBoundary.rows[0]?.access_tables!==false)throw new Error("Partner runtime database role is not safely provisioned");
  const userPrivileges = await sql.query<{ can_user_security_update: boolean }>(`SELECT EXISTS(
    SELECT 1 FROM unnest(ARRAY['invitation_pending','password_version','id','company_id','principal_type','ops_role','disabled_at']) column_name
    WHERE has_column_privilege(current_user,'public.partner_users',column_name,'UPDATE')
  ) AS can_user_security_update`);
  if (userPrivileges.rows[0]?.can_user_security_update !== false) throw new Error("Partner runtime database role is not safely provisioned");
  const expected=env.PARTNER_DATABASE_RUNTIME_ROLE??"partner_portal_runtime";
  const migrationRole=env.PARTNER_MIGRATION_DATABASE_URL?databaseUsername(env.PARTNER_MIGRATION_DATABASE_URL,"PARTNER_MIGRATION_DATABASE_URL"):"__partner_migration_role_not_configured__";
  const result=await sql.query<{current_user:string;can_artifact_select:boolean;can_artifact_insert:boolean;can_artifact_update:boolean;can_artifact_delete:boolean;can_artifact_truncate:boolean;can_drawing_delete:boolean;can_drawing_data_insert:boolean;can_drawing_data_update:boolean;can_drawing_pointer_update:boolean;can_job_protected_update:boolean;runtime_group_member:boolean;artifact_owner_member:boolean;submission_owner_member:boolean;worker_member:boolean;migration_member:boolean;can_artifact_functions:boolean;can_submission_tables:boolean;can_submission_runtime_functions:boolean;can_submission_worker_functions:boolean;can_unapproved_definers:boolean}>(`SELECT current_user,
    has_table_privilege(current_user,'partner_site_plan_pdf_artifacts','SELECT') AS can_artifact_select,
    has_table_privilege(current_user,'partner_site_plan_pdf_artifacts','INSERT') AS can_artifact_insert,
    has_table_privilege(current_user,'partner_site_plan_pdf_artifacts','UPDATE') AS can_artifact_update,
    has_table_privilege(current_user,'partner_site_plan_pdf_artifacts','DELETE') AS can_artifact_delete,
    has_table_privilege(current_user,'partner_site_plan_pdf_artifacts','TRUNCATE') AS can_artifact_truncate,
    has_table_privilege(current_user,'partner_site_plan_drawings','DELETE') AS can_drawing_delete,
    has_column_privilege(current_user,'partner_site_plan_drawings','drawing_data','INSERT') AS can_drawing_data_insert,
    has_column_privilege(current_user,'partner_site_plan_drawings','drawing_data','UPDATE') AS can_drawing_data_update,
    has_column_privilege(current_user,'partner_site_plan_drawings','current_pdf_artifact_id','UPDATE') AS can_drawing_pointer_update,
    (SELECT COALESCE(bool_or(has_column_privilege(current_user,'public.partner_jobs',column_name,'UPDATE')),false)
      FROM unnest(ARRAY['deleted_at','id','company_id','created_by_user_id','billing_model_snapshot','created_at','submission_state','legacy_job_id','legacy_job_number','final_quote_number','submission_started_at','submitted_at','submission_checkpoint','submission_adapter_mode_snapshot','submission_contract_version_snapshot','legacy_job_prefix_snapshot']) column_name) AS can_job_protected_update,
    pg_has_role(current_user,'partner_portal_runtime','MEMBER') AS runtime_group_member,
    pg_has_role(current_user,'partner_artifact_owner','MEMBER') AS artifact_owner_member,
    pg_has_role(current_user,'partner_submission_owner','MEMBER') AS submission_owner_member,
    pg_has_role(current_user,'partner_submission_worker','MEMBER') AS worker_member,
    EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=$1 AND pg_has_role(current_user,r.oid,'MEMBER')) AS migration_member,
    (SELECT count(*)=4 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles owner ON owner.oid=p.proowner
      WHERE n.nspname='public' AND ((p.proname='partner_lock_site_plan_company' AND oidvectortypes(p.proargtypes)='uuid')
        OR (p.proname='partner_prune_site_plan_pdf_artifacts' AND oidvectortypes(p.proargtypes)='uuid')
        OR (p.proname='partner_publish_site_plan_pdf_artifact' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, text, bytea, integer, text, text, text, text, text, text, integer, integer, uuid')
        OR (p.proname='partner_purge_draft_site_plan_drawing' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, integer'))
      AND p.prosecdef AND owner.rolname='partner_artifact_owner' AND p.proconfig @> ARRAY['search_path=pg_catalog']
      AND has_function_privilege(current_user,p.oid,'EXECUTE')) AS can_artifact_functions,
    (SELECT bool_or(has_table_privilege(current_user,table_name,privilege)) FROM unnest(ARRAY['public.partner_submission_snapshots','public.partner_submission_plan_manifest','public.partner_submission_requests','public.partner_submission_plan_deliveries','public.partner_submission_rate_limits','public.partner_submission_attempts','public.partner_outbox_events']) table_name CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege) AS can_submission_tables,
    (SELECT count(*)=5 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles owner ON owner.oid=p.proowner WHERE n.nspname='public'
      AND ((p.proname='partner_freeze_submission' AND oidvectortypes(p.proargtypes)='uuid, uuid, text, integer, integer, uuid, uuid, text, text, jsonb')
        OR (p.proname='partner_delete_draft' AND oidvectortypes(p.proargtypes)='uuid, uuid, text, integer')
        OR (p.proname='partner_submission_status' AND oidvectortypes(p.proargtypes)='uuid, uuid')
        OR (p.proname='partner_consume_submission_rate_limit' AND oidvectortypes(p.proargtypes)='uuid, text, text, integer, integer')
        OR (p.proname='partner_submission_request_id' AND oidvectortypes(p.proargtypes)='uuid, uuid'))
      AND p.prosecdef AND owner.rolname='partner_submission_owner' AND p.proconfig @> ARRAY['search_path=pg_catalog']
      AND has_function_privilege(current_user,p.oid,'EXECUTE')) AS can_submission_runtime_functions,
    (SELECT bool_or(has_function_privilege(current_user,p.oid,'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN('partner_claim_submission','partner_checkpoint_submission','partner_finalize_submission','partner_submission_claimed_snapshot')) AS can_submission_worker_functions,
    (SELECT COALESCE(bool_or(has_function_privilege(current_user,p.oid,'EXECUTE')),false) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND p.proname LIKE 'partner_%' AND NOT (
      (p.proname='partner_lock_site_plan_company' AND oidvectortypes(p.proargtypes)='uuid') OR
      (p.proname='partner_prune_site_plan_pdf_artifacts' AND oidvectortypes(p.proargtypes)='uuid') OR
      (p.proname='partner_publish_site_plan_pdf_artifact' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, text, bytea, integer, text, text, text, text, text, text, integer, integer, uuid') OR
      (p.proname='partner_purge_draft_site_plan_drawing' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, integer') OR
      (p.proname='partner_freeze_submission' AND oidvectortypes(p.proargtypes)='uuid, uuid, text, integer, integer, uuid, uuid, text, text, jsonb') OR
      (p.proname='partner_delete_draft' AND oidvectortypes(p.proargtypes)='uuid, uuid, text, integer') OR
      (p.proname='partner_submission_status' AND oidvectortypes(p.proargtypes)='uuid, uuid') OR
      (p.proname='partner_consume_submission_rate_limit' AND oidvectortypes(p.proargtypes)='uuid, text, text, integer, integer') OR
      (p.proname='partner_submission_request_id' AND oidvectortypes(p.proargtypes)='uuid, uuid') OR
      (p.proname='partner_partner_tracking_projection' AND oidvectortypes(p.proargtypes)='text, uuid, uuid') OR
      p.oid IN (to_regprocedure('public.partner_access_rate_limit(text,integer)'),to_regprocedure('public.partner_access_request_reset(text,text)'),to_regprocedure('public.partner_access_complete(text,text)'),to_regprocedure('public.partner_access_email_result(text,boolean)')))) AS can_unapproved_definers`,[migrationRole]);
  const row=result.rows[0];
  const unsafe=!row||row.current_user!==expected||!row.runtime_group_member||!row.can_artifact_select||row.can_artifact_insert||row.can_artifact_update||row.can_artifact_delete||row.can_artifact_truncate||row.can_drawing_delete||!row.can_drawing_data_insert||!row.can_drawing_data_update||row.can_drawing_pointer_update||row.can_job_protected_update||row.artifact_owner_member||row.submission_owner_member||row.worker_member||row.migration_member||!row.can_artifact_functions||row.can_submission_tables||!row.can_submission_runtime_functions||row.can_submission_worker_functions||row.can_unapproved_definers;
  if(unsafe){console.error("[partner:db] runtime role verification failed",{hasRow:Boolean(row),identityMatches:row?.current_user===expected,runtimeGroup:row?.runtime_group_member===true,artifactReadOnly:row?.can_artifact_select===true&&row?.can_artifact_insert===false&&row?.can_artifact_update===false&&row?.can_artifact_delete===false&&row?.can_artifact_truncate===false,drawingScope:row?.can_drawing_delete===false&&row?.can_drawing_data_insert===true&&row?.can_drawing_data_update===true&&row?.can_drawing_pointer_update===false,jobScope:row?.can_job_protected_update===false,ownerIsolation:row?.artifact_owner_member===false&&row?.submission_owner_member===false&&row?.worker_member===false&&row?.migration_member===false,artifactFunctions:row?.can_artifact_functions===true,submissionBoundary:row?.can_submission_tables===false&&row?.can_submission_runtime_functions===true&&row?.can_submission_worker_functions===false,approvedDefiners:row?.can_unapproved_definers===false});throw new Error("Partner runtime database role is not safely provisioned");}
}

export async function assertPartnerSubmissionWorkerRole(sql: PartnerSql, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const expected = env.PARTNER_SUBMISSION_DATABASE_ROLE ?? "partner_submission_worker";
  const result = await sql.query<{
    current_user: string; worker_member: boolean; submission_owner_member: boolean; artifact_owner_member: boolean; runtime_member: boolean; migration_member:boolean;
    can_company_select: boolean; can_auth_select: boolean; can_artifact_select: boolean; can_snapshot_select: boolean; can_job_update: boolean;
    can_worker_functions: boolean; can_runtime_freeze: boolean; can_direct_tables: boolean; can_unapproved_definers:boolean;
  }>(`SELECT current_user,
    pg_has_role(current_user,'partner_submission_worker','MEMBER') AS worker_member,
    pg_has_role(current_user,'partner_submission_owner','MEMBER') AS submission_owner_member,
    pg_has_role(current_user,'partner_artifact_owner','MEMBER') AS artifact_owner_member,
    pg_has_role(current_user,'partner_portal_runtime','MEMBER') AS runtime_member,
    EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=$1 AND pg_has_role(current_user,r.oid,'MEMBER')) AS migration_member,
    has_table_privilege(current_user,'partner_companies','SELECT') AS can_company_select,
    has_table_privilege(current_user,'partner_sessions','SELECT') OR has_table_privilege(current_user,'partner_accounts','SELECT') AS can_auth_select,
    has_table_privilege(current_user,'partner_site_plan_pdf_artifacts','SELECT') AS can_artifact_select,
    has_table_privilege(current_user,'partner_submission_snapshots','SELECT') AS can_snapshot_select,
    has_table_privilege(current_user,'partner_jobs','UPDATE') AS can_job_update,
    (SELECT bool_or(has_table_privilege(current_user,table_name,privilege)) FROM unnest(ARRAY['public.partner_companies','public.partner_users','public.partner_sessions','public.partner_accounts','public.partner_verifications','public.partner_audit_events','public.partner_outbox_events','public.partner_jobs','public.partner_site_plan_drawings','public.partner_site_plan_pdf_artifacts','public.partner_submission_snapshots','public.partner_submission_requests','public.partner_submission_plan_manifest','public.partner_submission_plan_deliveries','public.partner_submission_rate_limits','public.partner_submission_attempts','public.partner_notification_settings']) table_name CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege) AS can_direct_tables,
    (SELECT count(*)=30 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles owner ON owner.oid=p.proowner WHERE n.nspname='public'
      AND ((p.proname='partner_claim_submission_bounded' AND oidvectortypes(p.proargtypes)='text, integer')
        OR (p.proname='partner_claim_submission_exact' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, text, integer')
        OR (p.proname='partner_claim_submission_notification_exact' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, text, integer')
        OR (p.proname='partner_heartbeat_submission' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint, integer')
        OR (p.proname='partner_checkpoint_submission_bounded' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint, text, text, bigint, integer, text')
        OR (p.proname='partner_begin_plan_upload' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint, integer')
        OR (p.proname='partner_checkpoint_quote_verified' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint, text')
        OR (p.proname='partner_adopt_attached_plan' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint, integer, text')
        OR (p.proname='partner_begin_attachment' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint')
        OR (p.proname='partner_release_submission_bounded' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint, text, integer')
        OR (p.proname='partner_finalize_submission_verified' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint, integer')
        OR (p.proname='partner_reconcile_submission' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint, text')
        OR (p.proname IN('partner_submission_claimed_snapshot','partner_submission_claimed_plans') AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint')
        OR (p.proname='partner_claim_notification' AND oidvectortypes(p.proargtypes)='text, integer')
        OR (p.proname='partner_claim_notification_exact' AND oidvectortypes(p.proargtypes)='uuid, text, integer')
        OR (p.proname='partner_notification_delivery_context' AND oidvectortypes(p.proargtypes)='uuid, uuid, bigint')
        OR (p.proname='partner_begin_notification_dispatch' AND oidvectortypes(p.proargtypes)='uuid, uuid, bigint, text, text, text, text, text, text, text, bigint, text, bigint, text')
        OR (p.proname='partner_notification_test_status' AND oidvectortypes(p.proargtypes)='uuid')
        OR (p.proname='partner_heartbeat_notification' AND oidvectortypes(p.proargtypes)='uuid, uuid, bigint, integer')
        OR (p.proname='partner_checkpoint_notification_accepted' AND oidvectortypes(p.proargtypes)='uuid, uuid, bigint, text')
        OR (p.proname='partner_release_notification' AND oidvectortypes(p.proargtypes)='uuid, uuid, bigint, text, integer')
        OR (p.proname='partner_finalize_notification' AND oidvectortypes(p.proargtypes)='uuid, uuid, bigint, text')
        OR (p.proname='partner_reconcile_notification' AND oidvectortypes(p.proargtypes)='uuid, uuid, bigint, text')
        OR (p.proname='partner_begin_legacy_create_dispatch' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint')
        OR (p.proname='partner_record_legacy_create_result' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, text, bigint')
        OR (p.proname='partner_legacy_create_receipt' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid')
        OR (p.proname='partner_claim_live_test_request' AND oidvectortypes(p.proargtypes)='uuid, text, integer')
        OR (p.proname IN('partner_live_test_queue_guard','partner_live_test_status') AND oidvectortypes(p.proargtypes)='uuid'))
      AND p.prosecdef AND owner.rolname='partner_submission_owner' AND p.proconfig @> ARRAY['search_path=pg_catalog'] AND has_function_privilege(current_user,p.oid,'EXECUTE')) AS can_worker_functions,
    (SELECT bool_or(has_function_privilege(current_user,p.oid,'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='partner_freeze_submission') AS can_runtime_freeze,
    (SELECT COALESCE(bool_or(has_function_privilege(current_user,p.oid,'EXECUTE')),false) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND p.proname LIKE 'partner_%' AND NOT (
      (p.proname='partner_claim_submission_bounded' AND oidvectortypes(p.proargtypes)='text, integer') OR
      (p.proname='partner_claim_submission_exact' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, text, integer') OR
      (p.proname='partner_claim_submission_notification_exact' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, text, integer') OR
      (p.proname='partner_heartbeat_submission' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint, integer') OR
      (p.proname='partner_checkpoint_submission_bounded' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint, text, text, bigint, integer, text') OR
      (p.proname='partner_begin_plan_upload' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint, integer') OR
      (p.proname='partner_checkpoint_quote_verified' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint, text') OR
      (p.proname='partner_adopt_attached_plan' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint, integer, text') OR
      (p.proname='partner_begin_attachment' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint') OR
      (p.proname='partner_release_submission_bounded' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint, text, integer') OR
      (p.proname='partner_finalize_submission_verified' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint, integer') OR
      (p.proname='partner_reconcile_submission' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint, text') OR
      (p.proname IN('partner_submission_claimed_snapshot','partner_submission_claimed_plans') AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint') OR
      (p.proname='partner_claim_notification' AND oidvectortypes(p.proargtypes)='text, integer') OR
      (p.proname='partner_claim_notification_exact' AND oidvectortypes(p.proargtypes)='uuid, text, integer') OR
      (p.proname='partner_notification_delivery_context' AND oidvectortypes(p.proargtypes)='uuid, uuid, bigint') OR
      (p.proname='partner_begin_notification_dispatch' AND oidvectortypes(p.proargtypes)='uuid, uuid, bigint, text, text, text, text, text, text, text, bigint, text, bigint, text') OR
      (p.proname='partner_notification_test_status' AND oidvectortypes(p.proargtypes)='uuid') OR
      (p.proname='partner_heartbeat_notification' AND oidvectortypes(p.proargtypes)='uuid, uuid, bigint, integer') OR
      (p.proname='partner_checkpoint_notification_accepted' AND oidvectortypes(p.proargtypes)='uuid, uuid, bigint, text') OR
      (p.proname='partner_release_notification' AND oidvectortypes(p.proargtypes)='uuid, uuid, bigint, text, integer') OR
      (p.proname='partner_finalize_notification' AND oidvectortypes(p.proargtypes)='uuid, uuid, bigint, text') OR
      (p.proname='partner_reconcile_notification' AND oidvectortypes(p.proargtypes)='uuid, uuid, bigint, text') OR
      (p.proname='partner_begin_legacy_create_dispatch' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, bigint') OR
      (p.proname='partner_record_legacy_create_result' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid, uuid, text, bigint') OR
      (p.proname='partner_legacy_create_receipt' AND oidvectortypes(p.proargtypes)='uuid, uuid, uuid') OR
      (p.proname='partner_claim_live_test_request' AND oidvectortypes(p.proargtypes)='uuid, text, integer') OR
      (p.proname IN('partner_live_test_queue_guard','partner_live_test_status') AND oidvectortypes(p.proargtypes)='uuid'))) AS can_unapproved_definers`,[env.PARTNER_MIGRATION_DATABASE_URL?databaseUsername(env.PARTNER_MIGRATION_DATABASE_URL,"PARTNER_MIGRATION_DATABASE_URL"):"__partner_migration_role_not_configured__"]);
  const row = result.rows[0];
  if (!row || row.current_user !== expected || !row.worker_member || row.submission_owner_member || row.artifact_owner_member || row.runtime_member || row.migration_member
    || row.can_company_select || row.can_auth_select || row.can_artifact_select || row.can_snapshot_select || row.can_job_update || row.can_direct_tables || !row.can_worker_functions || row.can_runtime_freeze || row.can_unapproved_definers) {
    throw new Error("Partner submission worker database role is not safely provisioned");
  }
}

let submissionRoleAssertion: Promise<void> | undefined;
export function ensurePartnerSubmissionWorkerRole(): Promise<void> {
  submissionRoleAssertion ??= assertPartnerSubmissionWorkerRole(getPartnerSubmissionPool());
  return submissionRoleAssertion;
}

let runtimeRoleAssertion:Promise<void>|undefined;
export function ensurePartnerRuntimeRole():Promise<void>{runtimeRoleAssertion??=assertPartnerRuntimeRole(getPartnerPool());return runtimeRoleAssertion;}

export async function withPartnerTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPartnerPool().connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
