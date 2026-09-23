import { type ConversationEventInput, stableHash } from "@eco/shared";
import type { AgentInstanceRecord } from "./usage-ledger";

/** Agent lifecycle and recovery facts share the same immutable V2 event. */
export function conversationV2AgentEvent(record: AgentInstanceRecord): ConversationEventInput {
  const sourceEventKey = `desktop:agent:${record.threadId}:${record.agentId}:${stableHash(record)}`;
  const text = (key: string): string | undefined =>
    typeof record.metadata?.[key] === "string" ? (record.metadata[key] as string) : undefined;
  const taskName = text("taskName");
  const delegationSummary = text("delegationSummary");
  const delegationPrompt = text("delegationPrompt");
  return {
    conversationId: record.threadId,
    eventId: `desktop_v2_agent_${stableHash(sourceEventKey)}`,
    sourceEventKey,
    type:
      record.status === "launching"
        ? "agent.created"
        : record.status === "active"
          ? "agent.started"
          : record.status === "abandoned"
            ? "agent.interrupted"
            : "agent.completed",
    occurredAt: record.updatedAt,
    agentId: record.agentId,
    agentInstanceId: record.agentId,
    ...(record.runAttemptId !== undefined ? { runId: record.runAttemptId } : {}),
    ...(record.parentAgentId !== undefined
      ? { parentAgentId: record.parentAgentId, parentAgentInstanceId: record.parentAgentId }
      : {}),
    ...(record.parentToolUseId !== undefined ? { parentToolCallId: record.parentToolUseId } : {}),
    payload: {
      authority: "lifecycle",
      role: record.role,
      kind: record.kind,
      status: record.status,
      startedAt: record.startedAt,
      updatedAt: record.updatedAt,
      ...(record.endedAt !== undefined ? { endedAt: record.endedAt } : {}),
      ...(record.missionKey !== undefined ? { mission: record.missionKey } : {}),
      ...(record.todoId !== undefined ? { todoId: record.todoId } : {}),
      ...(record.metadata !== undefined ? { metadata: record.metadata } : {}),
      ...(taskName !== undefined ? { taskName } : {}),
      ...(delegationSummary !== undefined ? { delegationSummary } : {}),
      ...(delegationPrompt !== undefined ? { delegationPrompt } : {}),
    },
  };
}
