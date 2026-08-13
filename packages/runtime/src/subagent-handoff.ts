import { computeOccupancyRatio } from "./models-dev-limits.js";

export const DEFAULT_SUBAGENT_HANDOFF_THRESHOLD = 0.85;

/**
 * Occupancy threshold helper (monitor / diagnostics).
 * Does not inject prompts — resume uses SDK `Resume agent {id}` only.
 */
export function shouldHandoffSubagentResume(
  occupied: number,
  compactLimit: number,
  threshold = DEFAULT_SUBAGENT_HANDOFF_THRESHOLD,
): boolean {
  if (occupied <= 0 || compactLimit <= 0) {
    return false;
  }
  return computeOccupancyRatio(occupied, compactLimit, threshold).atThreshold;
}

export function estimateHandoffTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
