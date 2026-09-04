import "server-only";

export interface LegacyContractCapabilities {
  exactCreateMarker: boolean;
  exhaustiveMarkerPagination: boolean;
  remoteVersionCas: boolean;
  quoteReadback: boolean;
  uploadIdempotency: boolean;
  uploadContentHashReadback: boolean;
  uploadBytesReadback: boolean;
  attachmentReadback: boolean;
  markerField: "integrationReference";
  providerDto: "FICTIONAL_IN_MEMORY" | "UNAPPROVED_SCAFFOLD" | "INSUL_HUB_ACCEPTED_V1";
  graphqlAuthPolicy: "FICTIONAL_IN_MEMORY" | "UNAPPROVED_BEARER_SCAFFOLD" | "X_ACCESS_TOKEN_V1";
  uploadHeaderPolicy: "FICTIONAL_IN_MEMORY" | "UNAPPROVED_RAW_PDF_SCAFFOLD" | "X_TOKEN_MULTIPART_V1";
  markerPageLimit: number;
  operationTimeoutMs: number;
}

export interface LegacyContract {
  version: string;
  approvedForLive: boolean;
  capabilities: LegacyContractCapabilities;
}

export const FICTIONAL_LEGACY_CONTRACT: LegacyContract = Object.freeze<LegacyContract>({
  version: "fictional-v1",
  approvedForLive: false,
  capabilities: {
    exactCreateMarker: true, exhaustiveMarkerPagination: true, remoteVersionCas: true, quoteReadback: true,
    uploadIdempotency: true, uploadContentHashReadback: true, uploadBytesReadback: true, attachmentReadback: true,
    markerField: "integrationReference", providerDto: "FICTIONAL_IN_MEMORY", graphqlAuthPolicy: "FICTIONAL_IN_MEMORY",
    uploadHeaderPolicy: "FICTIONAL_IN_MEMORY", markerPageLimit: 4, operationTimeoutMs: 60_000,
  },
});

// No live provider contract has completed sandbox acceptance. Adding a version
// here requires all capabilities and an independent contract review.
const LIVE_CONTRACTS = new Map<string, LegacyContract>();

export function approvedLiveContract(version: string): LegacyContract | null {
  const contract = LIVE_CONTRACTS.get(version);
  if (!contract?.approvedForLive) return null;
  return Object.values(contract.capabilities).every(Boolean) ? contract : null;
}

export function contractSupportsSafeSubmission(contract: LegacyContract): boolean {
  const value = contract.capabilities;
  return contract.approvedForLive && value.exactCreateMarker && value.exhaustiveMarkerPagination && value.remoteVersionCas
    && value.quoteReadback && value.uploadIdempotency && value.attachmentReadback
    && (value.uploadContentHashReadback || value.uploadBytesReadback)
    && value.providerDto === "INSUL_HUB_ACCEPTED_V1" && value.graphqlAuthPolicy === "X_ACCESS_TOKEN_V1" && value.uploadHeaderPolicy === "X_TOKEN_MULTIPART_V1"
    && Number.isInteger(value.markerPageLimit) && value.markerPageLimit >= 1 && value.markerPageLimit <= 20
    && Number.isInteger(value.operationTimeoutMs) && value.operationTimeoutMs >= 1_000 && value.operationTimeoutMs <= 90_000;
}

export function legacySubmissionMarker(companyId: string, requestId: string): string | null {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuid.test(companyId) && uuid.test(requestId) ? `PARTNER-SUBMISSION:${companyId.toLowerCase()}:${requestId.toLowerCase()}` : null;
}
