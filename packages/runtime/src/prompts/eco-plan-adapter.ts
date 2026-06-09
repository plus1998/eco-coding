import type { SubagentAvailability } from "../subagent-availability.js";
import { defaultSubagentAvailability } from "../subagent-availability.js";
import { buildEcoPlanHarnessAdapter } from "./subagent-pipeline.js";

export { buildEcoPlanHarnessAdapter } from "./subagent-pipeline.js";

/**
 * Minimal Eco harness on top of Claude Code's native Plan Mode.
 * Do not pass this as planModeInstructions; native Plan Mode owns the workflow body.
 */
/** @deprecated Use buildEcoPlanHarnessAdapter(availability) */
export const ecoPlanHarnessAdapter = buildEcoPlanHarnessAdapter(defaultSubagentAvailability());

export function buildPlanningPhaseSystemAppend(
  availability: SubagentAvailability = defaultSubagentAvailability(),
): string {
  return buildEcoPlanHarnessAdapter(availability);
}

/** @deprecated Use buildPlanningPhaseSystemAppend(availability) */
export const planningPhaseSystemAppend = buildPlanningPhaseSystemAppend();
