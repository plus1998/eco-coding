import { DEFAULT_CONTEXT_LIMIT, occupancyPercent } from "@eco/runtime";
import type {
  ThreadBillingSnapshot,
  ThreadContextSnapshot,
  ThreadStatus,
  ThreadUsageSnapshot,
} from "./ipc";
import { pickDisplayContextTokens } from "./thread-continuation";

export interface ThreadUsageSummaryInput {
  billing?: ThreadBillingSnapshot;
  context?: ThreadContextSnapshot;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
}

export interface ThreadUsageSummaryOutput {
  billing?: ThreadBillingSnapshot;
  context?: ThreadContextSnapshot;
  contextTokens?: number;
}

/** Build a minimal context card from planner usage when /context breakdown is not cached yet. */
export function buildFallbackContextSnapshot(options: {
  context?: ThreadContextSnapshot;
  contextTokens?: number;
  plannerUsage?: ThreadUsageSnapshot;
}): ThreadContextSnapshot | undefined {
  if (options.context) {
    return options.context;
  }

  const occupied = options.contextTokens ?? options.plannerUsage?.contextTokens ?? 0;
  if (occupied <= 0) {
    return undefined;
  }

  const limit = options.plannerUsage?.contextLimit ?? DEFAULT_CONTEXT_LIMIT;
  const occupancyPct =
    options.plannerUsage?.occupancyPct ?? occupancyPercent(occupied, limit);

  return {
    occupied,
    limit,
    occupancyPct,
    limitsResolved: options.plannerUsage?.contextLimit !== undefined,
    segments: [
      {
        key: "conversation",
        label: "会话占用",
        tokens: occupied,
        color: "#ea580c",
      },
    ],
    updatedAt: Date.now(),
  };
}

export function buildThreadUsageSummary(
  input: ThreadUsageSummaryInput,
): ThreadUsageSummaryOutput {
  const contextTokens = input.usageByRole ? pickDisplayContextTokens(input.usageByRole) : 0;
  const plannerUsage = input.usageByRole?.planner;
  const context = buildFallbackContextSnapshot({
    context: input.context,
    contextTokens,
    plannerUsage,
  });

  return {
    ...(input.billing && { billing: input.billing }),
    ...(context && { context }),
    ...(contextTokens > 0 && { contextTokens }),
  };
}

const USAGE_PANEL_STATUSES = new Set<ThreadStatus>([
  "running",
  "queued",
  "awaiting_plan",
  "completed",
  "idle",
  "failed",
  "blocked",
]);

export function shouldShowThreadUsagePanels(status?: ThreadStatus): boolean {
  return status !== undefined && USAGE_PANEL_STATUSES.has(status);
}

export function contextCardPlaceholder(status?: ThreadStatus): string {
  if (status === "running" || status === "queued") {
    return "上下文统计中…";
  }
  if (status === "awaiting_plan") {
    return "正在同步上下文窗口…";
  }
  if (
    status === "completed" ||
    status === "idle" ||
    status === "failed" ||
    status === "blocked"
  ) {
    return "暂无上下文数据";
  }
  return "上下文 — 有模型请求后显示";
}

export function billingEmptyHint(status?: ThreadStatus): string {
  if (status === "running" || status === "queued") {
    return "费用累计中…";
  }
  if (status === "awaiting_plan") {
    return "计划阶段已产生的 token 与费用将显示在此处。";
  }
  if (shouldShowThreadUsagePanels(status)) {
    return "暂无累计 token 或费用记录。";
  }
  return "费用 — 有模型请求后显示";
}
