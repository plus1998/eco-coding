import type { RuntimeAgentRole } from "../shared/ipc";
import {
  readBillingRole,
  readRouteRole,
  USAGE_LEDGER_ALIAS_MODEL_ID_METADATA_KEY,
  USAGE_LEDGER_PROVIDER_ID_METADATA_KEY,
} from "./proxy-usage-pending-settlement";
import type { UsageAttributionStatus, UsageLedgerEvent, UsageLedgerKind } from "./usage-ledger";
import {
  readUsageLedgerComputedBilling,
  readUsageLedgerGenerationMs,
  readUsageLedgerLogicalRequestId,
  readUsageLedgerTtftMs,
} from "./usage-ledger-cost-metadata";

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
  usageKind: UsageLedgerKind;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens?: number;
  /** Gateway-measured time to first content token (ms), when known. */
  ttftMs?: number;
  /** Gateway-measured first-chunk → stream-end window (ms, new-api generationMs). */
  generationMs?: number;
  /** Feed logical request id — joins multi-invocation rows onto one span. */
  logicalRequestId?: string;
  /** Client-side request span start (fallback timing for rows without gateway timing). */
  spanStartedAt?: string;
  /** Client-side first narrative delta time (fallback timing). */
  spanFirstTokenAt?: string;
  /** Client-side request span end (fallback timing). */
  spanEndedAt?: string;
  ecoCostUsd?: number;
  reportedCostUsd?: number;
  pricingResolved?: boolean;
  observedAt: string;
}

export function buildThreadUsageLedgerEventView(event: UsageLedgerEvent): ThreadUsageLedgerEventView {
  const aliasModelId = readMetadataString(event, USAGE_LEDGER_ALIAS_MODEL_ID_METADATA_KEY);
  const providerId = readMetadataString(event, USAGE_LEDGER_PROVIDER_ID_METADATA_KEY);
  const computedBilling = readUsageLedgerComputedBilling(event.metadata);
  const ttftMs = readUsageLedgerTtftMs(event.metadata);
  const generationMs = readUsageLedgerGenerationMs(event.metadata);
  const logicalRequestId = readUsageLedgerLogicalRequestId(event.metadata);
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
    usageKind: event.usageKind,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    cacheReadTokens: event.cacheReadTokens,
    cacheCreationTokens: event.cacheCreationTokens,
    ...(event.reasoningTokens !== undefined &&
      event.reasoningTokens > 0 && { reasoningTokens: event.reasoningTokens }),
    ...(ttftMs !== undefined && { ttftMs }),
    ...(generationMs !== undefined && { generationMs }),
    ...(logicalRequestId && { logicalRequestId }),
    ...(computedBilling && {
      ecoCostUsd: computedBilling.ecoCostUsd,
      pricingResolved: computedBilling.pricingResolved,
    }),
    ...(event.reportedCostUsd !== undefined && { reportedCostUsd: event.reportedCostUsd }),
    observedAt: event.observedAt,
  };
}

function readMetadataString(event: UsageLedgerEvent, key: string): string | undefined {
  const value = event.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
