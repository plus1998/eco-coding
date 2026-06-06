import { emptyCostBreakdown, type ParsedUsage } from "@eco/runtime";
import { isSubagentBillingRole } from "./billing-orchestration";
import type {
  BillingProjectorAgentSnapshot,
  UsageLedgerBillingProjection,
} from "./billing-projector";
import type { SubagentMetricsEntry, SubagentMetricsStatus } from "./subagent-metrics-registry";

export function projectSubagentMetricsEntriesFromBillingProjection(input: {
  projection: UsageLedgerBillingProjection;
  existingEntries: readonly SubagentMetricsEntry[];
  now?: number;
}): SubagentMetricsEntry[] {
  const now = input.now ?? Date.now();
  const existingByAgent = new Map(input.existingEntries.map((entry) => [entry.agentId, entry]));
  const projectedAgentIds = new Set<string>();
  const entries: SubagentMetricsEntry[] = [];

  for (const agent of Object.values(input.projection.byAgent)) {
    if (!isProjectedSubagent(agent) || usageTotal(agent) === 0) {
      continue;
    }
    projectedAgentIds.add(agent.agentId);
    entries.push(projectAgentEntry(agent, existingByAgent.get(agent.agentId), now));
  }

  for (const existing of input.existingEntries) {
    if (!projectedAgentIds.has(existing.agentId)) {
      entries.push(existing);
    }
  }

  return entries.sort((left, right) => right.updatedAt - left.updatedAt);
}

function projectAgentEntry(
  agent: BillingProjectorAgentSnapshot,
  existing: SubagentMetricsEntry | undefined,
  now: number,
): SubagentMetricsEntry {
  const usage: ParsedUsage = {
    inputTokens: agent.inputTokens,
    outputTokens: agent.outputTokens,
    cacheReadTokens: agent.cacheReadTokens,
    cacheCreationTokens: agent.cacheCreationTokens,
  };
  const status: SubagentMetricsStatus =
    existing?.status ?? (agent.status === "active" ? "active" : "stopped");
  return {
    agentId: agent.agentId,
    role: agent.role,
    status,
    usage,
    contextOccupied: existing?.contextOccupied ?? 0,
    ...(existing?.contextLimit !== undefined && { contextLimit: existing.contextLimit }),
    ecoCostUsd: agent.ecoCostUsd,
    ecoCostBreakdown: agent.ecoCostBreakdown ?? emptyCostBreakdown(),
    ...(agent.modelIds[0] && { modelId: agent.modelIds[0] }),
    ...(existing?.lastRequestKey && { lastRequestKey: existing.lastRequestKey }),
    updatedAt: existing?.updatedAt ?? now,
  };
}

function isProjectedSubagent(agent: BillingProjectorAgentSnapshot): boolean {
  return agent.kind === "subagent" || isSubagentBillingRole(agent.role);
}

function usageTotal(agent: BillingProjectorAgentSnapshot): number {
  return agent.inputTokens + agent.outputTokens + agent.cacheReadTokens + agent.cacheCreationTokens;
}
