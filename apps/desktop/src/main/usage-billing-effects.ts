import type {
  AgentRole,
  ThreadBillingSnapshot,
  ThreadUsageSnapshot,
} from "../shared/ipc";
import { computeWindowOccupancy, formatUsageBadge, type ParsedUsage } from "@eco/runtime";
import { buildUsageSnapshotForRole, isSubagentBillingRole } from "./billing-orchestration";
import type { ContextWindowMonitor } from "./context-window-monitor";
import type { SubagentMetricsRegistry } from "./subagent-metrics-registry";
import { ThreadUsageAccumulator } from "./thread-usage-accumulator";
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
  contextMonitor: Pick<ContextWindowMonitor, "getSnapshot" | "updateFromUsage">;
  usageLedger: Pick<UsageLedgerCoordinator, "appendEvents" | "resolveBillingSnapshot" | "reconcileShadow">;
  accumulator: Pick<ThreadUsageAccumulator, "recordUsage" | "recordRunUsage" | "hasSeenRequestKey">;
  subagentMetrics: Pick<SubagentMetricsRegistry, "recordSdkUsage">;
  emitUsageUpdated(event: UsageBillingUpdatedEvent): void;
  schedulePersistThreadMetrics(threadId: string): void;
  emitLiveContext(threadId: string): void;
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

  if (!input.artifacts.contextUpdate) {
    return;
  }

  await services.contextMonitor.updateFromUsage(input.threadId, input.usage, {
    role: input.artifacts.contextUpdate.role,
    ...(input.subagentAgentId && { agentId: input.subagentAgentId }),
    modelId: input.artifacts.contextUpdate.modelId,
    providerBaseUrl: input.artifacts.contextUpdate.providerBaseUrl,
    ...(input.artifacts.contextUpdate.modelsDevMapping && {
      modelsDevMapping: input.artifacts.contextUpdate.modelsDevMapping,
    }),
    ...(input.artifacts.contextUpdate.manualSpec && {
      manualSpec: input.artifacts.contextUpdate.manualSpec,
    }),
  });
  services.emitLiveContext(input.threadId);
}

export async function applySingleUsageBillingEffects(
  services: UsageBillingEffectsServices,
  input: ApplySingleUsageBillingEffectsInput,
): Promise<ThreadBillingSnapshot> {
  const { artifacts } = input;
  services.usageLedger.appendEvents([artifacts.ledgerEvent]);

  if (input.updateContext && artifacts.contextUpdate) {
    await services.contextMonitor.updateFromUsage(input.threadId, artifacts.delta, {
      role: artifacts.contextUpdate.role,
      ...(input.agentId && { agentId: input.agentId }),
      modelId: artifacts.contextUpdate.modelId,
      providerBaseUrl: artifacts.contextUpdate.providerBaseUrl,
      ...(artifacts.contextUpdate.modelsDevMapping && {
        modelsDevMapping: artifacts.contextUpdate.modelsDevMapping,
      }),
      ...(artifacts.contextUpdate.manualSpec && { manualSpec: artifacts.contextUpdate.manualSpec }),
      ...(input.messageId && { messageId: input.messageId }),
    });
  }

  const monitorSnap = services.contextMonitor.getSnapshot(input.threadId);
  let billingSelection = services.usageLedger.resolveBillingSnapshot(
    input.threadId,
    services.accumulator.recordUsage({
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
    }),
  );
  let billing = billingSelection.snapshot;

  if (input.fillSdkPrimaryForSubagent && isSubagentBillingRole(artifacts.billingRole) && input.agentId) {
    const sdkProxyKey = `sdk:proxy-subagent:${artifacts.requestKey}`;
    if (!services.accumulator.hasSeenRequestKey(input.threadId, sdkProxyKey)) {
      billingSelection = services.usageLedger.resolveBillingSnapshot(
        input.threadId,
        services.accumulator.recordUsage({
          threadId: input.threadId,
          role: artifacts.billingRole,
          source: "sdk",
          delta: artifacts.delta,
          actualRates: artifacts.actualRates,
          plannerRates: artifacts.plannerRates,
          ...(artifacts.resolvedModelId && { modelId: artifacts.resolvedModelId }),
          requestKey: sdkProxyKey,
          ...(artifacts.plannerModelLabel && { plannerModelLabel: artifacts.plannerModelLabel }),
        }),
      );
      billing = billingSelection.snapshot;
    }
  }
  services.usageLedger.reconcileShadow(input.threadId, billingSelection.legacySnapshot);

  if (input.agentId && isSubagentBillingRole(artifacts.billingRole)) {
    const roleSnap = services.contextMonitor.getSnapshot(input.threadId);
    const instance = roleSnap?.instances?.find((row) => row.agentId === input.agentId);
    services.subagentMetrics.recordSdkUsage(input.threadId, {
      role: artifacts.billingRole,
      agentId: input.agentId,
      usage: artifacts.delta,
      contextOccupied: instance?.occupied ?? computeWindowOccupancy(artifacts.delta),
      ...(instance?.limit !== undefined && { contextLimit: instance.limit }),
      billing: artifacts.requestBilling,
      ...(artifacts.resolvedModelId && { modelId: artifacts.resolvedModelId }),
      requestKey: artifacts.requestKey,
    });
  }

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
  services.emitLiveContext(input.threadId);
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

  if (input.updateContext && input.contextUpdate) {
    await services.contextMonitor.updateFromUsage(input.threadId, input.contextUsage, {
      role: input.contextUpdate.role,
      ...(input.resolvedSubagentId && { agentId: input.resolvedSubagentId }),
      modelId: input.contextUpdate.modelId,
      providerBaseUrl: input.contextUpdate.providerBaseUrl,
      ...(input.contextUpdate.modelsDevMapping && {
        modelsDevMapping: input.contextUpdate.modelsDevMapping,
      }),
      ...(input.contextUpdate.manualSpec && { manualSpec: input.contextUpdate.manualSpec }),
    });
  }

  if (input.resolvedSubagentId && isSubagentBillingRole(input.billingRole)) {
    const roleSnap = services.contextMonitor.getSnapshot(input.threadId);
    const instance = roleSnap?.instances?.find((row) => row.agentId === input.resolvedSubagentId);
    for (const model of input.models) {
      services.subagentMetrics.recordSdkUsage(input.threadId, {
        role: model.role ?? input.billingRole,
        agentId: input.resolvedSubagentId,
        usage: model.usage,
        contextOccupied: instance?.occupied ?? computeWindowOccupancy(input.contextUsage),
        ...(instance?.limit !== undefined && { contextLimit: instance.limit }),
        billing: model.computedBilling,
        ...(model.modelId && { modelId: model.modelId }),
        requestKey: input.requestKey,
      });
    }
  }

  const billingSelection = services.usageLedger.resolveBillingSnapshot(
    input.threadId,
    services.accumulator.recordRunUsage({
      threadId: input.threadId,
      role: input.role,
      source: "sdk",
      requestKey: input.requestKey,
      models: [...input.models],
      ...(input.totalCostUsd !== undefined && { otelCostUsd: input.totalCostUsd }),
      ...(input.plannerModelLabel && { plannerModelLabel: input.plannerModelLabel }),
    }),
  );
  const billing = billingSelection.snapshot;
  services.usageLedger.reconcileShadow(input.threadId, billingSelection.legacySnapshot);

  const monitorSnap = services.contextMonitor.getSnapshot(input.threadId);
  const primaryModel = input.models[0];
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
  services.emitLiveContext(input.threadId);
  return billing;
}
