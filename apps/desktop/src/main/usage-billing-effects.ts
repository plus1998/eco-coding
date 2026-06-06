import type { AgentRole, ThreadBillingSnapshot, ThreadUsageSnapshot } from "../shared/ipc";
import { computeWindowOccupancy, formatUsageBadge, type ParsedUsage } from "@eco/runtime";
import { buildUsageSnapshotForRole, isSubagentBillingRole } from "./billing-orchestration";
import {
  applySubagentLegacyMetricsFallback,
  type SubagentLegacyMetricsRecordInput,
} from "./subagent-legacy-metrics-fallback-effects";
import type { SubagentMetricsRegistry } from "./subagent-metrics-registry";
import {
  resolveBillingSnapshotSelectionOptions,
  type BillingSnapshotSelectionPolicy,
} from "./billing-snapshot-selection-policy";
import type { UsageContextService } from "./usage-context-effects";
import {
  recordLegacySdkRunBilling,
  recordLegacySingleUsageBilling,
  type UsageLegacyBillingAccumulator,
} from "./usage-legacy-billing";
import type { UsageLedgerCoordinator } from "./usage-ledger-coordinator";
import {
  type ResolvedSdkRunBillingModel,
  type SdkStreamPartialBillingArtifacts,
  type SingleUsageBillingArtifacts,
  type UsageBillingContextUpdate,
} from "./usage-billing-artifacts";
import { buildSdkUsageLedgerEvents } from "./usage-ledger-adapters";

export interface UsageBillingUpdatedEvent {
  threadId: string;
  role: AgentRole;
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
  const subagentContext =
    input.agentId && isSubagentBillingRole(artifacts.billingRole)
      ? resolveSubagentMetricsContext({
          snapshot: monitorSnap,
          agentId: input.agentId,
          fallbackUsage: artifacts.delta,
        })
      : undefined;
  if (input.agentId && subagentContext) {
    services.subagentMetrics.recordContextObservation(input.threadId, {
      role: artifacts.billingRole,
      agentId: input.agentId,
      contextOccupied: subagentContext.contextOccupied,
      ...(subagentContext.contextLimit !== undefined && { contextLimit: subagentContext.contextLimit }),
      ...(artifacts.resolvedModelId && { modelId: artifacts.resolvedModelId }),
      requestKey: artifacts.requestKey,
    });
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

  const legacySubagentRecords: SubagentLegacyMetricsRecordInput[] =
    input.agentId && subagentContext
      ? [
          {
            role: artifacts.billingRole,
            agentId: input.agentId,
            usage: artifacts.delta,
            contextOccupied: subagentContext.contextOccupied,
            ...(subagentContext.contextLimit !== undefined && {
              contextLimit: subagentContext.contextLimit,
            }),
            billing: artifacts.requestBilling,
            ...(artifacts.resolvedModelId && { modelId: artifacts.resolvedModelId }),
            requestKey: artifacts.requestKey,
          },
        ]
      : [];
  const legacySubagentFallback = applySubagentLegacyMetricsFallback({
    threadId: input.threadId,
    hasSubagentContext: Boolean(input.agentId && subagentContext),
    billingSelection,
    legacyBilling: legacyBilling.snapshot,
    selectionOptions,
    records: legacySubagentRecords,
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
  role: AgentRole;
  requestKey: string;
  models: readonly ResolvedSdkRunBillingModel[];
  billingRole: AgentRole;
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
      metadata: { path: "processSdkRunBilling" },
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
  const subagentContext =
    input.resolvedSubagentId && isSubagentBillingRole(input.billingRole)
      ? resolveSubagentMetricsContext({
          snapshot: monitorSnap,
          agentId: input.resolvedSubagentId,
          fallbackUsage: input.contextUsage,
        })
      : undefined;
  if (input.resolvedSubagentId && subagentContext) {
    services.subagentMetrics.recordContextObservation(input.threadId, {
      role: input.billingRole,
      agentId: input.resolvedSubagentId,
      ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
      contextOccupied: subagentContext.contextOccupied,
      ...(subagentContext.contextLimit !== undefined && { contextLimit: subagentContext.contextLimit }),
      ...(primaryModel?.modelId && { modelId: primaryModel.modelId }),
      requestKey: input.requestKey,
    });
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

  const resolvedSubagentId = input.resolvedSubagentId;
  const legacySubagentRecords: SubagentLegacyMetricsRecordInput[] =
    resolvedSubagentId && subagentContext
      ? input.models.map((model) => ({
          role: model.role ?? input.billingRole,
          agentId: resolvedSubagentId,
          ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
          usage: model.usage,
          contextOccupied: subagentContext.contextOccupied,
          ...(subagentContext.contextLimit !== undefined && {
            contextLimit: subagentContext.contextLimit,
          }),
          billing: model.computedBilling,
          ...(model.modelId && { modelId: model.modelId }),
          requestKey: input.requestKey,
        }))
      : [];
  const legacySubagentFallback = applySubagentLegacyMetricsFallback({
    threadId: input.threadId,
    hasSubagentContext: Boolean(input.resolvedSubagentId && subagentContext),
    billingSelection,
    legacyBilling,
    selectionOptions,
    records: legacySubagentRecords,
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

function resolveSubagentMetricsContext(input: {
  snapshot: ReturnType<UsageContextService["getSnapshot"]>;
  agentId: string;
  fallbackUsage: ParsedUsage;
}): { contextOccupied: number; contextLimit?: number } {
  const instance = input.snapshot?.instances?.find((row) => row.agentId === input.agentId);
  return {
    contextOccupied: instance?.occupied ?? computeWindowOccupancy(input.fallbackUsage),
    ...(instance?.limit !== undefined && { contextLimit: instance.limit }),
  };
}
