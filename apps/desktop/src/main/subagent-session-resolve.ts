import { normalizeTaskTitle } from "./coder-tasks.js";
import type { SubagentRunPhase, ThreadSubagentSessionRecord } from "./subagent-session-types.js";

export function normalizeSubagentMissionKey(prompt: string): string {
  return normalizeTaskTitle(prompt.trim().slice(0, 2000));
}

export function resolveResumeAgentIdFromRecords(
  records: readonly ThreadSubagentSessionRecord[],
  input: {
    role: string;
    phase: SubagentRunPhase;
    prompt: string;
    todoIdHint?: string;
    freshRequest: boolean;
  },
): string | undefined {
  if (input.freshRequest) {
    return undefined;
  }

  const stopped = records.filter(
    (row) =>
      row.role === input.role &&
      row.phase === input.phase &&
      row.status === "stopped",
  );
  if (stopped.length === 0) {
    return undefined;
  }

  if (input.role === "coder") {
    const missionKey = normalizeSubagentMissionKey(input.prompt);
    if (input.todoIdHint) {
      const byTodo = stopped.find((row) => row.todoId === input.todoIdHint);
      if (byTodo) {
        return byTodo.agentId;
      }
    }
    if (missionKey) {
      const byMission = stopped.find((row) => row.missionKey === missionKey);
      if (byMission) {
        return byMission.agentId;
      }
    }
    if (stopped.length === 1) {
      return stopped[0]?.agentId;
    }
    return latestStopped(stopped)?.agentId;
  }

  return latestStopped(stopped)?.agentId;
}

function latestStopped(rows: readonly ThreadSubagentSessionRecord[]): ThreadSubagentSessionRecord | undefined {
  return rows.reduce<ThreadSubagentSessionRecord | undefined>((best, row) => {
    if (!best || row.updatedAt > best.updatedAt) {
      return row;
    }
    return best;
  }, undefined);
}
