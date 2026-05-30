import type { ParsedUsage } from "@eco/runtime";

export function createEmptyUsage(): ParsedUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}

export interface UsageRequestRecord {
  role: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  modelId?: string;
}
