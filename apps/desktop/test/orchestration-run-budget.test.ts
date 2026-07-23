import { expect, test } from "bun:test";
import {
  OrchestrationRunBudgetGuard,
  resolveOrchestrationRunBudget,
  type OrchestrationRunBudgetExceeded,
} from "../src/main/orchestration-run-budget";

const limits = {
  maxSubagents: 2,
  maxWallClockMs: 60_000,
  maxObservedTokens: 100,
  maxCostUsd: 2,
};

test("OrchestrationRunBudgetGuard aborts after too many distinct subagents", () => {
  const exceeded: OrchestrationRunBudgetExceeded[] = [];
  const guard = new OrchestrationRunBudgetGuard(limits, (event) => exceeded.push(event));
  guard.start("thr_budget");
  guard.observeSubagent("thr_budget", "agent_a");
  guard.observeSubagent("thr_budget", "agent_a");
  guard.observeSubagent("thr_budget", "agent_b");
  guard.observeSubagent("thr_budget", "agent_c");

  expect(exceeded).toHaveLength(1);
  expect(exceeded[0]).toMatchObject({ kind: "subagents", observed: 3, limit: 2 });
  guard.finish("thr_budget");
});

test("OrchestrationRunBudgetGuard deduplicates usage before enforcing tokens", () => {
  const exceeded: OrchestrationRunBudgetExceeded[] = [];
  const guard = new OrchestrationRunBudgetGuard(limits, (event) => exceeded.push(event));
  const usage = {
    inputTokens: 30,
    outputTokens: 10,
    cacheReadTokens: 20,
    cacheCreationTokens: 0,
  };
  guard.start("thr_budget");
  guard.observeUsage("thr_budget", "request_a", usage);
  guard.observeUsage("thr_budget", "request_a", usage);
  expect(exceeded).toHaveLength(0);
  guard.observeUsage("thr_budget", "request_b", usage);

  expect(exceeded[0]).toMatchObject({ kind: "tokens", observed: 120, limit: 100 });
  guard.finish("thr_budget");
});

test("OrchestrationRunBudgetGuard enforces the highest observed run cost", () => {
  const exceeded: OrchestrationRunBudgetExceeded[] = [];
  const guard = new OrchestrationRunBudgetGuard(limits, (event) => exceeded.push(event));
  guard.start("thr_budget");
  guard.observeCost("thr_budget", 1.5);
  guard.observeCost("thr_budget", 1.25);
  expect(exceeded).toHaveLength(0);
  guard.observeCost("thr_budget", 2.01);
  guard.observeCost("thr_budget", 3);

  expect(exceeded).toHaveLength(1);
  expect(exceeded[0]).toMatchObject({ kind: "cost", observed: 2.01, limit: 2 });
  guard.finish("thr_budget");
});

test("resolveOrchestrationRunBudget accepts positive environment overrides", () => {
  expect(
    resolveOrchestrationRunBudget({
      ECO_ORCHESTRATION_MAX_SUBAGENTS: "4",
      ECO_ORCHESTRATION_MAX_WALL_MINUTES: "5",
      ECO_ORCHESTRATION_MAX_TOKENS: "600",
      ECO_ORCHESTRATION_MAX_COST_USD: "7.5",
    }),
  ).toEqual({
    maxSubagents: 4,
    maxWallClockMs: 300_000,
    maxObservedTokens: 600,
    maxCostUsd: 7.5,
  });
});
