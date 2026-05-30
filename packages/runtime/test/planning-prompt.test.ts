import { expect, test } from "bun:test";
import { buildPlanningPhaseSystemAppend } from "../src/prompts/eco-plan-adapter.js";
import { CODEX_PLAN_MODE_TEMPLATE } from "../src/prompts/codex-plan-template.js";
import { buildPlanningPhasePrompt, planningPhaseSystemAppend } from "../src/prompts/planning.js";

test("inlined Codex plan template matches upstream structure", () => {
  const template = CODEX_PLAN_MODE_TEMPLATE;
  expect(template).toContain("# Plan Mode (Conversational)");
  expect(template).toContain("PHASE 1 — Ground in the environment");
  expect(template).toContain("request_user_input");
  expect(template).toContain("<proposed_plan>");
  expect(template).toContain("Two kinds of unknowns");
});

test("planning system append is Codex template plus minimal Eco adapter", () => {
  const append = buildPlanningPhaseSystemAppend();
  expect(append).toContain("PHASE 1 — Ground in the environment");
  expect(append).toContain("AskUserQuestion");
  expect(append).not.toMatch(/`request_user_input`/);
  expect(append).toContain("## Implementation Plan");
  expect(append).toContain("Agent(explore)");
  expect(append).toContain("Eco Plan Mode turn order");
  expect(append).toContain("MUST NOT include `## Implementation Plan`");
});

test("planningPhaseSystemAppend is built from inlined Codex template", () => {
  expect(planningPhaseSystemAppend).toContain("Finalization rule");
  expect(planningPhaseSystemAppend).not.toContain("adq_account");
});

test("buildPlanningPhasePrompt enforces explore and ask on turn 1", () => {
  const prompt = buildPlanningPhasePrompt("Add caching to the API layer");
  expect(prompt).toContain("turn 1");
  expect(prompt).toContain("AskUserQuestion");
  expect(prompt).toContain("Do NOT output ## Implementation Plan");
  expect(prompt).not.toContain("when decision-complete");
});
