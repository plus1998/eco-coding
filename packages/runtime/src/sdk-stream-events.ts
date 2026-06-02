import {
  type AgentEvent,
  type AgentRole,
  createAgentEvent,
} from "../../shared/src";

export type EcoStreamBlockKind = "text" | "thinking" | "tool_use";

/** Mutable state for one SDK query session while partial messages stream. */
export interface SdkStreamContext {
  inToolBlock: boolean;
  activeBlockKind: EcoStreamBlockKind | null;
  currentToolUseId?: string;
  currentToolName?: string;
  currentToolInputJson: string;
  parentToolUseId: string | null;
  emittedToolUseIds: Set<string>;
}

export function createSdkStreamContext(): SdkStreamContext {
  return {
    inToolBlock: false,
    activeBlockKind: null,
    currentToolInputJson: "",
    parentToolUseId: null,
    emittedToolUseIds: new Set(),
  };
}

export type EcoStreamPayload =
  | {
      type: "eco_stream";
      blockKind: "text" | "thinking";
      text?: string;
      streamPlaceholder?: boolean;
      streamFinalize?: boolean;
      parent_tool_use_id?: string | null;
      subagent_type?: string;
      agent_type?: string;
    }
  | {
      type: "tool_use";
      tool_name: string;
      tool_use_id?: string;
      input?: Record<string, unknown>;
      streaming?: boolean;
      parent_tool_use_id?: string | null;
      subagent_type?: string;
      agent_type?: string;
    };

export function slimStreamEventMessage(message: Record<string, unknown>): Record<string, unknown> {
  const parentToolUseId =
    typeof message.parent_tool_use_id === "string" ? message.parent_tool_use_id : null;
  const subagentType = typeof message.subagent_type === "string" ? message.subagent_type : undefined;
  const agentType = typeof message.agent_type === "string" ? message.agent_type : undefined;
  const event = isRecord(message.event) ? message.event : null;
  if (!event) {
    return {
      type: "stream_event",
      ...(parentToolUseId && { parent_tool_use_id: parentToolUseId }),
      ...(subagentType && { subagent_type: subagentType }),
      ...(agentType && { agent_type: agentType }),
    };
  }
  return {
    type: "stream_event",
    event: slimRawStreamEvent(event),
    ...(parentToolUseId && { parent_tool_use_id: parentToolUseId }),
    ...(subagentType && { subagent_type: subagentType }),
    ...(agentType && { agent_type: agentType }),
  };
}

function slimRawStreamEvent(event: Record<string, unknown>): Record<string, unknown> {
  const slim: Record<string, unknown> = { type: event.type };
  if (event.type === "content_block_delta" && isRecord(event.delta)) {
    slim.delta = event.delta;
  }
  if (event.type === "content_block_start" && isRecord(event.content_block)) {
    slim.content_block = event.content_block;
  }
  if (event.type === "message_delta" && isRecord(event.usage)) {
    slim.usage = event.usage;
  }
  if (event.type === "message_delta" && event.delta !== undefined) {
    slim.delta = event.delta;
  }
  return slim;
}

export function mapStreamEventToEvents(
  message: Record<string, unknown>,
  threadId: string,
  sessionId: string,
  role: AgentRole,
  uuid: string,
  ctx: SdkStreamContext,
): AgentEvent[] {
  const parentToolUseId =
    typeof message.parent_tool_use_id === "string" ? message.parent_tool_use_id : null;
  if (parentToolUseId) {
    ctx.parentToolUseId = parentToolUseId;
  }

  const subagentType = typeof message.subagent_type === "string" ? message.subagent_type : undefined;
  const agentType = typeof message.agent_type === "string" ? message.agent_type : undefined;
  const event = isRecord(message.event) ? message.event : null;
  if (!event || typeof event.type !== "string") {
    return [];
  }

  const events: AgentEvent[] = [];
  const streamMeta = {
    ...(parentToolUseId && { parent_tool_use_id: parentToolUseId }),
    ...(subagentType && { subagent_type: subagentType }),
    ...(agentType && { agent_type: agentType }),
  };

  if (event.type === "content_block_start" && isRecord(event.content_block)) {
    const block = event.content_block;
    const blockType = block.type;
    if (blockType === "tool_use" && typeof block.name === "string") {
      ctx.inToolBlock = true;
      ctx.activeBlockKind = "tool_use";
      ctx.currentToolName = block.name;
      ctx.currentToolUseId = typeof block.id === "string" ? block.id : undefined;
      ctx.currentToolInputJson = "";
      if (ctx.currentToolUseId) {
        ctx.emittedToolUseIds.add(ctx.currentToolUseId);
      }
      events.push(
        createToolStartedEvent(threadId, sessionId, role, uuid, {
          tool_name: block.name,
          ...(ctx.currentToolUseId && { tool_use_id: ctx.currentToolUseId }),
          streaming: true,
          ...streamMeta,
        }),
      );
      return events;
    }
    if (blockType === "thinking") {
      ctx.inToolBlock = false;
      ctx.activeBlockKind = "thinking";
      events.push(
        createStreamDeltaEvent(threadId, sessionId, role, uuid, {
          type: "eco_stream",
          blockKind: "thinking",
          streamPlaceholder: true,
          ...streamMeta,
        }),
      );
      return events;
    }
    if (blockType === "text") {
      ctx.inToolBlock = false;
      ctx.activeBlockKind = "text";
      events.push(
        createStreamDeltaEvent(threadId, sessionId, role, uuid, {
          type: "eco_stream",
          blockKind: "text",
          streamPlaceholder: true,
          ...streamMeta,
        }),
      );
      return events;
    }
    return events;
  }

  if (event.type === "content_block_delta" && isRecord(event.delta)) {
    const delta = event.delta;
    if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
      ctx.currentToolInputJson += delta.partial_json;
      return events;
    }
    if (ctx.inToolBlock && delta.type === "text_delta") {
      return events;
    }
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      const text = delta.text;
      if (!text) {
        return events;
      }
      events.push(
        createStreamDeltaEvent(threadId, sessionId, role, uuid, {
          type: "eco_stream",
          blockKind: "text",
          text,
          ...streamMeta,
        }),
      );
      return events;
    }
    if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
      const thinking = delta.thinking;
      if (!thinking) {
        return events;
      }
      events.push(
        createStreamDeltaEvent(threadId, sessionId, role, uuid, {
          type: "eco_stream",
          blockKind: "thinking",
          text: thinking,
          ...streamMeta,
        }),
      );
      return events;
    }
    return events;
  }

  if (event.type === "content_block_stop") {
    if (ctx.inToolBlock) {
      const parsedInput = parseToolInputJson(ctx.currentToolInputJson);
      if (ctx.currentToolName) {
        events.push(
          createToolStartedEvent(threadId, sessionId, role, uuid, {
            type: "tool_use",
            tool_name: ctx.currentToolName,
            ...(ctx.currentToolUseId && { tool_use_id: ctx.currentToolUseId }),
            ...(parsedInput && { input: parsedInput }),
            streaming: true,
            ...streamMeta,
          }),
        );
      }
    } else if (ctx.activeBlockKind === "thinking") {
      events.push(
        createStreamDeltaEvent(threadId, sessionId, role, uuid, {
          type: "eco_stream",
          blockKind: "thinking",
          streamFinalize: true,
          ...streamMeta,
        }),
      );
    } else if (ctx.activeBlockKind === "text") {
      events.push(
        createStreamDeltaEvent(threadId, sessionId, role, uuid, {
          type: "eco_stream",
          blockKind: "text",
          streamFinalize: true,
          ...streamMeta,
        }),
      );
    }
    ctx.inToolBlock = false;
    ctx.activeBlockKind = null;
    ctx.currentToolName = undefined;
    ctx.currentToolUseId = undefined;
    ctx.currentToolInputJson = "";
    return events;
  }

  if (event.type === "message_delta" && isRecord(event.usage)) {
    events.push(
      createAgentEvent({
        id: `${uuid}:stream-usage`,
        threadId,
        agentId: sessionId,
        role,
        type: "usage.recorded",
        payload: { usage: event.usage },
      }),
    );
  }

  return events;
}

function createStreamDeltaEvent(
  threadId: string,
  sessionId: string,
  role: AgentRole,
  uuid: string,
  payload: EcoStreamPayload & { type: "eco_stream" },
): AgentEvent {
  return createAgentEvent({
    id: `${uuid}:stream`,
    threadId,
    agentId: sessionId,
    role,
    type: "message.delta",
    payload,
  });
}

function createToolStartedEvent(
  threadId: string,
  sessionId: string,
  role: AgentRole,
  uuid: string,
  payload: EcoStreamPayload & { type: "tool_use" },
): AgentEvent {
  const toolUseId = payload.tool_use_id;
  return createAgentEvent({
    id: `${uuid}:tool:${toolUseId ?? payload.tool_name}`,
    threadId,
    agentId: sessionId,
    role,
    type: "tool.started",
    payload,
  });
}

export function isEcoStreamPayload(payload: unknown): payload is EcoStreamPayload {
  if (!isRecord(payload)) {
    return false;
  }
  if (payload.type === "eco_stream") {
    return payload.blockKind === "text" || payload.blockKind === "thinking";
  }
  if (payload.type === "tool_use") {
    return typeof payload.tool_name === "string";
  }
  return false;
}

export function isEcoStreamPlaceholder(payload: unknown): boolean {
  return isRecord(payload) && payload.type === "eco_stream" && payload.streamPlaceholder === true;
}

export function isEcoStreamFinalize(payload: unknown): boolean {
  return isRecord(payload) && payload.type === "eco_stream" && payload.streamFinalize === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseToolInputJson(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
