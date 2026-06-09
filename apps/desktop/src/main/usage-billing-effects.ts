import type { RuntimeAgentRole, ThreadBillingSnapshot, ThreadUsageSnapshot } from "../shared/ipc";
import { formatUsageBadge, type ParsedUsage } from "@eco/runtime";
import { buildUsageSnapshotForRole } from "./billing-orchestration";
import {
  buildSubagentContextObservationInput,
  resolveSubagentBillingMetricsContext,
} from "./subagent-billing-metrics-effects";
import type { SubagentMetricsRegistry } from "./subagent-metrics-registry";
import {
  resolveBillingSnapshotSelectionOptions,
  type BillingSnapshotSelectionPolicy,
} from "./billing-snapshot-selection-policy";
import {
  applySdkRunSubagentLegacyFallback,
  applySingleUsageSubagentLegacyFallback,
} from "./usage-subagent-legacy-fallback";
import type { UsageContextService } from "./usage-context-effects";
import {
  recordLegacySdkRunBilling,
  recordLegacySingleUsageBilling,
  type UsageLegacyBillingAccumulator,
} from "./usage-legacy-billing";
import type { UsageLedgerCoordinator } from "./usage-ledger-coordinator";
import type {
  ResolvedSdkRunBillingModel,
  SdkStreamPartialBillingArtifacts,
  SingleUsageBillingArtifacts,
  UsageBillingContextUpdate,
} from "./usage-billing-artifacts";
import { buildSdkUsageLedgerEvents } from "./usage-ledger-adapters";

export interface UsageBillingUpdatedEvent {
  threadId: string;
  role: RuntimeAgentRole;
  badge: string;
  payload: {
    usage: ThreadUsageSnapshot;
    totalCostUsd: number;
    billing: ThreadBillingSnapshot;
    modelId?: string;
  };
}

export interface UsageBillingEffectsServices {
  context: UsageContextService;
  usageLedger: Pick<UsageLedgerCoordinator, "appendEvents" | "resolveBillingSnapshot" | "reconcileShadow">;
  accumulator: UsageLegacyBillingAccumulator;
  subagentMetrics: Pick<SubagentMetricsRegistry, "recordContextObservation" | "recordSdkUsage">;
  billingSnapshotSelection?: BillingSnapshotSelectionPolicy;
  emitUsageUpdated(event: UsageBillingUpdatedEvent): void;
  schedulePersistThreadMetrics(threadId: string): void;
}

export interface ApplySingleUsageBillingEffectsInput {
  threadId: string;
  artifacts: SingleUsageBillingArtifacts;
  updateContext: boolean;
  agentId?: string;
  messageId?: string;
  otelCostUsd?: number;
  reconciliationOnly?: boolean;
  fillSdkPrimaryForSubagent?: boolean;
}

export interface ApplySdkStreamPartialBillingEffectsInput {
  threadId: string;
  usage: ParsedUsage;
  artifacts: SdkStreamPartialBillingArtifacts;
  subagentAgentId?: string;
}

export async function applySdkStreamPartialBillingEffects(
  services: UsageBillingEffectsServices,
  input: ApplySdkStreamPartialBillingEffectsInput,
): Promise<void> {
  services.usageLedger.appendEvents([input.artifacts.ledgerEvent]);

  const contextUpdated = await services.context.applyUpdate({
    threadId: input.threadId,
    usage: input.usage,
    ...(input.artifacts.contextUpdate && { contextUpdate: input.artifacts.contextUpdate }),
    ...(input.subagentAgentId && { agentId: input.subagentAgentId }),
  });
  if (!contextUpdated) {
    return;
  }

  services.context.emitLive(input.threadId);
}

export async function applySingleUsageBillingEffects(
  services: UsageBillingEffectsServices,
  input: ApplySingleUsageBillingEffectsInput,
): Promise<ThreadBillingSnapshot> {
  const { artifacts } = input;
  services.usageLedger.appendEvents([artifacts.ledgerEvent]);

  await services.context.applyUpdate({
    threadId: input.threadId,
    usage: artifacts.delta,
    updateContext: input.updateContext,
    ...(artifacts.contextUpdate && { contextUpdate: artifacts.contextUpdate }),
    ...(input.agentId && { agentId: input.agentId }),
    ...(input.messageId && { messageId: input.messageId }),
  });

  const monitorSnap = services.context.getSnapshot(input.threadId);
  const subagentContext = resolveSubagentBillingMetricsContext({
    role: artifacts.billingRole,
    ...(input.agentId && { agentId: input.agentId }),
    snapshot: monitorSnap,
    fallbackUsage: artifacts.delta,
  });
  if (subagentContext) {
    services.subagentMetrics.recordContextObservation(
      input.threadId,
      buildSubagentContextObservationInput(subagentContext, {
        ...(artifacts.resolvedModelId && { modelId: artifacts.resolvedModelId }),
        requestKey: artifacts.requestKey,
      }),
    );
  }

  const legacyBilling = recordLegacySingleUsageBilling(services.accumulator, {
    threadId: input.threadId,
    artifacts,
    ...(input.agentId && { agentId: input.agentId }),
    ...(input.otelCostUsd !== undefined && { otelCostUsd: input.otelCostUsd }),
    ...(input.reconciliationOnly && { reconciliationOnly: true }),
    ...(input.fillSdkPrimaryForSubagent && { fillSdkPrimaryForSubagent: true }),
  });
  const selectionOptions = resolveBillingSnapshotSelectionOptions({
    ...(services.billingSnapshotSelection && { policy: services.billingSnapshotSelection }),
    ...(artifacts.plannerModelLabel && { plannerModelLabel: artifacts.plannerModelLabel }),
  });
  let billingSelection = services.usageLedger.resolveBillingSnapshot(
    input.threadId,
    legacyBilling.snapshot,
    selectionOptions,
  );

  const legacySubagentFallback = applySingleUsageSubagentLegacyFallback({
    threadId: input.threadId,
    context: subagentContext,
    billingSelection,
    legacyBilling: legacyBilling.snapshot,
    selectionOptions,
    usage: artifacts.delta,
    billing: artifacts.requestBilling,
    ...(artifacts.resolvedModelId && { modelId: artifacts.resolvedModelId }),
    requestKey: artifacts.requestKey,
    services: {
      recordSdkUsage: (threadId, record) => services.subagentMetrics.recordSdkUsage(threadId, record),
      resolveBillingSnapshot: (threadId, legacySnapshot, options) =>
        services.usageLedger.resolveBillingSnapshot(threadId, legacySnapshot, options),
    },
  });
  billingSelection = legacySubagentFallback.billingSelection;
  const billing = billingSelection.snapshot;
  services.usageLedger.reconcileShadow(input.threadId, billingSelection.legacySnapshot);

  const snapshot = buildUsageSnapshotForRole({
    usage: artifacts.parsedUsage,
    role: artifacts.billingRole,
    ...(monitorSnap && { monitorSnap }),
    ...(artifacts.parsedUsage.modelId && { modelId: artifacts.parsedUsage.modelId }),
    fallbackContext: input.updateContext ? "estimate" : "none",
  });

  services.emitUsageUpdated({
    threadId: input.threadId,
    role: artifacts.billingRole,
    badge: formatUsageBadge(artifacts.parsedUsage),
    payload: {
      usage: snapshot,
      totalCostUsd: billing.otelCostUsd,
      billing,
      ...(artifacts.parsedUsage.modelId && { modelId: artifacts.parsedUsage.modelId }),
    },
  });

  services.schedulePersistThreadMetrics(input.threadId);
  services.context.emitLive(input.threadId);
  return billing;
}

export interface ApplySdkRunBillingEffectsInput {
  threadId: string;
  role: RuntimeAgentRole;
  requestKey: string;
  models: readonly ResolvedSdkRunBillingModel[];
  billingRole: RuntimeAgentRole;
  contextUsage: ParsedUsage;
  updateContext: boolean;
  totalCostUsd?: number;
  plannerModelLabel?: string;
  runAttemptId?: string;
  parentToolUseId?: string;
  ledgerAgentId?: string;
  resolvedSubagentId?: string;
  contextUpdate?: UsageBillingContextUpdate;
}

export async function applySdkRunBillingEffects(
  services: UsageBillingEffectsServices,
  input: ApplySdkRunBillingEffectsInput,
): Promise<ThreadBillingSnapshot> {
  services.usageLedger.appendEvents(
    buildSdkUsageLedgerEvents({
      threadId: input.threadId,
      role: input.role,
      requestKey: input.requestKey,
      models: input.models,
      ...(input.totalCostUsd !== undefined && { totalCostUsd: input.totalCostUsd }),
      ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
      ...(input.ledgerAgentId && { agentId: input.ledgerAgentId }),
      ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
      metadata: {
        path: "processSdkRunBilling",
      },
    }),
  );

  await services.context.applyUpdate({
    threadId: input.threadId,
    usage: input.contextUsage,
    updateContext: input.updateContext,
    ...(input.contextUpdate && { contextUpdate: input.contextUpdate }),
    ...(input.resolvedSubagentId && { agentId: input.resolvedSubagentId }),
  });

  const monitorSnap = services.context.getSnapshot(input.threadId);
  const primaryModel = input.models[0];
  const subagentContext = resolveSubagentBillingMetricsContext({
    role: input.billingRole,
    ...(input.resolvedSubagentId && { agentId: input.resolvedSubagentId }),
    snapshot: monitorSnap,
    fallbackUsage: input.contextUsage,
  });
  if (subagentContext) {
    services.subagentMetrics.recordContextObservation(
      input.threadId,
      buildSubagentContextObservationInput(subagentContext, {
        ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
        ...(primaryModel?.modelId && { modelId: primaryModel.modelId }),
        requestKey: input.requestKey,
      }),
    );
  }

  const legacyBilling = recordLegacySdkRunBilling(services.accumulator, {
    threadId: input.threadId,
    role: input.role,
    requestKey: input.requestKey,
    models: input.models,
    ...(input.totalCostUsd !== undefined && { totalCostUsd: input.totalCostUsd }),
    ...(input.plannerModelLabel && { plannerModelLabel: input.plannerModelLabel }),
  });
  const selectionOptions = resolveBillingSnapshotSelectionOptions({
    ...(services.billingSnapshotSelection && { policy: services.billingSnapshotSelection }),
    ...(input.plannerModelLabel && { plannerModelLabel: input.plannerModelLabel }),
  });
  let billingSelection = services.usageLedger.resolveBillingSnapshot(
    input.threadId,
    legacyBilling,
    selectionOptions,
  );

  const legacySubagentFallback = applySdkRunSubagentLegacyFallback({
    threadId: input.threadId,
    context: subagentContext,
    billingSelection,
    legacyBilling,
    selectionOptions,
    models: input.models,
    billingRole: input.billingRole,
    ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
    requestKey: input.requestKey,
    services: {
      recordSdkUsage: (threadId, record) => services.subagentMetrics.recordSdkUsage(threadId, record),
      resolveBillingSnapshot: (threadId, legacySnapshot, options) =>
        services.usageLedger.resolveBillingSnapshot(threadId, legacySnapshot, options),
    },
  });
  billingSelection = legacySubagentFallback.billingSelection;
  const billing = billingSelection.snapshot;
  services.usageLedger.reconcileShadow(input.threadId, billingSelection.legacySnapshot);

  const snapshot = buildUsageSnapshotForRole({
    usage: input.contextUsage,
    role: input.billingRole,
    ...(monitorSnap && { monitorSnap }),
    fallbackContext: "none",
    ...(primaryModel?.modelId && { modelId: primaryModel.modelId }),
  });

  services.emitUsageUpdated({
    threadId: input.threadId,
    role: input.billingRole,
    badge: formatUsageBadge(input.contextUsage),
    payload: {
      usage: snapshot,
      totalCostUsd: billing.otelCostUsd,
      billing,
      ...(primaryModel?.modelId && { modelId: primaryModel.modelId }),
    },
  });

  services.schedulePersistThreadMetrics(input.threadId);
  services.context.emitLive(input.threadId);
  return billing;
}
