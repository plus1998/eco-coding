import { expect, test } from "bun:test";
import {
  DEFAULT_ORCHESTRATION_GUARDRAILS,
  resolveOrchestrationGuardrails,
} from "../src/main/orchestration-run-budget";

test("orchestration guardrails default to five concurrent subagents and thirty minutes each", () => {
  expect(DEFAULT_ORCHESTRATION_GUARDRAILS).toEqual({
    maxConcurrentSubagents: 5,
    maxSubagentRuntimeMs: 30 * 60 * 1_000,
  });
});

test("resolveOrchestrationGuardrails accepts positive environment overrides", () => {
  expect(
    resolveOrchestrationGuardrails({
      ECO_ORCHESTRATION_MAX_CONCURRENT_SUBAGENTS: "3",
      ECO_SUBAGENT_MAX_RUNTIME_MINUTES: "12",
    }),
  ).toEqual({
    maxConcurrentSubagents: 3,
    maxSubagentRuntimeMs: 12 * 60 * 1_000,
  });
});

test("legacy token, cost, total-agent and orchestration duration limits are ignored", () => {
  expect(
    resolveOrchestrationGuardrails({
      ECO_ORCHESTRATION_MAX_SUBAGENTS: "1",
      ECO_ORCHESTRATION_MAX_WALL_MINUTES: "1",
      ECO_ORCHESTRATION_MAX_TOKENS: "1",
      ECO_ORCHESTRATION_MAX_COST_USD: "0.01",
    }),
  ).toEqual(DEFAULT_ORCHESTRATION_GUARDRAILS);
});
