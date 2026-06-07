import {
  buildExecuteBuildSwitchAppend,
  buildExecutePhaseSystemAppend,
  summarizeExecutePipeline,
} from "./subagent-pipeline.js";
import { defaultSubagentAvailability, type SubagentAvailability } from "../subagent-availability.js";
import { formatResumableSubagentsAppend } from "../subagent-resume.js";

export { buildExecuteBuildSwitchAppend, buildExecutePhaseSystemAppend };

/** @deprecated Use buildExecuteBuildSwitchAppend(availability) */
export const executeBuildSwitchAppend = buildExecuteBuildSwitchAppend(defaultSubagentAvailability());

/** Skip architect only when ALL apply (otherwise architect is mandatory). */
export const architectSkipCriteria = [
  "Single focused change in one module or ≤3 files",
  "No new public API surface or cross-package boundary changes",
  "No schema/migration or config contract changes",
  "No parallel workstreams that could conflict",
].join("; ");

/** @deprecated Use buildExecutePhaseSystemAppend(availability) */
export const executePhaseSystemAppend = buildExecutePhaseSystemAppend(defaultSubagentAvailability());

export function buildExecutePhasePrompt(
  userPrompt: string,
  analysis: string,
  plan: string,
  options?: { planUserEdited?: boolean; availability?: SubagentAvailability },
): string {
  const availability = options?.availability ?? defaultSubagentAvailability();
  const lines = [
    buildExecuteBuildSwitchAppend(availability),
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

  lines.push("", `Task: Pipeline — ${summarizeExecutePipeline(availability)}.`);

  return lines.join("\n");
}

/** Execution prompt when resuming the same SDK session after planning (plan text is always inlined). */
export function buildExecuteResumePrompt(planning: {
  userPrompt: string;
  analysis: string;
  plan: string;
  planUserEdited?: boolean;
  /** Repo-relative path, e.g. `.eco/approved-plans/thr_x.md` */
  approvedPlanFile?: string;
  resumableSubagents?: readonly { role: string; agentId: string }[];
}, options?: { includePlanText?: boolean }): string {
  const includePlanText = options?.includePlanText === true;
  const lines = [
    "Proceed with phase 2 execution.",
  ];

  if (includePlanText) {
    lines.push(
      "The approved plan below is authoritative. Do not ask the user to paste the plan again.",
      "",
      "User request:",
      planning.userPrompt.trim() || "(not captured)",
      "",
      "Planning analysis:",
      planning.analysis.trim() || "(no analysis captured)",
      "",
      "Approved plan (follow this):",
      planning.plan.trim() || "(no plan captured)",
    );
  } else {
    lines.push(
      "Use the approved plan already submitted in this SDK session. Do not ask the user to paste the plan again.",
    );
  }

  if (planning.planUserEdited && includePlanText) {
    lines.push(
      "",
      "<system-reminder>",
      "The user edited this plan in Eco before approval. Treat the approved plan text above as authoritative over any earlier planner draft in the conversation.",
      "</system-reminder>",
    );
  } else if (planning.planUserEdited) {
    lines.push(
      "",
      "<system-reminder>",
      "The user edited this plan in Eco before approval. Treat the approved/on-disk plan as authoritative over any earlier planner draft in the conversation.",
      "</system-reminder>",
    );
  }

  if (planning.approvedPlanFile?.trim()) {
    lines.push("", `On-disk copy (workspace root): ${planning.approvedPlanFile.trim()}`);
  }

  lines.push("", "Task: Continue phase 2 — implement the approved plan and update ## Coder Tasks.");
  lines.push(formatResumableSubagentsAppend(planning.resumableSubagents ?? []));

  return lines.join("\n");
}

/** Shared execution prompt for first run, SDK resume, and thread continue follow-ups. */
export function buildExecutionPromptWithFollowUp(
  planning: {
    userPrompt: string;
    analysis: string;
    plan: string;
    planUserEdited?: boolean;
    approvedPlanFile?: string;
    resumableSubagents?: readonly { role: string; agentId: string }[];
  },
  followUp: string,
  options: { isResume: boolean; availability?: SubagentAvailability; includePlanOnResume?: boolean },
): string {
  if (options.isResume) {
    const base = buildExecuteResumePrompt({
      userPrompt: planning.userPrompt,
      analysis: planning.analysis,
      plan: planning.plan,
      ...(planning.planUserEdited ? { planUserEdited: true } : {}),
      ...(planning.approvedPlanFile ? { approvedPlanFile: planning.approvedPlanFile } : {}),
      ...(planning.resumableSubagents?.length
        ? { resumableSubagents: planning.resumableSubagents }
        : {}),
    }, { includePlanText: options.includePlanOnResume === true });
    const trimmed = followUp.trim();
    return trimmed && trimmed !== planning.userPrompt.trim()
      ? `${base}\n\nUser follow-up:\n${trimmed}`
      : base;
  }

  const trimmed = followUp.trim();
  const userPrompt =
    trimmed && trimmed !== planning.userPrompt.trim() ? trimmed : planning.userPrompt;
  return buildExecutePhasePrompt(userPrompt, planning.analysis, planning.plan, {
    ...(planning.planUserEdited ? { planUserEdited: true } : {}),
    ...(options.availability ? { availability: options.availability } : {}),
  });
}
