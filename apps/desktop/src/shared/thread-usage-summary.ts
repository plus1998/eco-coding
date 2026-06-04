import { DEFAULT_CONTEXT_LIMIT, occupancyPercent } from "@eco/runtime";
import type {
  AgentRole,
  ThreadBillingSnapshot,
  ThreadContextSnapshot,
  ThreadRoleContextSnapshot,
  ThreadStatus,
  ThreadUsageSnapshot,
} from "./ipc";
import { pickDisplayContextTokens } from "./thread-continuation";

const ROLE_ORDER: readonly AgentRole[] = ["planner", "explore", "architect", "coder", "reviewer", "tester"];

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

/** Build a minimal context card from planner usage when getContextUsage breakdown is not cached yet. */
export function buildFallbackContextSnapshot(options: {
  context?: ThreadContextSnapshot;
  contextTokens?: number;
  plannerUsage?: ThreadUsageSnapshot;
  usageByRole?: Record<string, ThreadUsageSnapshot>;
}): ThreadContextSnapshot | undefined {
  if (options.context) {
    return options.context;
  }

  const roles = buildFallbackRoleSnapshots(options.usageByRole, options.plannerUsage);
  const displayRole = roles.find((role) => role.role === "planner")?.role ?? roles[0]?.role;
  const active = roles.find((role) => role.role === displayRole);
  const occupied = active?.occupied ?? options.contextTokens ?? options.plannerUsage?.contextTokens ?? 0;
  if (occupied <= 0) {
    return undefined;
  }

  const limit = active?.limit ?? options.plannerUsage?.contextLimit ?? DEFAULT_CONTEXT_LIMIT;
  const occupancyPct =
    active?.occupancyPct ?? options.plannerUsage?.occupancyPct ?? occupancyPercent(occupied, limit);
  const limitsResolved = active?.limitsResolved ?? options.plannerUsage?.contextLimit !== undefined;
  const segments = active?.segments ?? fallbackSegments(occupied);

  return {
    occupied,
    limit,
    occupancyPct,
    limitsResolved,
    ...(displayRole && { displayRole }),
    segments,
    ...(roles.length > 0 && { roles }),
    updatedAt: Date.now(),
  };
}

export function buildThreadUsageSummary(input: ThreadUsageSummaryInput): ThreadUsageSummaryOutput {
  const contextTokens = input.usageByRole ? pickDisplayContextTokens(input.usageByRole) : 0;
  const plannerUsage = input.usageByRole?.planner;
  const context = buildFallbackContextSnapshot({
    ...(input.context && { context: input.context }),
    ...(contextTokens > 0 && { contextTokens }),
    ...(plannerUsage && { plannerUsage }),
    ...(input.usageByRole && { usageByRole: input.usageByRole }),
  });

  return {
    ...(input.billing && { billing: input.billing }),
    ...(context && { context }),
    ...(contextTokens > 0 && { contextTokens }),
  };
}

function buildFallbackRoleSnapshots(
  usageByRole: Record<string, ThreadUsageSnapshot> | undefined,
  plannerUsage: ThreadUsageSnapshot | undefined,
): ThreadRoleContextSnapshot[] {
  const snapshots: ThreadRoleContextSnapshot[] = [];
  const source = usageByRole ?? (plannerUsage ? { planner: plannerUsage } : undefined);
  if (!source) {
    return snapshots;
  }

  for (const role of ROLE_ORDER) {
    const usage = source[role];
    if (!usage || usage.contextTokens <= 0) {
      continue;
    }
    const limit = usage.contextLimit ?? DEFAULT_CONTEXT_LIMIT;
    snapshots.push({
      role,
      occupied: usage.contextTokens,
      limit,
      occupancyPct: usage.occupancyPct ?? occupancyPercent(usage.contextTokens, limit),
      limitsResolved: usage.contextLimit !== undefined,
      ...(usage.modelId && { modelId: usage.modelId }),
      segments: fallbackSegments(usage.contextTokens),
    });
  }
  return snapshots;
}

function fallbackSegments(tokens: number): ThreadRoleContextSnapshot["segments"] {
  return [
    {
      key: "conversation",
      label: "会话",
      tokens,
      color: "#ea580c",
    },
  ];
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
    return "用量随每轮模型响应更新";
  }
  if (status === "awaiting_plan") {
    return "计划阶段用量将随模型响应更新";
  }
  if (status === "completed" || status === "idle" || status === "failed" || status === "blocked") {
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
