import { randomUUID } from "node:crypto";
import { type AgentEvent, createAgentEvent } from "../../shared/src";
import {
  isAcpUnstartedProviderFailure,
  splitAcpProviderExhaustion,
} from "./acp-provider-exhaustion.js";

type JsonRecord = Record<string, unknown>;

export type AcpMappedTool = {
  tool_name: string;
  input: Record<string, unknown>;
};

export type AcpEventMapContext = {
  threadId: string;
  agentId: string;
  sessionRunId: string;
  /** Remember start payloads so tool_call_update completed can emit Eco tool_result. */
  tools?: Map<string, AcpMappedTool>;
  /**
   * Accumulated `agent_message_chunk` text for the current prompt turn.
   * Used so `end_turn` with only a RetriableError envelope becomes `run.terminal` failed.
   */
  agentMessageText?: { value: string };
  /** Whether this prompt turn produced tools or thinking before it failed. */
  turnProgress?: { tools: boolean; thoughts: boolean };
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
    return [mapStopReason(id, base, params.stopReason, params, ctx)];
  }

  const update = isRecord(params.update) ? params.update : undefined;
  const kind =
    update && typeof update.sessionUpdate === "string" ? update.sessionUpdate : undefined;

  // Eco already persisted the user prompt; load replay also emits these.
  if (kind === "user_message_chunk" || kind === "available_commands_update") {
    return [];
  }

  if (kind === "session_info_update") {
    const title = typeof update?.title === "string" ? update.title.trim() : "";
    return title
      ? [
          createAgentEvent({
            id,
            ...base,
            type: "session.title",
            payload: { title },
          }),
        ]
      : [];
  }

  if (kind === "agent_message_chunk") {
    const text = readContentText(update?.content);
    if (!text) {
      return [];
    }
    if (ctx.agentMessageText) {
      ctx.agentMessageText.value = `${ctx.agentMessageText.value}${text}`;
    }
    return [
      createAgentEvent({
        id,
        ...base,
        type: "message.delta",
        payload: ecoStreamPayload({ text, raw: params, messageId: readMessageId(update) }),
      }),
    ];
  }

  if (kind === "agent_thought_chunk") {
    const text = readContentText(update?.content);
    if (text && ctx.turnProgress) {
      ctx.turnProgress.thoughts = true;
    }
    return text
      ? [
          createAgentEvent({
            id,
            ...base,
            type: "message.delta",
            payload: ecoStreamPayload({
              text,
              raw: params,
              blockKind: "thinking",
              messageId: readMessageId(update),
            }),
          }),
        ]
      : [];
  }

  if (kind === "tool_call") {
    const toolCallId = typeof update?.toolCallId === "string" ? update.toolCallId : undefined;
    const mapped = mapAcpToolStart(update);
    if (toolCallId && ctx.tools) {
      ctx.tools.set(toolCallId, mapped);
    }
    if (ctx.turnProgress) {
      ctx.turnProgress.tools = true;
    }
    return [
      createAgentEvent({
        id,
        ...base,
        type: "tool.started",
        payload: {
          type: "tool_use",
          tool_name: mapped.tool_name,
          ...(toolCallId && { tool_use_id: toolCallId }),
          input: mapped.input,
          raw: params,
        },
      }),
    ];
  }

  if (kind === "tool_call_update") {
    const status = typeof update?.status === "string" ? update.status : undefined;
    if (status === "in_progress" || status === "pending") {
      return [];
    }
    const toolCallId = typeof update?.toolCallId === "string" ? update.toolCallId : undefined;
    const started = toolCallId ? ctx.tools?.get(toolCallId) : undefined;
    const tool_name = started?.tool_name ?? mapAcpToolName(update);
    const input = started?.input ?? resolveAcpToolInput(update);
    const failed = status === "failed";
    return [
      createAgentEvent({
        id,
        ...base,
        type: failed ? "tool.failed" : "tool.completed",
        payload: failed
          ? {
              type: "tool_result_error",
              tool_name,
              ...(toolCallId && { tool_use_id: toolCallId }),
              input,
              content: update?.content ?? update?.rawOutput,
              raw: params,
            }
          : {
              type: "tool_result",
              tool_name,
              ...(toolCallId && { tool_use_id: toolCallId }),
              input,
              content: update?.content ?? update?.rawOutput,
              raw: params,
            },
      }),
    ];
  }

  if (kind === "current_mode_update") {
    const modeId =
      typeof update?.currentModeId === "string" ? update.currentModeId.trim() : "";
    return modeId
      ? [
          createAgentEvent({
            id,
            ...base,
            type: "terminal.output",
            payload: {
              source: "acp",
              liveType: "acp.current_mode_update",
              currentModeId: modeId,
              raw: params,
            },
          }),
        ]
      : [];
  }

  if (kind === "plan") {
    const entries = Array.isArray(update?.entries) ? update.entries : [];
    return [
      createAgentEvent({
        id,
        ...base,
        type: "todo.updated",
        payload: {
          source: "acp",
          liveType: "acp.plan",
          entries,
          raw: params,
        },
      }),
    ];
  }

  return [rawOutput(id, base, params)];
}

function resetAcpTurnAccumulators(ctx: AcpEventMapContext): void {
  if (ctx.agentMessageText) {
    ctx.agentMessageText.value = "";
  }
  if (ctx.turnProgress) {
    ctx.turnProgress.tools = false;
    ctx.turnProgress.thoughts = false;
  }
}

function acpUnstartedFromContext(ctx: AcpEventMapContext, agentText = ""): boolean {
  return isAcpUnstartedProviderFailure({
    agentText,
    sawTool: Boolean(ctx.turnProgress?.tools),
    sawThought: Boolean(ctx.turnProgress?.thoughts),
  });
}

function mapStopReason(
  id: string,
  base: { threadId: string; agentId: string; role: "planner" },
  stopReason: string,
  params: JsonRecord,
  ctx: AcpEventMapContext,
): AgentEvent {
  if (stopReason === "end_turn" || stopReason === "max_tokens" || stopReason === "max_turn_requests") {
    const agentText = ctx.agentMessageText?.value?.trim() ?? "";
    if (stopReason === "end_turn") {
      const split = splitAcpProviderExhaustion(agentText);
      if (split) {
        const unstarted = isAcpUnstartedProviderFailure({
          agentText: split.body || split.envelope,
          sawTool: Boolean(ctx.turnProgress?.tools),
          sawThought: Boolean(ctx.turnProgress?.thoughts),
        });
        resetAcpTurnAccumulators(ctx);
        return createAgentEvent({
          id,
          ...base,
          type: "run.terminal",
          payload: { status: "failed", error: split.envelope, ...(unstarted ? { unstarted: true } : {}) },
        });
      }
    }
    resetAcpTurnAccumulators(ctx);
    return createAgentEvent({
      id,
      ...base,
      type: "run.terminal",
      payload: { status: "completed" },
    });
  }
  const unstarted = acpUnstartedFromContext(ctx, ctx.agentMessageText?.value ?? "");
  resetAcpTurnAccumulators(ctx);
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
    payload: { status: "failed", error, ...(unstarted ? { unstarted: true } : {}) },
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

function mapAcpToolStart(update: JsonRecord | undefined): AcpMappedTool {
  return {
    tool_name: mapAcpToolName(update),
    input: resolveAcpToolInput(update),
  };
}

/**
 * Cursor ACP kinds observed at runtime: execute / search / read.
 * Titles: command preview, "grep", "Find", "Read File".
 */
function mapAcpToolName(update: JsonRecord | undefined): string {
  const kind = typeof update?.kind === "string" ? update.kind.trim().toLowerCase() : "";
  const title = typeof update?.title === "string" ? update.title.trim() : "";
  const titleKey = title.toLowerCase();
  if (kind === "execute") {
    return "Bash";
  }
  if (kind === "read" || titleKey === "read file" || titleKey === "read") {
    return "Read";
  }
  if (titleKey === "grep") {
    return "Grep";
  }
  if (titleKey === "find" || titleKey === "glob") {
    return "Glob";
  }
  if (kind === "search") {
    return "Grep";
  }
  if (kind === "edit") {
    return "Edit";
  }
  if (titleKey === "agent" || titleKey === "task") {
    return "Agent";
  }
  if (kind === "other" || kind === "fetch") {
    return title || (kind === "fetch" ? "Fetch" : "MCP");
  }
  if (title && !title.startsWith("`") && title.length <= 80) {
    return title;
  }
  return kind ? kind[0]!.toUpperCase() + kind.slice(1) : "Tool";
}

function resolveAcpToolInput(update: JsonRecord | undefined): Record<string, unknown> {
  const raw = isRecord(update?.rawInput) ? { ...update.rawInput } : {};
  const pathFromLocations = readFirstLocationPath(update?.locations);
  if (pathFromLocations && typeof raw.path !== "string" && typeof raw.file_path !== "string") {
    raw.file_path = pathFromLocations;
    raw.path = pathFromLocations;
  }
  return raw;
}

function readFirstLocationPath(locations: unknown): string | undefined {
  if (!Array.isArray(locations)) {
    return undefined;
  }
  for (const entry of locations) {
    if (!isRecord(entry)) {
      continue;
    }
    if (typeof entry.path === "string" && entry.path.trim()) {
      return entry.path.trim();
    }
    if (typeof entry.file_path === "string" && entry.file_path.trim()) {
      return entry.file_path.trim();
    }
  }
  return undefined;
}

function ecoStreamPayload(input: {
  text: string;
  raw: unknown;
  blockKind?: "thinking";
  messageId?: string;
}): Record<string, unknown> {
  return {
    type: "eco_stream",
    ...(input.blockKind && { blockKind: input.blockKind }),
    text: input.text,
    ...(input.messageId && { messageId: input.messageId }),
    raw: input.raw,
  };
}

function readMessageId(update: JsonRecord | undefined): string | undefined {
  const value = update?.messageId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readContentText(content: unknown): string | undefined {
  if (!isRecord(content)) return undefined;
  if (content.type === "text" && typeof content.text === "string") return content.text;
  return undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
