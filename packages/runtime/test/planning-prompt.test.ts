import { expect, test } from "bun:test";
import {
  buildAutonomousOrchestratorAppend,
  buildAutonomousPlanContinuationPrompt,
} from "../src/prompts/autonomous.js";
import { CODEX_PLAN_MODE_TEMPLATE } from "../src/prompts/codex-plan-template.js";
import { buildPlanningPhaseSystemAppend } from "../src/prompts/eco-plan-adapter.js";
import {
  buildPlanningContinuationPrompt,
  buildPlanningPhasePrompt,
  planningPhaseSystemAppend,
} from "../src/prompts/planning.js";
import { formatMandatoryEcoSubagentRule } from "../src/prompts/subagent-pipeline.js";
import { ecoSubagentKeyForRole } from "../src/subagent-availability.js";

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
  expect(append).toContain("ExitPlanMode");
  expect(append).not.toMatch(/`request_user_input`/);
  expect(append).not.toContain("## Implementation Plan");
  expect(append).toContain(`Agent(${ecoSubagentKeyForRole("explore")})`);
  expect(append).toContain("Eco Plan Mode pipeline");
  expect(append).toContain("Explore first");
  expect(append).toContain("WebSearch");
  expect(append).toContain("Clarify when needed");
  expect(append).toContain("Context Digest");
  expect(append).toContain("Architecture Decision");
  expect(append).toContain("Architect is a targeted reviewer");
  expect(append).not.toContain("mcp__eco_plan__finalize_plan");
  expect(append).toContain("complete replacement");
});

test("planningPhaseSystemAppend is built from inlined Codex template", () => {
  expect(planningPhaseSystemAppend).toContain("Finalization rule");
  expect(planningPhaseSystemAppend).not.toContain("adq_account");
});

test("buildPlanningPhasePrompt enforces explore-before-ExitPlanMode sequential workflow", () => {
  const prompt = buildPlanningPhasePrompt("Add caching to the API layer");
  expect(prompt).toContain("explore before ExitPlanMode");
  expect(prompt).toContain("Explore the repository first");
  expect(prompt).toContain("WebSearch");
  expect(prompt).toContain("WebFetch");
  expect(prompt).toContain("material ambiguity");
  expect(prompt).toContain("AskUserQuestion");
  expect(prompt).toContain("ExitPlanMode");
  expect(prompt).toContain("one assistant turn");
  expect(prompt).not.toContain("turn 1");
  expect(prompt).not.toContain("mcp__eco_plan__finalize_plan");
});

test("buildPlanningContinuationPrompt requires full replacement plan", () => {
  const prompt = buildPlanningContinuationPrompt("把提示语改成可配置字段");
  expect(prompt).toContain("same Plan Mode session");
  expect(prompt).toContain("complete replacement");
  expect(prompt).toContain("ExitPlanMode");
  expect(prompt).not.toContain("not turn 1");
  expect(prompt).not.toContain("turn 1");
});

test("orchestrator prompts require eco subagent keys when delegating", () => {
  const rule = formatMandatoryEcoSubagentRule();
  expect(rule).toContain("Mandatory subagent policy");
  expect(rule).toContain("eco_*");
  expect(rule).toContain("Agent(general-purpose)");
  expect(rule).toContain("Do not use other SDK built-in agents");

  const planning = buildPlanningPhaseSystemAppend();
  expect(planning).toContain(formatMandatoryEcoSubagentRule());
  expect(planning).toContain(`Agent(${ecoSubagentKeyForRole("explore")})`);
  expect(planning).toContain("Agent(general-purpose)");
  expect(planning).not.toContain("Agent(Explore)");

  const autonomous = buildAutonomousOrchestratorAppend();
  expect(autonomous).toContain(ecoSubagentKeyForRole("coder"));
  expect(autonomous).toContain(formatMandatoryEcoSubagentRule());
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
