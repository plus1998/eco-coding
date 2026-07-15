export interface RequestCacheUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface CacheHitDropDetection {
  previousRatio: number;
  currentRatio: number;
  dropPoints: number;
  currentPromptTokens: number;
  previousCacheReadTokens: number;
  cacheReadLossTokens: number;
  cacheReadLossShare: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export const DEFAULT_MIN_BILLED_PROMPT_TOKENS = 8_000;
export const DEFAULT_MIN_PREVIOUS_CACHE_HIT_RATIO = 0.35;
export const DEFAULT_MIN_CACHE_HIT_DROP_POINTS = 0.25;
export const DEFAULT_MIN_CACHE_READ_LOSS_SHARE = 0.15;

export function computePromptCacheHitRatio(usage: RequestCacheUsage): number | null {
  const inputTokens = Math.max(0, usage.inputTokens);
  const cacheReadTokens = Math.max(0, usage.cacheReadTokens);
  const billedPromptTokens = inputTokens + cacheReadTokens + Math.max(0, usage.cacheCreationTokens);
  if (billedPromptTokens < DEFAULT_MIN_BILLED_PROMPT_TOKENS) {
    return null;
  }
  return cacheReadTokens / billedPromptTokens;
}

export function detectPromptCacheHitDrop(
  previous: RequestCacheUsage | undefined,
  current: RequestCacheUsage,
  options?: {
    minPreviousRatio?: number;
    minDropPoints?: number;
    minBilledPromptTokens?: number;
    minCacheReadLossShare?: number;
  },
): CacheHitDropDetection | null {
  const minPreviousRatio = options?.minPreviousRatio ?? DEFAULT_MIN_PREVIOUS_CACHE_HIT_RATIO;
  const minDropPoints = options?.minDropPoints ?? DEFAULT_MIN_CACHE_HIT_DROP_POINTS;
  const minBilledPromptTokens = options?.minBilledPromptTokens ?? DEFAULT_MIN_BILLED_PROMPT_TOKENS;
  const minCacheReadLossShare = options?.minCacheReadLossShare ?? DEFAULT_MIN_CACHE_READ_LOSS_SHARE;

  const currentRatio = computePromptCacheHitRatioWithThreshold(current, minBilledPromptTokens);
  if (currentRatio === null || !previous) {
    return null;
  }
  const previousRatio = computePromptCacheHitRatioWithThreshold(previous, minBilledPromptTokens);
  if (previousRatio === null) {
    return null;
  }
  if (previousRatio < minPreviousRatio) {
    return null;
  }
  const dropPoints = previousRatio - currentRatio;
  if (dropPoints < minDropPoints) {
    return null;
  }
  const previousCacheReadTokens = Math.max(0, previous.cacheReadTokens);
  const cacheReadTokens = Math.max(0, current.cacheReadTokens);
  const cacheReadLossTokens = Math.max(0, previousCacheReadTokens - cacheReadTokens);
  const currentPromptTokens = computeBilledPromptTokens(current);
  const cacheReadLossShare =
    currentPromptTokens > 0 ? Math.min(1, cacheReadLossTokens / currentPromptTokens) : 0;
  if (cacheReadLossShare < minCacheReadLossShare) {
    return null;
  }
  return {
    previousRatio,
    currentRatio,
    dropPoints,
    currentPromptTokens,
    previousCacheReadTokens,
    cacheReadLossTokens,
    cacheReadLossShare,
    inputTokens: Math.max(0, current.inputTokens),
    cacheReadTokens,
    cacheCreationTokens: Math.max(0, current.cacheCreationTokens),
  };
}

export function formatPromptCacheHitDropMessage(detection: CacheHitDropDetection): string {
  const previousPct = Math.round(detection.previousRatio * 100);
  const currentPct = Math.round(detection.currentRatio * 100);
  const dropPp = Math.round(detection.dropPoints * 100);
  const lossSharePct = Math.round(detection.cacheReadLossShare * 100);
  return `Prompt cache 命中率从 ${previousPct}% 降至 ${currentPct}%（↓${dropPp}pp），且 cache_read 较上轮减少 ${detection.cacheReadLossTokens.toLocaleString("en-US")}（占本轮 Prompt 输入 ${lossSharePct}%），可能由 cache break 引起。本轮 cache_read ${detection.cacheReadTokens.toLocaleString("en-US")} / Prompt 输入 ${detection.currentPromptTokens.toLocaleString("en-US")}`;
}

export class ThreadCacheHitMonitor {
  private readonly lastPlannerUsageByThread = new Map<string, RequestCacheUsage>();

  clearThread(threadId: string): void {
    this.lastPlannerUsageByThread.delete(threadId);
  }

  observePlannerUsage(threadId: string, usage: RequestCacheUsage): CacheHitDropDetection | null {
    const normalized: RequestCacheUsage = {
      inputTokens: Math.max(0, usage.inputTokens),
      cacheReadTokens: Math.max(0, usage.cacheReadTokens),
      cacheCreationTokens: Math.max(0, usage.cacheCreationTokens),
    };
    const detection = detectPromptCacheHitDrop(this.lastPlannerUsageByThread.get(threadId), normalized);
    this.lastPlannerUsageByThread.set(threadId, normalized);
    return detection;
  }
}

function computePromptCacheHitRatioWithThreshold(
  usage: RequestCacheUsage,
  minBilledPromptTokens: number,
): number | null {
  const inputTokens = Math.max(0, usage.inputTokens);
  const cacheReadTokens = Math.max(0, usage.cacheReadTokens);
  const billedPromptTokens = inputTokens + cacheReadTokens + Math.max(0, usage.cacheCreationTokens);
  if (billedPromptTokens < minBilledPromptTokens) {
    return null;
  }
  return cacheReadTokens / billedPromptTokens;
}

function computeBilledPromptTokens(usage: RequestCacheUsage): number {
  return (
    Math.max(0, usage.inputTokens) +
    Math.max(0, usage.cacheReadTokens) +
    Math.max(0, usage.cacheCreationTokens)
  );
}
