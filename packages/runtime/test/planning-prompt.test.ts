import { expect, test } from "bun:test";
import {
  buildAutonomousOrchestratorAppend,
  buildAutonomousPlanContinuationPrompt,
} from "../src/prompts/autonomous.js";
import { buildPlanningPhaseSystemAppend } from "../src/prompts/eco-plan-adapter.js";
import {
  buildPlanningContinuationPrompt,
  buildPlanningPhasePrompt,
  planningPhaseSystemAppend,
} from "../src/prompts/planning.js";
import { formatMandatoryEcoSubagentRule } from "../src/prompts/subagent-pipeline.js";
import { ecoSubagentKeyForRole } from "../src/subagent-availability.js";

test("planning system append keeps only Eco boundaries for native Plan Mode", () => {
  const append = buildPlanningPhaseSystemAppend();
  expect(append).toContain("Claude Code's native Plan Mode workflow");
  expect(append).toContain("Eco captures `ExitPlanMode`");
  expect(append).toContain("AskUserQuestion");
  expect(append).toContain("ExitPlanMode");
  expect(append).not.toContain("PHASE 1");
  expect(append).not.toContain("Finalization rule");
  expect(append).not.toMatch(/request_user_input/);
  expect(append).not.toContain("## Implementation Plan");
  expect(append).toContain(`Agent(${ecoSubagentKeyForRole("explore")})`);
  expect(append).toContain("WebSearch");
  expect(append).toContain("complete replacement");
  expect(append).not.toContain("mcp__eco_plan__finalize_plan");
  // New: AskUserQuestion strengthening
  expect(append).toContain("Explore first, ask second");
  expect(append).toContain("Two kinds of unknowns");
  expect(append).toContain("Asking questions");
  expect(append).toContain("materially change the plan");
  expect(append).toContain("Bias toward questions over guessing");
  expect(append).toContain("Plan quality");
  expect(append).toContain("Good steps are verifiable");
});

test("planningPhaseSystemAppend does not include legacy template text", () => {
  expect(planningPhaseSystemAppend).toContain("Eco Plan Mode integration");
  expect(planningPhaseSystemAppend).not.toContain("Finalization rule");
  expect(planningPhaseSystemAppend).not.toContain("PHASE 1");
  expect(planningPhaseSystemAppend).not.toContain("adq_account");
});

test("buildPlanningPhasePrompt preserves native Plan Mode with Eco boundaries", () => {
  const prompt = buildPlanningPhasePrompt("Add caching to the API layer");
  expect(prompt).toContain("native Plan Mode");
  expect(prompt).toContain("Explore the repository as needed");
  expect(prompt).toContain("WebSearch");
  expect(prompt).toContain("WebFetch");
  expect(prompt).toContain("AskUserQuestion");
  expect(prompt).toContain("ExitPlanMode");
  expect(prompt).toContain("`plan` field");
  expect(prompt).toContain("only `allowedPrompts`");
  expect(prompt).toContain("Do not use Write/Edit/MultiEdit");
  expect(prompt).not.toContain("turn 1");
  expect(prompt).not.toContain("mcp__eco_plan__finalize_plan");
  // New: proactive questioning + explore-first
  expect(prompt).toContain("high-impact ambiguity");
  expect(prompt).toContain("Ask after exploring, not before");
  expect(prompt).toContain("materially change the plan");
  expect(prompt).toContain("informed decision");
  expect(prompt).toContain("success criteria");
});

test("buildPlanningContinuationPrompt requires full replacement plan", () => {
  const prompt = buildPlanningContinuationPrompt("把提示语改成可配置字段");
  expect(prompt).toContain("same Plan Mode session");
  expect(prompt).toContain("complete replacement");
  expect(prompt).toContain("ExitPlanMode");
  expect(prompt).toContain("complete replacement Markdown plan in the `plan` field");
  expect(prompt).toContain("only `allowedPrompts`");
  expect(prompt).not.toContain("not turn 1");
  expect(prompt).not.toContain("turn 1");
  // New: follow-up ambiguity handling
  expect(prompt).toContain("new ambiguity");
  expect(prompt).toContain("explore first");
});

test("orchestrator prompts require eco subagent keys when delegating", () => {
  const rule = formatMandatoryEcoSubagentRule();
  expect(rule).toContain("Mandatory subagent policy");
  expect(rule).toContain("eco_*");
  expect(rule).toContain("Agent(general-purpose)");
  expect(rule).toContain("Do not use other SDK built-in agents");

  const planning = buildPlanningPhaseSystemAppend();
  expect(planning).toContain(formatMandatoryEcoSubagentRule({ allowPlanAgent: true }));
  expect(planning).toContain(`Agent(${ecoSubagentKeyForRole("explore")})`);
  expect(planning).toContain("Agent(general-purpose)");
  expect(planning).toContain("Agent(Plan)");
  expect(planning).toContain("Plan Mode exception");
  expect(planning).toContain("complete Markdown plan in the `plan` field");
  expect(planning).toContain("only `allowedPrompts`");
  expect(planning).not.toContain("Agent(Explore)");

  const autonomous = buildAutonomousOrchestratorAppend();
  expect(autonomous).toContain(ecoSubagentKeyForRole("coder"));
  expect(autonomous).toContain(formatMandatoryEcoSubagentRule());
  expect(autonomous).toContain("Do not declare the task complete");
  expect(autonomous).not.toContain("Plan Mode exception");
  expect(autonomous).not.toContain("explore → coder");
});

test("autonomous orchestrator asks questions without planning approval", () => {
  const autonomous = buildAutonomousOrchestratorAppend();
  expect(autonomous).toContain("Clarify vs plan");
  expect(autonomous).toContain("AskUserQuestion");
  expect(autonomous).toContain("ExitPlanMode");
  expect(autonomous).toContain("finalize_plan");
  expect(autonomous).toContain("Do not call ExitPlanMode or finalize_plan");
  expect(autonomous).not.toContain("call finalize_plan when the user should approve before large changes");
});

test("autonomous plan continuation references approved plan unless edited", () => {
  const prompt = buildAutonomousPlanContinuationPrompt({
    userPrompt: "Build feature",
    analysis: "Need backend changes",
    plan: "Long approved plan",
    followUp: "开始执行",
  });
  expect(prompt).toContain("approved plan already submitted");
  expect(prompt).not.toContain("Long approved plan");
  expect(prompt).toContain("Latest user message:");

  const edited = buildAutonomousPlanContinuationPrompt({
    userPrompt: "Build feature",
    analysis: "Need backend changes",
    plan: "Edited approved plan",
    planUserEdited: true,
  });
  expect(edited).toContain("Edited approved plan");
  expect(edited).toContain("user edited the plan");
});
