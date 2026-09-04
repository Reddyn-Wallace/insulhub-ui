import { describe, expect, it, vi } from "vitest";
import { assertPartnerOpsRole, assertPartnerRuntimeRole, assertPartnerSubmissionWorkerRole, PARTNER_OPS_FUNCTION_SIGNATURES, type PartnerSql } from "./db";

function roleSql(row: Record<string, unknown>): PartnerSql {
  return { query: vi.fn(async () => ({ rows: [row], rowCount: 1 })) as PartnerSql["query"] };
}

describe("partner operations function-only database role", () => {
  const safe = { current_user: "ops_login", runtime_member: true, unsafe_login: false, unsafe_group: false, extra_membership: false, direct_tables: false, direct_columns: false, direct_sequences: false, schema_create: false, functions: true, unapproved_definers: false, unsafe_owner: false };
  const env = { NODE_ENV: "test" as const, PARTNER_OPS_DATABASE_ROLE: "ops_login", PARTNER_NEUTRAL_CUTOVER_COMPLETE: "true" };
  it("asserts the complete exact signature/owner/search-path and effective privilege set", async () => {
    const sql = roleSql(safe);
    await expect(assertPartnerOpsRole(sql, env)).resolves.toBeUndefined();
    expect(sql.query).toHaveBeenCalledWith(expect.stringContaining("to_regprocedure(signature)"), [PARTNER_OPS_FUNCTION_SIGNATURES]);
    expect(PARTNER_OPS_FUNCTION_SIGNATURES).toHaveLength(29);
    expect(new Set(PARTNER_OPS_FUNCTION_SIGNATURES).size).toBe(29);
  });

  it("pins the branded notification dispatch signature in both worker allowlists",async()=>{
    const safe={current_user:"partner_submission_worker",worker_member:true,submission_owner_member:false,artifact_owner_member:false,runtime_member:false,migration_member:false,can_company_select:false,can_auth_select:false,can_artifact_select:false,can_snapshot_select:false,can_job_update:false,can_worker_functions:true,can_runtime_freeze:false,can_direct_tables:false,can_unapproved_definers:false};
    const sql={query:vi.fn<(text:string,values?:readonly unknown[])=>Promise<{rows:typeof safe[];rowCount:number}>>().mockResolvedValue({rows:[safe],rowCount:1})};
    await expect(assertPartnerSubmissionWorkerRole(sql as never,{NODE_ENV:"test"} as NodeJS.ProcessEnv)).resolves.toBeUndefined();
    const query=sql.query.mock.calls[0][0] as string,signature="uuid, uuid, bigint, text, text, text, text, text, text, text, bigint, text, bigint, text";
    expect(query.split(signature)).toHaveLength(3);
    expect(query).not.toContain("uuid, uuid, bigint, text, text, text, bigint, text'");
  });
  it.each([
    { current_user: "migration_login" }, { runtime_member: false }, { unsafe_login: true }, { unsafe_group: true }, { extra_membership: true },
    { direct_tables: true }, { direct_columns: true }, { direct_sequences: true }, { schema_create: true },
    { functions: false }, { functions: null }, { unapproved_definers: true }, { unsafe_owner: true },
  ])("fails closed for any grant, owner, signature or membership drift", async change => {
    await expect(assertPartnerOpsRole(roleSql({ ...safe, ...change }), env)).rejects.toThrow("not safely provisioned");
  });
  it("requires a separately named login rather than accepting the group role", async () => {
    for (const value of [undefined, "partner_ops_runtime", "partner_ops_owner"]) await expect(assertPartnerOpsRole(roleSql(safe), { NODE_ENV: "test", PARTNER_OPS_DATABASE_ROLE: value })).rejects.toThrow("not safely provisioned");
  });
});

describe("partner runtime database role", () => {
  const safeRuntime = { access_functions: true, access_tables: false, current_user: "partner_runtime_login", can_user_security_update: false, runtime_group_member: true, can_artifact_select: true, can_artifact_insert: false, can_artifact_update: false, can_artifact_delete: false, can_artifact_truncate: false, can_drawing_delete: false, can_drawing_data_insert: true, can_drawing_data_update: true, can_drawing_pointer_update: false, can_job_protected_update: false, artifact_owner_member: false, submission_owner_member: false, worker_member: false, migration_member: false, can_artifact_functions: true, can_submission_tables: false, can_submission_runtime_functions: true, can_submission_worker_functions: false, can_unapproved_definers: false };

  it("accepts only the expected role without direct artifact mutation privileges", async () => {
    const sql = roleSql(safeRuntime);
    await expect(assertPartnerRuntimeRole(sql, { NODE_ENV: "test", PARTNER_DATABASE_RUNTIME_ROLE: "partner_runtime_login" })).resolves.toBeUndefined();
    expect((sql.query as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0]).join("\n")).toContain("partner_submission_request_id");
  });

  it.each([
    { current_user: "migration_owner" },
    { can_user_security_update: true },
    { access_functions: false },
    { access_tables: true },
    { can_artifact_select: false },
    { can_artifact_insert: true },
    { can_artifact_update: true },
    { can_artifact_delete: true },
    { can_artifact_truncate: true },
    { can_drawing_delete: true },
    { can_drawing_data_insert: false },
    { can_drawing_data_update: false },
    { can_drawing_pointer_update: true },
    { can_job_protected_update: true },
    { runtime_group_member: false },
    { artifact_owner_member: true },
    { submission_owner_member: true },
    { worker_member: true },
    { migration_member: true },
    { can_artifact_functions: false },
    { can_submission_tables: true },
    { can_submission_runtime_functions: false },
    { can_submission_worker_functions: true },
    { can_unapproved_definers: true },
  ])("fails closed for an unsafe role or effective privilege set", async (row) => {
    await expect(assertPartnerRuntimeRole(roleSql({ ...safeRuntime, ...row }), { NODE_ENV: "test", PARTNER_DATABASE_RUNTIME_ROLE: "partner_runtime_login" })).rejects.toThrow("not safely provisioned");
  });
});

describe("partner submission worker database role", () => {
  const safeWorker = { current_user: "partner_worker_login", worker_member: true, submission_owner_member: false, artifact_owner_member: false, runtime_member: false, migration_member: false, can_company_select: false, can_auth_select: false, can_artifact_select: false, can_snapshot_select: false, can_job_update: false, can_direct_tables: false, can_worker_functions: true, can_runtime_freeze: false, can_unapproved_definers: false };

  it("accepts only the narrow function-only worker role", async () => {
    const sql=roleSql(safeWorker);await expect(assertPartnerSubmissionWorkerRole(sql, { NODE_ENV: "test", PARTNER_SUBMISSION_DATABASE_ROLE: "partner_worker_login" })).resolves.toBeUndefined();
    const query=(sql.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;expect(query).toContain("partner_claim_submission_exact");expect(query).toContain("partner_claim_submission_notification_exact");
  });

  it.each([
    { current_user: "migration_owner" }, { worker_member: false }, { submission_owner_member: true }, { artifact_owner_member: true }, { runtime_member: true }, { migration_member: true },
    { can_company_select: true }, { can_auth_select: true }, { can_artifact_select: true }, { can_snapshot_select: true }, { can_job_update: true }, { can_direct_tables: true },
    { can_worker_functions: false }, { can_runtime_freeze: true }, { can_unapproved_definers: true },
  ])("fails closed for worker privilege drift", async (row) => {
    await expect(assertPartnerSubmissionWorkerRole(roleSql({ ...safeWorker, ...row }), { NODE_ENV: "test", PARTNER_SUBMISSION_DATABASE_ROLE: "partner_worker_login" })).rejects.toThrow("not safely provisioned");
  });
});
