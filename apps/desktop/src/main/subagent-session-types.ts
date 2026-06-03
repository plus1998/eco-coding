import type { SubagentRole } from "@eco/runtime";

export type SubagentRunPhase = "planning" | "execution" | "question";

export type SubagentSessionStatus = "active" | "stopped";

export interface ThreadSubagentSessionRecord {
  threadId: string;
  role: SubagentRole;
  agentId: string;
  phase: SubagentRunPhase;
  status: SubagentSessionStatus;
  todoId?: string;
  missionKey?: string;
  updatedAt: string;
}
