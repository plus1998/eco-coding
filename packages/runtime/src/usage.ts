export interface ParsedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd?: number;
  modelId?: string;
}

export function parseUsagePayload(payload: unknown): ParsedUsage | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const usage = isRecord(record.usage) ? record.usage : record;
  const inputTokens = readTokenCount(usage, ["input_tokens", "inputTokens"]);
  const outputTokens = readTokenCount(usage, ["output_tokens", "outputTokens"]);
  const cacheReadTokens = readTokenCount(usage, [
    "cache_read_input_tokens",
    "cacheReadInputTokens",
    "cache_read_tokens",
  ]);
  const cacheCreationTokens = readTokenCount(usage, [
    "cache_creation_input_tokens",
    "cacheCreationInputTokens",
    "cache_creation_tokens",
  ]);

  const totalCostUsd =
    typeof record.total_cost_usd === "number"
      ? record.total_cost_usd
      : typeof record.totalCostUsd === "number"
        ? record.totalCostUsd
        : undefined;

  const modelId = extractModelId(record);

  if (
    inputTokens === 0 &&
    outputTokens === 0 &&
    cacheReadTokens === 0 &&
    cacheCreationTokens === 0 &&
    totalCostUsd === undefined
  ) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    ...(totalCostUsd !== undefined && { totalCostUsd }),
    ...(modelId && { modelId }),
  };
}

export function mergeUsageTotals(current: ParsedUsage, incoming: ParsedUsage): ParsedUsage {
  return {
    inputTokens: current.inputTokens + incoming.inputTokens,
    outputTokens: current.outputTokens + incoming.outputTokens,
    cacheReadTokens: current.cacheReadTokens + incoming.cacheReadTokens,
    cacheCreationTokens: current.cacheCreationTokens + incoming.cacheCreationTokens,
    ...(incoming.modelId && { modelId: incoming.modelId }),
    ...(incoming.totalCostUsd !== undefined && { totalCostUsd: incoming.totalCostUsd }),
  };
}

export function estimateContextTokens(usage: ParsedUsage): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${Math.round(value / 1000)}k`;
  }
  return String(value);
}

export function formatUsageBadge(usage: ParsedUsage): string {
  const parts = [
    `↑${formatTokenCount(usage.inputTokens)}`,
    `↓${formatTokenCount(usage.outputTokens)}`,
  ];
  if (usage.cacheReadTokens > 0 || usage.cacheCreationTokens > 0) {
    parts.push(`⊙${formatTokenCount(usage.cacheReadTokens + usage.cacheCreationTokens)}`);
  }
  return parts.join(" ");
}

export function formatRoleModelLabel(role: string, modelId?: string): string {
  const roleLabels: Record<string, string> = {
    planner: "规划",
    architect: "架构",
    coder: "编码",
    reviewer: "审查",
    tester: "测试",
    thinking: "思考",
  };
  const base = roleLabels[role] ?? role;
  if (!modelId?.trim()) {
    return base;
  }
  const shortModel = shortenModelId(modelId.trim());
  return `${base} · ${shortModel}`;
}

export function shortenModelId(modelId: string): string {
  const slash = modelId.lastIndexOf("/");
  if (slash >= 0) {
    return modelId.slice(slash + 1);
  }
  return modelId.length > 28 ? `${modelId.slice(0, 25)}…` : modelId;
}

function extractModelId(record: Record<string, unknown>): string | undefined {
  if (typeof record.model === "string" && record.model.trim()) {
    return record.model.trim();
  }
  if (isRecord(record.modelUsage)) {
    const keys = Object.keys(record.modelUsage);
    if (keys.length === 1) {
      return keys[0];
    }
  }
  return undefined;
}

function readTokenCount(usage: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
