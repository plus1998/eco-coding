/** Fields required to compute wall-clock active duration for a sub-agent session. */
export interface SubagentSessionTimingFields {
  status: "active" | "stopped" | "handed_off";
  accumulatedMs: number;
  lastActiveAt: string;
}

export function computeSubagentSessionDurationMs(
  timing: SubagentSessionTimingFields,
  nowMs = Date.now(),
): number {
  const lastActiveMs = Date.parse(timing.lastActiveAt);
  const activeSegmentMs =
    timing.status === "active" && Number.isFinite(lastActiveMs) ? Math.max(0, nowMs - lastActiveMs) : 0;
  return Math.max(0, timing.accumulatedMs + activeSegmentMs);
}
