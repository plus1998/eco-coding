import type { ThreadSubagentMetricsSummary } from "../shared/ipc";
import type { SubagentMetricsEntry } from "./subagent-metrics-registry";

export function buildSubagentMetricsSummaries(
  entries: readonly SubagentMetricsEntry[],
): ThreadSubagentMetricsSummary[] {
  return entries.map((entry) => ({
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
    ...(entry.modelId && { modelId: entry.modelId }),
  }));
}
