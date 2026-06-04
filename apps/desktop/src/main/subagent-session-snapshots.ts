import { computeSubagentSessionDurationMs } from "../shared/subagent-session-timing.js";
import type { ThreadSubagentSessionTiming } from "../shared/ipc.js";
import type { ThreadSubagentSessionRecord } from "./subagent-session-types.js";

export function buildSubagentSessionTimings(
  records: readonly ThreadSubagentSessionRecord[],
): ThreadSubagentSessionTiming[] {
  return records.map((row) => ({
    agentId: row.agentId,
    role: row.role,
    status: row.status,
    startedAt: row.startedAt,
    lastActiveAt: row.lastActiveAt,
    ...(row.endedAt && { endedAt: row.endedAt }),
    accumulatedMs: row.accumulatedMs,
    durationMs: computeSubagentSessionDurationMs(row),
  }));
}
