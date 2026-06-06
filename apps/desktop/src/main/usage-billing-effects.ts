import type {
  AgentRole,
  ThreadBillingSnapshot,
  ThreadUsageSnapshot,
} from "../shared/ipc";
import { computeWindowOccupancy, formatUsageBadge } from "@eco/runtime";
import { buildUsageSnapshotForRole, isSubagentBillingRole } from "./billing-orchestration";
import type { ContextWindowMonitor } from "./context-window-monitor";
import type { SubagentMetricsRegistry } from "./subagent-metrics-registry";
import { ThreadUsageAccumulator } from "./thread-usage-accumulator";
import type { UsageLedgerCoordinator } from "./usage-ledger-coordinator";
import {
  type SingleUsageBillingArtifacts,
} from "./usage-billing-artifacts";

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
  usageLedger: Pick<UsageLedgerCoordinator, "appendEvents" | "enrichBillingSnapshot" | "reconcileShadow">;
  accumulator: Pick<ThreadUsageAccumulator, "recordUsage" | "hasSeenRequestKey">;
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
  let billing = services.usageLedger.enrichBillingSnapshot(
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

  if (input.fillSdkPrimaryForSubagent && isSubagentBillingRole(artifacts.billingRole) && input.agentId) {
    const sdkProxyKey = `sdk:proxy-subagent:${artifacts.requestKey}`;
    if (!services.accumulator.hasSeenRequestKey(input.threadId, sdkProxyKey)) {
      billing = services.usageLedger.enrichBillingSnapshot(
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
    }
  }
  services.usageLedger.reconcileShadow(input.threadId, billing);

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
