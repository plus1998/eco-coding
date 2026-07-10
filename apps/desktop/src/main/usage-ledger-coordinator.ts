import type { RuntimeAgentRole, ThreadBillingSnapshot } from "../shared/ipc";
import { projectBillingFromUsageLedger, summarizeUsageLedgerBillingProjection } from "./billing-projector";
import {
  reconcileBillingProjectionWithLegacy,
  summarizeBillingProjectionReconciliation,
  type BillingProjectionReconciliationResult,
} from "./billing-projector-reconciliation";
import { withBillingDiagnostics } from "./billing-diagnostics";
import { projectSubagentMetricsEntriesFromBillingProjection } from "./subagent-metrics-projection";
import type { SubagentMetricsEntry } from "./subagent-metrics-registry";
import type {
  AgentInstanceRecord,
  RunAttemptStatus,
  UsageLedgerEvent,
} from "./usage-ledger";
import {
  reconcileUsageLedgerWithBilling,
  summarizeUsageLedgerReconciliation,
} from "./usage-ledger-reconciliation";
import { buildInterruptedStreamPartialSettlementEvents } from "./usage-ledger-settlement";
import { shortThreadId } from "./eco-diag-log";
import {
  PROXY_PENDING_TIMEOUT_REASON,
  ProxyUsagePendingRegistry,
  type ProxyMessageIdentityBinding,
  type ProxyMessageIdentityDiagnostic,
  type ProxyUsagePendingEntry,
  type ProxyUsagePendingMutationResult,
  type ProxyUsagePendingSettlementUpdate,
} from "./proxy-usage-pending-settlement";
import { buildThreadUsageLedgerEventView } from "./usage-ledger-view";

interface PendingInterruptedStreamSettlement {
  runAttemptId: string;
  runStatus: Exclude<RunAttemptStatus, "running" | "completed">;
}

export interface UsageLedgerCoordinatorStore {
  appendUsageLedgerEvent(event: UsageLedgerEvent): boolean;
  listUsageLedgerEvents(threadId: string): UsageLedgerEvent[];
  listAgentInstances(threadId: string): AgentInstanceRecord[];
  updateUsageLedgerEventAttribution?(
    eventId: string,
    update: { agentId?: string; attribution: UsageLedgerEvent["attribution"] },
  ): boolean;
}

export interface UsageLedgerCoordinatorMetrics {
  listEntries(threadId: string): SubagentMetricsEntry[];
  resolveAgentId?(
    threadId: string,
    input: { role: RuntimeAgentRole; parentToolUseId?: string },
  ): string | undefined;
}

export interface ProxyAttributionSettlement {
  event: UsageLedgerEvent;
  agentId: string;
  role: RuntimeAgentRole;
  messageId?: string;
  parentToolUseId?: string;
}

export interface UsageLedgerCoordinatorOptions {
  store: UsageLedgerCoordinatorStore;
  metrics: UsageLedgerCoordinatorMetrics;
  logDiag?: (topic: string, fields: Record<string, unknown>) => void;
  logDiagThrottled?: (
    key: string,
    topic: string,
    fields: Record<string, unknown>,
    intervalMs?: number,
  ) => void;
  writeError?: (message: string) => void;
  onProxyAttributionSettled?: (
    threadId: string,
    settlements: readonly ProxyAttributionSettlement[],
  ) => void | Promise<void>;
}

export type UsageLedgerBillingSnapshotSource = "legacy" | "ledger";

export interface UsageLedgerBillingSnapshotSelection {
  snapshot: ThreadBillingSnapshot;
  source: UsageLedgerBillingSnapshotSource;
  legacySnapshot: ThreadBillingSnapshot;
  ledgerSnapshot?: ThreadBillingSnapshot;
  reconciliation?: BillingProjectionReconciliationResult;
}

export interface UsageLedgerBillingSnapshotSelectionOptions {
  useLedgerProjection?: boolean;
  plannerModelLabel?: string;
}

export class UsageLedgerCoordinator {
  private readonly store: UsageLedgerCoordinatorStore;
  private readonly metrics: UsageLedgerCoordinatorMetrics;
  private readonly logDiag: UsageLedgerCoordinatorOptions["logDiag"] | undefined;
  private readonly logDiagThrottled: UsageLedgerCoordinatorOptions["logDiagThrottled"] | undefined;
  private readonly writeError: (message: string) => void;
  private readonly onProxyAttributionSettled:
    | ((
        threadId: string,
        settlements: readonly ProxyAttributionSettlement[],
      ) => void | Promise<void>)
    | undefined;
  private readonly proxyPendingRegistry = new ProxyUsagePendingRegistry();
  private readonly pendingInterruptedStreamSettlements = new Map<
    string,
    PendingInterruptedStreamSettlement[]
  >();
  private readonly pendingUsageUpdates = new Map<string, Set<Promise<void>>>();

  constructor(options: UsageLedgerCoordinatorOptions) {
    this.store = options.store;
    this.metrics = options.metrics;
    this.logDiag = options.logDiag;
    this.logDiagThrottled = options.logDiagThrottled;
    this.writeError = options.writeError ?? ((message) => process.stderr.write(message));
    this.onProxyAttributionSettled = options.onProxyAttributionSettled;
  }

  trackUsageUpdate(threadId: string, promise: Promise<void>): void {
    let set = this.pendingUsageUpdates.get(threadId);
    if (!set) {
      set = new Set();
      this.pendingUsageUpdates.set(threadId, set);
    }

    const tracked = promise.finally(() => {
      const current = this.pendingUsageUpdates.get(threadId);
      current?.delete(tracked);
      if (current?.size === 0) {
        this.pendingUsageUpdates.delete(threadId);
      }
    });
    set.add(tracked);
    void tracked.catch(() => {});
  }

  async flushUsageUpdates(threadId: string): Promise<void> {
    while (true) {
      const pending = this.pendingUsageUpdates.get(threadId);
      if (!pending || pending.size === 0) {
        this.settleQueuedInterruptedStreamPartials(threadId);
        this.settleProxyPendingTimeouts(threadId);
        const afterSettlement = this.pendingUsageUpdates.get(threadId);
        if (!afterSettlement || afterSettlement.size === 0) {
          return;
        }
        continue;
      }
      await Promise.allSettled([...pending]);
    }
  }

  queueInterruptedStreamSettlement(
    threadId: string,
    runAttemptId: string,
    runStatus: Exclude<RunAttemptStatus, "running">,
  ): void {
    if (runStatus === "completed") {
      return;
    }
    const pending = this.pendingInterruptedStreamSettlements.get(threadId) ?? [];
    if (!pending.some((entry) => entry.runAttemptId === runAttemptId && entry.runStatus === runStatus)) {
      pending.push({ runAttemptId, runStatus });
    }
    this.pendingInterruptedStreamSettlements.set(threadId, pending);
  }

  settleInterruptedStreamPartials(
    threadId: string,
    runAttemptId: string,
    runStatus: Exclude<RunAttemptStatus, "running" | "completed">,
  ): void {
    const settlements = buildInterruptedStreamPartialSettlementEvents({
      events: this.store.listUsageLedgerEvents(threadId),
      runAttemptId,
      runStatus,
    });
    if (settlements.length === 0) {
      return;
    }
    this.appendEvents(settlements);
    this.logDiag?.("usage_ledger.partial_settlement", {
      threadId: shortThreadId(threadId),
      runAttemptId,
      runStatus,
      eventCount: settlements.length,
    });
  }

  appendEvents(events: readonly UsageLedgerEvent[]): void {
    for (const event of events) {
      try {
        this.store.appendUsageLedgerEvent(event);
      } catch (error) {
        this.writeError(`[eco] usage ledger shadow write failed: ${errorMessage(error)}\n`);
      }
    }
  }

  registerProxyPendingAttribution(
    threadId: string,
    entry: ProxyUsagePendingEntry,
  ): number {
    return this.applyProxyPendingMutation(
      threadId,
      this.proxyPendingRegistry.register(threadId, entry),
    );
  }

  bindProxyMessageIdentity(
    threadId: string,
    binding: ProxyMessageIdentityBinding,
  ): number {
    const mutation = this.proxyPendingRegistry.bindMessageIdentity(
      threadId,
      binding,
    );
    const settledCount = this.applyProxyPendingMutation(threadId, mutation);
    this.logDiag?.("usage_ledger.proxy_message_identity", {
      threadId: shortThreadId(threadId),
      messageId: binding.messageId.slice(-12),
      agentId: binding.agentId,
      role: binding.role,
      bindingStatus: mutation.bindingStatus ?? "invalid",
      settledCount,
    });
    return settledCount;
  }

  settleProxyPendingForSubagentStart(
    threadId: string,
    input: {
      agentId: string;
      role: RuntimeAgentRole;
      parentToolUseId?: string;
    },
  ): number {
    const parentToolUseId = input.parentToolUseId?.trim();
    if (!parentToolUseId) {
      return 0;
    }
    const updates: ProxyUsagePendingSettlementUpdate[] = [];
    while (true) {
      const update = this.proxyPendingRegistry.consumeForParentToolUse(
        threadId,
        parentToolUseId,
        input.agentId,
        input.role,
      );
      if (!update) {
        break;
      }
      updates.push(update);
    }
    const settlements = this.applyProxyAttributionUpdates(threadId, updates);
    if (settlements.length > 0) {
      this.notifyProxyAttributionSettled(threadId, settlements);
      this.logDiag?.("usage_ledger.proxy_pending_settled", {
        threadId: shortThreadId(threadId),
        role: input.role,
        agentId: input.agentId,
        parentToolUseId: parentToolUseId.slice(-12),
        settledCount: settlements.length,
      });
    }
    return settlements.length;
  }

  settleProxyPendingTimeouts(threadId: string): number {
    const pending = this.proxyPendingRegistry.drainPending(threadId);
    if (pending.length === 0) {
      return 0;
    }
    const settlements: ProxyAttributionSettlement[] = [];
    let timedOutCount = 0;
    for (const entry of pending) {
      const resolvedAgentId = entry.parentToolUseId
        ? this.metrics.resolveAgentId?.(threadId, {
            role: entry.billingRole,
            parentToolUseId: entry.parentToolUseId,
          })
        : undefined;
      if (resolvedAgentId) {
        const settlement = this.applyProxyAttributionUpdate(threadId, {
          eventId: entry.eventId,
          agentId: resolvedAgentId,
          role: entry.billingRole,
          attribution: { status: "attributed", agentId: resolvedAgentId },
          ...(entry.messageId && { messageId: entry.messageId }),
          ...(entry.parentToolUseId && {
            parentToolUseId: entry.parentToolUseId,
          }),
        });
        if (settlement) {
          settlements.push(settlement);
        }
        continue;
      }
      const updated = this.updateProxyAttribution(threadId, {
        eventId: entry.eventId,
        attribution: {
          status: "unattributed",
          reason: PROXY_PENDING_TIMEOUT_REASON,
        },
      });
      if (updated) {
        timedOutCount += 1;
      }
    }
    if (settlements.length > 0) {
      this.notifyProxyAttributionSettled(threadId, settlements);
      this.logDiag?.("usage_ledger.proxy_pending_settled_on_timeout", {
        threadId: shortThreadId(threadId),
        settledCount: settlements.length,
      });
    }
    if (timedOutCount > 0) {
      this.logDiag?.("usage_ledger.proxy_pending_timeout", {
        threadId: shortThreadId(threadId),
        timedOutCount,
      });
    }
    return settlements.length + timedOutCount;
  }

  rebuildProxyPendingFromEvents(threadId: string): void {
    const mutation = this.proxyPendingRegistry.rebuildFromEvents(
      this.store.listUsageLedgerEvents(threadId),
    );
    this.applyProxyPendingMutation(threadId, mutation);
  }

  clearProxyAttributionState(threadId: string): void {
    this.proxyPendingRegistry.clearThread(threadId);
  }

  private applyProxyPendingMutation(
    threadId: string,
    mutation: ProxyUsagePendingMutationResult,
  ): number {
    this.logProxyMessageIdentityDiagnostics(threadId, mutation.diagnostics);
    const settlements = this.applyProxyAttributionUpdates(
      threadId,
      mutation.updates,
    );
    if (settlements.length > 0) {
      this.notifyProxyAttributionSettled(threadId, settlements);
    }
    return settlements.length;
  }

  private applyProxyAttributionUpdates(
    threadId: string,
    updates: readonly ProxyUsagePendingSettlementUpdate[],
  ): ProxyAttributionSettlement[] {
    return updates.flatMap((update) => {
      const settlement = this.applyProxyAttributionUpdate(threadId, update);
      return settlement ? [settlement] : [];
    });
  }

  private applyProxyAttributionUpdate(
    threadId: string,
    update: ProxyUsagePendingSettlementUpdate,
  ): ProxyAttributionSettlement | undefined {
    const event = this.updateProxyAttribution(threadId, update);
    if (!event) {
      return undefined;
    }
    return {
      event,
      agentId: update.agentId,
      role: update.role,
      ...(update.messageId && { messageId: update.messageId }),
      ...(update.parentToolUseId && {
        parentToolUseId: update.parentToolUseId,
      }),
    };
  }

  private updateProxyAttribution(
    threadId: string,
    update: {
      eventId: string;
      agentId?: string;
      attribution: UsageLedgerEvent["attribution"];
    },
  ): UsageLedgerEvent | undefined {
    if (!this.store.updateUsageLedgerEventAttribution) {
      return undefined;
    }
    try {
      const updated = this.store.updateUsageLedgerEventAttribution(
        update.eventId,
        {
          ...(update.agentId && { agentId: update.agentId }),
          attribution: update.attribution,
        },
      );
      if (!updated) {
        return undefined;
      }
      return this.store
        .listUsageLedgerEvents(threadId)
        .find((candidate) => candidate.id === update.eventId);
    } catch (error) {
      this.writeError(
        `[eco] usage ledger attribution update failed: ${errorMessage(error)}\n`,
      );
      return undefined;
    }
  }

  private notifyProxyAttributionSettled(
    threadId: string,
    settlements: readonly ProxyAttributionSettlement[],
  ): void {
    if (!this.onProxyAttributionSettled || settlements.length === 0) {
      return;
    }
    try {
      const task = this.onProxyAttributionSettled(threadId, settlements);
      if (task && typeof (task as Promise<void>).then === "function") {
        this.trackUsageUpdate(
          threadId,
          Promise.resolve(task).catch((error) => {
            this.writeError(
              `[eco] proxy attribution settlement effects failed: ${errorMessage(error)}\n`,
            );
          }),
        );
      }
    } catch (error) {
      this.writeError(
        `[eco] proxy attribution settlement effects failed: ${errorMessage(error)}\n`,
      );
    }
  }

  private logProxyMessageIdentityDiagnostics(
    threadId: string,
    diagnostics: readonly ProxyMessageIdentityDiagnostic[],
  ): void {
    for (const diagnostic of diagnostics) {
      this.logDiag?.("usage_ledger.proxy_message_identity_conflict", {
        threadId: shortThreadId(threadId),
        ...diagnostic,
        messageId: diagnostic.messageId.slice(-12),
      });
    }
  }

  enrichBillingSnapshot(threadId: string, billing: ThreadBillingSnapshot): ThreadBillingSnapshot {
    const subagents = this.listSubagentBillingEntries(threadId).map((entry) => ({
      agentId: entry.agentId,
      role: entry.role,
      status: entry.status,
      inputTokens: entry.usage.inputTokens,
      outputTokens: entry.usage.outputTokens,
      cacheReadTokens: entry.usage.cacheReadTokens,
      cacheCreationTokens: entry.usage.cacheCreationTokens,
      contextOccupied: entry.contextOccupied,
      ...(entry.contextLimit !== undefined && { contextLimit: entry.contextLimit }),
      ecoCostUsd: entry.ecoCostUsd,
      ecoCostBreakdown: entry.ecoCostBreakdown,
      ...(entry.modelId && { modelId: entry.modelId }),
    }));
    return withBillingDiagnostics(subagents.length > 0 ? { ...billing, subagents } : billing, {
      ledgerEvents: this.store.listUsageLedgerEvents(threadId),
    });
  }

  listUsageLedgerEventViews(threadId: string) {
    return this.store.listUsageLedgerEvents(threadId).map(buildThreadUsageLedgerEventView);
  }

  resolveBillingSnapshot(
    threadId: string,
    legacyBilling: ThreadBillingSnapshot,
    options: UsageLedgerBillingSnapshotSelectionOptions = {},
  ): UsageLedgerBillingSnapshotSelection {
    const legacySnapshot = this.enrichBillingSnapshot(threadId, legacyBilling);
    if (!options.useLedgerProjection) {
      return { snapshot: legacySnapshot, source: "legacy", legacySnapshot };
    }

    try {
      const projection = this.projectBilling(
        threadId,
        options.plannerModelLabel ?? legacySnapshot.plannerModelLabel,
      );
      if (!projection?.snapshot) {
        return { snapshot: legacySnapshot, source: "legacy", legacySnapshot };
      }

      const projectedSubagentMetrics = projectSubagentMetricsEntriesFromBillingProjection({
        projection,
        existingEntries: this.metrics.listEntries(threadId),
      });
      const reconciliation = reconcileBillingProjectionWithLegacy(projection, legacySnapshot, {
        subagentMetrics: projectedSubagentMetrics,
      });
      if (!reconciliation.ok) {
        this.logDiagThrottled?.(
          `usage-ledger-billing-selection:${threadId}`,
          "usage_ledger.billing_selection_rejected",
          {
            threadId: shortThreadId(threadId),
            projection: summarizeUsageLedgerBillingProjection(projection),
            projectionReconciliation: summarizeBillingProjectionReconciliation(reconciliation),
          },
          1000,
        );
        const diagnosticLegacySnapshot = withBillingDiagnostics(legacySnapshot, {
          projectionReconciliation: reconciliation,
        });
        const diagnosticLedgerSnapshot = withBillingDiagnostics(projection.snapshot, {
          projectionReconciliation: reconciliation,
        });
        return {
          snapshot: diagnosticLedgerSnapshot,
          source: "ledger",
          legacySnapshot: diagnosticLegacySnapshot,
          ledgerSnapshot: diagnosticLedgerSnapshot,
          reconciliation,
        };
      }

      const diagnosticLedgerSnapshot = withBillingDiagnostics(projection.snapshot, {
        projectionReconciliation: reconciliation,
      });
      return {
        snapshot: diagnosticLedgerSnapshot,
        source: "ledger",
        legacySnapshot,
        ledgerSnapshot: diagnosticLedgerSnapshot,
        reconciliation,
      };
    } catch (error) {
      this.writeError(`[eco] usage ledger billing selection failed: ${errorMessage(error)}\n`);
      return { snapshot: legacySnapshot, source: "legacy", legacySnapshot };
    }
  }

  projectBillingSnapshot(threadId: string, plannerModelLabel?: string): ThreadBillingSnapshot | undefined {
    try {
      const snapshot = this.projectBilling(threadId, plannerModelLabel)?.snapshot;
      return snapshot ? withBillingDiagnostics(snapshot) : undefined;
    } catch (error) {
      this.writeError(`[eco] usage ledger billing projection failed: ${errorMessage(error)}\n`);
      return undefined;
    }
  }

  listSubagentBillingEntries(threadId: string): SubagentMetricsEntry[] {
    const existingEntries = this.metrics.listEntries(threadId);
    try {
      const projection = this.projectBilling(threadId);
      if (!projection) {
        return existingEntries;
      }
      return projectSubagentMetricsEntriesFromBillingProjection({
        projection,
        existingEntries,
      });
    } catch (error) {
      this.writeError(`[eco] subagent ledger projection failed: ${errorMessage(error)}\n`);
      return existingEntries;
    }
  }

  private projectBilling(
    threadId: string,
    plannerModelLabel?: string,
  ): ReturnType<typeof projectBillingFromUsageLedger> | undefined {
    const events = this.store.listUsageLedgerEvents(threadId);
    if (events.length === 0) {
      return undefined;
    }
    if (this.proxyPendingRegistry.listPending(threadId).length === 0) {
      this.rebuildProxyPendingFromEvents(threadId);
    }
    return projectBillingFromUsageLedger({
      events,
      agents: this.store.listAgentInstances(threadId),
      ...(plannerModelLabel && { plannerModelLabel }),
    });
  }

  reconcileShadow(threadId: string, billing: ThreadBillingSnapshot): void {
    try {
      const events = this.store.listUsageLedgerEvents(threadId);
      if (events.length === 0) {
        return;
      }
      const result = reconcileUsageLedgerWithBilling(events, billing);
      const projection = projectBillingFromUsageLedger({
        events,
        agents: this.store.listAgentInstances(threadId),
        ...(billing.plannerModelLabel && { plannerModelLabel: billing.plannerModelLabel }),
      });
      const projectionResult = reconcileBillingProjectionWithLegacy(projection, billing, {
        subagentMetrics: this.metrics.listEntries(threadId),
      });
      if (result.ok && projectionResult.ok) {
        return;
      }
      this.logDiagThrottled?.(
        `usage-ledger-reconcile:${threadId}`,
        "usage_ledger.reconcile_mismatch",
        {
          threadId: shortThreadId(threadId),
          sourceReconciliation: summarizeUsageLedgerReconciliation(result),
          projection: summarizeUsageLedgerBillingProjection(projection),
          projectionReconciliation: summarizeBillingProjectionReconciliation(projectionResult),
        },
        1000,
      );
    } catch (error) {
      this.writeError(`[eco] usage ledger shadow reconcile failed: ${errorMessage(error)}\n`);
    }
  }

  private settleQueuedInterruptedStreamPartials(threadId: string): void {
    const pending = this.pendingInterruptedStreamSettlements.get(threadId);
    if (!pending || pending.length === 0) {
      return;
    }
    this.pendingInterruptedStreamSettlements.delete(threadId);
    for (const entry of pending) {
      this.settleInterruptedStreamPartials(threadId, entry.runAttemptId, entry.runStatus);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
