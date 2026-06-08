import type { ThreadBillingSnapshot } from "../shared/ipc";
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

interface PendingInterruptedStreamSettlement {
  runAttemptId: string;
  runStatus: Exclude<RunAttemptStatus, "running" | "completed">;
}

export interface UsageLedgerCoordinatorStore {
  appendUsageLedgerEvent(event: UsageLedgerEvent): boolean;
  listUsageLedgerEvents(threadId: string): UsageLedgerEvent[];
  listAgentInstances(threadId: string): AgentInstanceRecord[];
}

export interface UsageLedgerCoordinatorMetrics {
  listEntries(threadId: string): SubagentMetricsEntry[];
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
  private readonly logDiag?: UsageLedgerCoordinatorOptions["logDiag"];
  private readonly logDiagThrottled?: UsageLedgerCoordinatorOptions["logDiagThrottled"];
  private readonly writeError: (message: string) => void;
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
        return;
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
    return withBillingDiagnostics(subagents.length > 0 ? { ...billing, subagents } : billing);
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
          snapshot: diagnosticLegacySnapshot,
          source: "legacy",
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
