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
import type { MainAgentHandsOnCapability } from "../agent-orchestration.js";

/** Hoisted (not a const) so the execute.ts <-> subagent-pipeline.ts import cycle stays TDZ-safe. */
function fullHandsOnCapability(): MainAgentHandsOnCapability {
  return { canEditFiles: true, canRunBash: true };
}

/**
 * Hands-on boundary for the main orchestrator, derived from the active profile tool policy.
 * The prompt must state the same rules the Eco PreToolUse policy hook enforces, so the
 * model never has to discover them through denied tool calls.
 */
export function buildMainAgentHandsOnBoundaryAppend(
  capability: MainAgentHandsOnCapability,
  availability: SubagentAvailability = defaultSubagentAvailability(),
  options: { delegateTarget?: string } = {},
): string {
  const coderEnabled = isSubagentEnabled(availability, "coder");
  const coderTarget =
    options.delegateTarget ??
    (coderEnabled ? agentCall("coder") : `Agent(${SDK_GENERAL_PURPOSE_AGENT_KEY})`);
  const lines: string[] = ["Hands-on boundary (enforced by Eco tool policy):"];
  if (capability.canEditFiles) {
    lines.push(
      "- You may edit files directly. Prefer direct edits for small, localized changes (a focused fix within 1-2 files, config/copy/type tweaks).",
      ...(coderEnabled
        ? [
            `- Delegate multi-file or parallelizable implementation to ${coderTarget}; keep the review/verify pipeline for substantial changes.`,
          ]
        : []),
    );
  } else {
    lines.push(
      `- Filesystem writes (Write/Edit) are DISABLED for you. Do not attempt them; every code change must be delegated to ${coderTarget}.`,
    );
  }
  if (capability.canRunBash) {
    lines.push("- You may run shell commands via Bash.");
  } else {
    lines.push(
      `- Bash is DISABLED for you. Do not attempt it; have ${coderTarget} run commands and report results.`,
    );
  }
  return lines.join("\n");
}

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

export function buildExecuteBuildSwitchAppend(
  availability: SubagentAvailability,
  capability: MainAgentHandsOnCapability = fullHandsOnCapability(),
): string {
  const delegates = formatExecutionSubagentNames(availability);
  const coderEnabled = isSubagentEnabled(availability, "coder");
  const delegationRule = capability.canEditFiles
    ? coderEnabled
      ? `You are now in EXECUTE phase: you may edit files${capability.canRunBash ? ", run shell commands," : ""} and delegate to subagents (${delegates}).`
      : `You are now in EXECUTE phase: you may edit files${capability.canRunBash ? " and run shell commands" : ""}. Coder is disabled, so implement directly unless another enabled subagent is materially useful (${delegates}).`
    : `You are now in EXECUTE phase as a pure orchestrator: delegate implementation to subagents (${delegates}).`;
  return [
    "<system-reminder>",
    "The implementation plan has been approved by the user.",
    delegationRule,
    buildMainAgentHandsOnBoundaryAppend(capability, availability),
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
  capability: MainAgentHandsOnCapability = fullHandsOnCapability(),
): string {
  let step = 0;
  const taskListName = isSubagentEnabled(availability, "coder") ? "Coder Tasks" : "Implementation Tasks";
  const pipeline: string[] = [
    "Eco orchestration phase 2/2 — EXECUTE.",
    buildExecuteBuildSwitchAppend(availability, capability),
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
    ? `- Optional broad repository exploration: use Read, Glob, Grep, and **\`${agentCall("explore")}\`** when materially useful.`
    : `- Exploration: use Read, Glob, and Grep only — **do not** call ${agentCall("explore")} (disabled in Eco settings).`;
  const architectLine = isSubagentEnabled(availability, "architect")
    ? `- Optional architecture review: for cross-module or boundary decisions, you may call **\`${agentCall("architect")}\`** with one precise structural question.`
    : "";

  return [
    "# Eco Plan Mode integration",
    "",
    "Use Claude Code's native Plan Mode workflow. Eco only adds product boundaries and approval routing.",
    "",
    "## Eco boundaries",
    "- Eco captures `ExitPlanMode` and shows the submitted plan for user approval before execution phase 2/2.",
    "- Do **not** use `Write`, `Edit`, or `MultiEdit` to create the plan file; those tools remain unavailable in Plan Mode.",
    exploreLine,
    architectLine,
    `- Official SDK built-ins: **\`Agent(${SDK_PLAN_AGENT_KEY})\`** is available for native Plan Mode read-only research; **\`Agent(${SDK_GENERAL_PURPOSE_AGENT_KEY})\`** is available for complex multi-step research/decomposition.`,
    `- Do **not** call ${agentCall("coder")}, ${agentCall("reviewer")}, or ${agentCall("tester")} in this phase.`,
    "- For external facts outside the repository, use `WebSearch` / `WebFetch` when needed.",
    "- If the user revises the spec after a prior submitted plan, the next `ExitPlanMode` plan must be a complete replacement, not a partial diff.",
    "",
    "## Explore first, ask second",
    "- Before asking the user any question, perform at least one targeted non-mutating exploration pass (search relevant files, inspect configs/types/schemas, confirm current implementation shape).",
    "- Do not ask questions that can be answered from the repo or system. Only ask once you have exhausted reasonable non-mutating exploration.",
    "- Exception: you may ask clarifying questions before exploring ONLY if there are obvious ambiguities or contradictions in the user's prompt itself that exploration cannot resolve.",
    "",
    "## Two kinds of unknowns (treat differently)",
    "1. **Discoverable facts** (repo/system truth): explore first. Ask only if multiple plausible candidates remain or nothing was found. When asking, present concrete candidates + recommend one.",
    "2. **Preferences / tradeoffs** (not discoverable): ask early. Provide 2–4 mutually exclusive options + a recommended default. If unanswered, proceed with the recommended option and record it as an assumption.",
    "",
    "## Asking questions — quality standards",
    "- You SHOULD ask questions proactively using `AskUserQuestion`, but each question must: **materially change the plan**, OR **confirm/lock an assumption**, OR **choose between meaningful tradeoffs**.",
    "- Bias toward questions over guessing: if any high-impact ambiguity remains, do NOT plan yet — ask.",
    "- When asking the user to choose, include enough context to explain what is actually being decided. Briefly explain the tradeoff or consequence of each option, not just the action.",
    "- When implementing paths differ in complexity, risk, scope, or compatibility, include those consequences in the question.",
    "- If the user may lack context to choose, explicitly include a \"need more context\" or \"explain first\" option.",
    "- Offer only meaningful multiple-choice options; do not include filler choices that are obviously wrong or irrelevant.",
    "- In rare cases where an important question cannot be expressed with reasonable multiple-choice options (extreme ambiguity), ask it directly without the tool.",
    "",
    formatAvailableSubagentsLine(availability, { allowPlanAgent: true }),
  ]
    .filter(Boolean)
    .join("\n");
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
