import type { AgentRole, TokenCostBreakdown } from "../shared/ipc";
import type { ParsedUsage, RequestBillingDelta } from "@eco/runtime";
import { isSubagentBillingRole } from "./billing-orchestration";
import { logEcoDiag, shortAgentId, shortThreadId } from "./eco-diag-log";
import {
  resolveSubagentAgentId,
  type SubagentAgentResolveMissReason,
} from "./subagent-agent-resolver";
import {
  buildSubagentUsageContributionKey,
  subagentMetricsEntryFromPersistenceRecord,
  subagentMetricsEntryToPersistenceInput,
  type SubagentMetricsPersistenceStore,
} from "./subagent-metrics-persistence";
import { SubagentToolUseIndex } from "./subagent-tool-use-index";

export type SubagentMetricsStatus = "active" | "stopped";

export interface SubagentMetricsEntry {
  agentId: string;
  role: AgentRole;
  status: SubagentMetricsStatus;
  usage: ParsedUsage;
  contextOccupied: number;
  contextLimit?: number;
  ecoCostUsd: number;
  ecoCostBreakdown: TokenCostBreakdown;
  modelId?: string;
  lastRequestKey?: string;
  updatedAt: number;
}

interface ThreadSubagentState {
  activeByRole: Map<AgentRole, Set<string>>;
  toolUses: SubagentToolUseIndex;
  seenUsageKeys: Set<string>;
  byAgentId: Map<string, SubagentMetricsEntry>;
}

export interface SubagentContextObservationInput {
  role: AgentRole;
  agentId?: string;
  parentToolUseId?: string;
  contextOccupied: number;
  contextLimit?: number;
  modelId?: string;
  requestKey?: string;
}

export class SubagentMetricsRegistry {
  private readonly threads = new Map<string, ThreadSubagentState>();

  constructor(private readonly store: SubagentMetricsPersistenceStore) {}

  onSubagentStart(threadId: string, input: { agentId: string; role: AgentRole }): void {
    if (!isSubagentBillingRole(input.role)) {
      return;
    }
    const state = this.getOrCreateThread(threadId);
    const now = Date.now();
    let entry = state.byAgentId.get(input.agentId);
    if (!entry) {
      entry = createEmptyEntry(input.agentId, input.role, "active", now);
      state.byAgentId.set(input.agentId, entry);
    } else {
      entry.status = "active";
      entry.role = input.role;
      entry.updatedAt = now;
    }
    const pendingToolUseId = state.toolUses.consumeForRole(input.role);
    if (pendingToolUseId) {
      state.toolUses.link(pendingToolUseId, input.agentId);
    }
    const active = state.activeByRole.get(input.role) ?? new Set();
    active.add(input.agentId);
    state.activeByRole.set(input.role, active);
    this.persistEntry(threadId, entry);
    logEcoDiag("subagent.lifecycle", {
      threadId: shortThreadId(threadId),
      event: "start",
      role: input.role,
      agentId: shortAgentId(input.agentId),
      activeCount: active.size,
      toolUseLinks: state.toolUses.mappedCount,
    });
  }

  onSubagentStop(threadId: string, input: { agentId: string; role: AgentRole }): void {
    const state = this.threads.get(threadId);
    if (!state) {
      return;
    }
    const entry = state.byAgentId.get(input.agentId);
    if (entry) {
      entry.status = "stopped";
      entry.updatedAt = Date.now();
      this.persistEntry(threadId, entry);
    }
    const active = state.activeByRole.get(input.role);
    active?.delete(input.agentId);
    logEcoDiag("subagent.lifecycle", {
      threadId: shortThreadId(threadId),
      event: "stop",
      role: input.role,
      agentId: shortAgentId(input.agentId),
      activeCount: active?.size ?? 0,
    });
  }

  noteTaskToolUse(threadId: string, toolUseId: string, role?: AgentRole): void {
    const state = this.getOrCreateThread(threadId);
    const pendingRole = role && isSubagentBillingRole(role) ? role : undefined;
    const result = state.toolUses.note(toolUseId, pendingRole);
    logEcoDiag("subagent.task_tool", {
      threadId: shortThreadId(threadId),
      toolUseId: toolUseId.slice(-12),
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
    const activeAgentIds = state ? [...(state.activeByRole.get(input.role) ?? [])] : undefined;
    const stoppedAgentIdsForRole = state
      ? [...state.byAgentId.values()]
          .filter((entry) => entry.role === input.role)
          .map((entry) => entry.agentId)
      : undefined;
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
      this.logResolveMiss(
        threadId,
        input,
        result.missReason,
        new Set(result.activeAgentIds ?? []),
      );
    }
    return undefined;
  }

  roleForAgentId(threadId: string, agentId: string): AgentRole | undefined {
    return this.threads.get(threadId)?.byAgentId.get(agentId)?.role;
  }

  recordContextObservation(
    threadId: string,
    input: SubagentContextObservationInput,
  ): SubagentMetricsEntry | undefined {
    const resolvedAgentId = this.resolveAgentId(threadId, {
      role: input.role,
      ...(input.agentId && { subagentAgentId: input.agentId }),
      ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
    });
    const entryRole = resolvedAgentId ? this.roleForAgentId(threadId, resolvedAgentId) : undefined;
    if (!resolvedAgentId || !entryRole || !isSubagentBillingRole(entryRole)) {
      return undefined;
    }

    const state = this.getOrCreateThread(threadId);
    const now = Date.now();
    let entry = state.byAgentId.get(resolvedAgentId);
    if (!entry) {
      entry = createEmptyEntry(resolvedAgentId, entryRole, "active", now);
      state.byAgentId.set(resolvedAgentId, entry);
    }

    entry.contextOccupied = input.contextOccupied;
    if (input.contextLimit !== undefined) {
      entry.contextLimit = input.contextLimit;
    }
    if (input.modelId) {
      entry.modelId = input.modelId;
    }
    if (input.requestKey) {
      entry.lastRequestKey = input.requestKey;
    }
    entry.updatedAt = now;
    this.persistEntry(threadId, entry);
    return entry;
  }

  private logResolveMiss(
    threadId: string,
    input: { role: AgentRole; parentToolUseId?: string },
    reason: SubagentAgentResolveMissReason,
    active?: Set<string>,
  ): void {
    logEcoDiag("subagent.resolve_miss", {
      threadId: shortThreadId(threadId),
      role: input.role,
      reason,
      parentToolUseId: input.parentToolUseId?.slice(-12),
      activeAgents: active ? [...active].map(shortAgentId) : [],
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
    const resolvedAgentId = this.resolveAgentId(threadId, {
      role: input.role,
      ...(input.agentId && { subagentAgentId: input.agentId }),
      ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
    });
    const entryRole = resolvedAgentId ? this.roleForAgentId(threadId, resolvedAgentId) : undefined;
    if (!resolvedAgentId || !entryRole || !isSubagentBillingRole(entryRole)) {
      return undefined;
    }
    const state = this.getOrCreateThread(threadId);
    const usageKey = buildSubagentUsageContributionKey(input, {
      agentId: resolvedAgentId,
      role: entryRole,
    });
    if (state.seenUsageKeys.has(usageKey)) {
      logEcoDiag("subagent.usage_dedupe", {
        threadId: shortThreadId(threadId),
        role: entryRole,
        agentId: shortAgentId(resolvedAgentId),
        requestKey: input.requestKey,
        modelId: input.modelId ?? input.usage.modelId,
      });
      return state.byAgentId.get(resolvedAgentId);
    }
    state.seenUsageKeys.add(usageKey);
    const now = Date.now();
    let entry = state.byAgentId.get(resolvedAgentId);
    if (!entry) {
      entry = createEmptyEntry(resolvedAgentId, entryRole, "active", now);
      state.byAgentId.set(resolvedAgentId, entry);
    }
    entry.usage = mergeUsage(entry.usage, input.usage);
    entry.contextOccupied = input.contextOccupied;
    if (input.contextLimit !== undefined) {
      entry.contextLimit = input.contextLimit;
    }
    entry.ecoCostUsd += input.billing.ecoCostUsd;
    if (input.billing.ecoBreakdown) {
      entry.ecoCostBreakdown = mergeBreakdown(entry.ecoCostBreakdown, input.billing.ecoBreakdown);
    }
    if (input.modelId) {
      entry.modelId = input.modelId;
    }
    entry.lastRequestKey = input.requestKey;
    entry.updatedAt = now;
    this.persistEntry(threadId, entry);
    return entry;
  }

  listEntries(threadId: string): SubagentMetricsEntry[] {
    const state = this.threads.get(threadId);
    if (!state) {
      return [];
    }
    return [...state.byAgentId.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  restoreFromStore(threadId: string): void {
    const rows = this.store.listSubagentMetrics(threadId);
    if (rows.length === 0) {
      return;
    }
    const state = this.getOrCreateThread(threadId);
    for (const row of rows) {
      const entry = subagentMetricsEntryFromPersistenceRecord(row);
      state.byAgentId.set(row.agentId, entry);
      if (row.lastRequestKey) {
        state.seenUsageKeys.add(
          buildSubagentUsageContributionKey(
            {
              ...(entry.modelId && { modelId: entry.modelId }),
              requestKey: row.lastRequestKey,
            },
            { agentId: row.agentId, role: row.role },
          ),
        );
      }
      if (entry.status === "active" && isSubagentBillingRole(entry.role)) {
        const active = state.activeByRole.get(entry.role) ?? new Set();
        active.add(entry.agentId);
        state.activeByRole.set(entry.role, active);
      }
    }
  }

  clearThread(threadId: string): void {
    this.threads.delete(threadId);
    this.store.clearSubagentMetrics(threadId);
  }

  private getOrCreateThread(threadId: string): ThreadSubagentState {
    let state = this.threads.get(threadId);
    if (!state) {
      state = {
        activeByRole: new Map(),
        toolUses: new SubagentToolUseIndex(),
        seenUsageKeys: new Set(),
        byAgentId: new Map(),
      };
      this.threads.set(threadId, state);
    }
    return state;
  }

  private persistEntry(threadId: string, entry: SubagentMetricsEntry): void {
    this.store.upsertSubagentMetrics(threadId, subagentMetricsEntryToPersistenceInput(entry));
  }
}

function createEmptyEntry(
  agentId: string,
  role: AgentRole,
  status: SubagentMetricsStatus,
  updatedAt: number,
): SubagentMetricsEntry {
  return {
    agentId,
    role,
    status,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    contextOccupied: 0,
    ecoCostUsd: 0,
    ecoCostBreakdown: { inputUsd: 0, outputUsd: 0, cacheReadUsd: 0, cacheCreationUsd: 0, totalUsd: 0 },
    updatedAt,
  };
}

function mergeUsage(left: ParsedUsage, right: ParsedUsage): ParsedUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheCreationTokens: left.cacheCreationTokens + right.cacheCreationTokens,
  };
}

function mergeBreakdown(left: TokenCostBreakdown, right: TokenCostBreakdown): TokenCostBreakdown {
  return {
    inputUsd: left.inputUsd + right.inputUsd,
    outputUsd: left.outputUsd + right.outputUsd,
    cacheReadUsd: left.cacheReadUsd + right.cacheReadUsd,
    cacheCreationUsd: left.cacheCreationUsd + right.cacheCreationUsd,
    totalUsd: left.totalUsd + right.totalUsd,
  };
}
