import type { SubagentAvailability } from "../subagent-availability.js";
import { defaultSubagentAvailability } from "../subagent-availability.js";
import { CODEX_PLAN_MODE_TEMPLATE } from "./codex-plan-template.js";
import { buildEcoPlanHarnessAdapter } from "./subagent-pipeline.js";

export { buildEcoPlanHarnessAdapter } from "./subagent-pipeline.js";

/**
 * Minimal Eco harness mapping on top of the inlined Codex Plan Mode template.
 * Keeps Codex workflow text; only tools, deliverable envelope, and product boundaries differ.
 */
/** @deprecated Use buildEcoPlanHarnessAdapter(availability) */
export const ecoPlanHarnessAdapter = buildEcoPlanHarnessAdapter(defaultSubagentAvailability());

export function buildPlanningPhaseSystemAppend(
  availability: SubagentAvailability = defaultSubagentAvailability(),
): string {
  const codexPlan = CODEX_PLAN_MODE_TEMPLATE.replaceAll("request_user_input", "AskUserQuestion");
  return [codexPlan, buildEcoPlanHarnessAdapter(availability)].join("\n\n");
}

/** @deprecated Use buildPlanningPhaseSystemAppend(availability) */
export const planningPhaseSystemAppend = buildPlanningPhaseSystemAppend();
