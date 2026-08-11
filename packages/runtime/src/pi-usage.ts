import type { ParsedUsage } from "./usage.js";

/** Subset of `@earendil-works/pi-ai` Usage used for Eco occupancy and billing. */
export interface PiUsageLike {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
}

export function parsePiUsage(usage: unknown, modelId?: string): ParsedUsage | null {
  if (!usage || typeof usage !== "object") {
    return null;
  }
  const record = usage as PiUsageLike;
  const inputTokens = asNonNegativeInt(record.input);
  const outputTokens = asNonNegativeInt(record.output);
  const cacheReadTokens = asNonNegativeInt(record.cacheRead);
  const cacheCreationTokens = asNonNegativeInt(record.cacheWrite);
  const totalCostUsd =
    typeof record.cost?.total === "number" && Number.isFinite(record.cost.total)
      ? record.cost.total
      : undefined;

  if (
    inputTokens === 0 &&
    outputTokens === 0 &&
    cacheReadTokens === 0 &&
    cacheCreationTokens === 0 &&
    totalCostUsd === undefined
  ) {
    return null;
  }

  const trimmedModel = modelId?.trim();
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    ...(totalCostUsd !== undefined && { totalCostUsd }),
    ...(trimmedModel && { modelId: trimmedModel }),
  };
}

function asNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}
