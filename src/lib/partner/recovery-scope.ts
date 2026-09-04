import "server-only";
import { createHash } from "node:crypto";
import type { PartnerPrincipal } from "./repository";

export function partnerRecoveryScope(principal: PartnerPrincipal): string {
  return createHash("sha256")
    .update(`partner-draft-recovery-v2\0${principal.companyId}\0${principal.userId}`)
    .digest("base64url")
    .slice(0, 24);
}
