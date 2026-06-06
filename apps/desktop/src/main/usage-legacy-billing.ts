import type { AgentRole, ThreadBillingSnapshot } from "../shared/ipc";
import { isSubagentBillingRole } from "./billing-orchestration";
import type {
  RecordRunUsageInput,
  RecordUsageInput,
} from "./thread-usage-accumulator";
import type {
  ResolvedSdkRunBillingModel,
  SingleUsageBillingArtifacts,
} from "./usage-billing-artifacts";

export interface UsageLegacyBillingAccumulator {
  recordUsage(input: RecordUsageInput): ThreadBillingSnapshot;
  recordRunUsage(input: RecordRunUsageInput): ThreadBillingSnapshot;
  hasSeenRequestKey(threadId: string, requestKey: string): boolean;
}

export interface RecordLegacySingleUsageBillingInput {
  threadId: string;
  artifacts: SingleUsageBillingArtifacts;
  agentId?: string;
  otelCostUsd?: number;
  reconciliationOnly?: boolean;
  fillSdkPrimaryForSubagent?: boolean;
}

export interface RecordLegacySingleUsageBillingResult {
  snapshot: ThreadBillingSnapshot;
  filledSdkPrimary: boolean;
}

export interface RecordLegacySdkRunBillingInput {
  threadId: string;
  role: AgentRole;
  requestKey: string;
  models: readonly ResolvedSdkRunBillingModel[];
  totalCostUsd?: number;
  plannerModelLabel?: string;
}

export function recordLegacySingleUsageBilling(
  accumulator: UsageLegacyBillingAccumulator,
  input: RecordLegacySingleUsageBillingInput,
): RecordLegacySingleUsageBillingResult {
  const { artifacts } = input;
  let snapshot = accumulator.recordUsage({
    threadId: input.threadId,
    role: artifacts.billingRole,
    source: artifacts.source,
    delta: artifacts.delta,
    ...(input.otelCostUsd !== undefined && { otelCostUsd: input.otelCostUsd }),
    actualRates: artifacts.actualRates,
    plannerRates: artifacts.plannerRates,
    ...(artifacts.resolvedModelId && { modelId: artifacts.resolvedModelId }),
    requestKey: artifacts.requestKey,
    ...(artifacts.plannerModelLabel && { plannerModelLabel: artifacts.plannerModelLabel }),
    ...(input.reconciliationOnly && { reconciliationOnly: true }),
  });

  if (!shouldFillSdkPrimaryForSubagent(input)) {
    return { snapshot, filledSdkPrimary: false };
  }

  const sdkProxyKey = buildSyntheticSdkPrimaryRequestKey(artifacts.requestKey);
  if (accumulator.hasSeenRequestKey(input.threadId, sdkProxyKey)) {
    return { snapshot, filledSdkPrimary: false };
  }

  snapshot = accumulator.recordUsage({
    threadId: input.threadId,
    role: artifacts.billingRole,
    source: "sdk",
    delta: artifacts.delta,
    actualRates: artifacts.actualRates,
    plannerRates: artifacts.plannerRates,
    ...(artifacts.resolvedModelId && { modelId: artifacts.resolvedModelId }),
    requestKey: sdkProxyKey,
    ...(artifacts.plannerModelLabel && { plannerModelLabel: artifacts.plannerModelLabel }),
  });

  return { snapshot, filledSdkPrimary: true };
}

export function recordLegacySdkRunBilling(
  accumulator: UsageLegacyBillingAccumulator,
  input: RecordLegacySdkRunBillingInput,
): ThreadBillingSnapshot {
  return accumulator.recordRunUsage({
    threadId: input.threadId,
    role: input.role,
    source: "sdk",
    requestKey: input.requestKey,
    models: [...input.models],
    ...(input.totalCostUsd !== undefined && { otelCostUsd: input.totalCostUsd }),
    ...(input.plannerModelLabel && { plannerModelLabel: input.plannerModelLabel }),
  });
}

export function buildSyntheticSdkPrimaryRequestKey(requestKey: string): string {
  return `sdk:proxy-subagent:${requestKey}`;
}

function shouldFillSdkPrimaryForSubagent(input: RecordLegacySingleUsageBillingInput): boolean {
  return Boolean(
    input.fillSdkPrimaryForSubagent &&
      input.agentId &&
      isSubagentBillingRole(input.artifacts.billingRole),
  );
}
