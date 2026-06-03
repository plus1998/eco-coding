import type { SubagentAvailability, SubagentRole } from "../subagent-availability.js";
import {
  defaultSubagentAvailability,
  isSubagentEnabled,
  listEnabledSubagents,
} from "../subagent-availability.js";
import { executeCoreGoalAppend } from "./eco-common.js";
import { architectSkipCriteria } from "./execute.js";

export function formatAvailableSubagentsLine(availability: SubagentAvailability): string {
  const enabled = listEnabledSubagents(availability);
  const names = enabled.join(", ");
  return [
    `Available subagents in this session: ${names}.`,
    "Do NOT call Agent(<role>) for any role not listed above.",
  ].join("\n");
}

export function formatExecutionSubagentNames(availability: SubagentAvailability): string {
  const roles = listEnabledSubagents(availability).filter((role) => role !== "explore");
  return roles.length > 0 ? roles.join(", ") : "coder";
}

export function buildExecuteBuildSwitchAppend(availability: SubagentAvailability): string {
  const delegates = formatExecutionSubagentNames(availability);
  return [
    "<system-reminder>",
    "The implementation plan has been approved by the user.",
    `You are now in EXECUTE phase: you may edit files, run shell commands, and delegate to subagents (${delegates}).`,
    "Follow the approved plan and the execution pipeline. Do not restart planning from scratch unless blocked.",
    "</system-reminder>",
  ].join("\n");
}

function buildArchitectStep(availability: SubagentAvailability, step: number): string[] {
  if (!isSubagentEnabled(availability, "architect")) {
    return [
      `${step}. Coder Tasks (mandatory): Do NOT call Agent(architect). You must publish "## Coder Tasks" yourself before spawning coders.`,
    ];
  }
  return [
    `${step}. Architect (conditional): Call Agent(architect) unless the approved plan is trivial — trivial means ALL: ${architectSkipCriteria}.`,
    '   Wait for "## Coder Tasks". If skipping architect, you must still publish "## Coder Tasks" yourself before coders.',
  ];
}

function buildReviewerStep(availability: SubagentAvailability, step: number): string[] {
  if (!isSubagentEnabled(availability, "reviewer")) {
    return [
      "",
      "Reviewer subagent is disabled — skip formal review; rely on coder verification output.",
    ];
  }
  return [
    `${step}. Reviewer: After all coders finish, call Agent(reviewer) with approved plan + task list.`,
    "   Eco prepends this session's changed file list; do not diff against main/master.",
    "   Severity policy: only fix P0/P1 issues. Do NOT spend cycles implementing P2 suggestions.",
    "   If the reviewer returns BLOCKERS (P0/P1 exist), convert ALL P0/P1 items into a single concrete fix batch and run coders once to address them.",
    "   Then re-run Agent(reviewer) exactly once (Eco auto-Resumes the same reviewer session when possible — do not restart from scratch). If there are still P0/P1 issues after the second review, STOP and summarize remaining P0/P1 for the user (do not loop).",
    "   Always summarize P2 items at the end as follow-ups; do not implement them unless the user explicitly asks.",
  ];
}

function buildTesterStep(availability: SubagentAvailability, step: number): string[] {
  if (!isSubagentEnabled(availability, "tester")) {
    return ["", "Tester subagent is disabled — skip the formal test step after review."];
  }
  return [`${step}. Tester: After review passes, call Agent(tester).`];
}

function buildWhenNotToUseAgent(availability: SubagentAvailability): string[] {
  const lines = ["When NOT to use Agent:"];
  if (isSubagentEnabled(availability, "reviewer")) {
    lines.push("- Single known file for reviewer → still use Agent(reviewer) for pipeline consistency");
  }
  lines.push("- Do not delegate exploration during execute unless blocked — execute the approved plan");
  return lines;
}

export function buildExecutePhaseSystemAppend(
  availability: SubagentAvailability = defaultSubagentAvailability(),
): string {
  let step = 0;
  const pipeline: string[] = [
    "Eco orchestration phase 2/2 — EXECUTE.",
    buildExecuteBuildSwitchAppend(availability),
    "",
    executeCoreGoalAppend,
    "",
    formatAvailableSubagentsLine(availability),
    "",
    "You are the orchestrator (Planner). Follow this pipeline strictly:",
    "",
    `${step}. Progress (mandatory): Use TaskCreate and TaskUpdate to drive the user-visible progress list.`,
    "   - After you have a final ## Coder Tasks list, call TaskCreate for each short step (about 5–7 words each).",
    "   - Use TaskUpdate to change status (pending | in_progress | completed) for one task at a time.",
    "   - Exactly ONE step must be in_progress until everything is done.",
    "   - Set in_progress BEFORE starting a step; set completed IMMEDIATELY after finishing (do not batch).",
    "   - Update task status after each meaningful sub-step; do not rely on prose alone for progress.",
    "",
  ];
  step += 1;
  pipeline.push(...buildArchitectStep(availability, step));
  pipeline.push("");
  step += 1;
  pipeline.push(
    `${step}. Task list: Parse "## Coder Tasks". Each item becomes one Agent(coder) delegation.`,
    '   Print the final "## Coder Tasks" section with numbered tasks before spawning coders.',
    "",
  );
  step += 1;
  pipeline.push(
    `${step}. Coders (parallel): Same parallel_group or no dependencies → multiple Agent(coder) in one turn.`,
    "   Each delegation must state: scope, target files, how to verify (test/lint command), expected return format.",
    "",
  );
  if (isSubagentEnabled(availability, "reviewer")) {
    step += 1;
    pipeline.push(...buildReviewerStep(availability, step));
    pipeline.push("");
  } else {
    pipeline.push(...buildReviewerStep(availability, step));
    pipeline.push("");
  }
  if (isSubagentEnabled(availability, "tester")) {
    step += 1;
    pipeline.push(...buildTesterStep(availability, step));
    pipeline.push("");
  } else {
    pipeline.push(...buildTesterStep(availability, step));
    pipeline.push("");
  }
  pipeline.push(...buildWhenNotToUseAgent(availability));
  pipeline.push(
    "",
    "Never ask a subagent to spawn another subagent. You alone coordinate the pipeline.",
    "Do not replan from scratch unless blocked; extend minimally if discoveries require it.",
    "",
    "Subagent resume: When a prior explore/architect/coder/reviewer/tester run exists in this thread, call Agent(role) normally — Eco rewrites to Resume agent {id} unless your prompt asks for a fresh/restart pass.",
  );
  return pipeline.join("\n");
}

export function summarizeExecutePipeline(availability: SubagentAvailability): string {
  const parts = ["TaskCreate/TaskUpdate after Coder Tasks"];
  if (isSubagentEnabled(availability, "architect")) {
    parts.push("Architect (or skip per criteria)");
  } else {
    parts.push("self-authored Coder Tasks");
  }
  parts.push("parallel coders");
  if (isSubagentEnabled(availability, "reviewer")) {
    parts.push("reviewer");
  }
  if (isSubagentEnabled(availability, "tester")) {
    parts.push("tester");
  }
  return parts.join(", ");
}

export function formatPlanExecutionSummary(availability: SubagentAvailability): string {
  const labels: Record<SubagentRole, string> = {
    explore: "Explore",
    architect: "Architect",
    coder: "Coder",
    reviewer: "Reviewer",
    tester: "Tester",
  };
  const enabled = listEnabledSubagents(availability)
    .filter((role) => role !== "explore")
    .map((role) => labels[role]);
  if (enabled.length === 0) {
    return "将按你已启用的子代理执行（Coder 为必需）。";
  }
  return `确认后将按流程执行：${enabled.join(" → ")}（复杂需求可能先拆分任务）。`;
}

export function buildEcoPlanHarnessAdapter(availability: SubagentAvailability): string {
  const exploreLine = isSubagentEnabled(availability, "explore")
    ? "- Exploration: use Read, Glob, Grep, Bash (read-only), and **`Agent(explore)`** for broad codebase discovery (same role as Codex PHASE 1 exploration)."
    : "- Exploration: use Read, Glob, Grep, and Bash (read-only) only — **do not** call Agent(explore) (disabled in Eco settings).";

  const architectLines = isSubagentEnabled(availability, "architect")
    ? [
        "",
        "## Optional planning architect",
        "- For cross-module or boundary decisions, you may call **`Agent(architect)`** for read-only structural guidance.",
        "- Do not use architect for simple localized changes — prefer direct exploration.",
      ]
    : [];

  const turn1Explore = isSubagentEnabled(availability, "explore")
    ? "- **Explore first**: run at least one targeted pass with Read, Glob, Grep, and/or `Agent(explore)` before asking the user anything answerable from the repo."
    : "- **Explore first**: run at least one targeted pass with Read, Glob, Grep, and/or Bash (read-only) before asking the user anything answerable from the repo. Do not call Agent(explore).";

  return [
    "# Eco harness (minimal overrides — Codex Plan text above is authoritative)",
    "",
    "You are in Eco Coding phase 1/2 PLAN (read-only).",
    "",
    "## Tool name mapping",
    "- User clarifications: **`AskUserQuestion`** (Codex Plan Mode asking-questions section; same role).",
    "- Final plan submission: **`mcp__eco_plan__finalize_plan`** with `{ analysis, plan }` strings.",
    exploreLine,
    "- Do **not** use `update_plan` in Plan Mode (Codex rule still applies).",
    "- Do **not** call Agent(coder), Agent(reviewer), Agent(tester), or ExitPlanMode in this phase.",
    ...architectLines,
    "",
    "## Deliverable envelope (Eco UI strict tool mode)",
    "Follow Codex **Finalization rule** content quality exactly; submission channel differs:",
    "",
    "1. Optional: analysis summary in plain text — exploration facts, extracted requirements, open assumptions.",
    "2. Required: submit decision-complete plan via `mcp__eco_plan__finalize_plan`.",
    "   - `analysis`: complete analysis summary string.",
    "   - `plan`: complete implementation plan string (Summary/Key Changes/Test Plan/Assumptions).",
    "3. Do not ask \"should I proceed?\" — the user approves the submitted plan in Eco UI before execution phase 2/2.",
    "",
    "For `AskUserQuestion`, Eco always provides a custom text field; include an \"其他（自定义说明）\" option when presets may not fit.",
    "",
    formatAvailableSubagentsLine(availability),
    "",
    "## Eco Plan Mode turn order (mandatory — overrides one-shot planning)",
    "",
    "A detailed user message is **not** permission to skip PHASE 1–2 or to finalize in one turn.",
    "",
    "### Turn 1 (first assistant reply after the user request)",
    "",
    turn1Explore,
    "- **Do not finalize**: MUST NOT call `mcp__eco_plan__finalize_plan` on turn 1.",
    "- **Do not one-shot**: MUST NOT combine full exploration + final plan in the same turn.",
    "- **Ask next**: after exploration, call **`AskUserQuestion`** with 2–5 high-impact questions (Codex PHASE 2 intent + PHASE 3 implementation). Include preferences/tradeoffs (scope, defaults, validation bounds, rollout, test depth) even when the user already proposed an approach.",
    "- Optional: short `## Analysis Result` / `## 分析结果` summarizing repo facts and open assumptions — not a substitute for `AskUserQuestion`.",
    "",
    "### Middle turns",
    "",
    "- Incorporate answers; explore more if needed; call `AskUserQuestion` again while material ambiguity remains.",
    "- Still MUST NOT call `mcp__eco_plan__finalize_plan` until decision-complete per Codex Finalization rule.",
    "",
    "### Final turn only",
    "",
    "- Call `mcp__eco_plan__finalize_plan` once spec is decision-complete (unanswered preference questions use recommended defaults recorded under Assumptions).",
    "",
    "If you have not called `AskUserQuestion` at least once in this Plan Mode session, you are not ready for the final plan (except truly trivial one-line doc fixes with zero tradeoffs).",
    "",
    "### Plan revisions via chat (after dismiss or follow-up)",
    "",
    "If the user revises the spec after a prior submitted plan (including after dismissing Eco plan approval),",
    "the next `mcp__eco_plan__finalize_plan` payload MUST be a **complete replacement** — same rule as Codex `<proposed_plan>` revisions, not a partial diff.",
  ].join("\n");
}

export function buildPlanningExploreInstruction(availability: SubagentAvailability): string {
  return isSubagentEnabled(availability, "explore")
    ? "Read / Glob / Grep and/or Agent(explore)"
    : "Read / Glob / Grep and Bash (read-only) only — do not call Agent(explore)";
}

export function buildPlanningContinuationExploreHint(availability: SubagentAvailability): string {
  const explore = isSubagentEnabled(availability, "explore")
    ? "explore or AskUserQuestion"
    : "Read/Glob/Grep or AskUserQuestion";
  return [
    `Incorporate this message; ${explore} if material ambiguity remains.`,
    "If explore/architect already ran in this Plan Mode session, call Agent(role) again — Eco will Resume prior subagent context when available (use fresh/restart in the prompt to force a new pass).",
  ].join(" ");
}

export function buildQuestionExploreInstruction(availability: SubagentAvailability): string {
  return isSubagentEnabled(availability, "explore")
    ? "For broad codebase questions, use Agent(explore) with thoroughness quick|medium|very thorough."
    : "For broad codebase questions, use Read, Glob, Grep, and Bash (read-only) — do not call Agent(explore).";
}

export function buildQuestionAnswerTaskLine(availability: SubagentAvailability): string {
  return isSubagentEnabled(availability, "explore")
    ? "Task: Answer read-only. Use Agent(explore) if the question requires repo-wide context."
    : "Task: Answer read-only. Use Read/Glob/Grep for repo-wide context.";
}
