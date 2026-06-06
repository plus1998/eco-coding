import type { AgentRole, TokenCostBreakdown } from "../shared/ipc";

export type SubagentMetricsPersistenceStatus = "active" | "stopped";

export interface SubagentMetricsPersistenceRecord {
  threadId: string;
  agentId: string;
  role: AgentRole;
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
  role: AgentRole;
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
  upsertSubagentMetrics(
    threadId: string,
    input: UpsertSubagentMetricsPersistenceInput,
  ): void;
  clearSubagentMetrics(threadId: string): void;
}
