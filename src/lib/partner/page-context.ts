import "server-only";
import { requirePartnerPrincipal } from "./auth";
import { getPartnerPool } from "./db";
import { partnerRecoveryScope } from "./recovery-scope";
import { PartnerRepository } from "./repository";
import { verifyPartnerRequestHost } from "./security";

export async function getPartnerPageContext(requestHeaders: Headers) {
  if (!verifyPartnerRequestHost(requestHeaders)) return null;
  const principal = await requirePartnerPrincipal(requestHeaders);
  if (!principal) return null;
  const repository = new PartnerRepository(getPartnerPool());
  const viewer = await repository.getViewer(principal);
  return viewer ? { principal, repository, viewer, recoveryScope: partnerRecoveryScope(principal) } : null;
}
