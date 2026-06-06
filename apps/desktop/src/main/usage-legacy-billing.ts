import type { AgentRole, ThreadBillingSnapshot } from "../shared/ipc";
import { isSubagentBillingRole } from "./billing-orchestration";
import type { RecordRunUsageInput, RecordUsageInput } from "./thread-usage-accumulator";
import type { ResolvedSdkRunBillingModel, SingleUsageBillingArtifacts } from "./usage-billing-artifacts";

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
  syntheticSdkPrimaryDecision: SyntheticSdkPrimaryFillDecision;
}

export interface RecordLegacySdkRunBillingInput {
  threadId: string;
  role: AgentRole;
  requestKey: string;
  models: readonly ResolvedSdkRunBillingModel[];
  totalCostUsd?: number;
  plannerModelLabel?: string;
}

export type SyntheticSdkPrimaryFillDecision =
  | { fill: true; reason: "subagent_compatibility" }
  | {
      fill: false;
      reason: "not_requested" | "missing_agent" | "non_subagent_role" | "already_seen";
    };

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

  const sdkProxyKey = buildSyntheticSdkPrimaryRequestKey(artifacts.requestKey);
  const syntheticSdkPrimaryDecision = resolveSyntheticSdkPrimaryFill({
    requested: input.fillSdkPrimaryForSubagent === true,
    role: artifacts.billingRole,
    hasAgent: Boolean(input.agentId),
    alreadySeen: accumulator.hasSeenRequestKey(input.threadId, sdkProxyKey),
  });
  if (!syntheticSdkPrimaryDecision.fill) {
    return { snapshot, filledSdkPrimary: false, syntheticSdkPrimaryDecision };
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

  return { snapshot, filledSdkPrimary: true, syntheticSdkPrimaryDecision };
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

export function resolveSyntheticSdkPrimaryFill(input: {
  requested: boolean;
  role: AgentRole;
  hasAgent: boolean;
  alreadySeen: boolean;
}): SyntheticSdkPrimaryFillDecision {
  if (!input.requested) {
    return { fill: false, reason: "not_requested" };
  }
  if (!isSubagentBillingRole(input.role)) {
    return { fill: false, reason: "non_subagent_role" };
  }
  if (!input.hasAgent) {
    return { fill: false, reason: "missing_agent" };
  }
  if (input.alreadySeen) {
    return { fill: false, reason: "already_seen" };
  }
  return { fill: true, reason: "subagent_compatibility" };
}
