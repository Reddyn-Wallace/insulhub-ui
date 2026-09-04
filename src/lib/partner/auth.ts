import "server-only";
import { randomUUID } from "node:crypto";
import { verifyPassword } from "better-auth/crypto";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import type { Pool } from "pg";
import { ensurePartnerRuntimeRole, getPartnerPool, withPartnerTransaction, type PartnerSql } from "./db";
import { writePartnerAuditEvent } from "./audit";
import { PARTNER_DEMO_AUTH_SECRET, partnerDemoModeEnabled } from "./demo";
import type { AuthenticatedPrincipal, InternalPrincipal, PartnerPrincipal } from "./repository";
import { PARTNER_SETTINGS_SERVICE_ID } from "./settings-service";

type AuthDatabase = Pick<Pool, "query">;

export function createPartnerAuth(options: { database: AuthDatabase; secret: string; baseURL: string }) {
  const database = options.database;
  return betterAuth({
    appName: "Insul Hub Partner Portal",
    basePath: "/api/partner/auth",
    baseURL: options.baseURL,
    secret: options.secret,
    database,
    trustedOrigins: [new URL(options.baseURL).origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    user: {
      modelName: "partner_users",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: {
        companyId: { type: "string", required: false, input: false, fieldName: "company_id" },
        principalType: { type: ["PARTNER", "INTERNAL"], required: true, input: false, fieldName: "principal_type" },
        disabledAt: { type: "date", required: false, input: false, returned: false, fieldName: "disabled_at" },
      },
    },
    session: {
      modelName: "partner_sessions",
      additionalFields: { passwordVersion: { type: "number", defaultValue: 0, input: false, fieldName: "password_version" } },
      expiresIn: 60 * 60 * 12,
      updateAge: 60 * 60,
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        userId: "user_id",
      },
    },
    account: {
      modelName: "partner_accounts",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "partner_verifications",
      fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "partner_auth_rate_limits",
      window: 60,
      max: 30,
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
      fields: { lastRequest: "last_request" },
    },
    advanced: {
      cookiePrefix: "insulhub_partner",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      },
      database: { generateId: () => randomUUID() },
    },
    logger: { disabled: true },
    databaseHooks: {
      session: {
        create: {
          before: async (session, context) => {
            if (session.userId === PARTNER_SETTINGS_SERVICE_ID) throw new APIError("UNAUTHORIZED", { message: "Invalid credentials" });
            const user = await database.query(
              `SELECT u.principal_type, u.disabled_at, u.invitation_pending, u.password_version, c.is_active AS company_active
               FROM partner_users u
               LEFT JOIN partner_companies c ON c.id = u.company_id
               WHERE u.id = $1`,
              [session.userId],
            );
            const row = user.rows[0] as { principal_type?: string; disabled_at?: Date | null; invitation_pending?: boolean; password_version?: number; company_active?: boolean | null } | undefined;
            const surface = context?.request?.headers.get("x-partner-auth-surface");
            const expectedType = surface === "ops" ? "INTERNAL" : surface === "partner" ? "PARTNER" : null;
            if (!row || row.invitation_pending || (expectedType && row.principal_type !== expectedType)) {
              throw new APIError("UNAUTHORIZED", { message: "Invalid credentials" });
            }
            if (context?.path === "/sign-in/email") {
              const password = (context.body as {password?:unknown})?.password;
              const credentials = await database.query("SELECT password FROM partner_accounts WHERE user_id=$1 AND provider_id=\'credential\'", [session.userId]);
              const hash = credentials.rows[0]?.password;
              if (typeof password !== "string" || typeof hash !== "string" || !await verifyPassword({hash,password})) throw new APIError("UNAUTHORIZED", {message:"Invalid credentials"});
            }
            if (row.disabled_at || (row.principal_type === "PARTNER" && row.company_active !== true)) {
              // Only a freshly verified password may reveal that access was disabled.
              if (context?.path === "/sign-in/email") throw new APIError("FORBIDDEN", { code: "ACCOUNT_DISABLED", message: "Your account is disabled. Contact your administrator." });
              throw new APIError("UNAUTHORIZED", { message: "Invalid credentials" });
            }
            // The DB insert trigger fences a reset that races this second password check.
            return { data: { ...session, passwordVersion: Number(row.password_version ?? 0) } };
          },
        },
      },
    },
  });
}

export type PartnerAuth = ReturnType<typeof createPartnerAuth>;
let authInstance: PartnerAuth | undefined;

function authConfiguration(): { secret: string; baseURL: string } {
  if (partnerDemoModeEnabled()) {
    return { secret: PARTNER_DEMO_AUTH_SECRET, baseURL: process.env.PARTNER_APP_ORIGIN! };
  }
  const secret = process.env.PARTNER_AUTH_SECRET;
  const baseURL = process.env.PARTNER_APP_ORIGIN;
  if (!secret || secret.length < 32) throw new Error("PARTNER_AUTH_SECRET must be at least 32 characters");
  if (!baseURL) throw new Error("PARTNER_APP_ORIGIN is required");
  return { secret, baseURL };
}

export function getPartnerAuth(): PartnerAuth {
  authInstance ??= createPartnerAuth({ database: getPartnerPool(), ...authConfiguration() });
  return authInstance;
}

export async function getAuthenticatedPrincipal(requestHeaders: Headers): Promise<AuthenticatedPrincipal | null> {
  await ensurePartnerRuntimeRole();
  return getAuthenticatedPrincipalWith(getPartnerAuth(), getPartnerPool(), requestHeaders);
}

export async function getAuthenticatedPrincipalWith(
  auth: PartnerAuth,
  sql: PartnerSql,
  requestHeaders: Headers,
): Promise<AuthenticatedPrincipal | null> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session || session.user.id === PARTNER_SETTINGS_SERVICE_ID) return null;
  const result = await sql.query<{
    id: string;
    company_id: string | null;
    principal_type: "PARTNER" | "INTERNAL";
    disabled_at: Date | null;
    company_active: boolean | null;
    invitation_pending: boolean;
    password_version: number;
    session_password_version: number;
  }>(
    `SELECT u.id, u.company_id, u.principal_type, u.disabled_at, u.invitation_pending, u.password_version, s.password_version AS session_password_version, c.is_active AS company_active
     FROM partner_users u
     JOIN partner_sessions s ON s.user_id=u.id AND s.id=$2
     LEFT JOIN partner_companies c ON c.id = u.company_id
     WHERE u.id = $1`,
    [session.user.id, session.session.id],
  );
  const user = result.rows[0];
  if (!user || user.disabled_at || user.invitation_pending || user.password_version !== user.session_password_version) return null;
  if (user.principal_type === "PARTNER" && user.company_id && user.company_active === true) {
    return { userId: user.id, companyId: user.company_id, principalType: "PARTNER" };
  }
  if (user.principal_type === "INTERNAL" && !user.company_id) return { userId: user.id, companyId: null, principalType: "INTERNAL" };
  return null;
}

export async function requirePartnerPrincipal(requestHeaders: Headers): Promise<PartnerPrincipal | null> {
  const principal = await getAuthenticatedPrincipal(requestHeaders);
  return principal?.principalType === "PARTNER" ? principal : null;
}

export async function requireInternalPrincipal(requestHeaders: Headers): Promise<InternalPrincipal | null> {
  const principal = await getAuthenticatedPrincipal(requestHeaders);
  return principal?.principalType === "INTERNAL" ? principal : null;
}

export async function disablePartnerUser(input: { actor: InternalPrincipal; subjectUserId: string; reason: string }): Promise<void> {
  await withPartnerTransaction(async (client) => {
    await disablePartnerUserInTransaction(client, input);
  });
}

export async function disablePartnerUserInTransaction(
  sql: AuthDatabase,
  input: { actor: InternalPrincipal; subjectUserId: string; reason: string },
): Promise<void> {
    if (input.actor.principalType !== "INTERNAL" || input.actor.companyId !== null) {
      throw new Error("Internal authorization required");
    }
    const authorization = await sql.query<{ id: string }>(
       `WITH authorized_actor AS (
         SELECT id FROM partner_users
         WHERE id = $1 AND principal_type = 'INTERNAL' AND company_id IS NULL AND disabled_at IS NULL
         FOR UPDATE
       )
       SELECT id FROM authorized_actor`,
      [input.actor.userId],
    );
    if (!authorization.rows[0]) throw new Error("Unable to disable partner user");
    const result = await sql.query<{ company_id: string | null }>(
      `UPDATE partner_users SET disabled_at = now(), updated_at = now()
       WHERE id = $1 AND principal_type = 'PARTNER' AND disabled_at IS NULL
       RETURNING company_id`,
      [input.subjectUserId],
    );
    if (!result.rows[0]) throw new Error("Unable to disable partner user");
    await sql.query("DELETE FROM partner_sessions WHERE user_id = $1", [input.subjectUserId]);
    await writePartnerAuditEvent(sql, {
      type: "USER_DISABLED",
      actorUserId: input.actor.userId,
      subjectUserId: input.subjectUserId,
      companyId: result.rows[0].company_id,
      metadata: { reason: input.reason },
    });
    await writePartnerAuditEvent(sql, {
      type: "SESSIONS_REVOKED",
      actorUserId: input.actor.userId,
      subjectUserId: input.subjectUserId,
      companyId: result.rows[0].company_id,
      metadata: { reason: "account_disabled" },
    });
}
