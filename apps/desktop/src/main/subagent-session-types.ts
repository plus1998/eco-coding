import type { RuntimeAgentRole } from "../shared/ipc";

export type SubagentRunPhase = "planning" | "execution" | "ask";

export type SubagentSessionStatus = "active" | "stopped" | "handed_off";

export interface ThreadSubagentSessionRecord {
  threadId: string;
  role: RuntimeAgentRole;
  agentId: string;
  phase: SubagentRunPhase;
  status: SubagentSessionStatus;
  todoId?: string;
  missionKey?: string;
  startedAt: string;
  lastActiveAt: string;
  endedAt?: string;
  accumulatedMs: number;
  updatedAt: string;
}
