import {
  defaultSubagentAvailability,
  ecoSubagentKeyForRole,
  isSubagentEnabled,
  listEnabledSubagents,
  SDK_GENERAL_PURPOSE_AGENT_KEY,
  SDK_PLAN_AGENT_KEY,
  type SubagentAvailability,
  type SubagentRole,
} from "../subagent-availability.js";
import { executeCoreGoalAppend } from "./eco-common.js";
import { architectUseCriteria } from "./execute.js";

function agentCall(role: SubagentRole): string {
  return `Agent(${ecoSubagentKeyForRole(role)})`;
}

/** Shared rule: Eco role delegation must use Eco subagent keys; SDK built-in exceptions are explicit. */
export function formatMandatoryEcoSubagentRule(options: { allowPlanAgent?: boolean } = {}): string {
  const blockedExamples = options.allowPlanAgent ? "Explore, Bash" : "Explore, Plan, Bash";
  return [
    "Mandatory subagent policy: when delegating to an Eco role via Agent(), set subagent_type to the exact eco_* key for that role.",
    `Allowed SDK built-in exception: Agent(${SDK_GENERAL_PURPOSE_AGENT_KEY}) for complex, multi-step tasks that require both exploration and action.`,
    ...(options.allowPlanAgent
      ? [
          `Plan Mode exception: Agent(${SDK_PLAN_AGENT_KEY}) is also allowed for read-only codebase research before ExitPlanMode.`,
        ]
      : []),
    `Do not use other SDK built-in agents (e.g. ${blockedExamples}), plain role names (coder/reviewer/explore/...), or Agent(<role>).`,
  ].join(" ");
}

export function formatAvailableSubagentsLine(
  availability: SubagentAvailability,
  options: { allowPlanAgent?: boolean } = {},
): string {
  const enabled = listEnabledSubagents(availability);
  const names = enabled.map((role) => `${role}: ${ecoSubagentKeyForRole(role)}`).join(", ");
  return [
    `Available Eco subagents in this session: ${names}.`,
    `Available SDK built-in subagent: ${SDK_GENERAL_PURPOSE_AGENT_KEY} (inherits the main conversation model and all tools).`,
    ...(options.allowPlanAgent
      ? [
          `Available SDK Plan Mode subagent: ${SDK_PLAN_AGENT_KEY} (inherits the main conversation model; read-only).`,
        ]
      : []),
    formatMandatoryEcoSubagentRule(options),
  ].join("\n");
}

export function formatExecutionSubagentNames(availability: SubagentAvailability): string {
  const roles = listEnabledSubagents(availability).filter((role) => role !== "explore");
  return roles.length > 0
    ? roles.map((role) => ecoSubagentKeyForRole(role)).join(", ")
    : "none; execute directly without Agent delegation";
}

function executionSubagentAvailability(availability: SubagentAvailability): SubagentAvailability {
  return {
    ...availability,
    explore: false,
  };
}

export function buildExecuteBuildSwitchAppend(availability: SubagentAvailability): string {
  const delegates = formatExecutionSubagentNames(availability);
  const delegationRule = isSubagentEnabled(availability, "coder")
    ? `You are now in EXECUTE phase: you may edit files, run shell commands, and delegate to subagents (${delegates}).`
    : `You are now in EXECUTE phase: you may edit files and run shell commands. Coder is disabled, so implement directly unless another enabled subagent is materially useful (${delegates}).`;
  return [
    "<system-reminder>",
    "The implementation plan has been approved by the user.",
    delegationRule,
    "Follow the approved plan and the execution pipeline. Do not restart planning from scratch unless blocked.",
    "</system-reminder>",
  ].join("\n");
}

function buildArchitectStep(availability: SubagentAvailability, step: number): string[] {
  if (!isSubagentEnabled(availability, "architect")) {
    const taskHeading = isSubagentEnabled(availability, "coder")
      ? "## Coder Tasks"
      : "## Implementation Tasks";
    return [
      `${step}. Task decomposition: Do NOT call ${agentCall("architect")}. You must publish "${taskHeading}" yourself before implementation.`,
    ];
  }
  const implementationTarget = isSubagentEnabled(availability, "coder")
    ? "before coders"
    : "before direct implementation";
  return [
    `${step}. Architect (targeted): Call ${agentCall("architect")} only when the approved plan truly needs architecture decomposition — use it if ANY apply: ${architectUseCriteria}.`,
    `   Default: skip architect and publish implementation tasks yourself ${implementationTarget}. If you call architect, pass the approved plan, the planner's Context Digest / Architecture Decision excerpts, and the specific boundary/decomposition question.`,
    "   Do not ask architect to re-explore the project. If the digest is insufficient, name the missing fact or file explicitly before delegating.",
  ];
}

function buildReviewerStep(availability: SubagentAvailability, step: number): string[] {
  if (!isSubagentEnabled(availability, "reviewer")) {
    const verifier = isSubagentEnabled(availability, "coder")
      ? "coder verification output"
      : "your verification output";
    return ["", `Reviewer subagent is disabled — skip formal review; rely on ${verifier}.`];
  }
  const completionSource = isSubagentEnabled(availability, "coder")
    ? "all coders finish"
    : "direct implementation finishes";
  const fixSource = isSubagentEnabled(availability, "coder")
    ? "run coders once to address them"
    : "fix them yourself once";
  return [
    `${step}. Reviewer: After ${completionSource}, call ${agentCall("reviewer")} with approved plan + task list.`,
    "   Eco prepends this session's changed file list; do not diff against main/master.",
    "   Severity policy: only fix P0/P1 issues. Do NOT spend cycles implementing P2 suggestions.",
    `   If the reviewer returns BLOCKERS (P0/P1 exist), convert ALL P0/P1 items into a single concrete fix batch and ${fixSource}.`,
    `   Then re-run ${agentCall("reviewer")} exactly once (Eco auto-Resumes the same reviewer session when possible — do not restart from scratch). If there are still P0/P1 issues after the second review, STOP and summarize remaining P0/P1 for the user (do not loop).`,
    "   Always summarize P2 items at the end as follow-ups; do not implement them unless the user explicitly asks.",
  ];
}

function buildTesterStep(availability: SubagentAvailability, step: number): string[] {
  if (!isSubagentEnabled(availability, "tester")) {
    return ["", "Tester subagent is disabled — skip the formal test step after review."];
  }
  return [`${step}. Tester: After review passes, call ${agentCall("tester")}.`];
}

function buildWhenNotToUseAgent(availability: SubagentAvailability): string[] {
  const lines = ["When NOT to use Agent:"];
  if (isSubagentEnabled(availability, "reviewer")) {
    lines.push(
      `- Single known file for reviewer → still use ${agentCall("reviewer")} for pipeline consistency`,
    );
  }
  lines.push("- Do not delegate exploration during execute unless blocked — execute the approved plan");
  if (isSubagentEnabled(availability, "architect")) {
    lines.push("- Do not call architect for routine task listing or localized changes");
  }
  return lines;
}

export function buildExecutePhaseSystemAppend(
  availability: SubagentAvailability = defaultSubagentAvailability(),
): string {
  let step = 0;
  const taskListName = isSubagentEnabled(availability, "coder") ? "Coder Tasks" : "Implementation Tasks";
  const pipeline: string[] = [
    "Eco orchestration phase 2/2 — EXECUTE.",
    buildExecuteBuildSwitchAppend(availability),
    "",
    executeCoreGoalAppend,
    "Final response: keep it concise. State what changed, verification result, and blockers only.",
    `Do not restate the full approved plan, full ${taskListName} list, long diffs, or tool logs in the final response.`,
    "",
    formatAvailableSubagentsLine(executionSubagentAvailability(availability)),
    "",
    "You are the orchestrator (Planner). Follow this pipeline strictly:",
    "",
    `${step}. Progress (mandatory): Use TaskCreate and TaskUpdate to drive the user-visible progress list.`,
    `   - After you have a final ## ${taskListName} list, call TaskCreate for each short step (about 5–7 words each).`,
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
  if (isSubagentEnabled(availability, "coder")) {
    pipeline.push(
      `${step}. Task list: Parse "## Coder Tasks". Each item becomes one ${agentCall("coder")} delegation.`,
      '   Print the final "## Coder Tasks" section with numbered tasks before spawning coders.',
      "",
    );
  } else {
    pipeline.push(
      `${step}. Task list: Parse "## Implementation Tasks" or the approved plan into direct work items.`,
      '   Print "## Implementation Tasks" with numbered tasks before editing.',
      `   Do NOT call ${agentCall("coder")} because coder is disabled for this run.`,
      "",
    );
  }
  step += 1;
  if (isSubagentEnabled(availability, "coder")) {
    pipeline.push(
      `${step}. Coders (parallel): Same parallel_group or no dependencies → multiple ${agentCall("coder")} calls in one turn.`,
      "   Each delegation must state: scope, target files, how to verify (test/lint command), expected return format.",
      "",
    );
  } else {
    pipeline.push(
      `${step}. Direct implementation: edit files and run verification yourself according to the task list.`,
      "   Keep progress updated with TaskUpdate after each meaningful implementation step.",
      "",
    );
  }
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
    "Subagent resume: When a prior architect/coder/reviewer/tester run exists in this thread, call the same eco_* Agent key normally — Eco rewrites to Resume agent {id} unless your prompt asks for a fresh/restart pass.",
  );
  return pipeline.join("\n");
}

export function summarizeExecutePipeline(availability: SubagentAvailability): string {
  const coderEnabled = isSubagentEnabled(availability, "coder");
  const taskListName = coderEnabled ? "Coder Tasks" : "Implementation Tasks";
  const parts = [`TaskCreate/TaskUpdate after ${taskListName}`];
  parts.push(
    isSubagentEnabled(availability, "architect")
      ? "targeted architect only when needed"
      : `self-authored ${taskListName}`,
  );
  parts.push(coderEnabled ? "parallel coders" : "direct implementation");
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
    return "当前未启用执行子代理，将由主 Agent 直接执行。";
  }
  return `确认后将按流程执行：${enabled.join(" → ")}（复杂需求可能先拆分任务）。`;
}

export function buildEcoPlanHarnessAdapter(availability: SubagentAvailability): string {
  const exploreLine = isSubagentEnabled(availability, "explore")
    ? `- Exploration: use Read, Glob, Grep, and **\`${agentCall("explore")}\`** for broad codebase discovery (same role as Codex PHASE 1 exploration).`
    : `- Exploration: use Read, Glob, and Grep only — **do not** call ${agentCall("explore")} (disabled in Eco settings).`;

  const architectLines = isSubagentEnabled(availability, "architect")
    ? [
        "",
        "## Optional planning architect",
        `- For cross-module or boundary decisions, you may call **\`${agentCall("architect")}\`** for read-only structural guidance.`,
        "- Planner owns repository exploration. If you call architect, pass the exploration facts / Context Digest you already gathered plus one precise structural question.",
        "- Architect is a targeted reviewer, not a second full-project reader; if it lacks a fact, it should name that gap instead of inferring around it.",
        "- Do not use architect for simple localized changes — prefer direct exploration.",
      ]
    : [];

  const exploreFirstRule = isSubagentEnabled(availability, "explore")
    ? `- **Explore first**: run at least one targeted pass with Read, Glob, Grep, and/or \`${agentCall("explore")}\` before asking the user anything answerable from the repo.`
    : `- **Explore first**: run at least one targeted pass with Read, Glob, and/or Grep before asking the user anything answerable from the repo. Do not call ${agentCall("explore")}.`;

  return [
    "# Eco harness (minimal overrides — Codex Plan text above is authoritative)",
    "",
    "You are in Eco Coding phase 1/2 PLAN (read-only).",
    "",
    "## Tool name mapping",
    "- User clarifications: **`AskUserQuestion`** (Codex Plan Mode asking-questions section; same role).",
    "- Final plan submission: present the complete Markdown plan and call **`ExitPlanMode`**. Claude Code saves the plan file internally and injects `plan` / `planFilePath` into hooks.",
    "- Do **not** use `Write`, `Edit`, or `MultiEdit` to create the plan file; those tools remain unavailable in Plan Mode.",
    exploreLine,
    `- Official SDK built-ins: **\`Agent(${SDK_PLAN_AGENT_KEY})\`** is available for Plan Mode read-only codebase research; **\`Agent(${SDK_GENERAL_PURPOSE_AGENT_KEY})\`** is available for complex multi-step research/decomposition. Plan Mode remains read-only; do not use either to implement before approval.`,
    "- External facts (official docs, API versions, third-party behavior, current best practices not in the repo): use **`WebSearch`**; open a specific URL with **`WebFetch`** after repo exploration — do not skip local exploration for in-repo questions.",
    "- Do **not** use `update_plan` in Plan Mode (Codex rule still applies).",
    `- Do **not** call ${agentCall("coder")}, ${agentCall("reviewer")}, or ${agentCall("tester")} in this phase.`,
    ...architectLines,
    "",
    "## Deliverable envelope (Eco UI approval)",
    "Follow Codex **Finalization rule** content quality exactly; Eco captures the official ExitPlanMode plan and shows it for approval:",
    "",
    "1. Optional: analysis summary in plain text — exploration facts, extracted requirements, open assumptions.",
    "   Include a `## Context Digest` section with the concrete repo facts future subagents need: tech stack, entry points, affected files/modules, existing contracts, and important constraints.",
    "2. Required: present a decision-complete Markdown plan and submit it via `ExitPlanMode`.",
    "   - Include Summary, Key Changes, Architecture Decision, Test Plan, and Assumptions when they are material.",
    "   - `Architecture Decision`: state the chosen boundary/data-flow approach, or explicitly say the change is localized and no new architecture boundary is introduced.",
    '3. Do not ask "should I proceed?" — the user approves the submitted plan in Eco UI before execution phase 2/2.',
    "",
    'For `AskUserQuestion`, Eco always provides a custom text field; include an "其他（自定义说明）" option when presets may not fit.',
    "",
    formatAvailableSubagentsLine(availability, { allowPlanAgent: true }),
    "",
    "## Eco Plan Mode pipeline (mandatory ordering)",
    "",
    "A detailed user message is **not** permission to skip exploration. A clear request may proceed to finalize after exploration without extra clarification.",
    "",
    "### Required order",
    "",
    exploreFirstRule,
    "- **External lookup when needed**: after repo exploration, use `WebSearch` / `WebFetch` only for facts outside the repo (not for code or config discoverable locally).",
    "- **Clarify when needed**: after exploration, call **`AskUserQuestion`** only for material preferences/tradeoffs that exploration cannot resolve (Codex PHASE 2–3). Do not ask questions answerable from the repo.",
    "- **Submit when ready**: present the plan and call `ExitPlanMode` once decision-complete per Codex Finalization rule (unanswered preference questions use recommended defaults recorded under Assumptions).",
    "",
    "Exploration, clarification, and finalization may occur in the same assistant turn, but `ExitPlanMode` must come after exploration completes in that turn.",
    "Optional: short `## Analysis Result` / `## 分析结果` summarizing repo facts and open assumptions.",
    "",
    "### Plan revisions via chat (after dismiss or follow-up)",
    "",
    "If the user revises the spec after a prior submitted plan (including after dismissing Eco plan approval),",
    "the next `ExitPlanMode` plan MUST be a **complete replacement**, not a partial diff.",
  ].join("\n");
}

export function buildPlanningExploreInstruction(availability: SubagentAvailability): string {
  return isSubagentEnabled(availability, "explore")
    ? `Read / Glob / Grep, ${agentCall("explore")}, and/or Agent(${SDK_PLAN_AGENT_KEY})`
    : `Read / Glob / Grep and/or Agent(${SDK_PLAN_AGENT_KEY}) — do not call ${agentCall("explore")}`;
}

export function buildPlanningContinuationExploreHint(availability: SubagentAvailability): string {
  const explore = isSubagentEnabled(availability, "explore")
    ? `${agentCall("explore")}, Agent(${SDK_PLAN_AGENT_KEY}), or AskUserQuestion`
    : `Read/Glob/Grep, Agent(${SDK_PLAN_AGENT_KEY}), or AskUserQuestion`;
  return [
    `Incorporate this message; ${explore} if material ambiguity remains.`,
    "If explore/architect already ran in this Plan Mode session, call the same eco_* Agent key again — Eco will Resume prior subagent context when available (use fresh/restart in the prompt to force a new pass).",
  ].join(" ");
}

export function buildQuestionExploreInstruction(availability: SubagentAvailability): string {
  return isSubagentEnabled(availability, "explore")
    ? `For broad codebase questions, use ${agentCall("explore")} with thoroughness quick|medium|very thorough.`
    : `For broad codebase questions, use Read, Glob, and Grep — do not call ${agentCall("explore")}.`;
}

export function buildQuestionAnswerTaskLine(availability: SubagentAvailability): string {
  return isSubagentEnabled(availability, "explore")
    ? `Task: Answer read-only. Use ${agentCall("explore")} if the question requires repo-wide context.`
    : "Task: Answer read-only. Use Read/Glob/Grep for repo-wide context.";
}
