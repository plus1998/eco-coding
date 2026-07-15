import type { RuntimeAgentRole } from "../shared/ipc";
import type { ThreadRunEvent } from "../shared/thread-run-events";
import type { SubagentRunPhase } from "./subagent-session-types";

export interface CodexSubagentLifecycleServices {
  getAgentStatus: (threadId: string, agentId: string) => string | undefined;
  resolvePhase: (threadId: string) => SubagentRunPhase;
  startSession: (input: {
    threadId: string;
    role: RuntimeAgentRole;
    agentId: string;
    phase: SubagentRunPhase;
  }) => void;
  stopSession: (threadId: string, agentId: string) => void;
  startMetrics: (threadId: string, input: {
    agentId: string;
    role: RuntimeAgentRole;
    parentToolUseId?: string;
  }) => void;
  stopMetrics: (threadId: string, input: { agentId: string; role: RuntimeAgentRole }) => void;
  startAgent: (input: {
    threadId: string;
    agentId: string;
    role: RuntimeAgentRole;
    parentToolUseId?: string;
  }) => void;
  stopAgent: (input: { threadId: string; agentId: string; role: RuntimeAgentRole }) => void;
  abandonAgent: (input: { threadId: string; agentId: string; role: RuntimeAgentRole }) => void;
}

export function applyCodexSubagentLifecycleEvent(
  event: ThreadRunEvent,
  services: CodexSubagentLifecycleServices,
): boolean {
  const agentId = event.agentId?.trim();
  const role = event.role?.trim();
  if (event.scope !== "agent" || !agentId || !role) {
    return false;
  }

  if (event.eventType === "agent.started") {
    const existingStatus = services.getAgentStatus(event.threadId, agentId);
    if (existingStatus === "active" || existingStatus === "launching") {
      return false;
    }
    const parentToolUseId = event.parentToolUseId?.trim() || undefined;
    services.startSession({
      threadId: event.threadId,
      role,
      agentId,
      phase: services.resolvePhase(event.threadId),
    });
    services.startMetrics(event.threadId, {
      agentId,
      role,
      ...(parentToolUseId && { parentToolUseId }),
    });
    services.startAgent({
      threadId: event.threadId,
      agentId,
      role,
      ...(parentToolUseId && { parentToolUseId }),
    });
    return true;
  }

  if (event.eventType !== "agent.stopped" && event.eventType !== "agent.abandoned") {
    return false;
  }
  services.stopSession(event.threadId, agentId);
  services.stopMetrics(event.threadId, { agentId, role });
  const terminal = { threadId: event.threadId, agentId, role };
  if (event.eventType === "agent.abandoned") {
    services.abandonAgent(terminal);
  } else {
    services.stopAgent(terminal);
  }
  return true;
}
