import "server-only";

import { requireInternalPrincipal } from "./auth";
import { ensurePartnerOpsRole, getPartnerOpsPool, getPartnerPool } from "./db";
import { PartnerOperationsRepository } from "./operations-repository";
import type { OpsRole } from "./operations";
import { verifyPartnerRequestHost } from "./security";

export type OpsViewer = { name: string; role: OpsRole };

export async function getOpsPageContext(requestHeaders: Headers) {
  if (!verifyPartnerRequestHost(requestHeaders)) return null;
  const principal = await requireInternalPrincipal(requestHeaders);
  if (!principal) return null;
  const viewer = await getPartnerPool().query<{ name: string; ops_role: OpsRole }>(
    "SELECT name,ops_role FROM partner_users WHERE id=$1 AND principal_type='INTERNAL' AND company_id IS NULL AND disabled_at IS NULL",
    [principal.userId],
  );
  const row = viewer.rows[0];
  if (!row?.ops_role) return null;
  await ensurePartnerOpsRole();
  return { principal, viewer: { name: row.name, role: row.ops_role } satisfies OpsViewer, repository: new PartnerOperationsRepository(getPartnerOpsPool()) };
}
