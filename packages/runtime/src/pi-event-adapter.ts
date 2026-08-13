import { type AgentEvent, createAgentEvent } from "../../shared/src";
import { parsePiUsage } from "./pi-usage.js";

/**
 * Minimal PI session event surface used by Eco's feed adapter.
 * Full union lives in `@earendil-works/pi-coding-agent` AgentSessionEvent.
 */
export type PiSessionEventLike = {
  type: string;
  [key: string]: unknown;
};

/** Mutable per-session adapter state so stream_block_key are ordered and scoped. */
export interface PiEventAdapterState {
  /** Monotonic assistant message generation (bumped on message_start / message_end). */
  messageSeq: number;
  /** last contentIndex for text / thinking within current message (for stable keys). */
  lastTextIndex: number | null;
  lastThinkingIndex: number | null;
  openText: boolean;
  openThinking: boolean;
}

export function createPiEventAdapterState(): PiEventAdapterState {
  return {
    messageSeq: 0,
    lastTextIndex: null,
    lastThinkingIndex: null,
    openText: false,
    openThinking: false,
  };
}

export interface PiEventAdapterContext {
  threadId: string;
  sessionId: string;
  /** Monotonic counter for stable event ids within a turn. */
  nextSeq: () => number;
  /** Required for stream-key isolation across multi-message agent loops. */
  state: PiEventAdapterState;
  /**
   * Eco feed agentId. Parent sessions use the PI session UUID; subagents use their
   * instance id (must NOT equal the parent session UUID).
   */
  agentId?: string;
  /** Eco feed role. Parent = planner; subagents use their orchestration agentKey. */
  role?: string;
}

/**
 * Map Pi agent/session events → Eco `AgentEvent` stream for feed + billing.
 * Unknown events yield an empty array (no silent inventing of feed rows).
 *
 * Ordering / stream isolation rules (v1):
 * - Every assistant message gets a unique stream generation (`messageSeq`).
 * - text / thinking use different stream_block_key and finalize on *_end / message_end / tools.
 * - Never reuse one session-wide key (that merges later turns into earlier narrative).
 */
export function mapPiSessionEventToAgentEvents(
  event: PiSessionEventLike,
  ctx: PiEventAdapterContext,
): AgentEvent[] {
  const seq = ctx.nextSeq();
  // Parent: agentId must equal conversationStore sessionId (PI session UUID).
  // Subagent: agentId is the child instance id and role is the orchestration agentKey.
  const base = {
    threadId: ctx.threadId,
    agentId: ctx.agentId?.trim() || ctx.sessionId,
    role: ctx.role?.trim() || "planner",
  };
  const state = ctx.state;

  switch (event.type) {
    case "agent_start":
      return [
        createAgentEvent({
          id: `${ctx.threadId}:pi:${seq}:agent_start`,
          ...base,
          type: "agent.started",
          payload: { source: "pi", sessionId: ctx.sessionId },
        }),
      ];

    case "message_start": {
      // Only assistant model messages open a new stream generation.
      // Tool-result / user app messages must not burn messageSeq or reset mid-stream state.
      if (isAssistantMessage(event.message) || event.message === undefined) {
        // message may be partial on start; PI partials are assistant-shaped when present.
        const role =
          isRecord(event.message) && typeof event.message.role === "string"
            ? event.message.role
            : "assistant";
        if (role === "assistant") {
          beginMessage(state);
        }
      }
      return [];
    }

    case "agent_end": {
      // agent_end is loop-boundary only — may retry / continue. Do NOT emit run completion.
      const events: AgentEvent[] = [
        ...closeOpenStreams(ctx, seq, "agent_end"),
        createAgentEvent({
          id: `${ctx.threadId}:pi:${seq}:agent_end`,
          ...base,
          type: "agent.loop_ended",
          payload: {
            source: "pi",
            sessionId: ctx.sessionId,
            willRetry: event.willRetry === true,
          },
        }),
      ];
      const messages = Array.isArray(event.messages) ? event.messages : [];
      for (const message of messages) {
        const usageEvent = usageEventFromAssistantMessage(message, ctx, seq);
        if (usageEvent) {
          events.push(usageEvent);
        }
      }
      return events;
    }

    case "agent_settled": {
      // True settle — no automatic retry/compaction/queued continuation remains.
      // run.terminal is emitted by the session prompt loop after settle (single observable).
      return [
        ...closeOpenStreams(ctx, seq, "agent_settled"),
        createAgentEvent({
          id: `${ctx.threadId}:pi:${seq}:agent_settled`,
          ...base,
          type: "agent.settled",
          payload: { source: "pi", sessionId: ctx.sessionId },
        }),
      ];
    }

    case "message_update": {
      const amEvent = isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : null;
      if (!amEvent) {
        return [];
      }
      const amType = typeof amEvent.type === "string" ? amEvent.type : "";
      const contentIndex = readContentIndex(amEvent);

      if (amType === "text_start") {
        ensureMessageGeneration(state);
        state.lastTextIndex = contentIndex ?? state.lastTextIndex ?? 0;
        state.openText = true;
        return [];
      }
      if (amType === "thinking_start") {
        ensureMessageGeneration(state);
        state.lastThinkingIndex = contentIndex ?? state.lastThinkingIndex ?? 0;
        state.openThinking = true;
        return [];
      }

      if (amType === "text_delta") {
        const delta = typeof amEvent.delta === "string" ? amEvent.delta : "";
        if (!delta) {
          return [];
        }
        ensureMessageGeneration(state);
        if (contentIndex !== null) {
          state.lastTextIndex = contentIndex;
        } else if (state.lastTextIndex === null) {
          state.lastTextIndex = 0;
        }
        state.openText = true;
        return [
          createAgentEvent({
            id: `${ctx.threadId}:pi:${seq}:text_delta`,
            ...base,
            type: "message.delta",
            payload: {
              type: "eco_stream",
              blockKind: "text",
              text: delta,
              stream_block_key: textStreamKey(ctx.sessionId, state),
            },
          }),
        ];
      }

      if (amType === "thinking_delta") {
        const delta = typeof amEvent.delta === "string" ? amEvent.delta : "";
        if (!delta) {
          return [];
        }
        ensureMessageGeneration(state);
        if (contentIndex !== null) {
          state.lastThinkingIndex = contentIndex;
        } else if (state.lastThinkingIndex === null) {
          state.lastThinkingIndex = 0;
        }
        state.openThinking = true;
        // OpenAI/gateway reasoning.summary is wire-mapped to thinking_delta.
        const reasoningDisplay =
          amEvent.reasoningDisplay === "raw" || amEvent.reasoningDisplay === "summary"
            ? amEvent.reasoningDisplay
            : "summary";
        return [
          createAgentEvent({
            id: `${ctx.threadId}:pi:${seq}:thinking_delta`,
            ...base,
            type: "message.delta",
            payload: {
              type: "eco_stream",
              blockKind: "thinking",
              text: delta,
              reasoningDisplay,
              stream_block_key: thinkingStreamKey(ctx.sessionId, state),
            },
          }),
        ];
      }

      if (amType === "text_end") {
        const content = typeof amEvent.content === "string" ? amEvent.content : "";
        ensureMessageGeneration(state);
        if (contentIndex !== null) {
          state.lastTextIndex = contentIndex;
        } else if (state.lastTextIndex === null) {
          state.lastTextIndex = 0;
        }
        const events: AgentEvent[] = [];
        // If no deltas arrived, surface full block once; else finalize accumulated stream.
        if (!state.openText && content) {
          events.push(
            createAgentEvent({
              id: `${ctx.threadId}:pi:${seq}:text_end_body`,
              ...base,
              type: "message.delta",
              payload: {
                type: "eco_stream",
                blockKind: "text",
                text: content,
                stream_block_key: textStreamKey(ctx.sessionId, state),
              },
            }),
          );
        }
        events.push(
          createAgentEvent({
            id: `${ctx.threadId}:pi:${seq}:text_end`,
            ...base,
            type: "message.delta",
            payload: {
              type: "eco_stream",
              blockKind: "text",
              text: "",
              streamFinalize: true,
              stream_block_key: textStreamKey(ctx.sessionId, state),
            },
          }),
        );
        state.openText = false;
        return events;
      }

      if (amType === "thinking_end") {
        const content = typeof amEvent.content === "string" ? amEvent.content : "";
        ensureMessageGeneration(state);
        if (contentIndex !== null) {
          state.lastThinkingIndex = contentIndex;
        } else if (state.lastThinkingIndex === null) {
          state.lastThinkingIndex = 0;
        }
        const reasoningDisplay =
          amEvent.reasoningDisplay === "raw" || amEvent.reasoningDisplay === "summary"
            ? amEvent.reasoningDisplay
            : "summary";
        const events: AgentEvent[] = [];
        if (!state.openThinking && content) {
          events.push(
            createAgentEvent({
              id: `${ctx.threadId}:pi:${seq}:thinking_end_body`,
              ...base,
              type: "message.delta",
              payload: {
                type: "eco_stream",
                blockKind: "thinking",
                text: content,
                reasoningDisplay,
                stream_block_key: thinkingStreamKey(ctx.sessionId, state),
              },
            }),
          );
        }
        events.push(
          createAgentEvent({
            id: `${ctx.threadId}:pi:${seq}:thinking_end`,
            ...base,
            type: "message.delta",
            payload: {
              type: "eco_stream",
              blockKind: "thinking",
              text: "",
              reasoningDisplay,
              streamFinalize: true,
              stream_block_key: thinkingStreamKey(ctx.sessionId, state),
            },
          }),
        );
        state.openThinking = false;
        return events;
      }

      // toolcall_* are handled via tool_execution_* session events; ignore raw LLM toolcall stream noise.
      return [];
    }

    case "message_end": {
      const message = event.message;
      const events: AgentEvent[] = [];
      // Close any open streams first so thinking never bleeds into the next message.
      events.push(...closeOpenStreams(ctx, seq, "message_end"));

      if (isAssistantMessage(message)) {
        const text = extractAssistantText(message);
        // Only inject a full text snapshot when this message never streamed text deltas
        // (avoids re-pushing full body and double-merge into narrative).
        if (text && state.lastTextIndex === null) {
          ensureMessageGeneration(state);
          state.lastTextIndex = 0;
          events.push(
            createAgentEvent({
              id: `${ctx.threadId}:pi:${seq}:message_end_text`,
              ...base,
              type: "message.delta",
              payload: {
                type: "eco_stream",
                blockKind: "text",
                text,
                streamFinalize: true,
                stream_block_key: textStreamKey(ctx.sessionId, state),
              },
            }),
          );
        } else if (text) {
          // Already streamed — finalize only if still open (closeOpenStreams may have done it).
          // No full-text re-emit.
        }

        // Same for thinking blocks that never streamed (non-stream path).
        const thinking = extractAssistantThinking(message);
        if (thinking && state.lastThinkingIndex === null) {
          ensureMessageGeneration(state);
          state.lastThinkingIndex = 0;
          events.push(
            createAgentEvent({
              id: `${ctx.threadId}:pi:${seq}:message_end_thinking`,
              ...base,
              type: "message.delta",
              payload: {
                type: "eco_stream",
                blockKind: "thinking",
                text: thinking,
                reasoningDisplay: "summary",
                streamFinalize: true,
                stream_block_key: thinkingStreamKey(ctx.sessionId, state),
              },
            }),
          );
        }

        const usageEvent = usageEventFromAssistantMessage(message, ctx, seq);
        if (usageEvent) {
          events.push(usageEvent);
        }
      }

      // Close generation so the next message_start / first delta starts a fresh key.
      endMessage(state);
      return events;
    }

    case "tool_execution_start": {
      // Barrier: finalize open narrative streams before tool noise so they cannot merge across tools.
      const barrier = closeOpenStreams(ctx, seq, "tool_start");
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : `tool_${seq}`;
      const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
      const args = isRecord(event.args) ? event.args : {};
      return [
        ...barrier,
        createAgentEvent({
          id: `${ctx.threadId}:pi:${seq}:tool_start:${toolCallId}`,
          ...base,
          type: "tool.started",
          payload: {
            type: "tool_use",
            tool_name: toolName,
            tool_use_id: toolCallId,
            input: args,
            input_complete: true,
          },
        }),
      ];
    }

    case "tool_execution_end": {
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : `tool_${seq}`;
      const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
      const isError = event.isError === true;
      const resultText = formatToolResult(event.result);
      return [
        createAgentEvent({
          id: `${ctx.threadId}:pi:${seq}:tool_end:${toolCallId}`,
          ...base,
          type: isError ? "tool.failed" : "tool.completed",
          payload: {
            type: "tool_result",
            tool_name: toolName,
            tool_use_id: toolCallId,
            content: resultText,
            is_error: isError,
          },
        }),
      ];
    }

    default:
      return [];
  }
}

function beginMessage(state: PiEventAdapterState): void {
  state.messageSeq += 1;
  state.lastTextIndex = null;
  state.lastThinkingIndex = null;
  state.openText = false;
  state.openThinking = false;
}

function endMessage(state: PiEventAdapterState): void {
  state.lastTextIndex = null;
  state.lastThinkingIndex = null;
  state.openText = false;
  state.openThinking = false;
}

/** First streamed content without message_start (defensive). */
function ensureMessageGeneration(state: PiEventAdapterState): void {
  if (state.messageSeq <= 0) {
    beginMessage(state);
  }
}

function textStreamKey(sessionId: string, state: PiEventAdapterState): string {
  const index = state.lastTextIndex ?? 0;
  return `pi-text:${sessionId}:m${state.messageSeq}:c${index}`;
}

function thinkingStreamKey(sessionId: string, state: PiEventAdapterState): string {
  const index = state.lastThinkingIndex ?? 0;
  return `pi-thinking:${sessionId}:m${state.messageSeq}:c${index}`;
}

function closeOpenStreams(
  ctx: PiEventAdapterContext,
  seq: number,
  reason: string,
): AgentEvent[] {
  const state = ctx.state;
  const events: AgentEvent[] = [];
  const base = {
    threadId: ctx.threadId,
    agentId: ctx.sessionId,
    role: "planner" as const,
  };
  if (state.openThinking) {
    events.push(
      createAgentEvent({
        id: `${ctx.threadId}:pi:${seq}:think_close:${reason}`,
        ...base,
        type: "message.delta",
        payload: {
          type: "eco_stream",
          blockKind: "thinking",
          text: "",
          reasoningDisplay: "summary",
          streamFinalize: true,
          stream_block_key: thinkingStreamKey(ctx.sessionId, state),
        },
      }),
    );
    state.openThinking = false;
  }
  if (state.openText) {
    events.push(
      createAgentEvent({
        id: `${ctx.threadId}:pi:${seq}:text_close:${reason}`,
        ...base,
        type: "message.delta",
        payload: {
          type: "eco_stream",
          blockKind: "text",
          text: "",
          streamFinalize: true,
          stream_block_key: textStreamKey(ctx.sessionId, state),
        },
      }),
    );
    state.openText = false;
  }
  return events;
}

function readContentIndex(amEvent: Record<string, unknown>): number | null {
  const value = amEvent.contentIndex ?? amEvent.index;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return null;
}

function usageEventFromAssistantMessage(
  message: unknown,
  ctx: PiEventAdapterContext,
  seq: number,
): AgentEvent | null {
  if (!isAssistantMessage(message)) {
    return null;
  }
  const modelId = typeof message.model === "string" ? message.model : undefined;
  const usage = parsePiUsage(message.usage, modelId);
  if (!usage) {
    return null;
  }
  return createAgentEvent({
    id: `${ctx.threadId}:pi:${seq}:usage`,
    threadId: ctx.threadId,
    agentId: ctx.sessionId,
    role: "planner",
    type: "usage.recorded",
    payload: {
      source: "pi",
      usage: {
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cache_read_input_tokens: usage.cacheReadTokens,
        cache_creation_input_tokens: usage.cacheCreationTokens,
      },
      ...(usage.totalCostUsd !== undefined && { total_cost_usd: usage.totalCostUsd }),
      ...(usage.modelId && { model: usage.modelId }),
    },
  });
}

function isAssistantMessage(value: unknown): value is {
  role: "assistant";
  content?: unknown;
  usage?: unknown;
  model?: string;
} {
  return isRecord(value) && value.role === "assistant";
}

function extractAssistantText(message: { content?: unknown }): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("");
}

function extractAssistantThinking(message: { content?: unknown }): string {
  const content = message.content;
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "thinking" && typeof block.thinking === "string") {
      parts.push(block.thinking);
    }
  }
  return parts.join("");
}

function formatToolResult(result: unknown): string {
  if (result === undefined || result === null) {
    return "";
  }
  if (typeof result === "string") {
    return result;
  }
  if (isRecord(result) && Array.isArray(result.content)) {
    const texts = result.content
      .filter((part): part is { type: string; text?: string } => isRecord(part))
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string);
    if (texts.length > 0) {
      return texts.join("\n");
    }
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
