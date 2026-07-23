import type { ParsedUsage } from "@eco/runtime/usage";

export interface OrchestrationRunBudgetLimits {
  maxSubagents: number;
  maxWallClockMs: number;
  maxObservedTokens: number;
  maxCostUsd: number;
}

export type OrchestrationRunBudgetExceeded = {
  threadId: string;
  kind: "subagents" | "wall_clock" | "tokens" | "cost";
  message: string;
  observed: number;
  limit: number;
};

export const DEFAULT_ORCHESTRATION_RUN_BUDGET: OrchestrationRunBudgetLimits = {
  maxSubagents: 16,
  maxWallClockMs: 90 * 60 * 1_000,
  maxObservedTokens: 50_000_000,
  maxCostUsd: 25,
};

type RunState = {
  agentIds: Set<string>;
  usageKeys: Set<string>;
  observedTokens: number;
  observedCostUsd: number;
  timer: ReturnType<typeof setTimeout>;
  exceeded?: OrchestrationRunBudgetExceeded;
};

export function resolveOrchestrationRunBudget(
  env: Record<string, string | undefined> = process.env,
): OrchestrationRunBudgetLimits {
  return {
    maxSubagents: positiveNumber(env.ECO_ORCHESTRATION_MAX_SUBAGENTS, 16),
    maxWallClockMs: positiveNumber(env.ECO_ORCHESTRATION_MAX_WALL_MINUTES, 90) * 60 * 1_000,
    maxObservedTokens: positiveNumber(env.ECO_ORCHESTRATION_MAX_TOKENS, 50_000_000),
    maxCostUsd: positiveNumber(env.ECO_ORCHESTRATION_MAX_COST_USD, 25),
  };
}

export class OrchestrationRunBudgetGuard {
  private readonly runs = new Map<string, RunState>();

  constructor(
    private readonly limits: OrchestrationRunBudgetLimits,
    private readonly onExceeded: (event: OrchestrationRunBudgetExceeded) => void,
  ) {}

  start(threadId: string): void {
    this.finish(threadId);
    const timer = setTimeout(() => {
      this.exceed(threadId, {
        kind: "wall_clock",
        observed: this.limits.maxWallClockMs,
        limit: this.limits.maxWallClockMs,
        message: `编排运行达到 ${Math.round(this.limits.maxWallClockMs / 60_000)} 分钟上限。`,
      });
    }, this.limits.maxWallClockMs);
    timer.unref?.();
    this.runs.set(threadId, {
      agentIds: new Set(),
      usageKeys: new Set(),
      observedTokens: 0,
      observedCostUsd: 0,
      timer,
    });
  }

  finish(threadId: string): void {
    const state = this.runs.get(threadId);
    if (state) clearTimeout(state.timer);
    this.runs.delete(threadId);
  }

  observeSubagent(threadId: string, agentId: string): void {
    const state = this.runs.get(threadId);
    const normalized = agentId.trim();
    if (!state || state.exceeded || !normalized || state.agentIds.has(normalized)) return;
    state.agentIds.add(normalized);
    if (state.agentIds.size > this.limits.maxSubagents) {
      this.exceed(threadId, {
        kind: "subagents",
        observed: state.agentIds.size,
        limit: this.limits.maxSubagents,
        message: `子代理总数达到硬上限（${state.agentIds.size}/${this.limits.maxSubagents}）。`,
      });
    }
  }

  observeUsage(threadId: string, key: string, usage: ParsedUsage): void {
    const state = this.runs.get(threadId);
    if (!state || state.exceeded || state.usageKeys.has(key)) return;
    state.usageKeys.add(key);
    state.observedTokens +=
      usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
    if (state.observedTokens > this.limits.maxObservedTokens) {
      this.exceed(threadId, {
        kind: "tokens",
        observed: state.observedTokens,
        limit: this.limits.maxObservedTokens,
        message: `观测 token 达到硬上限（${state.observedTokens}/${this.limits.maxObservedTokens}）。`,
      });
    }
  }

  observeCost(threadId: string, totalCostUsd: number): void {
    const state = this.runs.get(threadId);
    if (!state || state.exceeded || !Number.isFinite(totalCostUsd)) return;
    state.observedCostUsd = Math.max(state.observedCostUsd, totalCostUsd);
    if (state.observedCostUsd > this.limits.maxCostUsd) {
      this.exceed(threadId, {
        kind: "cost",
        observed: state.observedCostUsd,
        limit: this.limits.maxCostUsd,
        message: `本轮费用达到硬上限（$${state.observedCostUsd.toFixed(2)}/$${this.limits.maxCostUsd.toFixed(2)}）。`,
      });
    }
  }

  exceeded(threadId: string): OrchestrationRunBudgetExceeded | undefined {
    return this.runs.get(threadId)?.exceeded;
  }

  private exceed(threadId: string, input: Omit<OrchestrationRunBudgetExceeded, "threadId">): void {
    const state = this.runs.get(threadId);
    if (!state || state.exceeded) return;
    const event = { threadId, ...input };
    state.exceeded = event;
    clearTimeout(state.timer);
    this.onExceeded(event);
  }
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
