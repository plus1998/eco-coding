import {
  buildExecuteBuildSwitchAppend,
  buildExecutePhaseSystemAppend,
  summarizeExecutePipeline,
} from "./subagent-pipeline.js";
import { defaultSubagentAvailability, type SubagentAvailability } from "../subagent-availability.js";

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

/** Shorter execution prompt when resuming the same SDK session after planning. */
export function buildExecuteResumePrompt(planning: {
  plan: string;
  planUserEdited?: boolean;
}): string {
  if (planning.planUserEdited) {
    return [
      "Proceed with phase 2 execution.",
      "The user edited the approved plan before execution. Treat this plan as authoritative:",
      "",
      planning.plan.trim() || "(no plan captured)",
    ].join("\n");
  }
  return "Proceed with phase 2 execution. Implement the approved plan from our conversation above.";
}
