export interface ParsedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd?: number;
  modelId?: string;
}

export interface ModelUsageEntry {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd?: number;
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
  };
}

export interface SdkModelUsageBilling {
  modelId: string;
  usage: ParsedUsage;
  sdkCostUsd?: number;
}

/** Authoritative per-model usage from SDK result `modelUsage`. */
export function parseSdkModelUsageBilling(payload: unknown): SdkModelUsageBilling[] | null {
  const modelUsage = parseModelUsage(payload);
  if (!modelUsage) {
    return null;
  }
  const entries = Object.entries(modelUsage).map(([modelId, entry]) => ({
    modelId,
    usage: {
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheReadTokens: entry.cacheReadTokens,
      cacheCreationTokens: entry.cacheCreationTokens,
    },
    ...(entry.costUsd !== undefined && { sdkCostUsd: entry.costUsd }),
  }));
  return entries.length > 0 ? entries : null;
}

export function mergeModelUsages(usages: readonly ParsedUsage[]): ParsedUsage {
  return usages.reduce(
    (total, usage) => mergeUsageTotals(total, usage),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  );
}

export function parseSdkUsageBilling(payload: unknown): {
  models: SdkModelUsageBilling[];
  contextUsage: ParsedUsage;
  totalCostUsd?: number;
  authoritative: boolean;
} | null {
  if (!isRecord(payload)) {
    return null;
  }

  const modelBillings = parseSdkModelUsageBilling(payload);
  const totalCostUsd =
    typeof payload.totalCostUsd === "number"
      ? payload.totalCostUsd
      : typeof payload.total_cost_usd === "number"
        ? payload.total_cost_usd
        : undefined;

  if (modelBillings) {
    return {
      models: modelBillings,
      contextUsage: mergeModelUsages(modelBillings.map((entry) => entry.usage)),
      ...(totalCostUsd !== undefined && { totalCostUsd }),
      authoritative: true,
    };
  }

  const usage = parseUsagePayload(payload);
  if (!usage) {
    return null;
  }

  const messageId = typeof payload.messageId === "string" ? payload.messageId : undefined;
  const modelId = usage.modelId ?? "unknown";
  return {
    models: [{ modelId, usage }],
    contextUsage: usage,
    ...(totalCostUsd !== undefined && { totalCostUsd }),
    authoritative: !messageId,
  };
}

export function parseModelUsage(payload: unknown): Record<string, ModelUsageEntry> | null {
  if (!isRecord(payload)) {
    return null;
  }
  const raw = payload.modelUsage;
  if (!isRecord(raw)) {
    return null;
  }

  const result: Record<string, ModelUsageEntry> = {};
  for (const [modelName, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) {
      continue;
    }
    const costUsd =
      typeof entry.costUSD === "number"
        ? entry.costUSD
        : typeof entry.cost_usd === "number"
          ? entry.cost_usd
          : undefined;
    result[modelName] = {
      inputTokens: readTokenCount(entry, ["inputTokens", "input_tokens"]),
      outputTokens: readTokenCount(entry, ["outputTokens", "output_tokens"]),
      cacheReadTokens: readTokenCount(entry, [
        "cacheReadInputTokens",
        "cache_read_input_tokens",
        "cache_read_tokens",
      ]),
      cacheCreationTokens: readTokenCount(entry, [
        "cacheCreationInputTokens",
        "cache_creation_input_tokens",
        "cache_creation_tokens",
      ]),
      ...(costUsd !== undefined && { costUsd }),
    };
  }

  return Object.keys(result).length > 0 ? result : null;
}

export function accumulateThreadCost(current: number, delta?: number): number {
  if (delta === undefined || !Number.isFinite(delta)) {
    return current;
  }
  return current + delta;
}

export function formatCostUsd(value: number): string {
  return `$${value.toFixed(4)}`;
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

/** Activity / billing badge: ↑ input, ↓ output, ⊙ cache (read + write tokens). */
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
