import { expect, test } from "bun:test";
import { buildPlanningPhaseSystemAppend } from "../src/prompts/eco-plan-adapter.js";
import { CODEX_PLAN_MODE_TEMPLATE } from "../src/prompts/codex-plan-template.js";
import {
  buildPlanningContinuationPrompt,
  buildPlanningPhasePrompt,
  planningPhaseSystemAppend,
} from "../src/prompts/planning.js";

test("inlined Codex plan template matches upstream structure", () => {
  const template = CODEX_PLAN_MODE_TEMPLATE;
  expect(template).toContain("# Plan Mode (Conversational)");
  expect(template).toContain("PHASE 1 — Ground in the environment");
  expect(template).toContain("request_user_input");
  expect(template).toContain("Finalization rule");
  expect(template).not.toContain("proposed_plan");
  expect(template).toContain("Two kinds of unknowns");
});

test("planning system append is Codex template plus minimal Eco adapter", () => {
  const append = buildPlanningPhaseSystemAppend();
  expect(append).toContain("PHASE 1 — Ground in the environment");
  expect(append).toContain("AskUserQuestion");
  expect(append).toContain("mcp__eco_plan__finalize_plan");
  expect(append).not.toMatch(/`request_user_input`/);
  expect(append).not.toContain("## Implementation Plan");
  expect(append).toContain("Agent(explore)");
  expect(append).toContain("Eco Plan Mode workflow");
  expect(append).toContain("Explore first");
  expect(append).toContain("Clarify when needed");
  expect(append).not.toContain("MUST NOT call `mcp__eco_plan__finalize_plan`");
  expect(append).toContain("complete replacement");
});

test("planningPhaseSystemAppend is built from inlined Codex template", () => {
  expect(planningPhaseSystemAppend).toContain("Finalization rule");
  expect(planningPhaseSystemAppend).not.toContain("adq_account");
});

test("buildPlanningPhasePrompt enforces explore-before-finalize sequential workflow", () => {
  const prompt = buildPlanningPhasePrompt("Add caching to the API layer");
  expect(prompt).toContain("explore before finalize");
  expect(prompt).toContain("Explore the worktree first");
  expect(prompt).toContain("material ambiguity");
  expect(prompt).toContain("AskUserQuestion");
  expect(prompt).toContain("mcp__eco_plan__finalize_plan");
  expect(prompt).toContain("one assistant turn");
  expect(prompt).not.toContain("turn 1");
  expect(prompt).not.toContain("Do NOT call `mcp__eco_plan__finalize_plan`");
});

test("buildPlanningContinuationPrompt requires full replacement plan", () => {
  const prompt = buildPlanningContinuationPrompt("把提示语改成可配置字段");
  expect(prompt).toContain("same Plan Mode session");
  expect(prompt).toContain("complete replacement");
  expect(prompt).toContain("mcp__eco_plan__finalize_plan");
  expect(prompt).not.toContain("not turn 1");
  expect(prompt).not.toContain("turn 1");
});
