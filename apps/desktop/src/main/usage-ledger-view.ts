import type { RuntimeAgentRole } from "../shared/ipc";
import type { UsageAttributionStatus, UsageLedgerEvent } from "./usage-ledger";
import {
  readBillingRole,
  readRouteRole,
  USAGE_LEDGER_ALIAS_MODEL_ID_METADATA_KEY,
  USAGE_LEDGER_PROVIDER_ID_METADATA_KEY,
} from "./proxy-usage-pending-settlement";

export interface ThreadUsageLedgerEventView {
  id: string;
  source: UsageLedgerEvent["source"];
  role: RuntimeAgentRole;
  routeRole: RuntimeAgentRole;
  billingRole: RuntimeAgentRole;
  modelId?: string;
  aliasModelId?: string;
  providerId?: string;
  agentId?: string;
  requestKey?: string;
  providerRequestId?: string;
  attributionStatus: UsageAttributionStatus;
  attributionReason?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  observedAt: string;
}

export function buildThreadUsageLedgerEventView(event: UsageLedgerEvent): ThreadUsageLedgerEventView {
  const aliasModelId = readMetadataString(event, USAGE_LEDGER_ALIAS_MODEL_ID_METADATA_KEY);
  const providerId = readMetadataString(event, USAGE_LEDGER_PROVIDER_ID_METADATA_KEY);
  return {
    id: event.id,
    source: event.source,
    role: event.role,
    routeRole: readRouteRole(event),
    billingRole: readBillingRole(event),
    ...(event.modelId && { modelId: event.modelId }),
    ...(aliasModelId && { aliasModelId }),
    ...(providerId && { providerId }),
    ...(event.agentId && { agentId: event.agentId }),
    ...(event.requestKey && { requestKey: event.requestKey }),
    ...(event.providerRequestId && { providerRequestId: event.providerRequestId }),
    attributionStatus: event.attribution.status,
    ...(event.attribution.reason && { attributionReason: event.attribution.reason }),
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    cacheReadTokens: event.cacheReadTokens,
    cacheCreationTokens: event.cacheCreationTokens,
    observedAt: event.observedAt,
  };
}

function readMetadataString(event: UsageLedgerEvent, key: string): string | undefined {
  const value = event.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
