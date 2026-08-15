import { randomUUID } from "node:crypto";
import { type AgentEvent, createAgentEvent } from "../../shared/src";

type JsonRecord = Record<string, unknown>;

export type AcpEventMapContext = {
  threadId: string;
  agentId: string;
  sessionRunId: string;
};

/**
 * Map ACP `session/update` params (or prompt `stopReason` result) → Eco AgentEvent[].
 *
 * Cursor `agent acp` (2026.08.11-e8db854) notifies:
 * `{ sessionId, update: { sessionUpdate, ... } }`.
 * Turn end is on `session/prompt` result `{ stopReason }`, not on session/update.
 */
export function mapAcpSessionUpdate(
  params: unknown,
  ctx: AcpEventMapContext,
): AgentEvent[] {
  const base = { threadId: ctx.threadId, agentId: ctx.agentId, role: "planner" as const };
  const id = `${ctx.threadId}:acp:${ctx.sessionRunId}:${randomUUID()}`;

  if (!isRecord(params)) {
    return [rawOutput(id, base, params)];
  }

  // Prompt RPC result — Cursor does not emit end via session/update.
  if (typeof params.stopReason === "string" && !isRecord(params.update)) {
    return [mapStopReason(id, base, params.stopReason, params)];
  }

  const update = isRecord(params.update) ? params.update : undefined;
  const kind =
    update && typeof update.sessionUpdate === "string" ? update.sessionUpdate : undefined;

  // Eco already persisted the user prompt; load replay also emits these.
  if (kind === "user_message_chunk") {
    return [];
  }

  if (kind === "agent_message_chunk") {
    const text = readContentText(update?.content);
    return text
      ? [
          createAgentEvent({
            id,
            ...base,
            type: "message.delta",
            payload: { type: "eco_stream", text, raw: params },
          }),
        ]
      : [];
  }

  if (kind === "agent_thought_chunk") {
    const text = readContentText(update?.content);
    return text
      ? [
          createAgentEvent({
            id,
            ...base,
            type: "message.delta",
            payload: { type: "eco_stream", blockKind: "thinking", text, raw: params },
          }),
        ]
      : [];
  }

  if (kind === "tool_call") {
    return [
      createAgentEvent({
        id,
        ...base,
        type: "tool.started",
        payload: {
          toolCallId: update?.toolCallId,
          title: update?.title,
          kind: update?.kind,
          status: update?.status ?? "pending",
          rawInput: update?.rawInput,
          locations: update?.locations,
          raw: params,
        },
      }),
    ];
  }

  if (kind === "tool_call_update") {
    const status = typeof update?.status === "string" ? update.status : undefined;
    if (status === "in_progress" || status === "pending") {
      return [
        createAgentEvent({
          id,
          ...base,
          type: "tool.started",
          payload: {
            toolCallId: update?.toolCallId,
            status,
            content: update?.content,
            rawOutput: update?.rawOutput,
            locations: update?.locations,
            raw: params,
          },
        }),
      ];
    }
    return [
      createAgentEvent({
        id,
        ...base,
        type: "tool.completed",
        payload: {
          toolCallId: update?.toolCallId,
          status: status ?? "completed",
          content: update?.content,
          rawOutput: update?.rawOutput,
          locations: update?.locations,
          raw: params,
        },
      }),
    ];
  }

  return [rawOutput(id, base, params)];
}

function mapStopReason(
  id: string,
  base: { threadId: string; agentId: string; role: "planner" },
  stopReason: string,
  params: JsonRecord,
): AgentEvent {
  if (stopReason === "end_turn" || stopReason === "max_tokens" || stopReason === "max_turn_requests") {
    return createAgentEvent({
      id,
      ...base,
      type: "run.terminal",
      payload: { status: "completed" },
    });
  }
  if (stopReason === "cancelled") {
    return createAgentEvent({
      id,
      ...base,
      type: "run.terminal",
      payload: { status: "cancelled", reason: "cancelled" },
    });
  }
  const error =
    typeof params.error === "string"
      ? params.error
      : typeof params.message === "string"
        ? params.message
        : stopReason;
  return createAgentEvent({
    id,
    ...base,
    type: "run.terminal",
    payload: { status: "failed", error },
  });
}

function rawOutput(
  id: string,
  base: { threadId: string; agentId: string; role: "planner" },
  raw: unknown,
): AgentEvent {
  return createAgentEvent({
    id,
    ...base,
    type: "terminal.output",
    payload: { source: "acp", raw },
  });
}

function readContentText(content: unknown): string | undefined {
  if (!isRecord(content)) return undefined;
  if (content.type === "text" && typeof content.text === "string") return content.text;
  return undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
