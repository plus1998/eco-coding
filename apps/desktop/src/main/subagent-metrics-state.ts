import type { ParsedUsage } from "@eco/runtime";
import type { RuntimeAgentRole, TokenCostBreakdown } from "../shared/ipc";

export type SubagentMetricsStatus = "active" | "stopped";

export interface SubagentMetricsEntry {
  agentId: string;
  role: RuntimeAgentRole;
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

export interface SubagentContextObservationInput {
  role: RuntimeAgentRole;
  agentId?: string;
  parentToolUseId?: string;
  contextOccupied: number;
  contextLimit?: number;
  modelId?: string;
  requestKey?: string;
}

export class SubagentMetricsState {
  private readonly activeByRole = new Map<RuntimeAgentRole, Set<string>>();
  private readonly byAgentId = new Map<string, SubagentMetricsEntry>();

  start(
    input: { agentId: string; role: RuntimeAgentRole },
    updatedAt: number,
  ): { entry: SubagentMetricsEntry; activeCount: number } {
    const entry = this.ensureEntry(input.agentId, input.role, "active", updatedAt);
    entry.status = "active";
    entry.role = input.role;
    entry.updatedAt = updatedAt;

    const active = this.activeByRole.get(input.role) ?? new Set();
    active.add(input.agentId);
    this.activeByRole.set(input.role, active);

    return { entry, activeCount: active.size };
  }

  stop(
    input: { agentId: string; role: RuntimeAgentRole },
    updatedAt: number,
  ): { entry?: SubagentMetricsEntry; activeCount: number } {
    const entry = this.byAgentId.get(input.agentId);
    if (entry) {
      entry.status = "stopped";
      entry.updatedAt = updatedAt;
    }
    const active = this.activeByRole.get(input.role);
    active?.delete(input.agentId);
    return { ...(entry && { entry }), activeCount: active?.size ?? 0 };
  }

  recordContext(
    agentId: string,
    role: RuntimeAgentRole,
    input: Pick<
      SubagentContextObservationInput,
      "contextOccupied" | "contextLimit" | "modelId" | "requestKey"
    >,
    updatedAt: number,
  ): SubagentMetricsEntry {
    const entry = this.ensureEntry(agentId, role, "active", updatedAt);
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
    entry.updatedAt = updatedAt;
    return entry;
  }

  ensureEntry(
    agentId: string,
    role: RuntimeAgentRole,
    status: SubagentMetricsStatus,
    updatedAt: number,
  ): SubagentMetricsEntry {
    let entry = this.byAgentId.get(agentId);
    if (!entry) {
      entry = createEmptySubagentMetricsEntry(agentId, role, status, updatedAt);
      this.byAgentId.set(agentId, entry);
    }
    return entry;
  }

  restore(entry: SubagentMetricsEntry): void {
    this.byAgentId.set(entry.agentId, entry);
    this.activeByRole.get(entry.role)?.delete(entry.agentId);
    if (entry.status === "active") {
      const active = this.activeByRole.get(entry.role) ?? new Set();
      active.add(entry.agentId);
      this.activeByRole.set(entry.role, active);
    }
  }

  roleForAgentId(agentId: string): RuntimeAgentRole | undefined {
    return this.byAgentId.get(agentId)?.role;
  }

  activeAgentIds(role: RuntimeAgentRole): string[] {
    return [...(this.activeByRole.get(role) ?? [])];
  }

  agentIdsForRole(role: RuntimeAgentRole): string[] {
    return [...this.byAgentId.values()]
      .filter((entry) => entry.role === role)
      .map((entry) => entry.agentId);
  }

  getEntry(agentId: string): SubagentMetricsEntry | undefined {
    return this.byAgentId.get(agentId);
  }

  listEntries(): SubagentMetricsEntry[] {
    return [...this.byAgentId.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }
}

export function createEmptySubagentMetricsEntry(
  agentId: string,
  role: RuntimeAgentRole,
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
