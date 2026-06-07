import type { ParsedUsage, RequestBillingDelta } from "@eco/runtime";
import type { AgentRole } from "../shared/ipc";
import { isSubagentBillingRole } from "./billing-orchestration";
import { resolveSubagentAgentId, type SubagentAgentResolveMissReason } from "./subagent-agent-resolver";
import { SubagentLegacyUsageTracker } from "./subagent-legacy-usage";
import {
  defaultSubagentMetricsDiagnostics,
  type SubagentMetricsDiagnosticsPort,
} from "./subagent-metrics-diagnostics";
import type { SubagentMetricsPersistenceStore } from "./subagent-metrics-persistence";
import {
  resolveSubagentMetricsRecordTarget,
  type SubagentMetricsRecordTarget,
} from "./subagent-metrics-record-target";
import {
  type SubagentMetricsRegistryPersistence,
  SubagentMetricsStoreFacade,
} from "./subagent-metrics-registry-persistence";
import {
  type SubagentContextObservationInput,
  type SubagentMetricsEntry,
  SubagentMetricsState,
} from "./subagent-metrics-state";
import { SubagentToolUseIndex } from "./subagent-tool-use-index";

export type {
  SubagentContextObservationInput,
  SubagentMetricsEntry,
  SubagentMetricsStatus,
} from "./subagent-metrics-state";

interface ThreadSubagentState {
  metrics: SubagentMetricsState;
  toolUses: SubagentToolUseIndex;
  legacyUsage: SubagentLegacyUsageTracker;
}

export class SubagentMetricsRegistry {
  private readonly threads = new Map<string, ThreadSubagentState>();
  private readonly persistence: SubagentMetricsRegistryPersistence;

  constructor(
    store: SubagentMetricsPersistenceStore,
    private readonly diagnostics: SubagentMetricsDiagnosticsPort = defaultSubagentMetricsDiagnostics,
    persistence?: SubagentMetricsRegistryPersistence,
  ) {
    this.persistence = persistence ?? new SubagentMetricsStoreFacade(store);
  }

  onSubagentStart(threadId: string, input: { agentId: string; role: AgentRole }): void {
    if (!isSubagentBillingRole(input.role)) {
      return;
    }
    const state = this.getOrCreateThread(threadId);
    const now = Date.now();
    const start = state.metrics.start(input, now);
    const toolUseLink = state.toolUses.linkNextPendingForRole(input.role, input.agentId);
    this.persistEntry(threadId, start.entry);
    this.diagnostics.logLifecycle({
      threadId,
      event: "start",
      role: input.role,
      agentId: input.agentId,
      activeCount: start.activeCount,
      toolUseLinks: toolUseLink.mappedCount,
    });
  }

  onSubagentStop(threadId: string, input: { agentId: string; role: AgentRole }): void {
    const state = this.threads.get(threadId);
    if (!state) {
      return;
    }
    const stopped = state.metrics.stop(input, Date.now());
    if (stopped.entry) {
      this.persistEntry(threadId, stopped.entry);
    }
    this.diagnostics.logLifecycle({
      threadId,
      event: "stop",
      role: input.role,
      agentId: input.agentId,
      activeCount: stopped.activeCount,
    });
  }

  noteTaskToolUse(threadId: string, toolUseId: string, role?: AgentRole): void {
    const state = this.getOrCreateThread(threadId);
    const pendingRole = role && isSubagentBillingRole(role) ? role : undefined;
    const result = state.toolUses.note(toolUseId, pendingRole);
    this.diagnostics.logTaskTool({
      threadId,
      toolUseId,
      ...(pendingRole && { role: pendingRole }),
      pending: result.pending,
      pendingCount: result.pendingCount,
    });
  }

  linkToolUseToAgent(threadId: string, toolUseId: string, agentId: string): void {
    const state = this.threads.get(threadId);
    if (!state) {
      return;
    }
    state.toolUses.link(toolUseId, agentId);
  }

  resolveAgentIdByParentToolUse(threadId: string, parentToolUseId: string): string | undefined {
    const state = this.threads.get(threadId);
    if (!state) {
      return undefined;
    }
    return state.toolUses.resolve(parentToolUseId.trim());
  }

  resolveAgentId(
    threadId: string,
    input: {
      role: AgentRole;
      subagentAgentId?: string;
      parentToolUseId?: string;
    },
  ): string | undefined {
    const state = this.threads.get(threadId);
    const linkedParentAgentId =
      input.parentToolUseId && state ? state.toolUses.resolve(input.parentToolUseId) : undefined;
    const activeAgentIds = state ? state.metrics.activeAgentIds(input.role) : undefined;
    const stoppedAgentIdsForRole = state ? state.metrics.agentIdsForRole(input.role) : undefined;
    const result = resolveSubagentAgentId({
      role: input.role,
      ...(input.subagentAgentId && { explicitAgentId: input.subagentAgentId }),
      ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
      ...(linkedParentAgentId && { linkedParentAgentId }),
      hasThreadState: Boolean(state),
      ...(activeAgentIds && { activeAgentIds }),
      ...(stoppedAgentIdsForRole && { stoppedAgentIdsForRole }),
    });

    if (result.agentId) {
      return result.agentId;
    }

    if (result.missReason) {
      this.logResolveMiss(threadId, input, result.missReason, new Set(result.activeAgentIds ?? []));
    }
    return undefined;
  }

  roleForAgentId(threadId: string, agentId: string): AgentRole | undefined {
    return this.threads.get(threadId)?.metrics.roleForAgentId(agentId);
  }

  recordContextObservation(
    threadId: string,
    input: SubagentContextObservationInput,
  ): SubagentMetricsEntry | undefined {
    const target = this.resolveRecordTarget(threadId, input);
    if (!target) {
      return undefined;
    }

    const state = this.getOrCreateThread(threadId);
    const now = Date.now();
    const entry = state.metrics.recordContext(target.agentId, target.role, input, now);
    this.persistEntry(threadId, entry);
    return entry;
  }

  private logResolveMiss(
    threadId: string,
    input: { role: AgentRole; parentToolUseId?: string },
    reason: SubagentAgentResolveMissReason,
    active?: Set<string>,
  ): void {
    this.diagnostics.logResolveMiss({
      threadId,
      role: input.role,
      reason,
      ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
      ...(active && { activeAgentIds: [...active] }),
      mappedParents: this.threads.get(threadId)?.toolUses.mappedCount ?? 0,
    });
  }

  recordSdkUsage(
    threadId: string,
    input: {
      role: AgentRole;
      agentId?: string;
      parentToolUseId?: string;
      usage: ParsedUsage;
      contextOccupied: number;
      contextLimit?: number;
      billing: RequestBillingDelta;
      modelId?: string;
      requestKey: string;
    },
  ): SubagentMetricsEntry | undefined {
    const target = this.resolveRecordTarget(threadId, input);
    if (!target) {
      return undefined;
    }
    const state = this.getOrCreateThread(threadId);
    const result = state.legacyUsage.recordForTarget(state.metrics, target, input, Date.now());
    if (result.deduped) {
      this.diagnostics.logUsageDedupe({
        threadId,
        role: target.role,
        agentId: target.agentId,
        requestKey: input.requestKey,
        ...(result.modelId && { modelId: result.modelId }),
      });
      return result.entry;
    }
    this.persistEntry(threadId, result.entry);
    return result.entry;
  }

  listEntries(threadId: string): SubagentMetricsEntry[] {
    const state = this.threads.get(threadId);
    if (!state) {
      return [];
    }
    return state.metrics.listEntries();
  }

  restoreFromStore(threadId: string): void {
    const restoredEntries = this.persistence.restoreThread(threadId);
    if (restoredEntries.length === 0) {
      return;
    }
    const state = this.getOrCreateThread(threadId);
    for (const { entry, legacyUsageContribution } of restoredEntries) {
      state.metrics.restore(entry);
      if (legacyUsageContribution) {
        state.legacyUsage.restoreContribution(legacyUsageContribution);
      }
    }
  }

  clearThread(threadId: string): void {
    this.threads.delete(threadId);
    this.persistence.clearThread(threadId);
  }

  private getOrCreateThread(threadId: string): ThreadSubagentState {
    let state = this.threads.get(threadId);
    if (!state) {
      state = {
        metrics: new SubagentMetricsState(),
        toolUses: new SubagentToolUseIndex(),
        legacyUsage: new SubagentLegacyUsageTracker(),
      };
      this.threads.set(threadId, state);
    }
    return state;
  }

  private resolveRecordTarget(
    threadId: string,
    input: { role: AgentRole; agentId?: string; parentToolUseId?: string },
  ): SubagentMetricsRecordTarget | undefined {
    return resolveSubagentMetricsRecordTarget({
      threadId,
      role: input.role,
      resolver: this,
      ...(input.agentId && { agentId: input.agentId }),
      ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
    });
  }

  private persistEntry(threadId: string, entry: SubagentMetricsEntry): void {
    this.persistence.persistEntry(threadId, entry);
  }
}
