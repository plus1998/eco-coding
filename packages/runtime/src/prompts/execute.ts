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

/** Skip Agent(architect) only when ALL apply (otherwise architect is mandatory). */
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
}): string {
  const lines = [
    "Proceed with phase 2 execution.",
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
  ];

  if (planning.planUserEdited) {
    lines.push(
      "",
      "<system-reminder>",
      "The user edited this plan in Eco before approval. Treat the approved plan text above as authoritative over any earlier planner draft in the conversation.",
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
