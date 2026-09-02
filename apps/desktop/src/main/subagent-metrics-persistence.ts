import type { ParsedUsage } from "@eco/runtime";
import type { RuntimeAgentRole, TokenCostBreakdown } from "../shared/ipc";
import type { SubagentMetricsEntry } from "./subagent-metrics-state";

export type SubagentMetricsPersistenceStatus = "active" | "stopped";

export interface SubagentMetricsPersistenceRecord {
  threadId: string;
  agentId: string;
  role: RuntimeAgentRole;
  status: SubagentMetricsPersistenceStatus;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  contextOccupied: number;
  contextLimit?: number;
  ecoCostUsd: number;
  ecoCostBreakdown: TokenCostBreakdown;
  modelId?: string;
  lastRequestKey?: string;
  updatedAt: string;
}

export interface UpsertSubagentMetricsPersistenceInput {
  agentId: string;
  role: RuntimeAgentRole;
  status: SubagentMetricsPersistenceStatus;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  contextOccupied: number;
  contextLimit?: number;
  ecoCostUsd: number;
  ecoCostBreakdown: TokenCostBreakdown;
  modelId?: string;
  lastRequestKey?: string;
}

export interface SubagentMetricsPersistenceStore {
  listSubagentMetrics(threadId: string): SubagentMetricsPersistenceRecord[];
  upsertSubagentMetrics(threadId: string, input: UpsertSubagentMetricsPersistenceInput): void;
  clearSubagentMetrics(threadId: string): void;
}

export function subagentMetricsEntryFromPersistenceRecord(
  row: SubagentMetricsPersistenceRecord,
): SubagentMetricsEntry {
  return {
    agentId: row.agentId,
    role: row.role,
    status: row.status,
    usage: {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheCreationTokens: row.cacheCreationTokens,
    },
    contextOccupied: row.contextOccupied,
    ...(row.contextLimit !== undefined && { contextLimit: row.contextLimit }),
    ecoCostUsd: row.ecoCostUsd,
    ecoCostBreakdown: row.ecoCostBreakdown,
    ...(row.modelId && { modelId: row.modelId }),
    ...(row.lastRequestKey && { lastRequestKey: row.lastRequestKey }),
    updatedAt: Date.parse(row.updatedAt) || Date.now(),
  };
}

export function subagentMetricsEntryToPersistenceInput(
  entry: SubagentMetricsEntry,
): UpsertSubagentMetricsPersistenceInput {
  return {
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
    ...(entry.lastRequestKey && { lastRequestKey: entry.lastRequestKey }),
  };
}

export function buildSubagentUsageContributionKey(
  input: { requestKey: string; modelId?: string; usage?: Pick<ParsedUsage, "modelId"> },
  resolved: { agentId: string; role: RuntimeAgentRole },
): string {
  const modelId = input.modelId ?? input.usage?.modelId ?? "unknown-model";
  return [resolved.agentId, resolved.role, input.requestKey, modelId].join("\u001f");
}
