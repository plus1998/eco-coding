import { type AgentEvent, createAgentEvent, type RuntimeAgentRole } from "../../shared/src";
import { tryParseSerializedAnthropicContentBlocks } from "./anthropic-content-normalize.js";
import { SDK_GENERAL_PURPOSE_AGENT_KEY, SDK_PLAN_AGENT_KEY } from "./subagent-availability.js";
import { normalizeSdkSubagentType } from "./subagent-resume.js";

export type EcoStreamBlockKind = "text" | "thinking" | "tool_use";

/** Mutable state for one SDK query session while partial messages stream. */
export interface SdkStreamContext {
  inToolBlock: boolean;
  activeBlockKind: EcoStreamBlockKind | null;
  currentToolUseId?: string;
  currentToolName?: string;
  currentToolInputJson: string;
  parentToolUseId: string | null;
  activeSubagentRole?: RuntimeAgentRole;
  /** Remembers each subagent's role so interleaved parallel streams keep correct roles. */
  subagentRoleByParentToolUseId: Map<string, RuntimeAgentRole>;
  emittedToolUseIds: Set<string>;
  resolveSubagentAgentId?: (input: {
    role: RuntimeAgentRole;
    parentToolUseId?: string;
    sessionId: string;
  }) => string | undefined;
}

export function createSdkStreamContext(options?: {
  resolveSubagentAgentId?: SdkStreamContext["resolveSubagentAgentId"];
}): SdkStreamContext {
  return {
    inToolBlock: false,
    activeBlockKind: null,
    currentToolInputJson: "",
    parentToolUseId: null,
    subagentRoleByParentToolUseId: new Map(),
    emittedToolUseIds: new Set(),
    ...(options?.resolveSubagentAgentId && { resolveSubagentAgentId: options.resolveSubagentAgentId }),
  };
}

/** Attach subagent agent_id to usage events when desktop attribution resolver is wired. */
export function applySubagentUsageAttribution(
  input: {
    role: RuntimeAgentRole;
    sessionId: string;
    payload: Record<string, unknown>;
    /**
     * parent_tool_use_id carried by the SDK message itself. A string marks subagent usage;
     * null marks main-session usage and must never inherit a stale subagent stream context.
     * Omit only for legacy callers that have no message-level signal.
     */
    messageParentToolUseId?: string | null;
  },
  streamCtx?: SdkStreamContext,
): { agentId: string; payload: Record<string, unknown> } {
  const explicit = input.messageParentToolUseId;
  if (explicit === null) {
    return { agentId: input.sessionId, payload: input.payload };
  }
  const parentToolUseId = explicit ?? streamCtx?.parentToolUseId ?? undefined;
  const attributionRole =
    explicit !== undefined ? input.role : (streamCtx?.activeSubagentRole ?? input.role);
  const subagentAgentId = streamCtx?.resolveSubagentAgentId?.({
    role: attributionRole,
    sessionId: input.sessionId,
    ...(parentToolUseId && { parentToolUseId }),
  });
  if (!subagentAgentId) {
    // Keep parent_tool_use_id on the payload so downstream billing can still attribute the
    // usage to a subagent instance when runtime-side resolution is unavailable or ambiguous.
    return {
      agentId: input.sessionId,
      payload: parentToolUseId
        ? { ...input.payload, parent_tool_use_id: parentToolUseId }
        : input.payload,
    };
  }
  return {
    agentId: subagentAgentId,
    payload: {
      ...input.payload,
      subagentAgentId,
      ...(parentToolUseId && { parent_tool_use_id: parentToolUseId }),
    },
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
      input_complete?: boolean;
      parent_tool_use_id?: string | null;
      subagent_type?: string;
      agent_type?: string;
    };

export function slimStreamEventMessage(message: Record<string, unknown>): Record<string, unknown> {
  const parentToolUseId = typeof message.parent_tool_use_id === "string" ? message.parent_tool_use_id : null;
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

function readMessageSubagentRole(message: Record<string, unknown>): RuntimeAgentRole | undefined {
  const subagentType = typeof message.subagent_type === "string" ? message.subagent_type : undefined;
  const agentType = typeof message.agent_type === "string" ? message.agent_type : undefined;
  const subagentRole = subagentType ? normalizeSdkRuntimeAgentRole(subagentType) : undefined;
  const agentRole = agentType ? normalizeSdkRuntimeAgentRole(agentType) : undefined;
  return subagentRole ?? agentRole;
}

function normalizeSdkRuntimeAgentRole(type: string): RuntimeAgentRole | undefined {
  const trimmed = type.trim();
  if (trimmed === SDK_GENERAL_PURPOSE_AGENT_KEY || trimmed === SDK_PLAN_AGENT_KEY) {
    return trimmed;
  }
  return normalizeSdkSubagentType(trimmed);
}

function effectiveStreamRole(ctx: SdkStreamContext, fallback: RuntimeAgentRole): RuntimeAgentRole {
  return ctx.activeSubagentRole ?? fallback;
}

export function mapStreamEventToEvents(
  message: Record<string, unknown>,
  threadId: string,
  sessionId: string,
  role: RuntimeAgentRole,
  uuid: string,
  ctx: SdkStreamContext,
): AgentEvent[] {
  const parentToolUseId = typeof message.parent_tool_use_id === "string" ? message.parent_tool_use_id : null;
  ctx.parentToolUseId = parentToolUseId;

  const messageRole = readMessageSubagentRole(message);
  if (parentToolUseId) {
    if (messageRole) {
      ctx.subagentRoleByParentToolUseId.set(parentToolUseId, messageRole);
    }
    const resolvedRole = messageRole ?? ctx.subagentRoleByParentToolUseId.get(parentToolUseId);
    if (resolvedRole) {
      ctx.activeSubagentRole = resolvedRole;
    } else {
      delete ctx.activeSubagentRole;
    }
  } else if (messageRole) {
    ctx.activeSubagentRole = messageRole;
  } else {
    // Messages with no subagent marker belong to the main session; clear subagent context
    // so interleaved main-agent output is not attributed to the last streaming subagent.
    delete ctx.activeSubagentRole;
  }
  const streamRole = effectiveStreamRole(ctx, role);

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
      if (typeof block.id === "string") {
        ctx.currentToolUseId = block.id;
      } else {
        delete ctx.currentToolUseId;
      }
      ctx.currentToolInputJson = "";
      if (ctx.currentToolUseId) {
        ctx.emittedToolUseIds.add(ctx.currentToolUseId);
      }
      events.push(
        createToolStartedEvent(threadId, sessionId, streamRole, uuid, {
          type: "tool_use",
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
        createStreamDeltaEvent(threadId, sessionId, streamRole, uuid, {
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
        createStreamDeltaEvent(threadId, sessionId, streamRole, uuid, {
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
      const embedded = tryParseSerializedAnthropicContentBlocks(text);
      if (embedded) {
        for (const [index, block] of embedded.entries()) {
          if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            events.push(
              createStreamDeltaEvent(threadId, sessionId, streamRole, uuid, {
                type: "eco_stream",
                blockKind: "text",
                text: block.text,
                streamFinalize: true,
                ...streamMeta,
              }),
            );
          } else if (
            block.type === "thinking" &&
            typeof block.thinking === "string" &&
            block.thinking.trim()
          ) {
            events.push(
              createStreamDeltaEvent(threadId, sessionId, streamRole, uuid, {
                type: "eco_stream",
                blockKind: "thinking",
                text: block.thinking,
                streamFinalize: true,
                ...streamMeta,
              }),
            );
          } else if (block.type === "tool_use" && typeof block.name === "string") {
            const toolUseId = typeof block.id === "string" ? block.id : undefined;
            if (toolUseId && ctx.emittedToolUseIds.has(toolUseId)) {
              continue;
            }
            if (toolUseId) {
              ctx.emittedToolUseIds.add(toolUseId);
            }
            events.push(
              createToolStartedEvent(threadId, sessionId, streamRole, `${uuid}:embedded:${index}`, {
                type: "tool_use",
                tool_name: block.name,
                ...(toolUseId && { tool_use_id: toolUseId }),
                ...(isRecord(block.input) && { input: block.input }),
                ...streamMeta,
              }),
            );
          }
        }
        return events;
      }
      events.push(
        createStreamDeltaEvent(threadId, sessionId, streamRole, uuid, {
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
        createStreamDeltaEvent(threadId, sessionId, streamRole, uuid, {
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
          createToolStartedEvent(threadId, sessionId, streamRole, uuid, {
            type: "tool_use",
            tool_name: ctx.currentToolName,
            ...(ctx.currentToolUseId && { tool_use_id: ctx.currentToolUseId }),
            ...(parsedInput && { input: parsedInput }),
            streaming: true,
            input_complete: true,
            ...streamMeta,
          }),
        );
      }
    } else if (ctx.activeBlockKind === "thinking") {
      events.push(
        createStreamDeltaEvent(threadId, sessionId, streamRole, uuid, {
          type: "eco_stream",
          blockKind: "thinking",
          streamFinalize: true,
          ...streamMeta,
        }),
      );
    } else if (ctx.activeBlockKind === "text") {
      events.push(
        createStreamDeltaEvent(threadId, sessionId, streamRole, uuid, {
          type: "eco_stream",
          blockKind: "text",
          streamFinalize: true,
          ...streamMeta,
        }),
      );
    }
    ctx.inToolBlock = false;
    ctx.activeBlockKind = null;
    delete ctx.currentToolName;
    delete ctx.currentToolUseId;
    ctx.currentToolInputJson = "";
    return events;
  }

  if (event.type === "message_delta" && isRecord(event.usage)) {
    // A message carrying subagent_type but no parent id is still explicitly subagent usage;
    // only messages with neither marker are main-session usage (null short-circuits).
    const attributed = applySubagentUsageAttribution(
      {
        role: streamRole,
        sessionId,
        payload: { usage: event.usage },
        messageParentToolUseId: parentToolUseId ?? (messageRole ? undefined : null),
      },
      ctx,
    );
    events.push(
      createAgentEvent({
        id: `${uuid}:stream-usage`,
        threadId,
        agentId: attributed.agentId,
        role: streamRole,
        type: "usage.recorded",
        payload: attributed.payload,
      }),
    );
  }

  return events;
}

function createStreamDeltaEvent(
  threadId: string,
  sessionId: string,
  role: RuntimeAgentRole,
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
  role: RuntimeAgentRole,
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
