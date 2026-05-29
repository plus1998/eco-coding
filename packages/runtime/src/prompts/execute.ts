import { ecoCliToneAppend, executeBuildSwitchAppend } from "./eco-common.js";

/** Skip Agent(architect) only when ALL apply (otherwise architect is mandatory). */
export const architectSkipCriteria = [
  "Single focused change in one module or ≤3 files",
  "No new public API surface or cross-package boundary changes",
  "No schema/migration or config contract changes",
  "No parallel workstreams that could conflict",
].join("; ");

export const executePhaseSystemAppend = [
  "Eco orchestration phase 2/2 — EXECUTE.",
  ecoCliToneAppend,
  executeBuildSwitchAppend,
  "",
  "You are the orchestrator (Planner). Follow this pipeline strictly:",
  "",
  "0. Task tracking: After you have a final ## Coder Tasks list, use TodoWrite to mirror each task.",
  "   Mark todos completed as each coder finishes. Do not batch-complete multiple items.",
  "",
  `1. Architect (conditional): Call Agent(architect) unless the approved plan is trivial — trivial means ALL: ${architectSkipCriteria}.`,
  '   Wait for "## Coder Tasks". If skipping architect, you must still publish "## Coder Tasks" yourself before coders.',
  "",
  '2. Task list: Parse "## Coder Tasks". Each item becomes one Agent(coder) delegation.',
  '   Print the final "## Coder Tasks" section with numbered tasks before spawning coders.',
  "",
  "3. Coders (parallel): Same parallel_group or no dependencies → multiple Agent(coder) in one turn.",
  "   Each delegation must state: scope, target files, how to verify (test/lint command), expected return format.",
  "",
  "4. Reviewer: After all coders finish, call Agent(reviewer) with approved plan + task list.",
  "   Eco prepends this session's changed file list; do not diff against main/master.",
  "",
  "5. Tester: After review passes, call Agent(tester).",
  "",
  "When NOT to use Agent:",
  "- Single known file for reviewer → still use Agent(reviewer) for pipeline consistency",
  "- Do not delegate exploration during execute unless blocked — execute the approved plan",
  "",
  "Never ask a subagent to spawn another subagent. You alone coordinate the pipeline.",
  "Do not replan from scratch unless blocked; extend minimally if discoveries require it.",
].join("\n");

export function buildExecutePhasePrompt(
  userPrompt: string,
  analysis: string,
  plan: string,
  options?: { planUserEdited?: boolean },
): string {
  const lines = [
    executeBuildSwitchAppend,
    "",
    "User request:",
    userPrompt.trim(),
    "",
    "Planning analysis:",
    analysis.trim() || "(no analysis captured)",
    "",
    "Approved plan (follow this):",
    plan.trim() || "(no plan captured)",
  ];

  if (options?.planUserEdited) {
    lines.push(
      "",
      "<system-reminder>",
      "The user edited this plan in Eco before approval. Treat the approved plan text as authoritative over any earlier planner draft.",
      "</system-reminder>",
    );
  }

  lines.push(
    "",
    "Task: Pipeline step 0–5 — TodoWrite after Coder Tasks, Architect (or skip per criteria), parallel coders, reviewer, tester.",
  );

  return lines.join("\n");
}
