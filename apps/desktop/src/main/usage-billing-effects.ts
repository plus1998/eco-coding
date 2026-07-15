import { formatUsageBadge, type ParsedUsage } from "@eco/runtime";
import type { RuntimeAgentRole, ThreadBillingSnapshot, ThreadUsageSnapshot } from "../shared/ipc";
import { buildUsageSnapshotForRole } from "./billing-orchestration";
import {
  type BillingSnapshotSelectionPolicy,
  resolveBillingSnapshotSelectionOptions,
} from "./billing-snapshot-selection-policy";
import { readBillingRole, readRouteRole } from "./proxy-usage-pending-settlement";
import {
  buildSubagentContextObservationInput,
  resolveSubagentBillingMetricsContext,
} from "./subagent-billing-metrics-effects";
import type { SubagentMetricsRegistry } from "./subagent-metrics-registry";
import type {
  ResolvedSdkRunBillingModel,
  SdkStreamPartialBillingArtifacts,
  SingleUsageBillingArtifacts,
  UsageBillingContextUpdate,
} from "./usage-billing-artifacts";
import type { UsageContextService } from "./usage-context-effects";
import { buildSdkUsageLedgerEvents } from "./usage-ledger-adapters";
import type { UsageLedgerCoordinator } from "./usage-ledger-coordinator";
import {
  recordLegacySdkRunBilling,
  recordLegacySingleUsageBilling,
  type UsageLegacyBillingAccumulator,
} from "./usage-legacy-billing";

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
  usageLedger: Pick<
    UsageLedgerCoordinator,
    "appendEvents" | "resolveBillingSnapshot" | "reconcileShadow" | "registerProxyPendingAttribution"
  > & Partial<Pick<UsageLedgerCoordinator, "persistSubagentBillingEntries">>;
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
  sourceReportedCostUsd?: number;
  reconciliationOnly?: boolean;
  fillSdkPrimaryForSubagent?: boolean;
}

export interface ApplySdkStreamPartialBillingEffectsInput {
  threadId: string;
  usage: ParsedUsage;
  artifacts: SdkStreamPartialBillingArtifacts;
  subagentAgentId?: string;
  updateContext?: boolean;
}

export async function applySdkStreamPartialBillingEffects(
  services: UsageBillingEffectsServices,
  input: ApplySdkStreamPartialBillingEffectsInput,
): Promise<void> {
  services.usageLedger.appendEvents([input.artifacts.ledgerEvent]);

  const contextUpdated = await services.context.applyUpdate({
    threadId: input.threadId,
    usage: input.usage,
    ...(input.updateContext !== undefined ? { updateContext: input.updateContext } : {}),
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
  if (artifacts.ledgerEvent.attribution.status === "pending") {
    services.usageLedger.registerProxyPendingAttribution(input.threadId, {
      eventId: artifacts.ledgerEvent.id,
      requestKey: artifacts.requestKey,
      routeRole: readRouteRole(artifacts.ledgerEvent),
      billingRole: readBillingRole(artifacts.ledgerEvent),
      observedAt: artifacts.ledgerEvent.observedAt,
      ...(artifacts.ledgerEvent.parentToolUseId && {
        parentToolUseId: artifacts.ledgerEvent.parentToolUseId,
      }),
      ...(artifacts.ledgerEvent.sdkMessageId && {
        messageId: artifacts.ledgerEvent.sdkMessageId,
      }),
    });
  }

  const pendingExactAttribution =
    artifacts.ledgerEvent.attribution.status === "pending" && !input.agentId;
  await services.context.applyUpdate({
    threadId: input.threadId,
    usage: artifacts.delta,
    updateContext: pendingExactAttribution ? false : input.updateContext,
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
  services.usageLedger.persistSubagentBillingEntries?.(input.threadId);

  const legacyBilling = recordLegacySingleUsageBilling(services.accumulator, {
    threadId: input.threadId,
    artifacts,
    ...(input.agentId && { agentId: input.agentId }),
    ...(input.sourceReportedCostUsd !== undefined && { sourceReportedCostUsd: input.sourceReportedCostUsd }),
    ...(input.reconciliationOnly && { reconciliationOnly: true }),
    ...(input.fillSdkPrimaryForSubagent && { fillSdkPrimaryForSubagent: true }),
  });
  const selectionOptions = resolveBillingSnapshotSelectionOptions({
    ...(services.billingSnapshotSelection && { policy: services.billingSnapshotSelection }),
    ...(artifacts.plannerModelLabel && { plannerModelLabel: artifacts.plannerModelLabel }),
  });
  const billingSelection = services.usageLedger.resolveBillingSnapshot(
    input.threadId,
    legacyBilling.snapshot,
    selectionOptions,
  );
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
      totalCostUsd: billing.sourceReportedCostUsd,
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
  services.usageLedger.persistSubagentBillingEntries?.(input.threadId);

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
  const billingSelection = services.usageLedger.resolveBillingSnapshot(
    input.threadId,
    legacyBilling,
    selectionOptions,
  );
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
      totalCostUsd: billing.sourceReportedCostUsd,
      billing,
      ...(primaryModel?.modelId && { modelId: primaryModel.modelId }),
    },
  });

  services.schedulePersistThreadMetrics(input.threadId);
  services.context.emitLive(input.threadId);
  return billing;
}
